<?php

namespace App\Http\Requests;

use App\Models\Categoria;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CategoriaRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        return [
            'nome' => [
                'required', 'string', 'max:100',
                // O índice único do banco é (nome, tipo). Sem esta regra o nome
                // repetido subia UniqueConstraintViolation e virava 500 genérico na cara de
                // quem cadastra — e é o erro mais provável do primeiro dia, porque o catálogo
                // padrão já semeia "Atendimentos" e "Despesas da clínica" (achado do gate).
                Rule::unique('categorias', 'nome')
                    ->where('tipo', $this->input('tipo'))
                    ->ignore($this->route('id')),
            ],
            'tipo' => ['required', Rule::in(Categoria::TIPOS)],
        ];
    }

    public function messages(): array
    {
        return [
            'tipo.in' => 'Natureza inválida: use receita ou despesa.',
            'nome.unique' => 'Já existe uma categoria com este nome nesta natureza.',
        ];
    }
}
