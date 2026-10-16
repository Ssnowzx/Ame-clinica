<?php

namespace App\Support\Relatorios;

use App\Models\Categoria;
use App\Models\LancamentoCaixa;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\Escopo;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Relatório `contas-em-aberto` — "Contas a pagar e a receber" (change `relatorios-do-caixa`):
 * quem deve e o que vence. Os lançamentos EM ABERTO (sem `pago_em`) com VENCIMENTO no período —
 * uma pergunta, uma base de data, dita no cabeçalho (D1). No ClinicaÁgil, "Contas a
 * Pagar/Receber".
 *
 * Cada linha diz a situação em relação a HOJE na parede da clínica (`clinica.timezone`, D3):
 * "Atrasado há N dias", "Vence hoje" ou "Vence em N dias". Vencer hoje não é atraso.
 *
 * As colunas de dinheiro têm as MESMAS chaves dos totais (a tela só soma a chave que é coluna —
 * lição do `recebido-por-profissional`). Por isso o "atrasado" é por natureza: com Tipo
 * "Receber" é o atrasado a receber; com "Pagar", o a pagar; com os dois, as duas colunas — somar
 * o que a clínica tem a receber com o que ela deve daria um número que não é de ninguém.
 *
 * Somas no banco pelo líquido (D2). Totais da clínica: exige `lancamentos.ver` E
 * `fluxo_caixa.ver` (decisão de 2026-07-19 — quem lança não vê o total). Sai com o nome da
 * criança: é a folha da cobrança (AP-09). Sem eixo: o caixa é da clínica.
 */
final class ContasEmAberto implements Relatorio
{
    /** @var list<string> */
    public const RESULTADOS = ['analitico', 'sintetico'];

    /** @var list<string> */
    public const DIVISOES = ['categoria', 'pessoa', 'mes'];

    /** @var list<string> */
    public const TIPOS = ['receber', 'pagar'];

    public const BASE = 'Pelo vencimento, só o que está em aberto';

    private const NATUREZA = ['receber' => 'receita', 'pagar' => 'despesa'];

    private const ROTULO_DO_TIPO = ['receber' => 'Receber', 'pagar' => 'Pagar'];

    private const ROTULO_DA_DIVISAO = ['categoria' => 'Categoria', 'pessoa' => 'Pessoa', 'mes' => 'Mês de vencimento'];

    /** As colunas de dinheiro por Tipo — chave da coluna = chave do total. */
    private const DINHEIRO = [
        'receber' => ['a_receber' => 'A receber', 'atrasado_a_receber' => 'Atrasado'],
        'pagar' => ['a_pagar' => 'A pagar', 'atrasado_a_pagar' => 'Atrasado'],
        'ambos' => [
            'a_receber' => 'A receber', 'a_pagar' => 'A pagar',
            'atrasado_a_receber' => 'Atrasado a receber', 'atrasado_a_pagar' => 'Atrasado a pagar',
        ],
    ];

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS,
    ) {}

    public function slug(): string
    {
        return 'contas-em-aberto';
    }

    public function titulo(): string
    {
        return 'Contas a pagar e a receber';
    }

    public function permissoes(): array
    {
        return ['lancamentos.ver', 'fluxo_caixa.ver'];
    }

    public function eixo(): ?string
    {
        return null;
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
        return [
            'resultado' => ['sometimes', Rule::in(self::RESULTADOS)],
            'dividir_por' => ['required_if:resultado,sintetico', Rule::in(self::DIVISOES)],
            'tipo' => ['sometimes', Rule::in(self::TIPOS)],
            ...LancamentosNoRelatorio::regrasDeContaECategoria(),
        ];
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        $tipo = $parametros['tipo'] ?? null;
        LancamentosNoRelatorio::assegurarCategoriaDaNatureza($parametros, self::NATUREZA[$tipo] ?? null);

        // a parede da clínica (D3): em UTC, às 21h de São Paulo o "hoje" já seria amanhã
        $hoje = now((string) $this->configuracoes->get('clinica.timezone'))->toDateString();
        $dinheiro = self::DINHEIRO[$tipo ?? 'ambos'];
        $consulta = $this->consulta($parametros);
        $periodo = ['de' => $parametros['de'], 'ate' => $parametros['ate']];
        $filtros = $this->filtrosAplicados($parametros);

        if (($parametros['resultado'] ?? 'analitico') === 'sintetico') {
            return $this->sintetico($consulta, $parametros['dividir_por'], $dinheiro, $hoje, $periodo, $filtros);
        }

        return $this->analitico($consulta, $dinheiro, $hoje, $periodo, $filtros);
    }

    /**
     * O recorte: em aberto, vencimento no período, a natureza do Tipo, conta e categoria — na
     * MESMA query (interseção por construção).
     *
     * @param  array<string, mixed>  $parametros
     * @return Builder<LancamentoCaixa>
     */
    private function consulta(array $parametros): Builder
    {
        $consulta = LancamentoCaixa::query()
            ->whereNull('lancamentos_caixa.pago_em')
            ->whereBetween('lancamentos_caixa.vencimento', [$parametros['de'], $parametros['ate']])
            ->when(self::NATUREZA[$parametros['tipo'] ?? ''] ?? null, fn (Builder $q, string $natureza) => $q
                ->where('lancamentos_caixa.tipo', $natureza));

        return LancamentosNoRelatorio::filtrarPorContaECategoria($consulta, $parametros);
    }

    /**
     * As somas de UMA query, pelo líquido sem sinal: cada natureza na sua coluna, o atraso pelo
     * vencimento ANTERIOR a hoje (dois bindings `hoje`).
     */
    private function somas(): string
    {
        $liquido = LancamentoCaixa::LIQUIDO_SQL;
        $atrasada = 'lancamentos_caixa.vencimento < ?';

        return "COALESCE(SUM(CASE WHEN lancamentos_caixa.tipo = 'receita' THEN {$liquido} ELSE 0 END), 0) as a_receber, "
            ."COALESCE(SUM(CASE WHEN lancamentos_caixa.tipo = 'despesa' THEN {$liquido} ELSE 0 END), 0) as a_pagar, "
            ."COALESCE(SUM(CASE WHEN lancamentos_caixa.tipo = 'receita' AND {$atrasada} THEN {$liquido} ELSE 0 END), 0) as atrasado_a_receber, "
            ."COALESCE(SUM(CASE WHEN lancamentos_caixa.tipo = 'despesa' AND {$atrasada} THEN {$liquido} ELSE 0 END), 0) as atrasado_a_pagar, "
            .'COUNT(*) as lancamentos';
    }

    /**
     * Uma linha por lançamento, com a situação na parede da clínica. Os totais são do RECORTE
     * inteiro, somados no banco — não das linhas carregadas, que o corte pode ter encurtado.
     *
     * @param  Builder<LancamentoCaixa>  $consulta
     * @param  array<string, string>  $dinheiro
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function analitico(Builder $consulta, array $dinheiro, string $hoje, array $periodo, array $filtros): Envelope
    {
        $brutas = (clone $consulta)
            ->select(LancamentosNoRelatorio::COLUNAS)
            ->orderBy('lancamentos_caixa.vencimento')
            ->orderBy('lancamentos_caixa.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;
        $brutas = $brutas->take($this->limiteDeLinhas);
        $nomes = LancamentosNoRelatorio::nomes($brutas);

        $linhas = $brutas->map(fn (LancamentoCaixa $l): array => [
            'vencimento' => $l->vencimento->format('Y-m-d'),
            'situacao' => self::situacao($l->vencimento->format('Y-m-d'), $hoje),
            'pessoa' => LancamentosNoRelatorio::pessoa($nomes['pessoas'], $l->interessado_tipo, $l->interessado_id),
            'categoria' => LancamentosNoRelatorio::categoria($nomes, $l),
            'conta' => (string) ($nomes['contas'][$l->conta_id] ?? LancamentosNoRelatorio::SEM_VALOR),
            ...$this->dinheiroDaLinha($l, $dinheiro, $hoje),
        ])->values()->all();

        $somas = (clone $consulta)->selectRaw($this->somas(), [$hoje, $hoje])->toBase()->first();

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            colunas: [
                ['chave' => 'vencimento', 'rotulo' => 'Vencimento', 'tipo' => 'data'],
                ['chave' => 'situacao', 'rotulo' => 'Situação', 'tipo' => 'texto'],
                ['chave' => 'pessoa', 'rotulo' => 'Pessoa', 'tipo' => 'texto'],
                ['chave' => 'categoria', 'rotulo' => 'Categoria', 'tipo' => 'texto'],
                ['chave' => 'conta', 'rotulo' => 'Conta', 'tipo' => 'texto'],
                ...LancamentosNoRelatorio::colunasDeDinheiro($dinheiro),
            ],
            linhas: $linhas,
            grupos: null,
            totais: LancamentosNoRelatorio::totaisDeDinheiro($somas, array_keys($dinheiro)),
            truncado: $truncado,
        );
    }

    /**
     * O valor da linha na coluna da SUA natureza, e na do atraso quando venceu antes de hoje; as
     * outras colunas de dinheiro ficam vazias (a tela mostra "—").
     *
     * @param  array<string, string>  $dinheiro
     * @return array<string, string|null>
     */
    private function dinheiroDaLinha(LancamentoCaixa $lancamento, array $dinheiro, string $hoje): array
    {
        $natureza = $lancamento->tipo === 'despesa' ? 'a_pagar' : 'a_receber';
        $atrasado = $lancamento->vencimento->format('Y-m-d') < $hoje;
        $celulas = array_fill_keys(array_keys($dinheiro), null);

        if (array_key_exists($natureza, $celulas)) {
            $celulas[$natureza] = $lancamento->liquido;
        }
        if ($atrasado && array_key_exists("atrasado_{$natureza}", $celulas)) {
            $celulas["atrasado_{$natureza}"] = $lancamento->liquido;
        }

        return $celulas;
    }

    /**
     * Por categoria, pessoa ou mês de vencimento — os grupos e o total do MESMO GROUP BY (D2).
     *
     * @param  Builder<LancamentoCaixa>  $consulta
     * @param  array<string, string>  $dinheiro
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function sintetico(Builder $consulta, string $dimensao, array $dinheiro, string $hoje, array $periodo, array $filtros): Envelope
    {
        // a expressão vem de um `match` fechado sobre `DIVISOES` (validado) — nunca do payload
        [$expressao, $titulos, $semValor] = match ($dimensao) {
            'categoria' => ['lancamentos_caixa.categoria_id', fn (Collection $ids): Collection => Categoria::whereIn('id', $ids)->pluck('nome', 'id'), 'Sem categoria'],
            'pessoa' => ["CONCAT(lancamentos_caixa.interessado_tipo, '#', lancamentos_caixa.interessado_id)", LancamentosNoRelatorio::titulosDePessoas(), 'Sem pessoa'],
            'mes' => ["DATE_FORMAT(lancamentos_caixa.vencimento, '%Y-%m')", fn (Collection $meses): Collection => $meses->mapWithKeys(fn (string $mes): array => [$mes => LancamentosNoRelatorio::mesPorExtenso($mes)]), 'Sem mês'],
        };

        $sintetico = LancamentosNoRelatorio::sintetico(
            $consulta, $expressao, $this->somas(), [$hoje, $hoje], array_keys($dinheiro), 'lancamentos', $titulos, $semValor, $dimensao === 'mes',
        );
        $filtros[] = ['rotulo' => 'Dividido por', 'valor' => self::ROTULO_DA_DIVISAO[$dimensao]];

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            // o dinheiro logo depois do nome, a contagem por último (no celular a última coluna
            // fica atrás do véu de rolagem — lição do `recebido-por-profissional`)
            colunas: [
                ['chave' => 'grupo', 'rotulo' => self::ROTULO_DA_DIVISAO[$dimensao], 'tipo' => 'texto'],
                ...LancamentosNoRelatorio::colunasDeDinheiro($dinheiro),
                ['chave' => 'lancamentos', 'rotulo' => 'Lançamentos', 'tipo' => 'numero'],
            ],
            linhas: [],
            grupos: $sintetico['grupos'],
            totais: $sintetico['totais'],
        );
    }

    /**
     * "Atrasado há N dias", "Vence hoje" ou "Vence em N dias" — as duas datas na parede da clínica.
     */
    private static function situacao(string $vencimento, string $hoje): string
    {
        $dias = (int) round(CarbonImmutable::createFromFormat('!Y-m-d', $hoje)->diffInDays(CarbonImmutable::createFromFormat('!Y-m-d', $vencimento)));
        $quantos = fn (int $n): string => $n === 1 ? '1 dia' : "{$n} dias";

        return match (true) {
            $dias < 0 => 'Atrasado há '.$quantos(-$dias),
            $dias === 0 => 'Vence hoje',
            default => 'Vence em '.$quantos($dias),
        };
    }

    /**
     * A BASE primeiro (sempre — D1: o cabeçalho diz de que data o papel é), depois os filtros.
     *
     * @param  array<string, mixed>  $parametros
     * @return list<array{rotulo: string, valor: string}>
     */
    private function filtrosAplicados(array $parametros): array
    {
        $filtros = [['rotulo' => 'Base', 'valor' => self::BASE]];

        if (isset($parametros['tipo'])) {
            $filtros[] = ['rotulo' => 'Tipo', 'valor' => self::ROTULO_DO_TIPO[$parametros['tipo']]];
        }

        return [...$filtros, ...LancamentosNoRelatorio::filtrosDeContaECategoria($parametros)];
    }
}
