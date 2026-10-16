<?php

namespace App\Support\Relatorios;

use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\Carbon;
use InvalidArgumentException;

/**
 * A ABERTURA de um tratamento e os limites de um período, no fuso da CLÍNICA — em UM lugar,
 * para os três relatórios de tratamento (sessões, sem lançamento, serviços) dizerem a mesma
 * coisa quando falam "aberto no período".
 *
 * `tratamentos` não tem coluna de abertura: `data_inicio` é opcional (o formulário aceita
 * vazio) e `created_at` é UTC. A abertura é `data_inicio` quando informada, senão a DATA de
 * `created_at` convertida para a parede da clínica — às 22h em São Paulo o UTC já virou o dia
 * seguinte, e um pacote aberto hoje cairia em amanhã.
 *
 * O deslocamento é o de AGORA no fuso da clínica (`P` → `-03:00`). O Brasil não tem horário de
 * verão; num fuso que tenha, uma abertura na virada do dia em outro regime pode escorregar
 * um dia — limitação declarada, não escondida.
 */
final class PeriodoDoTratamento
{
    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /** A expressão SQL da data de abertura, na parede da clínica — serve a WHERE, SELECT e GROUP BY. */
    public function expressaoDeAbertura(): string
    {
        $deslocamento = now($this->fuso())->format('P');

        // interpolado, não binding: a MESMA expressão entra no WHERE e no GROUP BY, e binding
        // repetido desalinha a lista; daí a cerca de forma — só `±HH:MM` atravessa
        if (! preg_match('/^[+-]\d{2}:\d{2}$/', $deslocamento)) {
            throw new InvalidArgumentException("Deslocamento de fuso inesperado: `{$deslocamento}`.");
        }

        return "COALESCE(tratamentos.data_inicio, DATE(CONVERT_TZ(tratamentos.created_at, '+00:00', '{$deslocamento}')))";
    }

    /**
     * Os limites UTC de um período de dias da clínica, para comparar com coluna datetime UTC
     * (`updated_at`): `de 00:00:00` e `ate 23:59:59` na parede, convertidos.
     *
     * @return array{0: string, 1: string}
     */
    public function limitesUtc(string $de, string $ate): array
    {
        $fuso = $this->fuso();

        return [
            Carbon::parse("{$de} 00:00:00", $fuso)->utc()->format('Y-m-d H:i:s'),
            Carbon::parse("{$ate} 23:59:59", $fuso)->utc()->format('Y-m-d H:i:s'),
        ];
    }

    private function fuso(): string
    {
        return (string) $this->configuracoes->get('clinica.timezone');
    }
}
