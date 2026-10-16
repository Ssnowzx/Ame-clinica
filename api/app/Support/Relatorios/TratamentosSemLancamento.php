<?php

namespace App\Support\Relatorios;

use App\Models\Tratamento;
use App\Support\Rbac\Escopo;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\Auth;

/**
 * Relatório `tratamentos-sem-lancamento` (change `area-de-relatorios`, task 2.7): os pacotes
 * ABERTOS no período que ainda não têm NENHUMA RECEITA de caixa amarrada — a lista de quem a
 * clínica esqueceu de cobrar. Cobre, no ClinicaÁgil, "Tratamentos sem Lançamento".
 *
 * O vínculo é `lancamentos_caixa.tratamento_id`: gravado pelo faturamento
 * (`FaturamentoService`) e, desde a change `recebido-por-profissional`, também pelo lançamento
 * MANUAL que alguém liga ao pacote (o pacote pago adiantado). Só RECEITA tira o pacote da
 * lista (SEC-RPP-02): uma despesa de R$ 0,01 amarrada ao pacote desligava a lista de quem não
 * foi cobrado. Uma receita simbólica ainda desliga — é o gatilho `SEM-LANCAMENTO-RECEITA-SIMBOLICA`.
 * O pacote pago "por fora" e NÃO ligado continua aparecendo aqui — é a régua do dado.
 *
 * O valor PREVISTO é o preço do serviço × sessões vendidas: é o que o faturamento cobra por
 * sessão (`servico.valor`, preço do servidor — T-fin-15) vezes o que foi vendido. Sem serviço
 * não há preço: "Sem serviço" e 0,00 — a linha fica, nunca some da soma.
 *
 * O TOTAL previsto do recorte é dinheiro da clínica: só sai para quem tem `fluxo_caixa.ver` (change
 * `financeiro-sem-faturamento-total`). A lista e o valor de cada pacote ficam — é com eles que a
 * recepção cobra.
 *
 * É de CONFERÊNCIA (AP-09): sai com o nome da criança. Exige as DUAS permissões
 * (`tratamentos.ver` E `lancamentos.ver` — o dado é dos dois módulos), no eixo AGENDA (D11 —
 * ver `eixo()`).
 */
final class TratamentosSemLancamento implements Relatorio
{
    /** O corte do analítico é injetável (teste) e por padrão o teto comum do envelope. */
    public function __construct(
        private readonly PeriodoDoTratamento $periodo,
        private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS,
    ) {}

    public function slug(): string
    {
        return 'tratamentos-sem-lancamento';
    }

    public function titulo(): string
    {
        return 'Tratamentos sem lançamento';
    }

    public function permissoes(): array
    {
        return ['tratamentos.ver', 'lancamentos.ver'];
    }

    /**
     * Eixo AGENDA (D11) — o mesmo de `SessoesDosTratamentos`, e pelo mesmo motivo
     * (`SEC-REL-01`/`CRR-01`): §12 põe pacote e criança no alcance OPERACIONAL do eixo agenda,
     * e é por ele que as portas donas deste dado escopam. Com `clinico`, Secretaria e Faturista
     * (`agenda.ver_todos`, sem `clinico.ver_todos`, sem vínculo — AP-10) recebiam folha em
     * branco, e quem tem só `clinico.ver_todos` saía plano aqui e escopado na porta antiga.
     * Amarrado, papel a papel, por `RelatoriosEixoDoEscopoTest`.
     */
    public function eixo(): ?string
    {
        return 'agenda';
    }

    public function expoeNomeDaCrianca(): bool
    {
        return true;
    }

    public function usaPeriodo(): bool
    {
        return true;
    }

    public function regras(): array
    {
        return [];
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        $abertura = $this->periodo->expressaoDeAbertura();

        // abertos no período (pela abertura na parede da clínica) e sem NENHUMA receita —
        // `whereDoesntHave` sobre a relação do model
        $consulta = $escopo->aplicar(Tratamento::query(), 'tratamentos.profissional_id')
            ->whereRaw("{$abertura} BETWEEN ? AND ?", [$parametros['de'], $parametros['ate']])
            ->whereDoesntHave('lancamentos', fn ($lancamentos) => $lancamentos->where('tipo', 'receita'));

        // ordem: abertura, criança pelo NOME (daí o join) e id estável
        $brutas = (clone $consulta)
            ->join('pacientes', fn (JoinClause $join) => $join
                ->on('pacientes.id', '=', 'tratamentos.paciente_id'))
            ->select('tratamentos.*')
            ->selectRaw("{$abertura} as abertura")
            ->with(['paciente:id,nome', 'convenio:id,nome', 'servico:id,procedimento,valor', 'profissional:id,nome'])
            ->orderByRaw("{$abertura} asc")
            ->orderBy('pacientes.nome')
            ->orderBy('tratamentos.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;

        // totais NO BANCO (CR-04), em decimal, sobre o recorte inteiro; o serviço entra por
        // left join — pacote sem serviço soma 0 e continua contando
        $agregado = (clone $consulta)
            ->leftJoin('servicos', fn (JoinClause $join) => $join
                ->on('servicos.id', '=', 'tratamentos.servico_id'))
            ->selectRaw('COUNT(*) as quantidade, COALESCE(SUM(servicos.valor * tratamentos.sessoes_total), 0) as valor_previsto')
            ->first();

        // whitelist explícita no transform (lição WHITELIST-do-menor): nunca toArray() do model
        $linhas = $brutas->take($this->limiteDeLinhas)->map(fn (Tratamento $t): array => [
            'paciente' => $t->paciente?->nome,
            'convenio' => $t->convenio?->nome ?? 'Sem convênio',
            'servico' => $t->servico?->procedimento ?? 'Sem serviço',
            'valor_previsto' => $t->servico === null
                ? '0.00'
                : bcmul((string) $t->servico->valor, (string) $t->sessoes_total, 2),
            'abertura' => (string) $t->abertura,
            'profissional' => $t->profissional?->nome,
        ])->values()->all();

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: ['de' => $parametros['de'], 'ate' => $parametros['ate']],
            filtrosAplicados: [],
            colunas: [
                ['chave' => 'paciente', 'rotulo' => 'Paciente', 'tipo' => 'texto'],
                ['chave' => 'convenio', 'rotulo' => 'Convênio', 'tipo' => 'texto'],
                ['chave' => 'servico', 'rotulo' => 'Serviço', 'tipo' => 'texto'],
                ['chave' => 'valor_previsto', 'rotulo' => 'Valor previsto', 'tipo' => 'dinheiro'],
                ['chave' => 'abertura', 'rotulo' => 'Abertura', 'tipo' => 'data'],
                ['chave' => 'profissional', 'rotulo' => 'Profissional', 'tipo' => 'texto'],
            ],
            linhas: $linhas,
            grupos: null,
            totais: [
                'quantidade' => (int) $agregado->quantidade,
                ...(Auth::user()?->can('fluxo_caixa.ver') === true
                    ? ['valor_previsto' => bcadd((string) $agregado->valor_previsto, '0', 2)]
                    : []),
            ],
            truncado: $truncado,
        );
    }
}
