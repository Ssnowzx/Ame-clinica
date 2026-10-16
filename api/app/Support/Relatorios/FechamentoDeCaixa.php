<?php

namespace App\Support\Relatorios;

use App\Models\Conta;
use App\Models\LancamentoCaixa;
use App\Models\TipoPagamento;
use App\Models\Usuario;
use App\Support\Rbac\Escopo;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Relatório `fechamento-de-caixa` — "Fechamento de caixa" (change `fechamento-de-caixa`): no fim do
 * dia, quem deu baixa confere o que recebeu — em dinheiro, PIX, cartão — contra a gaveta. Os
 * lançamentos PAGOS no período pela data do pagamento, pelo líquido, com QUEM deu a baixa
 * (`pago_por_id`).
 *
 * É a conferência do caixa da CLÍNICA: exige `lancamentos.ver` E `fluxo_caixa.ver` (change
 * `financeiro-sem-faturamento-total`, D5). Até ela, quem não via o caixa fechava as próprias baixas;
 * a clínica disse que a recepção não fecha o caixa, e as baixas de quem mais recebe, num período de
 * até 366 dias, eram quase o faturamento de particulares.
 *
 * As colunas de dinheiro têm as MESMAS chaves dos totais: entradas, saidas e saldo. Sai com o nome
 * da criança (conferência, AP-09). Sem eixo: o caixa é da clínica.
 */
final class FechamentoDeCaixa implements Relatorio
{
    /** @var list<string> */
    public const RESULTADOS = ['analitico', 'sintetico'];

    /** @var list<string> */
    public const DIVISOES = ['forma_de_pagamento', 'conta', 'quem_deu_baixa'];

    /** @var list<string> */
    public const TIPOS = ['entradas', 'saidas'];

    public const BASE = 'Pela data do pagamento';

    public const NAO_REGISTRADO = 'Não registrado';

    private const NATUREZA = ['entradas' => 'receita', 'saidas' => 'despesa'];

    private const ROTULO_DA_DIVISAO = [
        'forma_de_pagamento' => 'Forma de pagamento',
        'conta' => 'Conta',
        'quem_deu_baixa' => 'Quem deu baixa',
    ];

    /** As colunas de dinheiro por Tipo — chave da coluna = chave do total. */
    private const DINHEIRO = [
        'entradas' => ['entradas' => 'Entradas'],
        'saidas' => ['saidas' => 'Saídas'],
        'ambos' => ['entradas' => 'Entradas', 'saidas' => 'Saídas', 'saldo' => 'Saldo'],
    ];

    public function __construct(private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS) {}

    public function slug(): string
    {
        return 'fechamento-de-caixa';
    }

    public function titulo(): string
    {
        return 'Fechamento de caixa';
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
        // categoria de outra natureza que o Tipo é folha vazia calada: 422, como nos outros do caixa
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

    private function somas(): string
    {
        $liquido = LancamentoCaixa::LIQUIDO_SQL;

        return "COALESCE(SUM(CASE WHEN lancamentos_caixa.tipo = 'receita' THEN {$liquido} ELSE 0 END), 0) as entradas, "
            ."COALESCE(SUM(CASE WHEN lancamentos_caixa.tipo = 'despesa' THEN {$liquido} ELSE 0 END), 0) as saidas, "
            .'COALESCE(SUM('.LancamentoCaixa::LIQUIDO_COM_SINAL_SQL.'), 0) as saldo, '
            .'COUNT(*) as lancamentos';
    }

    /**
     * @param  Builder<LancamentoCaixa>  $consulta
     * @param  array<string, string>  $dinheiro
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function analitico(Builder $consulta, array $dinheiro, array $periodo, array $filtros): Envelope
    {
        $brutas = (clone $consulta)
            ->select([...LancamentosNoRelatorio::COLUNAS, 'lancamentos_caixa.pago_por_id'])
            ->orderBy('lancamentos_caixa.pago_em')
            ->orderBy('lancamentos_caixa.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;
        $brutas = $brutas->take($this->limiteDeLinhas);
        $nomes = LancamentosNoRelatorio::nomes($brutas);
        $quem = self::nomesDeQuemDeuBaixa($brutas->pluck('pago_por_id')->filter()->unique()->values());

        $linhas = $brutas->map(fn (LancamentoCaixa $l): array => [
            'hora' => $l->pago_em->format('H:i'),
            'data' => $l->pago_em->format('Y-m-d'),
            'pessoa' => LancamentosNoRelatorio::pessoa($nomes['pessoas'], $l->interessado_tipo, $l->interessado_id),
            'categoria' => LancamentosNoRelatorio::categoria($nomes, $l),
            'forma_de_pagamento' => (string) ($nomes['formas'][$l->tipo_pagamento_id] ?? LancamentosNoRelatorio::SEM_VALOR),
            'conta' => (string) ($nomes['contas'][$l->conta_id] ?? LancamentosNoRelatorio::SEM_VALOR),
            'quem_deu_baixa' => (string) ($quem[$l->pago_por_id] ?? self::NAO_REGISTRADO),
            ...array_intersect_key([
                'entradas' => $l->tipo === 'receita' ? $l->liquido : null,
                'saidas' => $l->tipo === 'despesa' ? $l->liquido : null,
                'saldo' => $l->tipo === 'despesa' ? bcmul($l->liquido, '-1', 2) : $l->liquido,
            ], $dinheiro),
        ])->values()->all();

        $somas = (clone $consulta)->selectRaw($this->somas())->toBase()->first();

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            colunas: [
                ['chave' => 'data', 'rotulo' => 'Data', 'tipo' => 'data'],
                ['chave' => 'hora', 'rotulo' => 'Hora', 'tipo' => 'hora'],
                ['chave' => 'pessoa', 'rotulo' => 'Pessoa', 'tipo' => 'texto'],
                ['chave' => 'categoria', 'rotulo' => 'Categoria', 'tipo' => 'texto'],
                ['chave' => 'forma_de_pagamento', 'rotulo' => 'Forma de pagamento', 'tipo' => 'texto'],
                ['chave' => 'conta', 'rotulo' => 'Conta', 'tipo' => 'texto'],
                ['chave' => 'quem_deu_baixa', 'rotulo' => 'Quem deu baixa', 'tipo' => 'texto'],
                ...LancamentosNoRelatorio::colunasDeDinheiro($dinheiro),
            ],
            linhas: $linhas,
            grupos: null,
            totais: LancamentosNoRelatorio::totaisDeDinheiro($somas, array_keys($dinheiro)),
            truncado: $truncado,
        );
    }

    /**
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
            'conta' => ['lancamentos_caixa.conta_id', fn (Collection $ids): Collection => Conta::whereIn('id', $ids)->pluck('nome', 'id'), 'Sem conta'],
            'quem_deu_baixa' => ['lancamentos_caixa.pago_por_id', fn (Collection $ids): Collection => self::nomesDeQuemDeuBaixa($ids), self::NAO_REGISTRADO],
        };

        $sintetico = LancamentosNoRelatorio::sintetico(
            $consulta, $expressao, $this->somas(), [], array_keys($dinheiro), 'lancamentos', $titulos, $semValor,
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
     * Os nomes de quem deu baixa (um id de usuário que não existe mais sai "não registrado").
     *
     * @param  Collection<int, mixed>  $ids
     * @return Collection<string, string>
     */
    private static function nomesDeQuemDeuBaixa(Collection $ids): Collection
    {
        return Usuario::query()
            ->whereIn('id', $ids)
            ->pluck('nome', 'id')
            ->mapWithKeys(fn (string $nome, int $id): array => [(string) $id => $nome]);
    }

    /**
     * @param  array<string, mixed>  $parametros
     * @return list<array{rotulo: string, valor: string}>
     */
    private function filtrosAplicados(array $parametros): array
    {
        $filtros = [['rotulo' => 'Base', 'valor' => self::BASE]];
        if (isset($parametros['tipo'])) {
            $filtros[] = ['rotulo' => 'Tipo', 'valor' => $parametros['tipo'] === 'entradas' ? 'Entradas' : 'Saídas'];
        }

        return [...$filtros, ...LancamentosNoRelatorio::filtrosDeContaECategoria($parametros)];
    }
}
