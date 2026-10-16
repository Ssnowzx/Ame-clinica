<?php

namespace App\Support\Ciclos;

use App\Models\Convenio;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * A DERIVAÇÃO do período do ciclo a partir do calendário do convênio (D1).
 *
 * Duas formas, ambas DADO no convênio (§13): `dia_fixo` com dia de corte D — o período
 * vai de D+1 de um mês a D do seguinte (Unimed, D=15 ⇒ 16→15) — e `ultimo_dia`, em que o
 * período é o mês calendário (SC Saúde).
 *
 * **Por que o domínio para em 28 (SEC-FC-21).** A derivação precisa PARTICIONAR o
 * calendário: cada dia pertence a exatamente um período, sem buraco e sem sobreposição.
 * Isso vale porque a janela é sempre `[corte anterior + 1 dia, corte]` e o dia D existe em
 * TODO mês quando D ≤ 28 — inclusive fevereiro. Com corte em 29–31 seria preciso clampar
 * nos meses curtos, e o clamp abre buraco: corte 30 daria 31/01–28/02 seguido de
 * 01/03–30/03, deixando 31/03 fora de todo período — um dia eternamente editável, que é
 * exatamente a garantia que esta change existe para dar. O teste de partição
 * (`CalendarioDoCicloTest`) prova isso para os 28 valores × 24 meses consecutivos.
 *
 * Note que a janela do `dia_fixo` NÃO é "D+1 a D" mecanicamente: é o dia SEGUINTE ao
 * corte anterior. Com D=28, o corte anterior 28/02 dá início em 01/03 (e não num
 * inexistente 29/02); em ano bissexto o mesmo corte dá 29/02. É essa formulação — e não a
 * aritmética ingênua de dia — que faz a partição fechar.
 *
 * Todas as janelas são calculadas na PAREDE da clínica: quem chama passa uma data já
 * naive no fuso da clínica; nenhuma conversão acontece aqui.
 */
final class CalendarioDoCiclo
{
    public const TIPO_DIA_FIXO = 'dia_fixo';

    public const TIPO_ULTIMO_DIA = 'ultimo_dia';

    public const TIPOS = [self::TIPO_DIA_FIXO, self::TIPO_ULTIMO_DIA];

    public const DIA_CORTE_MIN = 1;

    /** SEC-FC-21 — ver docblock: acima de 28 a derivação deixaria dias órfãos. */
    public const DIA_CORTE_MAX = 28;

    /**
     * O convênio tem calendário? Sem ele NÃO há ciclo: nenhum período é derivável e
     * nada muda no comportamento do sistema para esse convênio (fail-safe, D1).
     */
    public static function configurado(?string $tipo, ?int $dia): bool
    {
        if ($tipo === self::TIPO_ULTIMO_DIA) {
            return true;
        }

        return $tipo === self::TIPO_DIA_FIXO
            && $dia !== null
            && $dia >= self::DIA_CORTE_MIN
            && $dia <= self::DIA_CORTE_MAX;
    }

    public static function doConvenio(Convenio $convenio): bool
    {
        return self::configurado($convenio->ciclo_tipo_corte, $convenio->ciclo_dia_corte);
    }

    /**
     * A janela que CONTÉM a data — o coração da partição.
     *
     * @return array{periodo_inicio: string, periodo_fim: string} datas Y-m-d
     */
    public static function janelaQueContem(string $tipo, ?int $dia, CarbonInterface $data): array
    {
        $data = CarbonImmutable::parse($data->format('Y-m-d'));

        if ($tipo === self::TIPO_ULTIMO_DIA) {
            return [
                'periodo_inicio' => $data->startOfMonth()->format('Y-m-d'),
                'periodo_fim' => $data->endOfMonth()->format('Y-m-d'),
            ];
        }

        // dia_fixo: o FIM é o próximo corte a partir da data (inclusive); o INÍCIO é o
        // dia seguinte ao corte anterior — nunca "D+1", que quebraria em fevereiro
        $corteDoMes = $data->startOfMonth()->addDays($dia - 1);
        $fim = $data->day <= $dia ? $corteDoMes : $corteDoMes->addMonthNoOverflow();
        $inicio = $fim->subMonthNoOverflow()->addDay();

        return [
            'periodo_inicio' => $inicio->format('Y-m-d'),
            'periodo_fim' => $fim->format('Y-m-d'),
        ];
    }

    /**
     * A janela imediatamente anterior à que contém a data — derivada pela MESMA função
     * (o dia anterior ao início pertence, por definição da partição, ao período anterior).
     *
     * @return array{periodo_inicio: string, periodo_fim: string}
     */
    public static function janelaAnterior(string $tipo, ?int $dia, CarbonInterface $data): array
    {
        $atual = self::janelaQueContem($tipo, $dia, $data);

        return self::janelaQueContem(
            $tipo,
            $dia,
            CarbonImmutable::parse($atual['periodo_inicio'])->subDay()
        );
    }

    /**
     * O par (início, fim) corresponde a uma janela DERIVÁVEL deste calendário?
     *
     * Fechar um período arbitrário — "só o dia 07", "o semestre inteiro" — congelaria
     * produção fora de qualquer ciclo que a operadora reconhece, e a não-sobreposição
     * viraria uma corrida de intervalos quaisquer. O período fechado é sempre uma janela
     * do calendário, e ela é reconstruída a partir do próprio início informado.
     */
    public static function ehJanelaDerivavel(string $tipo, ?int $dia, string $inicio, string $fim): bool
    {
        $derivada = self::janelaQueContem($tipo, $dia, CarbonImmutable::parse($inicio));

        return $derivada['periodo_inicio'] === $inicio && $derivada['periodo_fim'] === $fim;
    }
}
