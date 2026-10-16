<?php

namespace App\Http\Requests;

use App\Models\Tarefa;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Criação/edição de tarefa do mural. Responsável tem de ser usuário ATIVO
 * (422 — spec tarefas); coluna/prioridade são domínio em Rule::in,
 * nunca ENUM de banco (design D1). Edição é PARCIAL: chave ausente preserva.
 */
class TarefaRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        $criando = $this->route('id') === null;

        return [
            'titulo' => [$criando ? 'required' : 'sometimes', 'string', 'min:2', 'max:200'],
            'descricao' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'coluna' => ['sometimes', 'string', Rule::in(Tarefa::COLUNAS)],
            'prioridade' => ['sometimes', 'string', Rule::in(Tarefa::PRIORIDADES)],
            'prazo' => ['sometimes', 'nullable', 'date'],
            'etiquetas' => ['sometimes', 'nullable', 'string', 'max:255'],
            'responsaveis' => ['sometimes', 'array', 'max:50'],
            'responsaveis.*' => [
                'integer',
                Rule::exists('usuarios', 'id')
                    ->where('ativo', true),
            ],
        ];
    }
}
