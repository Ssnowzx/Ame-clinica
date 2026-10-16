<?php

namespace App\Support\Indicadores;

use App\Models\Agendamento;
use App\Models\Feriado;
use App\Models\Profissional;
use App\Support\Rbac\Escopo;
use Illuminate\Support\Collection;

/**
 * A GRADE dos profissionais ativos num intervalo de dias — o denominador da ocupação dos painéis
 * (change indicadores-profissionais, D4/D8), na mesma régua da produtividade: janelas reais por dia
 * da semana, menos feriados ativos e bloqueios (`CapacidadeDoMes`), vezes a simultaneidade
 * (atendimento em grupo), em SESSÕES pela duração da especialidade principal.
 *
 * Carrega tudo de uma vez — profissionais, especialidades, horários, feriados e bloqueios: cinco
 * consultas, independentemente do número de profissionais. A conta por período fica em PHP, como
 * na produtividade: é calendário.
 *
 * "Tem grade" é ter HORÁRIO CADASTRADO e uma DURAÇÃO de referência (a especialidade principal com
 * `tempo_sessao` > 0) — a pendência que a Equipe lista. Faltando qualquer um dos dois, a grade não
 * se converte em sessões: a capacidade é zero, a ocupação do profissional fica nula (nunca 0%) e
 * ele não entra no "N de M com grade" (CR-IND-14). Contar só o horário punha no denominador da
 * frase quem não tem denominador nenhum.
 */
final class GradeDoPeriodo
{
    /**
     * @param  Collection<int, Profissional>  $profissionais
     * @param  list<array{data: string, recorrente: bool}>  $feriados
     * @param  Collection<int, list<array{inicio: string, fim: string}>>  $bloqueios
     */
    private function __construct(
        private readonly Collection $profissionais,
        private readonly array $feriados,
        private readonly Collection $bloqueios,
    ) {}

    /**
     * @param  Escopo  $escopo  D11 na coluna DONA (`id`): plano lista todos os ativos, `de(id)` só
     *                          o próprio, `nenhum` ninguém
     * @param  string  $primeiroDia  "Y-m-d" — o começo da janela que os bloqueios precisam cobrir
     * @param  string  $ultimoDia  "Y-m-d"
     */
    public static function carregar(Escopo $escopo, string $primeiroDia, string $ultimoDia): self
    {
        $profissionais = $escopo->aplicar(
            Profissional::query()
                ->where('ativo', true)
                ->with(['especialidades:id,nome,tempo_sessao', 'horarios']),
            'id',
        )
            ->orderBy('nome')
            // `atendimentos_simultaneos` é o MULTIPLICADOR da capacidade (atendimento-em-grupo):
            // fora da lista de colunas, o modelo devolveria o default 1 em silêncio
            ->get(['id', 'nome', 'atendimentos_simultaneos'])
            ->keyBy('id');

        $feriados = Feriado::query()
            ->where('ativo', true)
            ->get(['data', 'recorrente'])
            ->map(fn (Feriado $feriado): array => [
                'data' => $feriado->data->toDateString(),
                'recorrente' => (bool) $feriado->recorrente,
            ])
            ->all();

        // por SOBREPOSIÇÃO, como na produtividade: o bloqueio que começa antes e invade a janela conta.
        // O limite INFERIOR é o `fim` (PERF-05): bloqueio não tem duração máxima (férias de vários dias),
        // então um piso no `inicio` perderia o que começou antes. O índice
        // `(tipo, profissional_id, fim)` torna esse piso uma faixa — sem ele, a consulta lia o
        // histórico inteiro da agenda para achar os bloqueios do período
        $bloqueios = $profissionais->isEmpty() ? collect() : Agendamento::query()
            ->where('tipo', 'bloqueio')
            ->whereIn('profissional_id', $profissionais->keys())
            ->where('inicio', '<=', $ultimoDia.' 23:59:59')
            ->where('fim', '>=', $primeiroDia.' 00:00:00')
            ->get(['profissional_id', 'inicio', 'fim'])
            ->groupBy('profissional_id')
            ->map(fn (Collection $doProfissional): array => $doProfissional
                ->map(fn (Agendamento $bloqueio): array => [
                    'inicio' => $bloqueio->inicio->format('Y-m-d H:i:s'),
                    'fim' => $bloqueio->fim->format('Y-m-d H:i:s'),
                ])
                ->values()
                ->all());

        return new self($profissionais, $feriados, $bloqueios);
    }

    /** @return Collection<int, Profissional> os ativos do escopo, por id, em ordem de nome */
    public function profissionais(): Collection
    {
        return $this->profissionais;
    }

    public function temGrade(Profissional $profissional): bool
    {
        return $profissional->horarios->isNotEmpty() && $this->duracao($profissional) > 0;
    }

    /**
     * A capacidade do profissional, em SESSÕES (fracionárias — quem arredonda é quem mostra), por
     * dia da semana × faixa do dia, nos dias `$de`..`$ate`.
     *
     * @return array<int, array<string, float>>
     */
    public function capacidade(Profissional $profissional, string $de, string $ate): array
    {
        $duracao = $this->duracao($profissional);
        $minutos = CapacidadeDoMes::porFaixaDoDia(
            $de,
            $ate,
            $profissional->mapaDeHorarios(),
            $this->feriados,
            $this->bloqueios->get($profissional->id, []),
        );

        if ($duracao <= 0) {
            return array_map(fn (array $faixas): array => array_map(fn (): float => 0.0, $faixas), $minutos);
        }

        $simultaneos = max(1, (int) ($profissional->atendimentos_simultaneos ?? 1));

        return array_map(
            fn (array $faixas): array => array_map(fn (int $min): float => $min * $simultaneos / $duracao, $faixas),
            $minutos,
        );
    }

    /**
     * A capacidade TOTAL de um mapa dia × faixa, ainda fracionária — o denominador de toda taxa de
     * ocupação (change painel-do-profissional, gate r1, B2). Arredondar fica para quem MOSTRA uma
     * célula: arredondar antes de somar (o painel da agenda) ou o total (o da equipe) dava dois
     * percentuais para as mesmas marcadas.
     *
     * @param  array<int, array<string, float>>  $porFaixa  `capacidade()`, ou a soma de várias
     */
    public static function capacidadeTotal(array $porFaixa): float
    {
        return (float) array_sum(array_map('array_sum', $porFaixa));
    }

    /** A duração de referência da sessão, em minutos: a da especialidade principal (0 sem ela). */
    private function duracao(Profissional $profissional): int
    {
        return (int) ($profissional->especialidades->first()?->tempo_sessao ?? 0);
    }
}
