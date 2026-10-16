<?php

namespace App\Support\Relatorios;

use App\Models\Categoria;
use App\Models\Conta;
use App\Models\LancamentoCaixa;
use App\Models\Subcategoria;
use App\Models\TipoPagamento;
use App\Support\Financeiro\NomesDosInteressados;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * O que os três relatórios de DINHEIRO do caixa (change `relatorios-do-caixa`) têm em comum,
 * num lugar só: os filtros Conta e Categoria (D6), os nomes legíveis em lote (sempre uma coluna
 * por cadastro — `obs`, `documento` e o cadastro da criança nunca entram na memória) e o
 * sintético montado num GROUP BY só (D2).
 *
 * Três relatórios leem a mesma tabela com a mesma régua; três cópias seriam três jeitos de uma
 * delas esquecer o juro.
 */
final class LancamentosNoRelatorio
{
    public const SEM_VALOR = '—';

    /** As colunas do lançamento que os relatórios leem — whitelist no SQL, nunca `obs`/`documento`. */
    public const COLUNAS = [
        'lancamentos_caixa.id', 'lancamentos_caixa.tipo', 'lancamentos_caixa.competencia',
        'lancamentos_caixa.vencimento', 'lancamentos_caixa.pago_em',
        'lancamentos_caixa.interessado_tipo', 'lancamentos_caixa.interessado_id',
        'lancamentos_caixa.categoria_id', 'lancamentos_caixa.subcategoria_id',
        'lancamentos_caixa.conta_id', 'lancamentos_caixa.tipo_pagamento_id',
        'lancamentos_caixa.valor', 'lancamentos_caixa.juros', 'lancamentos_caixa.multa',
        'lancamentos_caixa.desconto',
    ];

    /**
     * Conta e Categoria existem (id inexistente → 422). O servidor nunca
     * os exige: o relatório sai sem eles (D6).
     *
     * @return array<string, list<mixed>>
     */
    public static function regrasDeContaECategoria(): array
    {
        return [
            'conta_id' => ['sometimes', 'integer', Rule::exists('contas', 'id')],
            'categoria_id' => ['sometimes', 'integer', Rule::exists('categorias', 'id')],
        ];
    }

    /**
     * @param  Builder<LancamentoCaixa>  $consulta
     * @param  array<string, mixed>  $parametros
     * @return Builder<LancamentoCaixa>
     */
    public static function filtrarPorContaECategoria(Builder $consulta, array $parametros): Builder
    {
        return $consulta
            ->when($parametros['conta_id'] ?? null, fn (Builder $q, $id) => $q->where('lancamentos_caixa.conta_id', $id))
            ->when($parametros['categoria_id'] ?? null, fn (Builder $q, $id) => $q->where('lancamentos_caixa.categoria_id', $id));
    }

    /**
     * Categoria de despesa num recorte de receitas (ou o contrário) é pedido incoerente, e
     * responde 422 — nunca uma folha vazia calada, que a clínica leria como "nada a receber".
     *
     * @param  array<string, mixed>  $parametros
     */
    public static function assegurarCategoriaDaNatureza(array $parametros, ?string $natureza): void
    {
        if ($natureza === null || ! isset($parametros['categoria_id'])) {
            return;
        }

        if (Categoria::whereKey($parametros['categoria_id'])->value('tipo') !== $natureza) {
            throw ValidationException::withMessages([
                'categoria_id' => $natureza === 'receita' ? 'Esta categoria é de despesa.' : 'Esta categoria é de receita.',
            ]);
        }
    }

    /**
     * As linhas do cabeçalho do papel para os filtros de conta e categoria, com o nome legível.
     *
     * @param  array<string, mixed>  $parametros
     * @return list<array{rotulo: string, valor: string}>
     */
    public static function filtrosDeContaECategoria(array $parametros): array
    {
        $filtros = [];

        if (isset($parametros['conta_id'])) {
            $filtros[] = ['rotulo' => 'Conta', 'valor' => (string) Conta::whereKey($parametros['conta_id'])->value('nome')];
        }
        if (isset($parametros['categoria_id'])) {
            $filtros[] = ['rotulo' => 'Categoria', 'valor' => (string) Categoria::whereKey($parametros['categoria_id'])->value('nome')];
        }

        return $filtros;
    }

    /**
     * Os nomes legíveis das linhas CARREGADAS, um `whereIn` por cadastro. A pessoa vem da fonte
     * única da lista de lançamentos (`NomesDosInteressados::de`: criança, fornecedor ou funcionário,
     * só o nome).
     *
     * @param  Collection<int, LancamentoCaixa>  $lancamentos
     * @return array{pessoas: Collection<string, string>, categorias: Collection<int, string>, subcategorias: Collection<int, string>, contas: Collection<int, string>, formas: Collection<int, string>}
     */
    public static function nomes(Collection $lancamentos): array
    {
        return [
            'pessoas' => NomesDosInteressados::de($lancamentos),
            'categorias' => Categoria::whereIn('id', self::ids($lancamentos, 'categoria_id'))->pluck('nome', 'id'),
            'subcategorias' => Subcategoria::whereIn('id', self::ids($lancamentos, 'subcategoria_id'))->pluck('nome', 'id'),
            'contas' => Conta::whereIn('id', self::ids($lancamentos, 'conta_id'))->pluck('nome', 'id'),
            'formas' => TipoPagamento::whereIn('id', self::ids($lancamentos, 'tipo_pagamento_id'))->pluck('nome', 'id'),
        ];
    }

    /** @param  Collection<string, string>  $pessoas */
    public static function pessoa(Collection $pessoas, ?string $tipo, mixed $id): string
    {
        return $tipo === null ? self::SEM_VALOR : (string) ($pessoas["{$tipo}#{$id}"] ?? self::SEM_VALOR);
    }

    /**
     * "Categoria › Subcategoria", como o extrato do paciente.
     *
     * @param  array{categorias: Collection<int, string>, subcategorias: Collection<int, string>}  $nomes
     */
    public static function categoria(array $nomes, LancamentoCaixa $lancamento): string
    {
        $categoria = (string) ($nomes['categorias'][$lancamento->categoria_id] ?? self::SEM_VALOR);
        $subcategoria = $nomes['subcategorias'][$lancamento->subcategoria_id] ?? null;

        return $subcategoria === null ? $categoria : "{$categoria} › {$subcategoria}";
    }

    /**
     * O SINTÉTICO: um GROUP BY só dá os grupos E o total geral (D2). O total é a soma decimal
     * EXATA dos grupos — nunca uma segunda consulta que poderia divergir deles. Cada grupo é uma
     * linha da tabela; o nulo vira "Sem …" e vai por último (é o resto, não o primeiro).
     *
     * @param  Builder<LancamentoCaixa>  $consulta
     * @param  string  $expressao  de um `match` fechado sobre as divisões validadas — nunca do payload
     * @param  string  $somas  o SELECT das somas, com um alias por chave de `$dinheiro` e `$contagem`
     * @param  list<mixed>  $bindings  os do `$somas`
     * @param  list<string>  $dinheiro  as chaves de dinheiro — as MESMAS das colunas
     * @param  Closure(Collection<int, string>): Collection<string, string>  $titulos  chave → título
     * @return array{grupos: list<array{titulo: string, linhas: list<array<string, mixed>>, totais: array<string, int|string>}>, totais: array<string, int|string>}
     */
    public static function sintetico(
        Builder $consulta,
        string $expressao,
        string $somas,
        array $bindings,
        array $dinheiro,
        string $contagem,
        Closure $titulos,
        string $semValor,
        bool $cronologico = false,
    ): array {
        $agregado = (clone $consulta)
            ->selectRaw("{$expressao} as chave, {$somas}", $bindings)
            // pelo ALIAS: o MariaDB (ONLY_FULL_GROUP_BY) nem sempre reconhece a expressão
            // repetida no GROUP BY como a mesma do SELECT
            ->groupBy('chave')
            ->toBase()
            ->get()
            ->map(fn (object $linha): array => [
                'chave' => $linha->chave === null ? null : (string) $linha->chave,
                'totais' => [
                    ...array_map(fn (string $chave): string => bcadd((string) $linha->{$chave}, '0', 2), array_combine($dinheiro, $dinheiro)),
                    $contagem => (int) $linha->{$contagem},
                ],
            ]);

        $nomes = $titulos($agregado->pluck('chave')->filter(fn (?string $chave): bool => $chave !== null)->values());
        $grupos = $agregado
            ->map(fn (array $grupo): array => [...$grupo, 'titulo' => $grupo['chave'] === null ? $semValor : (string) ($nomes[$grupo['chave']] ?? $semValor)])
            ->sortBy(fn (array $grupo): string => ($grupo['chave'] === null ? "\u{FFFF}" : '').($cronologico ? (string) $grupo['chave'] : mb_strtolower($grupo['titulo'])))
            ->values();

        $totais = [];
        foreach ($dinheiro as $chave) {
            $totais[$chave] = $grupos->reduce(fn (string $soma, array $grupo): string => bcadd($soma, $grupo['totais'][$chave], 2), '0.00');
        }
        $totais[$contagem] = (int) $grupos->sum(fn (array $grupo): int => $grupo['totais'][$contagem]);

        return [
            'grupos' => $grupos->map(fn (array $grupo): array => ['titulo' => $grupo['titulo'], 'linhas' => [], 'totais' => $grupo['totais']])->all(),
            'totais' => $totais,
        ];
    }

    /**
     * As colunas de dinheiro declaradas por um relatório — `chave => rótulo`. A chave É a chave do
     * total: a tela só desenha na linha de totais a chave que também é coluna.
     *
     * @param  array<string, string>  $dinheiro
     * @return list<array{chave: string, rotulo: string, tipo: string}>
     */
    public static function colunasDeDinheiro(array $dinheiro): array
    {
        return array_map(
            fn (string $chave, string $rotulo): array => ['chave' => $chave, 'rotulo' => $rotulo, 'tipo' => 'dinheiro'],
            array_keys($dinheiro),
            array_values($dinheiro),
        );
    }

    /**
     * Uma linha de somas do banco → os totais de dinheiro visíveis, em string decimal.
     *
     * @param  list<string>  $dinheiro
     * @return array<string, string>
     */
    public static function totaisDeDinheiro(object $somas, array $dinheiro): array
    {
        $totais = [];
        foreach ($dinheiro as $chave) {
            $totais[$chave] = bcadd((string) $somas->{$chave}, '0', 2);
        }

        return $totais;
    }

    /** Os títulos de uma divisão por pessoa: a chave é `tipo#id`, como a de `NomesDosInteressados::de`. */
    public static function titulosDePessoas(): Closure
    {
        return fn (Collection $chaves): Collection => NomesDosInteressados::de($chaves->map(function (string $chave): array {
            [$tipo, $id] = explode('#', $chave, 2);

            return ['interessado_tipo' => $tipo, 'interessado_id' => (int) $id];
        }));
    }

    /** "setembro de 2026" a partir de "2026-09". */
    public static function mesPorExtenso(string $anoMes): string
    {
        return CarbonImmutable::createFromFormat('!Y-m', $anoMes)->locale('pt_BR')->isoFormat('MMMM [de] YYYY');
    }

    /**
     * @param  Collection<int, LancamentoCaixa>  $linhas
     * @return Collection<int, int>
     */
    private static function ids(Collection $linhas, string $atributo): Collection
    {
        return $linhas->pluck($atributo)->filter(fn ($id) => $id !== null)->map(fn ($id): int => (int) $id)->unique()->values();
    }
}
