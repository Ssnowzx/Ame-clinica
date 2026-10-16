<?php

namespace App\Support\Indicadores;

use DateTimeImmutable;
use DateTimeZone;

/**
 * A CAPACIDADE de um profissional num mês, pela grade REAL (change
 * produtividade-do-profissional, D1) — não por "60 ÷ intervalo".
 *
 * PURA: recebe as janelas por dia da semana, os feriados e os bloqueios já lidos, e devolve
 * minutos. Nada de Eloquent, para a conta ser testável em unidade; quem lê o banco é
 * `ProdutividadeDoMes`. A conta é CALENDÁRIO (feriado recorrente por dia-mês, interseção de
 * intervalos), e por isso mora em PHP e não em SQL.
 *
 * Regras, dia a dia do mês:
 *  - as janelas do `dia_semana` (ISO 1=segunda…7=domingo) somam os minutos do dia;
 *  - dia de FERIADO (fixo com a data igual, OU recorrente com o mesmo dia-mês em qualquer ano —
 *    a MESMA regra de `feriadoDoDia` em `web/src/lib/grade-agenda.ts`) → os minutos do dia vão
 *    para `minutos_em_feriados` e NÃO para a grade; bloqueio nesse dia não desconta de novo;
 *  - bloqueio desconta SÓ a interseção com as janelas do dia (um bloqueio de 07:00–09:00 numa
 *    janela de 08:00–12:00 desconta 60, não 120); bloqueios sobrepostos entre si contam uma vez;
 *  - `minutos_na_grade` = janelas − feriados − bloqueios, nunca negativo.
 *
 * O fuso NÃO entra: os dias do mês são os dias do calendário e os bloqueios chegam na parede
 * da clínica, como todo `inicio`/`fim` da agenda — a aritmética é feita em UTC só para não
 * depender de horário de verão, que já não existe no Brasil.
 */
final class CapacidadeDoMes
{
    /**
     * @param  array<int|string, list<array{inicio: string, fim: string}>>  $janelas  dia ISO → intervalos "HH:MM[:SS]" (o `mapaDeHorarios()` do profissional)
     * @param  list<array{data: string, recorrente: bool}>  $feriados  só os ATIVOS — quem filtra é o leitor, como `/agenda/selecao` faz para a grade
     * @param  list<array{inicio: string, fim: string}>  $bloqueios  ocorrências "Y-m-d H:i[:s]" do profissional, já expandidas em linhas (a série grava uma linha por semana)
     * @return array{minutos_na_grade: int, minutos_em_feriados: int, minutos_em_bloqueios: int, por_dia_da_semana: array<int, int>}
     */
    public static function calcular(int $ano, int $mes, array $janelas, array $feriados, array $bloqueios): array
    {
        $diasNoMes = (int) self::momento(sprintf('%04d-%02d-01', $ano, $mes))->format('t');
        $bloqueiosEmMinutos = array_map(
            fn (array $bloqueio): array => [self::minutosAbsolutos($bloqueio['inicio']), self::minutosAbsolutos($bloqueio['fim'])],
            $bloqueios,
        );

        $naGrade = 0;
        $emFeriados = 0;
        $emBloqueios = 0;
        $porDiaDaSemana = array_fill(1, 7, 0);

        for ($dia = 1; $dia <= $diasNoMes; $dia++) {
            $data = sprintf('%04d-%02d-%02d', $ano, $mes, $dia);
            $diaIso = (int) self::momento($data)->format('N');
            $janelasDoDia = $janelas[$diaIso] ?? [];

            if ($janelasDoDia === []) {
                continue;
            }

            $minutosDasJanelas = 0;
            $intervalosDoDia = [];
            foreach ($janelasDoDia as $janela) {
                $inicio = self::minutosAbsolutos($data.' '.$janela['inicio']);
                $fim = self::minutosAbsolutos($data.' '.$janela['fim']);
                $minutosDasJanelas += max(0, $fim - $inicio);
                $intervalosDoDia[] = [$inicio, $fim];
            }

            if (self::ehFeriado($data, $feriados)) {
                $emFeriados += $minutosDasJanelas;

                continue;
            }

            $bloqueado = 0;
            foreach ($intervalosDoDia as [$inicio, $fim]) {
                $bloqueado += self::minutosBloqueados($inicio, $fim, $bloqueiosEmMinutos);
            }

            $liquido = max(0, $minutosDasJanelas - $bloqueado);
            $emBloqueios += $minutosDasJanelas - $liquido;
            $naGrade += $liquido;
            $porDiaDaSemana[$diaIso] += $liquido;
        }

        return [
            'minutos_na_grade' => $naGrade,
            'minutos_em_feriados' => $emFeriados,
            'minutos_em_bloqueios' => $emBloqueios,
            'por_dia_da_semana' => $porDiaDaSemana,
        ];
    }

    /**
     * As faixas do dia do mapa de ocupação (change indicadores-profissionais, D9): manhã antes
     * das 12h, tarde das 12h às 18h, noite a partir das 18h — em minutos desde a meia-noite.
     * São as MESMAS fronteiras da expressão SQL que agrupa as sessões
     * (`SessoesDoPeriodo::FAIXA_SQL`): capacidade e marcadas têm de cair no mesmo balde.
     */
    public const FAIXAS_DO_DIA = [
        'manha' => [0, 12 * 60],
        'tarde' => [12 * 60, 18 * 60],
        'noite' => [18 * 60, 24 * 60],
    ];

    /**
     * A capacidade de um PERÍODO de dias (`$de`..`$ate`, "Y-m-d", inclusivos) partida por dia da
     * semana × faixa do dia — o denominador do mapa de ocupação e da ocupação do painel
     * (change indicadores-profissionais, D4/D8). As regras são as de `calcular()`, dia a dia:
     * feriado zera o dia, bloqueio desconta só a interseção (sobrepostos contam uma vez). Cada
     * janela é recortada nas faixas e cada recorte desconta os seus bloqueios — os recortes
     * particionam a janela, então somar as faixas de um mês inteiro dá `minutos_na_grade`
     * (o teste de unidade prende a igualdade).
     *
     * @param  array<int|string, list<array{inicio: string, fim: string}>>  $janelas
     * @param  list<array{data: string, recorrente: bool}>  $feriados
     * @param  list<array{inicio: string, fim: string}>  $bloqueios
     * @return array<int, array<string, int>> dia ISO (1..7) → faixa → minutos líquidos
     */
    public static function porFaixaDoDia(string $de, string $ate, array $janelas, array $feriados, array $bloqueios): array
    {
        $bloqueiosEmMinutos = array_map(
            fn (array $bloqueio): array => [self::minutosAbsolutos($bloqueio['inicio']), self::minutosAbsolutos($bloqueio['fim'])],
            $bloqueios,
        );
        $porFaixa = array_fill(1, 7, array_fill_keys(array_keys(self::FAIXAS_DO_DIA), 0));

        for ($dia = self::momento($de); $dia <= self::momento($ate); $dia = $dia->modify('+1 day')) {
            $data = $dia->format('Y-m-d');
            $diaIso = (int) $dia->format('N');
            $janelasDoDia = $janelas[$diaIso] ?? [];

            if ($janelasDoDia === [] || self::ehFeriado($data, $feriados)) {
                continue;
            }

            $meiaNoite = self::minutosAbsolutos($data);
            foreach ($janelasDoDia as $janela) {
                $inicio = self::minutosAbsolutos($data.' '.$janela['inicio']);
                $fim = self::minutosAbsolutos($data.' '.$janela['fim']);

                foreach (self::FAIXAS_DO_DIA as $faixa => [$comeco, $termino]) {
                    $recorteDe = max($inicio, $meiaNoite + $comeco);
                    $recorteAte = min($fim, $meiaNoite + $termino);
                    if ($recorteDe >= $recorteAte) {
                        continue;
                    }
                    $bloqueado = self::minutosBloqueados($recorteDe, $recorteAte, $bloqueiosEmMinutos);
                    $porFaixa[$diaIso][$faixa] += max(0, $recorteAte - $recorteDe - $bloqueado);
                }
            }
        }

        return $porFaixa;
    }

    /**
     * Feriado do dia — recorrente vale para o mesmo dia e mês de QUALQUER ano (o cadastro guarda
     * o ano em que foi criado); fixo só na data exata. Espelho de `feriadoDoDia` do web.
     *
     * @param  list<array{data: string, recorrente: bool}>  $feriados
     */
    private static function ehFeriado(string $data, array $feriados): bool
    {
        $diaMes = substr($data, 5);

        foreach ($feriados as $feriado) {
            $bate = $feriado['recorrente']
                ? substr($feriado['data'], 5) === $diaMes
                : $feriado['data'] === $data;

            if ($bate) {
                return true;
            }
        }

        return false;
    }

    /**
     * Minutos de UMA janela cobertos por bloqueio: recorta cada bloqueio à janela, funde os
     * recortes que se sobrepõem e soma — dois bloqueios em cima um do outro descontam uma vez.
     *
     * @param  list<array{0: int, 1: int}>  $bloqueios  em minutos absolutos
     */
    private static function minutosBloqueados(int $inicioDaJanela, int $fimDaJanela, array $bloqueios): int
    {
        $recortes = [];
        foreach ($bloqueios as [$inicio, $fim]) {
            $de = max($inicio, $inicioDaJanela);
            $ate = min($fim, $fimDaJanela);
            if ($de < $ate) {
                $recortes[] = [$de, $ate];
            }
        }

        if ($recortes === []) {
            return 0;
        }

        usort($recortes, fn (array $a, array $b): int => $a[0] <=> $b[0]);

        $total = 0;
        [$de, $ate] = $recortes[0];
        foreach (array_slice($recortes, 1) as [$inicio, $fim]) {
            if ($inicio <= $ate) {
                $ate = max($ate, $fim);

                continue;
            }
            $total += $ate - $de;
            [$de, $ate] = [$inicio, $fim];
        }

        return $total + ($ate - $de);
    }

    /** "Y-m-d H:i[:s]" (ou "Y-m-d") → minutos desde a época, num fuso fixo. */
    private static function minutosAbsolutos(string $dataHora): int
    {
        return intdiv(self::momento($dataHora)->getTimestamp(), 60);
    }

    private static function momento(string $dataHora): DateTimeImmutable
    {
        return new DateTimeImmutable($dataHora, new DateTimeZone('UTC'));
    }
}
