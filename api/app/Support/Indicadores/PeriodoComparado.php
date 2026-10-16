<?php

namespace App\Support\Indicadores;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Carbon\CarbonTimeZone;
use Illuminate\Validation\ValidationException;

/**
 * O período que um painel mede e o período com que ele compara (change indicadores-profissionais,
 * D2) — UMA fonte, no servidor. A tela só escreve "de 1 a 5 de setembro"; quem decide as datas é
 * este objeto, e todos os painéis o usam.
 *
 * Existe porque o número sem comparação justa engana: no dia 5 de outubro, o mês inteiro de
 * setembro contra cinco dias de outubro diz "queda de 80%" todo começo de mês. Daí a regra:
 *  - **mês em curso** (na parede da CLÍNICA): do dia 1 até hoje, contra o mesmo intervalo de dias
 *    do mês anterior, limitado ao último dia dele (31/03 compara com 1–28/02, ou 29 no bissexto);
 *  - **mês fechado:** inteiro contra o anterior inteiro;
 *  - **mês futuro:** recusado (422) — não há o que medir, e um zero ali seria informação falsa;
 *  - **mês antes de 2000:** recusado (422, SEC-IND-03) — nenhuma clínica tem agenda ali, e o ano
 *    0001 levava a série e o mês anterior a datas que o banco não representa.
 *
 * "Hoje" é o relógio da clínica (`clinica.timezone`), nunca o do servidor: às 23h30 em Brasília o
 * UTC já virou o dia, e o painel pularia um dia de comparação. O relógio é injetável para o teste.
 */
final class PeriodoComparado
{
    /** O mês mais antigo que um painel aceita (SEC-IND-03). */
    public const PRIMEIRO_MES = '2000-01';

    private function __construct(
        public readonly string $mes,
        public readonly CarbonImmutable $de,
        public readonly CarbonImmutable $ate,
        public readonly bool $parcial,
        public readonly CarbonImmutable $comparadoDe,
        public readonly CarbonImmutable $comparadoAte,
        public readonly CarbonImmutable $agora,
    ) {}

    /**
     * @param  string  $mes  "YYYY-MM" (já validado pelo boundary; a forma é conferida de novo aqui)
     * @param  string  $fuso  o fuso da clínica
     * @param  CarbonInterface|null  $relogio  o instante de agora — `null` é o relógio real
     *
     * @throws ValidationException Se o mês não for "YYYY-MM", for anterior a 2000 ou estiver no futuro da clínica
     */
    public static function doMes(string $mes, string $fuso, ?CarbonInterface $relogio = null): self
    {
        if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $mes) !== 1) {
            throw ValidationException::withMessages(['mes' => 'Informe o mês no formato AAAA-MM.']);
        }
        // "AAAA-MM" com zeros à esquerda: a comparação de texto é a de calendário
        if ($mes < self::PRIMEIRO_MES) {
            throw ValidationException::withMessages(['mes' => 'Informe um mês a partir de janeiro de 2000.']);
        }

        $agora = CarbonImmutable::instance($relogio ?? now())->setTimezone($fuso);
        $hoje = $agora->startOfDay();
        $primeiro = CarbonImmutable::createFromFormat('Y-m-d H:i:s', $mes.'-01 00:00:00', $fuso);
        $mesCorrente = $hoje->startOfMonth();

        if ($primeiro->greaterThan($mesCorrente)) {
            throw ValidationException::withMessages(['mes' => 'O mês pedido ainda não começou.']);
        }

        $anterior = $primeiro->subMonthNoOverflow();

        if ($primeiro->equalTo($mesCorrente)) {
            // o mesmo intervalo de dias, limitado ao tamanho do mês anterior
            $diaFinal = min($hoje->day, $anterior->daysInMonth);

            return new self($mes, $primeiro, $hoje, true, $anterior, $anterior->setDay($diaFinal), $agora);
        }

        return new self($mes, $primeiro, $primeiro->endOfMonth()->startOfDay(), false, $anterior, $anterior->endOfMonth()->startOfDay(), $agora);
    }

    /** O objeto `periodo` da resposta (D9) — datas "Y-m-d", nada calculado na tela. */
    public function paraResposta(): array
    {
        return [
            'mes' => $this->mes,
            'de' => $this->de->toDateString(),
            'ate' => $this->ate->toDateString(),
            'parcial' => $this->parcial,
            'comparado_de' => $this->comparadoDe->toDateString(),
            'comparado_ate' => $this->comparadoAte->toDateString(),
        ];
    }

    /**
     * Os limites do período MEDIDO para coluna de parede (`inicio`, `pago_em`): o dia inteiro nas
     * duas pontas.
     *
     * @return array{0: string, 1: string}
     */
    public function limites(): array
    {
        return self::diasInteiros($this->de, $this->ate);
    }

    /** @return array{0: string, 1: string} os limites do período COMPARADO, como `limites()` */
    public function limitesComparados(): array
    {
        return self::diasInteiros($this->comparadoDe, $this->comparadoAte);
    }

    /**
     * Os limites em UTC, para coluna gravada pelo framework (`created_at`, `criado_em` da trilha):
     * às 22h em São Paulo o UTC já é o dia seguinte, e o paciente cadastrado no último dia do mês
     * cairia no mês seguinte.
     *
     * @param  array{0: string, 1: string}  $limites  um par de `limites()`/`limitesComparados()`
     * @return array{0: string, 1: string}
     */
    public function emUtc(array $limites): array
    {
        return self::limitesEmUtc($limites, $this->agora->getTimezone());
    }

    /**
     * A MESMA conversão de `emUtc`, para quem não tem um período comparado na mão — a vista antiga
     * `GET /api/indicadores/pacientes` (CR-IND-05) converte o mês por aqui, e os dois endpoints
     * põem o cadastro das 22h do último dia no mesmo mês.
     *
     * @param  array{0: string, 1: string}  $limites  "Y-m-d H:i:s" na parede da clínica
     * @return array{0: string, 1: string}
     */
    public static function limitesEmUtc(array $limites, CarbonTimeZone|string $fuso): array
    {
        return [
            CarbonImmutable::parse($limites[0], $fuso)->utc()->format('Y-m-d H:i:s'),
            CarbonImmutable::parse($limites[1], $fuso)->utc()->format('Y-m-d H:i:s'),
        ];
    }

    /** O instante de agora na parede da clínica — o corte de "sessão que já passou" (D4). */
    public function agoraNaParede(): string
    {
        return $this->agora->format('Y-m-d H:i:s');
    }

    /** A data de hoje na parede da clínica. */
    public function hoje(): string
    {
        return $this->agora->toDateString();
    }

    /**
     * Os meses da série: `$quantos` meses terminando no mês pedido, do mais antigo ao mais novo.
     *
     * @return list<string>
     */
    public function mesesDaSerie(int $quantos = 6): array
    {
        $meses = [];
        for ($i = $quantos - 1; $i >= 0; $i--) {
            $meses[] = $this->de->subMonthsNoOverflow($i)->format('Y-m');
        }

        return $meses;
    }

    /** @return array{0: string, 1: string} */
    private static function diasInteiros(CarbonImmutable $de, CarbonImmutable $ate): array
    {
        return [$de->format('Y-m-d').' 00:00:00', $ate->format('Y-m-d').' 23:59:59'];
    }
}
