<?php

namespace App\Support\Relatorios;

use App\Models\Categoria;
use App\Models\LancamentoCaixa;
use App\Support\Financeiro\EscadaDoDre;
use App\Support\Rbac\Escopo;
use Carbon\CarbonImmutable;
use Illuminate\Validation\Rule;

/**
 * Relatório `dre-gerencial` — "DRE gerencial" (change `dre-gerencial`): a clínica deu lucro ou
 * prejuízo no mês? A escada fixa (`EscadaDoDre`) com uma coluna por mês do período e o total.
 *
 * - Base pelo Tipo (D1 da área: uma base declarada): "pagamento" (lançamentos pagos, por
 *   `pago_em` — regime de caixa, o padrão) ou "competencia" (pela competência, pagos ou não).
 * - Cada lançamento cai na linha da subcategoria, senão na da categoria, senão no padrão da
 *   natureza — nunca fora (D2). O envelope AVISA quantas categorias estão no padrão.
 * - Soma no banco, por (linha efetiva × categoria × mês), pelo líquido (D3); subtotais em bcmath.
 *   Dedução, custo e despesa saem NEGATIVOS; o subtotal é a soma com sinal de tudo acima dele.
 * - As linhas levam `nivel` (0 grupo/subtotal, 1 linha, 2 categoria) e `destaque` (subtotal)
 *   para a tabela recuar e realçar (D4). Sem `totais`: os subtotais da escada SÃO o resultado.
 *
 * Resultado da clínica: exige `lancamentos.ver` E `fluxo_caixa.ver`. Numérico: sem nome de criança.
 */
final class DreGerencial implements Relatorio
{
    /** @var list<string> */
    public const TIPOS = ['pagamento', 'competencia'];

    private const BASE = [
        'pagamento' => 'Pela data do pagamento (regime de caixa)',
        'competencia' => 'Pela competência (o mês do serviço, pago ou não)',
    ];

    public function slug(): string
    {
        return 'dre-gerencial';
    }

    public function titulo(): string
    {
        return 'DRE gerencial';
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
        return false;
    }

    public function usaPeriodo(): bool
    {
        return true;
    }

    public function regras(): array
    {
        return [
            'tipo' => ['sometimes', Rule::in(self::TIPOS)],
            'somente_contabeis' => ['sometimes', 'boolean'],
        ];
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        $base = $parametros['tipo'] ?? 'pagamento';
        $meses = self::meses($parametros['de'], $parametros['ate']);
        $valores = $this->somas($parametros, $base);
        $nomes = Categoria::whereIn('id', collect($valores)->pluck('categoria_id')->unique())->pluck('nome', 'id');

        $linhas = [];
        $acumulado = self::zerado($meses);
        foreach (EscadaDoDre::ESCADA as $degrau) {
            if ($degrau['tipo'] === 'subtotal') {
                $linhas[] = ['linha' => $degrau['rotulo'], ...$acumulado, 'nivel' => 0, 'destaque' => true];

                continue;
            }

            $doGrupo = self::zerado($meses);
            $filhas = [];
            foreach ($degrau['linhas'] as $codigo) {
                $daLinha = self::zerado($meses);
                $categorias = [];
                foreach ($valores as $valor) {
                    if ($valor['linha'] !== $codigo) {
                        continue;
                    }
                    $chave = self::chaveDoMes($valor['mes']);
                    $comSinal = EscadaDoDre::comSinal($codigo, $valor['total']);
                    $categorias[$valor['categoria_id']] ??= self::zerado($meses);
                    $categorias[$valor['categoria_id']][$chave] = bcadd($categorias[$valor['categoria_id']][$chave], $comSinal, 2);
                    $categorias[$valor['categoria_id']]['total'] = bcadd($categorias[$valor['categoria_id']]['total'], $comSinal, 2);
                    $daLinha[$chave] = bcadd($daLinha[$chave], $comSinal, 2);
                    $daLinha['total'] = bcadd($daLinha['total'], $comSinal, 2);
                }
                $filhas[] = ['linha' => EscadaDoDre::LINHAS[$codigo]['rotulo'], ...$daLinha, 'nivel' => 1, 'destaque' => false];
                uksort($categorias, fn (int $a, int $b): int => strcmp(mb_strtolower((string) ($nomes[$a] ?? '')), mb_strtolower((string) ($nomes[$b] ?? ''))));
                foreach ($categorias as $categoriaId => $daCategoria) {
                    $filhas[] = ['linha' => (string) ($nomes[$categoriaId] ?? 'Categoria'), ...$daCategoria, 'nivel' => 2, 'destaque' => false];
                }
                $doGrupo = self::somar($doGrupo, $daLinha);
            }

            $linhas[] = ['linha' => $degrau['rotulo'], ...$doGrupo, 'nivel' => 0, 'destaque' => false];
            array_push($linhas, ...$filhas);
            $acumulado = self::somar($acumulado, $doGrupo);
        }

        $noPadrao = Categoria::whereNull('linha_dre')->count();

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: ['de' => $parametros['de'], 'ate' => $parametros['ate']],
            filtrosAplicados: [
                ['rotulo' => 'Base', 'valor' => self::BASE[$base]],
                ...(($parametros['somente_contabeis'] ?? false) ? [['rotulo' => 'Lançamentos', 'valor' => 'Somente contábeis']] : []),
            ],
            colunas: [
                ['chave' => 'linha', 'rotulo' => 'DRE', 'tipo' => 'texto'],
                ...array_map(fn (string $mes): array => ['chave' => self::chaveDoMes($mes), 'rotulo' => self::rotuloDoMes($mes), 'tipo' => 'dinheiro'], $meses),
                ['chave' => 'total', 'rotulo' => 'Total', 'tipo' => 'dinheiro'],
            ],
            linhas: $linhas,
            grupos: null,
            totais: [],
            avisos: $noPadrao === 0 ? [] : [
                ($noPadrao === 1 ? '1 categoria está' : "{$noPadrao} categorias estão")
                .' na linha padrão da natureza (receita em "Prestação de serviços", despesa em "Despesas administrativas") — confira em Configurar DRE.',
            ],
        );
    }

    /**
     * As somas do período por (linha efetiva × categoria × mês), numa consulta.
     *
     * @param  array<string, mixed>  $parametros
     * @return list<array{linha: string, categoria_id: int, mes: string, total: string}>
     */
    private function somas(array $parametros, string $base): array
    {
        $coluna = $base === 'pagamento' ? 'lancamentos_caixa.pago_em' : 'lancamentos_caixa.competencia';
        $inicio = $base === 'pagamento' ? "{$parametros['de']} 00:00:00" : $parametros['de'];
        $fim = $base === 'pagamento' ? "{$parametros['ate']} 23:59:59" : $parametros['ate'];

        return LancamentoCaixa::query()
            ->join('categorias', fn ($j) => $j->on('categorias.id', '=', 'lancamentos_caixa.categoria_id'))
            ->leftJoin('subcategorias', fn ($j) => $j->on('subcategorias.id', '=', 'lancamentos_caixa.subcategoria_id'))
            ->whereBetween($coluna, [$inicio, $fim])
            ->when(filter_var($parametros['somente_contabeis'] ?? false, FILTER_VALIDATE_BOOLEAN), fn ($q) => $q->where('lancamentos_caixa.contabil', true))
            ->selectRaw(EscadaDoDre::efetivaSql().' as linha, lancamentos_caixa.tipo as natureza, lancamentos_caixa.categoria_id as categoria_id, '
                ."DATE_FORMAT({$coluna}, '%Y-%m') as mes, SUM(".LancamentoCaixa::LIQUIDO_SQL.') as total')
            // pelos ALIASES: o MariaDB (ONLY_FULL_GROUP_BY) nem sempre casa a expressão repetida
            ->groupBy('linha', 'natureza', 'categoria_id', 'mes')
            ->toBase()
            ->get()
            ->map(fn (object $linha): array => [
                // a natureza é a do LANÇAMENTO (CR-API1-01): um código que saiu da escada, ou uma
                // linha de receita gravada antes de a categoria virar despesa, cai no padrão da
                // natureza do dinheiro — o sinal nunca inverte
                'linha' => EscadaDoDre::linhaParaSomar((string) $linha->linha, (string) $linha->natureza),
                'categoria_id' => (int) $linha->categoria_id,
                'mes' => (string) $linha->mes,
                'total' => bcadd((string) $linha->total, '0', 2),
            ])
            ->all();
    }

    /** @return list<string> os meses `Y-m` do período */
    private static function meses(string $de, string $ate): array
    {
        $meses = [];
        $cursor = CarbonImmutable::createFromFormat('!Y-m-d', $de)->startOfMonth();
        $fim = CarbonImmutable::createFromFormat('!Y-m-d', $ate)->startOfMonth();
        while ($cursor->lessThanOrEqualTo($fim)) {
            $meses[] = $cursor->format('Y-m');
            $cursor = $cursor->addMonth();
        }

        return $meses;
    }

    private static function chaveDoMes(string $mes): string
    {
        return 'm_'.str_replace('-', '_', $mes);
    }

    private static function rotuloDoMes(string $mes): string
    {
        $nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
        [$ano, $numero] = explode('-', $mes);

        return $nomes[(int) $numero - 1].'/'.$ano;
    }

    /**
     * @param  list<string>  $meses
     * @return array<string, string>
     */
    private static function zerado(array $meses): array
    {
        $zerado = [];
        foreach ($meses as $mes) {
            $zerado[self::chaveDoMes($mes)] = '0.00';
        }
        $zerado['total'] = '0.00';

        return $zerado;
    }

    /**
     * @param  array<string, string>  $a
     * @param  array<string, string>  $b
     * @return array<string, string>
     */
    private static function somar(array $a, array $b): array
    {
        foreach ($b as $chave => $valor) {
            $a[$chave] = bcadd($a[$chave] ?? '0.00', $valor, 2);
        }

        return $a;
    }
}
