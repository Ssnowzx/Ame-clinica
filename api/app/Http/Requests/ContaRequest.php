<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ContaRequest extends FormRequest
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
                Rule::unique('contas', 'nome')
                    ->ignore($this->route('id')),
            ],
            'codigo_contabil' => ['sometimes', 'nullable', 'string', 'max:30'],
            'ativo' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return ['nome.unique' => 'Já existe uma conta com este nome.'];
    }
}
