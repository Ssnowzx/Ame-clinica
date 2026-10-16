<?php

namespace App\Support\Agenda;

use App\Models\Agendamento;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;

/**
 * Primitiva única de conflito da agenda (§6, design D5): profissional, sala e
 * equipamento sobre intervalos [inicio, fim). Só contam agendamentos OCUPANTES:
 * bloqueios sempre; atendimentos apenas quando o status ocupa horário (D2).
 *
 * Os três eixos de recurso são avaliados por CAPACIDADE (change atendimento-em-grupo):
 * contagem de ocupantes contra um teto do cadastro, com o BLOQUEIO fora da conta — ele
 * é veto absoluto e não divide vaga com ninguém.
 */
class VerificadorDeConflitos
{
    /** Ausência declarada do profissional (ou sala interditada): veto ABSOLUTO, nunca relevado. */
    public const CAUSA_BLOQUEIO = 'bloqueio';

    /** O recurso encheu: é disputa de vaga, e o serviço pode relevá-la quando não é nova (D4). */
    public const CAUSA_CAPACIDADE = 'capacidade';

    /**
     * O INTERVALO já ocupado na agenda do profissional — para a recusa dizer para onde mover.
     *
     * Devolve `['inicio' => 'HH:MM', 'fim' => 'HH:MM']` do primeiro ocupante, ou `null` se a faixa
     * está livre. **Só o intervalo**: a criança que ocupa o horário é de outra família, e o nome
     * dela não tem o que fazer numa mensagem de erro de quem está marcando (LGPD).
     *
     * Nasceu de um beco real: a recusa de uma série listou 48 datas sem dizer o motivo, e nem eu
     * nem outra sessão acertamos a causa sem abrir o banco da clínica. Era a sessão das 08:00 com
     * 40 min esbarrando numa das 08:20.
     *
     * @param  list<int>  $ignorarIds
     * @return array{inicio: string, fim: string}|null
     */
    public function intervaloOcupadoDoProfissional(
        int $profissionalId,
        CarbonInterface $inicio,
        CarbonInterface $fim,
        array $ignorarIds = [],
        string $tipoDoAlvo = 'atendimento',
        bool $movendo = true,
        int $capacidade = 1,
    ): ?array {
        $daAgenda = $this->ocupantes($inicio, $fim, $ignorarIds, $tipoDoAlvo, $movendo)
            ->where('profissional_id', $profissionalId);

        // Com capacidade > 1 o primeiro ocupante NÃO é notícia: só quem fecha o horário é.
        // Dizer "já há uma sessão às 08:20" a quem tem quatro vagas manda mover uma sessão que
        // cabia — a recusa passaria a mentir sobre o motivo.
        if ($this->avaliar($daAgenda, $capacidade) === null) {
            return null;
        }

        $ocupante = $daAgenda->orderBy('inicio')->first(['inicio', 'fim']);

        return $ocupante === null
            ? null
            : ['inicio' => $ocupante->inicio->format('H:i'), 'fim' => $ocupante->fim->format('H:i')];
    }

    /**
     * Os três eixos de RECURSO, todos por CAPACIDADE (change atendimento-em-grupo, D2).
     *
     * A pergunta deixou de ser "existe alguém?" e passou a ser "quantos cabem?". O eixo
     * equipamento já era assim desde a primeira migration da agenda (`quantidade_total`);
     * profissional e sala eram por existência, e a assimetria era histórica, não conceitual.
     * Com capacidade 1 — o default de todo cadastro — o comportamento é idêntico ao anterior.
     *
     * A primitiva continua sem saber de ONDE o número vem: quem lê o cadastro é o serviço, que
     * também memoiza. É o que a mantém testável sem tocar em `profissionais`/`salas`.
     *
     * @return array<string, ConflitoDoEixo> campo => veredito (vazio = sem conflito)
     */
    public function verificar(
        int $profissionalId,
        CarbonInterface $inicio,
        CarbonInterface $fim,
        ?int $salaId = null,
        ?int $equipamentoId = null,
        ?int $quantidadeEquipamento = null,
        array $ignorarIds = [],
        string $tipoDoAlvo = 'atendimento',
        bool $movendo = true,
        int $capacidadeProfissional = 1,
        int $capacidadeSala = 1,
    ): array {
        $conflitos = [];

        $daAgenda = $this->ocupantes($inicio, $fim, $ignorarIds, $tipoDoAlvo, $movendo)
            ->where('profissional_id', $profissionalId);
        $veredito = $this->avaliar($daAgenda, $capacidadeProfissional);
        if ($veredito !== null) {
            $conflitos['profissional_id'] = $veredito->causa === self::CAUSA_BLOQUEIO
                ? new ConflitoDoEixo(self::CAUSA_BLOQUEIO, 'Este horário do profissional está bloqueado.')
                : new ConflitoDoEixo(
                    self::CAUSA_CAPACIDADE,
                    $capacidadeProfissional > 1
                        ? 'O profissional já tem '.$veredito->ocupantes.' atendimentos neste horário (limite '.$capacidadeProfissional.').'
                        : 'Horário ocupado do profissional.',
                );
        }

        if ($salaId !== null) {
            // O eixo da sala herda METADE da assimetria do eixo do profissional, e a metade
            // que fica de fora é decisão de domínio (r1 do gate).
            //
            // HERDA o `$movendo`: uma sala interditada DEPOIS não pode tornar ineditável o
            // atendimento que já estava nela — nem para desmarcá-lo. É o envenenamento que a
            // `desmarque-do-profissional` consertou de um lado e que aqui estava aberto.
            // Continua recusado CRIAR na sala interditada ou MOVER para ela: `$movendo`
            // reconhece a troca de sala como movimento.
            //
            // NÃO herda o `$tipoDoAlvo` (passa `'atendimento'` fixo). Bloqueio de PROFISSIONAL
            // declara a ausência DELE, e agenda de quem não vem não é disputada — por isso ele
            // não precisa do slot livre. Bloqueio de SALA é interdição de um recurso FÍSICO, e
            // as sessões já marcadas nela continuam precisando dela: interditar a sala com
            // sessões dentro segue recusado, como antes desta change.
            $naSala = $this->ocupantes($inicio, $fim, $ignorarIds, 'atendimento', $movendo)
                ->where('sala_id', $salaId);
            $veredito = $this->avaliar($naSala, $capacidadeSala);
            if ($veredito !== null) {
                $conflitos['sala_id'] = $veredito->causa === self::CAUSA_BLOQUEIO
                    ? new ConflitoDoEixo(self::CAUSA_BLOQUEIO, 'Esta sala está bloqueada neste horário.')
                    // sem o NÚMERO, e a assimetria com o eixo do profissional é de propósito
                    // (parecer SEC-AG-03): `atendimentos_simultaneos` já sai em `/agenda/selecao`
                    // para este mesmo público, e `salas.capacidade` não — dizê-lo aqui
                    // publicaria o cadastro da sala a quem não tem `salas.ver`
                    : new ConflitoDoEixo(
                        self::CAUSA_CAPACIDADE,
                        $capacidadeSala > 1 ? 'A sala não tem mais vaga neste horário.' : 'Sala ocupada neste horário.',
                    );
            }
        }

        if ($equipamentoId !== null) {
            $simultaneos = $this->ocupantes($inicio, $fim, $ignorarIds)
                ->where('equipamento_id', $equipamentoId)
                ->count();
            if ($simultaneos >= ($quantidadeEquipamento ?? 1)) {
                $conflitos['equipamento_id'] = new ConflitoDoEixo(
                    self::CAUSA_CAPACIDADE,
                    'Equipamento sem disponibilidade neste horário.',
                );
            }
        }

        return $conflitos;
    }

    /**
     * O recurso está lotado nesta faixa? — e o BLOQUEIO responde antes da contagem.
     *
     * **É aqui que esta change poderia estragar tudo em silêncio.** Escrita como uma contagem
     * só (`count(todos) >= capacidade`), a guarda faria uma capacidade 4 aceitar TRÊS
     * atendimentos por cima de uma folga declarada: o bloqueio viraria "mais um ocupante" e as
     * três vagas restantes ficariam abertas sobre uma ausência. Bloqueio marca AUSÊNCIA — não
     * existe vaga a dividir com ele, qualquer que seja o teto (D3).
     *
     * A capacidade chega aqui já SANEADA nos dois extremos pelo chamador (ver
     * `AgendamentoService::capacidadeDoProfissional`): o piso porque um `0` lotaria o recurso
     * com zero ocupantes e travaria a agenda inteira; o teto porque uma escrita que não passa
     * pela FormRequest — SQL direto na VPS, restauração de backup, um importador futuro —
     * desligaria o eixo em silêncio. `max(1, ...)` aqui é a última linha, para o caso de um
     * chamador novo esquecer o piso; o teto é do chamador porque é ele que conhece o cadastro.
     */
    private function avaliar(Builder $ocupantes, int $capacidade): ?ConflitoDoEixo
    {
        if ((clone $ocupantes)->where('tipo', 'bloqueio')->exists()) {
            return new ConflitoDoEixo(self::CAUSA_BLOQUEIO, '', 0);
        }

        $quantos = (clone $ocupantes)->count();

        return $quantos >= max(1, $capacidade)
            ? new ConflitoDoEixo(self::CAUSA_CAPACIDADE, '', $quantos)
            : null;
    }

    /**
     * O PACIENTE já está ocupado nesta faixa? (change `conflito-do-paciente`)
     *
     * Quarto eixo do conflito, e o único que não é recurso da clínica: a mesma criança em dois
     * atendimentos sobrepostos — profissionais e salas diferentes, nada disputado — passava
     * pelos três eixos de recurso sem tocar em nenhum. Um dos dois atendimentos é fantasma.
     *
     * Devolve FATO, não veredito: quem decide entre recusar, avisar e deixar passar é o
     * `AgendamentoService`, lendo `agenda.conflito_paciente` (§13). A primitiva continua
     * respondendo só "quem ocupa o quê".
     *
     * **Bloqueio sai de graça, e é de propósito:** `tipo = bloqueio` tem `paciente_id` nulo por
     * construção (o `AgendamentoRequest` proíbe o campo), então nunca casa com o `where` abaixo
     * — nem como ocupante, nem como alvo. Por isso a chamada usa os DEFAULTS de `ocupantes()`:
     * a assimetria bloqueio × atendimento que ela implementa não tem efeito aqui. Passar
     * `$tipoDoAlvo`/`$movendo` faria o resultado depender de um caminho que só não quebra por
     * acidente.
     *
     * @param  list<int>  $ignorarIds
     */
    public function pacienteOcupado(
        int $pacienteId,
        CarbonInterface $inicio,
        CarbonInterface $fim,
        array $ignorarIds = [],
    ): bool {
        return $this->ocupantes($inicio, $fim, $ignorarIds)
            ->where('paciente_id', $pacienteId)
            ->exists();
    }

    /**
     * Quem ocupa a faixa — e a resposta depende de QUEM está perguntando (decisão de domínio,
     * change `desmarque-do-profissional`, achado do gate).
     *
     * **Bloqueio marca AUSÊNCIA, não reserva slot.** Ele existe para impedir que alguém marque
     * em cima de um profissional que não vai estar; não para congelar o que já está na agenda.
     * Sem isso a baixa em massa era impossível no caso corriqueiro (uma sessão já atendida de
     * manhã fazia o bloqueio da tarde conflitar e derrubava o lote inteiro) e a operação ainda
     * SE ENVENENAVA: depois de criar o bloqueio, nenhum card daquela janela podia ser editado,
     * e repetir o gesto falhava.
     *
     * Duas metades, e as duas são necessárias:
     * 1. alvo BLOQUEIO ignora ocupante `atendimento` — ele não precisa do slot livre;
     * 2. alvo ATENDIMENTO que NÃO muda de horário ignora ocupante `bloqueio` — um bloqueio que
     *    já estava ali não é conflito NOVO; ele não pode tornar o card ineditável.
     *
     * O que continua valendo, e é o motivo de o bloqueio existir: marcar um agendamento NOVO
     * sobre um bloqueio, ou MOVER um para dentro dele, segue recusado.
     */
    private function ocupantes(
        CarbonInterface $inicio,
        CarbonInterface $fim,
        array $ignorarIds,
        string $tipoDoAlvo = 'atendimento',
        bool $movendo = true,
    ): Builder {
        $ignorarBloqueios = $tipoDoAlvo === 'atendimento' && ! $movendo;
        $ignorarAtendimentos = $tipoDoAlvo === 'bloqueio';

        return Agendamento::query()
            ->when($ignorarBloqueios, fn (Builder $q) => $q->where('tipo', '!=', 'bloqueio'))
            ->when($ignorarAtendimentos, fn (Builder $q) => $q->where('tipo', '=', 'bloqueio'))
            ->where('inicio', '<', $fim)
            ->where('fim', '>', $inicio)
            ->where(function (Builder $query): void {
                $query->where('tipo', 'bloqueio')
                    ->orWhereHas('status', fn (Builder $status) => $status->where('ocupa_horario', true));
            })
            ->when($ignorarIds !== [], fn (Builder $query) => $query->whereKeyNot($ignorarIds));
    }
}
