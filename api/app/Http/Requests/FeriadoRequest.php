<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class FeriadoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        return [
            'nome' => [
                'required', 'string', 'max:255',
                Rule::unique('feriados', 'nome')
                    ->where('data', (string) $this->input('data'))
                    ->ignore($this->route('id')),
            ],
            'data' => ['required', 'date_format:Y-m-d', 'after_or_equal:1900-01-01'],
            'recorrente' => ['sometimes', 'boolean'],
            'ativo' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'nome.unique' => 'Este feriado já está cadastrado nesta data.',
        ];
    }
}
