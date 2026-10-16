<?php

namespace App\Support\Relatorios;

use InvalidArgumentException;

/**
 * O ENVELOPE único de todo relatório (change `area-de-relatorios`, D2): a API manda as
 * colunas, e a tela genérica renderiza qualquer relatório sem conhecer o formato dele.
 *
 * É declarativo de propósito: `colunas[{chave, rotulo, tipo}]` acompanha `linhas`, e o
 * `tipo` é o que diz como formatar (dinheiro pela `formatarMoeda` da casa; a tela NÃO faz
 * aritmética — só o servidor soma, em decimal). Dinheiro vai como string decimal
 * (`"1234.50"`), data como `YYYY-MM-DD`, hora como `HH:MM`.
 *
 * Um envelope mal montado (tipo de coluna inexistente, total não numérico) falha AQUI, no
 * construtor — e portanto no teste do relatório —, nunca na tela da recepção.
 */
final class Envelope
{
    /**
     * O teto do analítico. Acima disto as linhas são cortadas e `truncado` avisa — o papel
     * imprime o que veio e diz que há mais. Cada relatório recebe o limite pelo construtor
     * (default este) para o teste do corte não precisar criar 2001 registros.
     */
    public const LIMITE_DE_LINHAS = 2000;

    /** @var list<string> */
    public const TIPOS = ['texto', 'numero', 'dinheiro', 'data', 'hora', 'percentual'];

    /**
     * @param  array{de: string, ate: string}|null  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtrosAplicados  legíveis — o cabeçalho impresso
     * @param  list<array{chave: string, rotulo: string, tipo: string}>  $colunas
     * @param  list<array<string, mixed>>  $linhas  o analítico (vazio no sintético)
     * @param  list<array{titulo: string, linhas: list<array<string, mixed>>, totais: array<string, int|float|string>}>|null  $grupos  o sintético com divisão
     * @param  array<string, int|float|string>  $totais  SÓ chaves numéricas
     * @param  list<string>  $avisos  frases para quem lê o papel (ex.: pagamentos sem profissional)
     *                                — NÃO são filtros: a tela as desenha como o aviso de corte
     */
    public function __construct(
        public readonly string $slug,
        public readonly string $titulo,
        public readonly ?array $periodo,
        public readonly array $filtrosAplicados,
        public readonly array $colunas,
        public readonly array $linhas,
        public readonly ?array $grupos,
        public readonly array $totais,
        public readonly bool $truncado = false,
        public readonly array $avisos = [],
    ) {
        foreach ($this->colunas as $coluna) {
            if (! isset($coluna['chave'], $coluna['rotulo'], $coluna['tipo'])) {
                throw new InvalidArgumentException("Coluna sem chave/rotulo/tipo no relatório `{$slug}`.");
            }
            if (! in_array($coluna['tipo'], self::TIPOS, true)) {
                throw new InvalidArgumentException("Tipo de coluna `{$coluna['tipo']}` desconhecido no relatório `{$slug}`.");
            }
        }

        self::assegurarNumericos($this->totais, $slug);
        foreach ($this->avisos as $aviso) {
            if (! is_string($aviso) || $aviso === '') {
                throw new InvalidArgumentException("Aviso vazio ou não textual no relatório `{$slug}`.");
            }
        }
        foreach ($this->grupos ?? [] as $grupo) {
            self::assegurarNumericos($grupo['totais'] ?? [], $slug);
        }
    }

    /**
     * `contagem` é o número de LINHAS do relatório — o que o papel chama de "N linhas". No
     * analítico, as linhas devolvidas (já cortadas, se `truncado`). No sintético, a soma das
     * linhas dos grupos; um grupo SEM linhas é ele próprio uma linha da tabela (o sintético
     * por dimensão) e conta 1.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $contagem = $this->grupos === null
            ? count($this->linhas)
            : array_sum(array_map(fn (array $grupo): int => count($grupo['linhas']) ?: 1, $this->grupos));

        return [
            'slug' => $this->slug,
            'titulo' => $this->titulo,
            'periodo' => $this->periodo,
            'filtros_aplicados' => $this->filtrosAplicados,
            'colunas' => $this->colunas,
            'linhas' => $this->linhas,
            'grupos' => $this->grupos,
            'totais' => $this->totais,
            'contagem' => $contagem,
            'truncado' => $this->truncado,
            'avisos' => $this->avisos,
        ];
    }

    /**
     * @param  array<string, mixed>  $totais
     */
    private static function assegurarNumericos(array $totais, string $slug): void
    {
        foreach ($totais as $chave => $valor) {
            if (! is_int($valor) && ! is_float($valor) && ! (is_string($valor) && is_numeric($valor))) {
                throw new InvalidArgumentException("Total `{$chave}` não numérico no relatório `{$slug}`.");
            }
        }
    }
}
