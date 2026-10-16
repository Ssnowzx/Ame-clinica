<?php

namespace App\Support\Indicadores;

use App\Models\Auditoria;
use App\Models\ListaEspera;
use App\Models\Paciente;
use App\Support\Clinica\PacotesAcabando;
use App\Support\Rbac\Escopo;

/**
 * `GET /api/indicadores/painel/pacientes` (change indicadores-profissionais, D4/D9) — sob
 * `pacientes.ver`. SÓ CONTAGENS: nenhum nome, nenhum id de criança sai daqui (LGPD — menores).
 *
 *  - **ativos:** a base ativa hoje (foto, sem comparação);
 *  - **novos:** cadastrados no período (`created_at` é UTC; o período é da parede da clínica), menos os
 *    da importação da virada (`importado_clinicaagil_em`): eles não são novos para a clínica, e o mês da
 *    importação virava uma "queda" de 85% na comparação (validação local de 05/10);
 *  - **saíram:** pacientes com evento na TRILHA (`auditoria`, `entidade = pacientes`) mudando
 *    `ativo` de verdadeiro para falso no período — cada criança conta UMA vez, mesmo reativada e
 *    inativada de novo. Não há coluna de data de inativação: o dado já existe na trilha, e criar
 *    um segundo registro do mesmo fato seria a chance de os dois discordarem;
 *  - **pacotes no fim:** a regra do bloco "Pacotes acabando" (`PacotesAcabando`), com o MESMO
 *    escopo D11 do eixo agenda que o sino aplica — o número do painel e o do sino são um só;
 *  - **fila de espera:** as entradas da lista de espera (o encaixe apaga a entrada: toda linha é
 *    uma criança esperando).
 *
 * Os dois últimos são de OUTRO módulo (SEC-IND-01): pacotes no fim só com `tratamentos.ver` (a
 * mesma permissão do bloco do sino) e a fila só com `lista_espera.ver`. Sem a permissão, a chave
 * fica AUSENTE — ausência é negação, como nos blocos do sino; um zero diria "nenhum pacote no fim"
 * a quem simplesmente não pode saber.
 */
final class PainelDosPacientes
{
    public function __construct(private readonly PacotesAcabando $pacotesAcabando) {}

    /**
     * @param  Escopo  $escopoDaAgenda  o eixo agenda do D11 — só os pacotes no fim o usam
     * @param  bool  $vePacotes  quem pede tem `tratamentos.ver` (decidido no boundary)
     * @param  bool  $veFila  quem pede tem `lista_espera.ver` (decidido no boundary)
     */
    public function calcular(PeriodoComparado $periodo, Escopo $escopoDaAgenda, bool $vePacotes, bool $veFila): array
    {
        $comparacao = ComparacaoDoPainel::para($periodo);
        $deOutrosModulos = [];
        if ($vePacotes) {
            $deOutrosModulos['pacotes_no_fim'] = $this->pacotesAcabando->consulta($escopoDaAgenda)->count();
        }
        if ($veFila) {
            $deOutrosModulos['fila_de_espera'] = ListaEspera::query()->count();
        }

        return [
            ...$comparacao->cabecalho(),
            'ativos' => Paciente::query()->where('ativo', true)->count(),
            'novos' => $comparacao->par(
                $this->novos($periodo->emUtc($periodo->limites())),
                fn (): int => $this->novos($periodo->emUtc($periodo->limitesComparados())),
            ),
            'sairam' => $comparacao->par(
                $this->sairam($periodo->emUtc($periodo->limites())),
                fn (): int => $this->sairam($periodo->emUtc($periodo->limitesComparados())),
            ),
            ...$deOutrosModulos,
            'serie_novos' => $this->serieDeNovos($comparacao),
        ];
    }

    /** @param  array{0: string, 1: string}  $limitesUtc */
    private function novos(array $limitesUtc): int
    {
        return Paciente::query()->whereNull('importado_clinicaagil_em')->whereBetween('created_at', $limitesUtc)->count();
    }

    /**
     * As crianças DISTINTAS que passaram de ativas a inativas no período. O valor gravado no diff
     * varia com quem escreveu — o `antes` vem com cast (`true`), o `depois` vem como chegou
     * (`false`, `0` ou `"0"`) —, e por isso a comparação é pelo texto do valor, nas duas formas.
     *
     * @param  array{0: string, 1: string}  $limitesUtc
     */
    private function sairam(array $limitesUtc): int
    {
        return (int) Auditoria::query()
            ->where('entidade', 'pacientes')
            ->where('acao', 'atualizou')
            ->whereBetween('criado_em', $limitesUtc)
            ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(diff_json, '$.antes.ativo')) IN ('true', '1')")
            ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(diff_json, '$.depois.ativo')) IN ('false', '0')")
            ->distinct()
            ->count('entidade_id');
    }

    /**
     * Os 6 meses de cadastros novos terminando no mês pedido, cada mês na PAREDE da clínica; antes
     * do histórico, `null` — a importação da virada não vira "queda" (D3).
     *
     * @return list<array{mes: string, quantidade: int|null}>
     */
    private function serieDeNovos(ComparacaoDoPainel $comparacao): array
    {
        $periodo = $comparacao->periodo;
        $meses = $periodo->mesesDaSerie();
        $limites = $periodo->emUtc([
            $meses[0].'-01 00:00:00',
            $periodo->de->endOfMonth()->format('Y-m-d').' 23:59:59',
        ]);
        $deslocamento = $periodo->agora->format('P');

        $porMes = Paciente::query()
            ->whereNull('importado_clinicaagil_em')
            ->whereBetween('created_at', $limites)
            ->toBase()
            ->selectRaw('DATE_FORMAT(CONVERT_TZ(created_at, ?, ?), ?) as mes, COUNT(*) as total', ['+00:00', $deslocamento, '%Y-%m'])
            ->groupBy('mes')
            ->pluck('total', 'mes');

        return array_map(fn (string $mes): array => [
            'mes' => $mes,
            'quantidade' => $comparacao->temHistorico($mes) ? (int) ($porMes[$mes] ?? 0) : null,
        ], $meses);
    }
}
