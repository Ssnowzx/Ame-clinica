<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class EspecialidadeRequest extends FormRequest
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
                Rule::unique('especialidades', 'nome')
                    ->ignore($this->route('id')),
            ],
            'tempo_sessao' => ['required', 'integer', 'min:5', 'max:480'],
            'cor' => ['required', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'exige_termo' => ['sometimes', 'boolean'],
            'oculta_agendamento_online' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'nome.unique' => 'Já existe uma especialidade com este nome.',
            'cor.regex' => 'A cor deve estar no formato #RRGGBB.',
        ];
    }
}
