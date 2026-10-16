<?php

namespace App\Support\Relatorios;

/**
 * O relatório em planilha (change `relatorio-em-planilha`): o MESMO envelope da tela e do papel,
 * desenhado como CSV que o Excel em pt-BR abre com duplo clique (D1):
 * - UTF-8 com BOM (sem ele, os acentos quebram);
 * - separador `;` e vírgula decimal, sem separador de milhar (o Excel lê como número);
 * - datas em dd/mm/aaaa.
 *
 * Cabeçalho como o papel (título, período, filtros, base, avisos), a linha dos rótulos, as linhas
 * (ou, no sintético, cada grupo) e os totais. O corte no teto é dito ANTES de tudo.
 *
 * Texto que começa com `= + - @`, tabulação ou retorno sai com apóstrofo na frente (D3, OWASP
 * CSV injection): um nome de criança ou uma categoria nunca vira fórmula no Excel. Número sai como
 * número — um `-350,00` é dinheiro, não texto.
 *
 * A linha com `nivel` (o DRE) sai recuada na primeira coluna, como na tela: sem o recuo, a linha
 * da escada e a categoria dentro dela ficam iguais no Excel. O recuo entra DEPOIS da neutralização.
 */
final class PlanilhaDoRelatorio
{
    private const SEPARADOR = ';';

    private const RECUO = '    ';

    private const BOM = "\xEF\xBB\xBF";

    /** @var list<string> */
    private const TIPOS_NUMERICOS = ['dinheiro', 'numero', 'percentual'];

    public static function csv(Envelope $envelope): string
    {
        $linhas = [];

        if ($envelope->truncado) {
            $linhas[] = ['Atenção: o relatório passou do teto de '.Envelope::LIMITE_DE_LINHAS.' linhas — esta planilha traz só as primeiras.'];
        }
        $linhas[] = [$envelope->titulo];
        if ($envelope->periodo !== null) {
            $linhas[] = ['Período', self::data($envelope->periodo['de']).' a '.self::data($envelope->periodo['ate'])];
        }
        foreach ($envelope->filtrosAplicados as $filtro) {
            $linhas[] = [$filtro['rotulo'], $filtro['valor']];
        }
        foreach ($envelope->avisos as $aviso) {
            $linhas[] = ['Aviso', $aviso];
        }
        $linhas[] = [];

        $colunas = $envelope->colunas;
        $linhas[] = array_map(fn (array $coluna): string => $coluna['rotulo'], $colunas);

        if ($envelope->grupos === null) {
            foreach ($envelope->linhas as $linha) {
                $linhas[] = self::recuada(self::celulas($colunas, $linha), $linha['nivel'] ?? 0);
            }
        } else {
            foreach ($envelope->grupos as $grupo) {
                if ($grupo['linhas'] === []) {
                    // o grupo É a linha: o título na primeira coluna, os totais nas suas
                    $linhas[] = self::celulas($colunas, [...$grupo['totais'], $colunas[0]['chave'] => $grupo['titulo']]);

                    continue;
                }
                $linhas[] = [$grupo['titulo']];
                foreach ($grupo['linhas'] as $linha) {
                    $linhas[] = self::celulas($colunas, $linha);
                }
                $linhas[] = self::celulas($colunas, [...$grupo['totais'], $colunas[0]['chave'] => 'Total — '.$grupo['titulo']]);
            }
        }

        $totais = array_intersect_key($envelope->totais, array_flip(array_column($colunas, 'chave')));
        if ($totais !== []) {
            $linhas[] = self::celulas($colunas, [...$totais, $colunas[0]['chave'] => 'Total']);
        }

        return self::BOM.implode("\r\n", array_map(
            fn (array $celulas): string => implode(self::SEPARADOR, array_map(self::celulaCsv(...), $celulas)),
            $linhas,
        ))."\r\n";
    }

    /**
     * Uma linha do envelope nas colunas, formatada pelo tipo de cada uma.
     *
     * @param  list<array{chave: string, rotulo: string, tipo: string}>  $colunas
     * @param  array<string, mixed>  $valores
     * @return list<string|array{numero: string}>
     */
    private static function celulas(array $colunas, array $valores): array
    {
        return array_map(function (array $coluna) use ($valores): string|array {
            $valor = $valores[$coluna['chave']] ?? null;
            if ($valor === null || $valor === '') {
                return '';
            }
            if (in_array($coluna['tipo'], self::TIPOS_NUMERICOS, true) && is_numeric($valor)) {
                return ['numero' => str_replace('.', ',', (string) $valor)];
            }
            if ($coluna['tipo'] === 'data' && is_string($valor) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $valor) === 1) {
                return self::data($valor);
            }

            return (string) $valor;
        }, $colunas);
    }

    /**
     * A primeira célula de texto leva o nível da linha para o `celulaCsv` recuar.
     *
     * @param  list<string|array{numero: string}>  $celulas
     * @return list<string|array{numero: string}|array{texto: string, nivel: int}>
     */
    private static function recuada(array $celulas, mixed $nivel): array
    {
        if (is_int($nivel) && $nivel > 0 && isset($celulas[0]) && is_string($celulas[0])) {
            $celulas[0] = ['texto' => $celulas[0], 'nivel' => $nivel];
        }

        return $celulas;
    }

    /**
     * `numero` sai cru; texto sai neutralizado (fórmula), recuado pelo nível e entre aspas.
     *
     * @param  string|array{numero: string}|array{texto: string, nivel: int}  $celula
     */
    private static function celulaCsv(string|array $celula): string
    {
        if (isset($celula['numero'])) {
            return $celula['numero'];
        }
        [$celula, $nivel] = is_array($celula) ? [$celula['texto'], $celula['nivel']] : [$celula, 0];
        // os sinais de largura cheia (＝ ＋ － ＠) e a quebra de linha também viram fórmula no
        // Excel (SEC-FIN-04, lista da OWASP)
        if ($celula !== '' && preg_match('/^[=+\-@\t\r\n\x{FF1D}\x{FF0B}\x{FF0D}\x{FF20}]/u', $celula) === 1) {
            $celula = "'".$celula;
        }

        return '"'.str_replace('"', '""', str_repeat(self::RECUO, $nivel).$celula).'"';
    }

    private static function data(string $iso): string
    {
        [$ano, $mes, $dia] = explode('-', $iso);

        return "{$dia}/{$mes}/{$ano}";
    }
}
