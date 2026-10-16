<?php

namespace App\Support\Ciclos;

use App\Models\Convenio;
use App\Models\FechamentoCiclo;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * O ponto de SERIALIZAÇÃO do ciclo de faturamento e as invariantes do fechamento (D8).
 *
 * ## Por que o lock é na linha do CONVÊNIO (SEC-FC-10 — leia antes de escrever a guarda)
 *
 * Travar a linha do registro que está sendo editado (atendimento, lançamento) serializa
 * edição-vs-edição, **não** edição-vs-fechamento: são tabelas diferentes, e sob REPEATABLE
 * READ a transação de edição não enxerga o fechamento comitado por outra sessão depois de
 * ela ter começado. O resultado seria uma gravação dentro de um ciclo que já estava
 * fechado — o TOCTOU exato que esta change existe para fechar.
 *
 * O único ponto que as duas famílias de transação têm em comum é a linha do **convênio**.
 * Por isso ela é travada aqui (fechar/reabrir) E deve ser travada pelo caminho de escrita
 * assim que ele resolve o convênio do registro.
 *
 * ## Contrato para os caminhos de escrita (tasks 3.x) — obrigatório
 *
 * Use ESTE método (`comLockDoConvenio`), não um `lockForUpdate` próprio: um segundo
 * call-site com a mesma intenção é como as duas metades de uma invariante divergem.
 *
 * **Posição na ordem de locks da casa (SEC-FC-12).** A ordem existente é
 * `agendamentos → atendimentos → tratamentos`; o convênio entra **DEPOIS de todas**, e
 * `fechamentos_ciclo` depois dele:
 *
 *     agendamentos → atendimentos → tratamentos → convenios → fechamentos_ciclo
 *
 * Não é arbitrário: o convênio só é *alcançável* através do tratamento
 * (`agendamento → tratamento → convenio`), então travá-lo antes exigiria descobrir o id
 * por um caminho paralelo. Ordem divergente entre os quatro caminhos é deadlock em
 * produção, não hipótese — se um caminho novo precisar do convênio antes do tratamento,
 * isso é ADR, não improviso local.
 *
 * ## O que NÃO mora aqui
 *
 * A decisão "este registro está em período fechado?" é da `GuardaDeCicloFechado` (D3,
 * task 3.1) — fonte única consumida pelos três boundaries. Esta classe fecha, reabre e
 * empresta o lock.
 */
final class FechamentoDeCiclo
{
    /**
     * Roda `$fn` dentro de uma transação que segura o lock da linha do convênio.
     *
     * O convênio é relido DO BANCO sob o lock e passado ao callback: qualquer decisão
     * tomada sobre o calendário (SEC-FC-18) ou sobre os fechamentos existentes
     * (SEC-FC-11) enxerga o estado serializado, não o que o chamador leu antes.
     *
     * Convênio inexistente → 404 pelo `firstOrFail`, antes de qualquer regra de ciclo.
     *
     * @template T
     *
     * @param  Closure(Convenio): T  $fn
     * @return T
     */
    public static function comLockDoConvenio(int $convenioId, Closure $fn): mixed
    {
        return DB::transaction(function () use ($convenioId, $fn) {
            $convenio = Convenio::whereKey($convenioId)->lockForUpdate()->firstOrFail();

            return $fn($convenio);
        });
    }

    /**
     * Fecha o período. **Precondição: já estar sob `comLockDoConvenio`** — a
     * não-sobreposição é verificada aqui e só vale dentro daquela transação (o índice
     * único pega o mesmo INÍCIO, jamais uma interseção parcial).
     */
    public static function fechar(Convenio $convenio, string $inicio, string $fim, int $usuarioId): FechamentoCiclo
    {
        if (! CalendarioDoCiclo::doConvenio($convenio)) {
            throw ValidationException::withMessages([
                'convenio_id' => 'Este convênio não tem calendário de ciclo configurado — não há período a fechar.',
            ]);
        }

        if (! CalendarioDoCiclo::ehJanelaDerivavel(
            $convenio->ciclo_tipo_corte,
            $convenio->ciclo_dia_corte,
            $inicio,
            $fim
        )) {
            throw ValidationException::withMessages([
                'periodo_inicio' => 'O período informado não corresponde a um ciclo do calendário deste convênio.',
            ]);
        }

        // interseção com QUALQUER período ainda aberto do mesmo convênio; linhas
        // reabertas ficam de fora — elas são histórico, não congelamento.
        // `lockForUpdate` não é redundante com o lock do convênio: sob REPEATABLE READ
        // um SELECT comum lê o snapshot da transação e ficaria cego a um fechamento
        // comitado por outra sessão enquanto esperávamos no lock. Hoje esta é a 1ª
        // leitura depois do lock (o read view ainda não fixou), então o SELECT comum
        // acertaria — mas por acidente de ordenação: qualquer leitura inserida antes
        // daqui reabriria a corrida em silêncio. É a mesma lição da guarda de escrita.
        $sobrepoe = self::abertosDoConvenio($convenio->id)
            ->where('periodo_inicio', '<=', $fim)
            ->where('periodo_fim', '>=', $inicio)
            ->lockForUpdate()
            ->exists();

        if ($sobrepoe) {
            throw ValidationException::withMessages([
                'periodo_inicio' => 'Este período se sobrepõe a um ciclo já fechado deste convênio.',
            ]);
        }

        $fechamento = new FechamentoCiclo;
        $fechamento->convenio_id = $convenio->id;
        $fechamento->periodo_inicio = $inicio;
        $fechamento->periodo_fim = $fim;
        $fechamento->fechado_por = $usuarioId;
        $fechamento->fechado_em = now();
        $fechamento->save();

        return $fechamento;
    }

    /**
     * Existe congelamento vivo neste convênio? É o que impede `convenios.editar` de
     * virar chave-mestra pelo cadastro (SEC-FC-18).
     */
    public static function temFechamentoAberto(int $convenioId): bool
    {
        return self::abertosDoConvenio($convenioId)->exists();
    }

    /**
     * SEC-FC-18 — o fail-safe do "sem calendário, sem ciclo" vale para o convênio que
     * NUNCA teve ciclo; ele MUST NOT valer retroativamente. Alterar ou apagar o
     * calendário com fechamento ABERTO destravaria toda a produção congelada sem
     * `ciclos.reabrir`, sem motivo digitado e sem trilha de reabertura — a mesma
     * escalada, por uma porta que nem se anuncia como tal.
     *
     * Recusa só quando o calendário MUDA de fato: salvar o convênio com o mesmo
     * calendário (o que a tela faz a cada edição de nome) segue livre.
     *
     * @param  array<string, mixed>  $validado  payload já validado (chaves ausentes = não muda)
     */
    public static function assegurarCalendarioMutavel(Convenio $convenio, array $validado): void
    {
        $tipoFinal = array_key_exists('ciclo_tipo_corte', $validado)
            ? $validado['ciclo_tipo_corte']
            : $convenio->ciclo_tipo_corte;
        $diaFinal = array_key_exists('ciclo_dia_corte', $validado)
            ? $validado['ciclo_dia_corte']
            : $convenio->ciclo_dia_corte;

        $mudou = $tipoFinal !== $convenio->ciclo_tipo_corte
            || (int) $diaFinal !== (int) $convenio->ciclo_dia_corte;

        if (! $mudou || ! self::temFechamentoAberto($convenio->id)) {
            return;
        }

        throw ValidationException::withMessages([
            'ciclo_tipo_corte' => 'Este convênio tem ciclo fechado em aberto: o calendário só muda '
                .'depois que o administrador reabrir os períodos fechados.',
        ]);
    }

    /** Fechamentos ainda vigentes (não reabertos) do convênio. */
    private static function abertosDoConvenio(int $convenioId): Builder
    {
        return FechamentoCiclo::query()
            ->where('convenio_id', $convenioId)
            ->whereNull('reaberto_em');
    }
}
