<?php

namespace App\Support\Indicadores;

use App\Models\Agendamento;
use App\Support\Rbac\Escopo;
use Illuminate\Support\Collection;

/**
 * As sessões de um período, agregadas em UMA consulta (change indicadores-profissionais, D8):
 * profissional × status × dia da semana × faixa do dia × "já passou". Os painéis da agenda e da
 * equipe tiram TODOS os números das linhas daqui — taxa, situação, mapa, por profissional — e a
 * classificação de cada status é feita depois, pelas flags (`ClassificacaoDosStatus`). Assim o
 * custo não cresce com o número de profissionais nem com o de status.
 *
 * "Já passou" é `inicio < agora` na parede da clínica (D4): a BASE de toda porcentagem. As sessões
 * de mais tarde (e as dos dias seguintes, que o período já não alcança) nunca entram nela — o
 * "Em Aberto 2.815" que dominava a agenda eram sessões que ainda iam acontecer.
 *
 * Só `tipo = atendimento`: bloqueio é grade, não sessão. O escopo D11 entra na MESMA consulta,
 * pela coluna dona `agendamentos.profissional_id`.
 */
final class SessoesDoPeriodo
{
    /**
     * A faixa do dia pela hora do início — as MESMAS fronteiras de `CapacidadeDoMes::FAIXAS_DO_DIA`.
     */
    public const FAIXA_SQL = "CASE WHEN HOUR(agendamentos.inicio) < 12 THEN 'manha'
        WHEN HOUR(agendamentos.inicio) < 18 THEN 'tarde' ELSE 'noite' END";

    /**
     * @param  array{0: string, 1: string}  $limites  parede da clínica (`PeriodoComparado::limites()`)
     * @param  string  $agora  "Y-m-d H:i:s" na parede — o corte de "já passou"
     * @param  bool  $comEvolucao  conta também as sessões cuja evolução já foi escrita (painel da equipe)
     * @return Collection<int, object{profissional_id: int, status_id: int|null, dia: int, faixa: string, passou: bool, total: int, com_evolucao: int}>
     */
    public static function agregar(Escopo $escopo, array $limites, string $agora, bool $comEvolucao = false): Collection
    {
        $consulta = $escopo->aplicar(
            Agendamento::query()
                ->where('agendamentos.tipo', 'atendimento')
                ->whereBetween('agendamentos.inicio', $limites),
            'agendamentos.profissional_id',
        );

        $evolucao = '0';
        if ($comEvolucao) {
            // atendimento e evolução são ÚNICOS por agendamento/atendimento: os LEFT JOINs não
            // multiplicam linha.
            $consulta
                ->leftJoin('atendimentos', fn ($join) => $join
                    ->on('atendimentos.agendamento_id', '=', 'agendamentos.id'))
                ->leftJoin('evolucoes', fn ($join) => $join
                    ->on('evolucoes.atendimento_id', '=', 'atendimentos.id'));
            $evolucao = 'SUM(CASE WHEN evolucoes.id IS NULL THEN 0 ELSE 1 END)';
        }

        return $consulta
            // WEEKDAY é 0=segunda…6=domingo; o +1 para ISO fica no PHP. O GROUP BY usa os ALIASES
            // das três expressões: a de "já passou" leva o binding de `agora` uma vez só. As duas
            // colunas vão QUALIFICADAS — no GROUP BY o MySQL procura nome nas tabelas antes dos
            // aliases, e `evolucoes` também tem `profissional_id` (seria ambíguo)
            ->selectRaw(
                'agendamentos.profissional_id as profissional_id, agendamentos.status_id as status_id, '
                .'WEEKDAY(agendamentos.inicio) as dia_zero, '.self::FAIXA_SQL.' as faixa, '
                .'CASE WHEN agendamentos.inicio < ? THEN 1 ELSE 0 END as passou, '
                .'COUNT(*) as total, '.$evolucao.' as com_evolucao',
                [$agora],
            )
            ->groupByRaw('agendamentos.profissional_id, agendamentos.status_id, dia_zero, faixa, passou')
            ->toBase()
            ->get()
            ->map(fn (object $linha): object => (object) [
                'profissional_id' => (int) $linha->profissional_id,
                'status_id' => $linha->status_id === null ? null : (int) $linha->status_id,
                'dia' => (int) $linha->dia_zero + 1,
                'faixa' => (string) $linha->faixa,
                'passou' => (int) $linha->passou === 1,
                'total' => (int) $linha->total,
                'com_evolucao' => (int) $linha->com_evolucao,
            ]);
    }
}
