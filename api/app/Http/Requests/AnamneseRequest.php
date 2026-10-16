<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Forma e FK escopada; a validação estrita das respostas contra o campos_json
 * do modelo (T-ate-10) vive no controller via ValidadorRespostasAnamnese.
 * preenchida_em NUNCA é aceito do payload (T-ate-12); a edição não troca o
 * modelo — altera respostas.
 */
class AnamneseRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        $criando = $this->route('id') === null;

        return [
            'modelo_id' => $criando
                ? [
                    'required', 'integer',
                    Rule::exists('anamnese_modelos', 'id'),
                ]
                : ['missing'],
            'respostas_json' => ['required', 'array'],
        ];
    }

    public function messages(): array
    {
        return [
            'modelo_id.missing' => 'O modelo da anamnese não pode ser trocado na edição.',
        ];
    }
}
