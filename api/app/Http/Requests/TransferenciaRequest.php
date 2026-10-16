<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class TransferenciaRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {

        return [
            'conta_origem_id' => [
                'required', 'integer',
                Rule::exists('contas', 'id'),
            ],
            'conta_destino_id' => [
                'required', 'integer', 'different:conta_origem_id', // T-fin-19
                Rule::exists('contas', 'id'),
            ],
            'valor' => ['required', 'numeric', 'decimal:0,2', 'gt:0', 'max:99999999.99'],
            'data' => ['required', 'date_format:Y-m-d', 'after_or_equal:1900-01-01'],
            'obs' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }

    public function messages(): array
    {
        return [
            'conta_destino_id.different' => 'A transferência exige contas de origem e destino distintas.',
        ];
    }
}
