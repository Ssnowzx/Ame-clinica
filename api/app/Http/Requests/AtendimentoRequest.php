<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Forma dos campos do atendimento; as invariantes temporais (não-futuro, ordem)
 * são validadas no ESTADO FINAL pelo controller (T-ate-02).
 */
class AtendimentoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        return [
            'iniciado_em' => ['sometimes', 'nullable', 'date_format:Y-m-d H:i'],
            'finalizado_em' => ['sometimes', 'date_format:Y-m-d H:i', 'after_or_equal:1900-01-01'],
            'observacoes' => ['sometimes', 'nullable', 'string', 'max:2000'], // T-ate-03
        ];
    }
}
