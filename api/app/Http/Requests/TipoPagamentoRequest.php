<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class TipoPagamentoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        return [
            'nome' => [
                'required', 'string', 'max:60',
                Rule::unique('tipos_pagamento', 'nome')
                    ->ignore($this->route('id')),
            ],
        ];
    }

    public function messages(): array
    {
        return ['nome.unique' => 'Já existe uma forma de pagamento com este nome.'];
    }
}
