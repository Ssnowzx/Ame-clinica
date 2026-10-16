<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class EquipamentoRequest extends FormRequest
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
                Rule::unique('equipamentos', 'nome')
                    ->ignore($this->route('id')),
            ],
            'quantidade_total' => ['required', 'integer', 'min:1', 'max:1000'],
            // FK inexistente é rejeitada na validação (abuse case das fundações)
            'especialidade_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('especialidades', 'id'),
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'nome.unique' => 'Já existe um equipamento com este nome.',
            'especialidade_id.exists' => 'Especialidade inválida.',
        ];
    }
}
