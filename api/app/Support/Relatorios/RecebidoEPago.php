<?php

namespace App\Support\Relatorios;

use App\Models\Categoria;
use App\Models\Conta;
use App\Models\LancamentoCaixa;
use App\Models\TipoPagamento;
use App\Support\Rbac\Escopo;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Relatório `recebido-e-pago` — "Recebido e pago" (change `relatorios-do-caixa`): quanto entrou
 * e saiu do caixa, e por onde. Os lançamentos PAGOS no período pela data do PAGAMENTO
 * (`pago_em`, o dinheiro no caixa — D1), pelo líquido (valor + juros + multa − desconto). No
 * ClinicaÁgil, "Contas Pagas/Recebidas" e "Contas por Categoria".
 *
 * Conta a MESMA coisa que o Fluxo de caixa (`GET /fluxo-caixa`) e isso é esperado: o Fluxo é o
 * extrato com saldo; este responde "por onde" (forma, categoria, conta, dia) e imprime. Um teste
 * prova que os totais batem. Transferência não entra: não é receita nem despesa (T-fin-19) — e
 * mora noutra tabela, então fica de fora por construção.
 *
 * As colunas de dinheiro têm as MESMAS chaves dos totais (a tela só soma a chave que é coluna):
 * recebido, pago e resultado (recebido − pago) com os dois tipos; só a coluna do tipo escolhido.
 *
 * Totais da clínica: exige `lancamentos.ver` E `fluxo_caixa.ver`. Sai com o nome da criança
 * (conferência, AP-09). Sem eixo: o caixa é da clínica.
 */
final class RecebidoEPago implements Relatorio
{
    /** @var list<string> */
    public const RESULTADOS = ['analitico', 'sintetico'];

    /** @var list<string> */
    public const DIVISOES = ['forma_de_pagamento', 'categoria', 'conta', 'dia'];

    /** @var list<string> */
    public const TIPOS = ['recebido', 'pago'];

    public const BASE = 'Pela data do pagamento';

    private const NATUREZA = ['recebido' => 'receita', 'pago' => 'despesa'];

    private const ROTULO_DO_TIPO = ['recebido' => 'Recebido', 'pago' => 'Pago'];

    private const ROTULO_DA_DIVISAO = [
        'forma_de_pagamento' => 'Forma de pagamento',
        'categoria' => 'Categoria',
        'conta' => 'Conta',
        'dia' => 'Dia',
    ];

    /** As colunas de dinheiro por Tipo — chave da coluna = chave do total. */
    private const DINHEIRO = [
        'recebido' => ['recebido' => 'Recebido'],
        'pago' => ['pago' => 'Pago'],
        'ambos' => ['recebido' => 'Recebido', 'pago' => 'Pago', 'resultado' => 'Resultado'],
    ];

    public function __construct(private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS) {}

    public function slug(): string
    {
        return 'recebido-e-pago';
    }

    public function titulo(): string
    {
        return 'Recebido e pago';
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

        $dinheiro = self::DINHEIRO[$tipo ?? 'ambos'];
        $consulta = $this->consulta($parametros);
        $periodo = ['de' => $parametros['de'], 'ate' => $parametros['ate']];
        $filtros = $this->filtrosAplicados($parametros);

        if (($parametros['resultado'] ?? 'analitico') === 'sintetico') {
            return $this->sintetico($consulta, $parametros['dividir_por'], $dinheiro, $periodo, $filtros);
        }

        return $this->analitico($consulta, $dinheiro, $periodo, $filtros);
    }

    /**
     * O recorte: pagos no período pela data do pagamento (a MESMA janela do Fluxo de caixa —
     * `pago_em` é a parede da clínica, T-fin-07), a natureza do Tipo, conta e categoria.
     *
     * @param  array<string, mixed>  $parametros
     * @return Builder<LancamentoCaixa>
     */
    private function consulta(array $parametros): Builder
    {
        $consulta = LancamentoCaixa::query()
            ->whereBetween('lancamentos_caixa.pago_em', ["{$parametros['de']} 00:00:00", "{$parametros['ate']} 23:59:59"])
            ->when(self::NATUREZA[$parametros['tipo'] ?? ''] ?? null, fn (Builder $q, string $natureza) => $q
                ->where('lancamentos_caixa.tipo', $natureza));

        return LancamentosNoRelatorio::filtrarPorContaECategoria($consulta, $parametros);
    }

    /** As somas de UMA query: cada natureza na sua coluna, e o resultado pelo líquido COM sinal. */
    private function somas(): string
    {
        $liquido = LancamentoCaixa::LIQUIDO_SQL;

        return "COALESCE(SUM(CASE WHEN lancamentos_caixa.tipo = 'receita' THEN {$liquido} ELSE 0 END), 0) as recebido, "
            ."COALESCE(SUM(CASE WHEN lancamentos_caixa.tipo = 'despesa' THEN {$liquido} ELSE 0 END), 0) as pago, "
            .'COALESCE(SUM('.LancamentoCaixa::LIQUIDO_COM_SINAL_SQL.'), 0) as resultado, '
            .'COUNT(*) as lancamentos';
    }

    /**
     * Uma linha por pagamento, na ordem em que o dinheiro se moveu.
     *
     * @param  Builder<LancamentoCaixa>  $consulta
     * @param  array<string, string>  $dinheiro
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function analitico(Builder $consulta, array $dinheiro, array $periodo, array $filtros): Envelope
    {
        $brutas = (clone $consulta)
            ->select(LancamentosNoRelatorio::COLUNAS)
            ->orderBy('lancamentos_caixa.pago_em')
            ->orderBy('lancamentos_caixa.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;
        $brutas = $brutas->take($this->limiteDeLinhas);
        $nomes = LancamentosNoRelatorio::nomes($brutas);

        $linhas = $brutas->map(fn (LancamentoCaixa $l): array => [
            'data' => $l->pago_em->format('Y-m-d'),
            'pessoa' => LancamentosNoRelatorio::pessoa($nomes['pessoas'], $l->interessado_tipo, $l->interessado_id),
            'categoria' => LancamentosNoRelatorio::categoria($nomes, $l),
            'forma_de_pagamento' => (string) ($nomes['formas'][$l->tipo_pagamento_id] ?? LancamentosNoRelatorio::SEM_VALOR),
            'conta' => (string) ($nomes['contas'][$l->conta_id] ?? LancamentosNoRelatorio::SEM_VALOR),
            ...array_intersect_key([
                'recebido' => $l->tipo === 'receita' ? $l->liquido : null,
                'pago' => $l->tipo === 'despesa' ? $l->liquido : null,
                // a linha diz o seu efeito no resultado: a soma da coluna fecha com o total
                'resultado' => $l->tipo === 'despesa' ? bcmul($l->liquido, '-1', 2) : $l->liquido,
            ], $dinheiro),
        ])->values()->all();

        $somas = (clone $consulta)->selectRaw($this->somas())->toBase()->first();

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            colunas: [
                ['chave' => 'data', 'rotulo' => 'Pago em', 'tipo' => 'data'],
                ['chave' => 'pessoa', 'rotulo' => 'Pessoa', 'tipo' => 'texto'],
                ['chave' => 'categoria', 'rotulo' => 'Categoria', 'tipo' => 'texto'],
                ['chave' => 'forma_de_pagamento', 'rotulo' => 'Forma de pagamento', 'tipo' => 'texto'],
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
     * Por forma de pagamento, categoria, conta ou dia — os grupos e o total do MESMO GROUP BY.
     *
     * @param  Builder<LancamentoCaixa>  $consulta
     * @param  array<string, string>  $dinheiro
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function sintetico(Builder $consulta, string $dimensao, array $dinheiro, array $periodo, array $filtros): Envelope
    {
        // a expressão vem de um `match` fechado sobre `DIVISOES` (validado) — nunca do payload
        [$expressao, $titulos, $semValor] = match ($dimensao) {
            'forma_de_pagamento' => ['lancamentos_caixa.tipo_pagamento_id', fn (Collection $ids): Collection => TipoPagamento::whereIn('id', $ids)->pluck('nome', 'id'), 'Sem forma de pagamento'],
            'categoria' => ['lancamentos_caixa.categoria_id', fn (Collection $ids): Collection => Categoria::whereIn('id', $ids)->pluck('nome', 'id'), 'Sem categoria'],
            'conta' => ['lancamentos_caixa.conta_id', fn (Collection $ids): Collection => Conta::whereIn('id', $ids)->pluck('nome', 'id'), 'Sem conta'],
            'dia' => ['DATE(lancamentos_caixa.pago_em)', fn (Collection $dias): Collection => $dias->mapWithKeys(fn (string $dia): array => [$dia => CarbonImmutable::createFromFormat('!Y-m-d', $dia)->format('d/m/Y')]), 'Sem dia'],
        };

        $sintetico = LancamentosNoRelatorio::sintetico(
            $consulta, $expressao, $this->somas(), [], array_keys($dinheiro), 'lancamentos', $titulos, $semValor, $dimensao === 'dia',
        );
        $filtros[] = ['rotulo' => 'Dividido por', 'valor' => self::ROTULO_DA_DIVISAO[$dimensao]];

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
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
