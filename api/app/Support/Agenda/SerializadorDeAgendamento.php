<?php

namespace App\Support\Agenda;

use App\Models\Agendamento;

/**
 * Forma do agendamento na API — em UM lugar só.
 *
 * Duas rotas criam agendamento (`POST /agendamentos` e o encaixe da fila): com
 * dois serializadores, o primeiro campo novo sairia por uma e não pela outra,
 * em silêncio (parecer code-review §7).
 */
final class SerializadorDeAgendamento
{
    /** @var list<string> */
    public const CAMPOS = [
        'id', 'tipo', 'paciente_id', 'profissional_id', 'especialidade_id',
        'tratamento_id', 'sala_id', 'equipamento_id', 'medico_id', 'status_id',
        'inicio', 'fim', 'origem', 'is_reposicao', 'reposicao_de_id',
        'recorrencia_grupo_id', 'obs',
        'updated_at', // token da concorrência otimista — do AGENDAMENTO (C8: o card da grade hidrata edição)
    ];

    /** @return array<string, mixed> */
    public static function escalares(Agendamento $agendamento): array
    {
        return [
            ...collect($agendamento->attributesToArray())->only(self::CAMPOS)->all(),
            'duracao_minutos' => $agendamento->duracao_minutos,
        ];
    }
}
