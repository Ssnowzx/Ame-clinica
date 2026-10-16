<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SalaRequest extends FormRequest
{
    /**
     * Teto do sistema para a capacidade da sala. Uma sala é maior que um profissional, mas não
     * é um auditório — e um teto arbitrariamente alto esvazia a própria guarda: um `200` onde
     * se queria `20` desliga o eixo da sala sem que ninguém perceba.
     */
    public const CAPACIDADE_MAXIMA = 20;

    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        return [
            'nome' => [
                'required', 'string', 'max:255',
                Rule::unique('salas', 'nome')
                    ->ignore($this->route('id')),
            ],
            // quantos agendamentos sobrepostos a sala aceita (change atendimento-em-grupo).
            // A faixa vive no BOUNDARY: a tela filtra, mas quem decide é o servidor — uma aba
            // velha, um curl com o mesmo token ou o DevTools passam por cima do input.
            'capacidade' => ['sometimes', 'integer', 'min:1', 'max:'.self::CAPACIDADE_MAXIMA],
            'ativo' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'nome.unique' => 'Já existe uma sala com este nome.',
            'capacidade.min' => 'A sala precisa comportar ao menos um atendimento.',
            'capacidade.max' => 'A capacidade da sala vai de 1 a '.self::CAPACIDADE_MAXIMA.'.',
        ];
    }
}
