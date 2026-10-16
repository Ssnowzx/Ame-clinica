<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Comentário do mural — texto PURO até 2000 (spec tarefas). Menções chegam como
 * ids e são REVALIDADAS no service (ativo, sem auto-menção); id
 * estranho é DESCARTADO em silêncio, nunca 422 — a spec manda descartar, porque
 * a menção é decoração do comentário, não dado próprio.
 */
class TarefaComentarioRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização (autor/moderação) é do controller
    }

    public function rules(): array
    {
        return [
            'corpo' => ['required', 'string', 'min:1', 'max:2000'],
            'mencoes' => ['sometimes', 'array', 'max:20'],
            'mencoes.*' => ['integer'],
        ];
    }
}
