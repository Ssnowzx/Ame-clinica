<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** Texto PURO com tetos (T-not-05/P7) — o escaping é gatilho da change de telas. */
class InformativoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        $criando = $this->route('id') === null;

        return [
            'titulo' => [$criando ? 'required' : 'sometimes', 'string', 'max:150'],
            'corpo' => [$criando ? 'required' : 'sometimes', 'string', 'max:5000'],
            'publicado' => ['sometimes', 'boolean'],
        ];
    }
}
