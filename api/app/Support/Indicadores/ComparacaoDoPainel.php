<?php

namespace App\Support\Indicadores;

use App\Models\Agendamento;
use App\Support\Configuracoes\CatalogoConfiguracoes;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Carbon;

/**
 * O formato COMUM dos painéis (change indicadores-profissionais, D3/D9): o período comparado, o
 * início do histórico da clínica e as regras que transformam número em par `atual`/`anterior`.
 *
 * **Início do histórico** é o DIA do PRIMEIRO atendimento agendado da clínica, lido uma vez por
 * requisição. Existe porque o sistema começou em setembro: maio a agosto zerados pareciam queda, e
 * "−387 novos" vinha da importação. Antes dele, nada foi medido — a série devolve `null` (ausente),
 * nunca zero. A alternativa recusada foi uma configuração "data da virada": mais um campo para a
 * clínica preencher, com o dado já no banco.
 *
 * O cabeçalho leva os dois recortes: `inicio_historico` (o MÊS, que decide a série) e
 * `inicio_historico_dia` (o DIA, que decide a comparação — DQ-10). A comparação só existe quando o
 * período comparado está INTEIRO dentro do histórico (`comparado_de >= inicio_historico_dia`): com o
 * sistema começando em 21/08, "setembro contra agosto" compararia um mês contra dez dias e diria
 * "subiu 200%". Nesse caso TODO `anterior` do painel é `null`, como antes do mês do início.
 *
 * Bloqueio de agenda não conta como início (CR-IND-09): é a grade do profissional, não a clínica
 * operando. Sem agendamento nenhum, o início é nulo e NENHUM mês tem histórico.
 *
 * **A data configurada adia o início** (change inicio-dos-indicadores, D1): o primeiro agendamento
 * sozinho errou por um mês na produção — um agendamento solto de 12/08, com o uso real só em meados
 * de setembro, fez "1–6/10 contra 1–6/09" dizer "3.337% a mais". O início é o MAIS TARDE entre o
 * primeiro agendamento e `indicadores.comparar_a_partir_de`: uma data anterior a ele só criaria meses
 * "com histórico" e zerados. A data nunca passa de hoje (D2), mesmo gravada antes da validação, e é
 * sempre o dia 1º de um mês.
 */
final class ComparacaoDoPainel
{
    private function __construct(
        public readonly PeriodoComparado $periodo,
        public readonly ?string $inicioHistorico,
        public readonly ?string $inicioHistoricoDia,
    ) {}

    /**
     * Lê o início do histórico da clínica. `ORDER BY inicio LIMIT 1` anda o índice
     * `(inicio)` em ordem e PARA no primeiro atendimento (PERF-04); o `MIN(inicio)` com
     * o filtro de `tipo` — coluna fora do índice — lia a tabela inteira.
     */
    public static function para(PeriodoComparado $periodo): self
    {
        $primeiro = Agendamento::query()
            ->where('tipo', 'atendimento')
            ->orderBy('inicio')
            ->toBase()
            ->value('inicio');

        if ($primeiro === null) {
            return new self($periodo, null, null);
        }
        $dia = max(Carbon::parse((string) $primeiro)->toDateString(), self::dataConfigurada($periodo));

        return new self($periodo, substr($dia, 0, 7), $dia);
    }

    /**
     * A data de `indicadores.comparar_a_partir_de`, com teto em hoje e levada ao DIA 1º do mês dela —
     * as séries e o número do mês cortam por mês, e um dia no meio diria "a partir de 10 de setembro"
     * contando desde o dia 1º (gate r1). A escrita já exige o dia 1º; a leitura repete as regras para o
     * valor gravado antes delas. Vazia, ou que não é data de calendário, vira '' e perde todo `max`: o
     * texto `Y-m-d` é comparado como calendário.
     */
    private static function dataConfigurada(PeriodoComparado $periodo): string
    {
        $configurada = (string) app(ConfiguracaoService::class)->get('indicadores.comparar_a_partir_de');

        if (! CatalogoConfiguracoes::dataReal($configurada)) {
            return '';
        }

        return substr(min($configurada, $periodo->hoje()), 0, 8).'01';
    }

    /** O cabeçalho comum de toda resposta de painel (D9). */
    public function cabecalho(): array
    {
        return [
            'periodo' => $this->periodo->paraResposta(),
            'inicio_historico' => $this->inicioHistorico,
            'inicio_historico_dia' => $this->inicioHistoricoDia,
        ];
    }

    /** O mês `YYYY-MM` está dentro do histórico da clínica? */
    public function temHistorico(string $mes): bool
    {
        return $this->inicioHistorico !== null && $mes >= $this->inicioHistorico;
    }

    /**
     * O período comparado está INTEIRO dentro do histórico (começa no dia do início ou depois)?
     * Senão, todo `anterior` é nulo — inclusive quando o comparado só começa uns dias antes do
     * primeiro atendimento (DQ-10). Datas "Y-m-d": a comparação de texto é a de calendário.
     */
    public function comparavel(): bool
    {
        return $this->inicioHistoricoDia !== null
            && $this->periodo->comparadoDe->toDateString() >= $this->inicioHistoricoDia;
    }

    /**
     * O par `{atual, anterior}`. O anterior chega como CALLABLE e só é calculado quando há
     * histórico para ele — a consulta do período sem histórico nem roda.
     *
     * @param  callable(): mixed  $anterior
     * @return array{atual: mixed, anterior: mixed}
     */
    public function par(mixed $atual, callable $anterior): array
    {
        return ['atual' => $atual, 'anterior' => $this->anterior($anterior)];
    }

    /** O valor do período comparado, ou `null` quando ele é anterior ao histórico. */
    public function anterior(callable $calcular): mixed
    {
        return $this->comparavel() ? $calcular() : null;
    }

    /**
     * Porcentagem do contrato (D9): número de 0 a 1 com até 4 casas; `null` sem denominador —
     * nunca zero por divisão. O teto em 1 é o mesmo cinto da produtividade (a marcação fora da
     * grade não estoura a barra; os números ao lado explicam).
     */
    public static function taxa(int|float $numerador, int|float $denominador): ?float
    {
        if ($denominador <= 0) {
            return null;
        }

        return (float) round(max(0, min(1, $numerador / $denominador)), 4);
    }

    /** Dinheiro do contrato (D9): string decimal com duas casas, nunca float. */
    public static function dinheiro(string|int|float|null $valor): string
    {
        return bcadd((string) ($valor ?? '0'), '0', 2);
    }
}
