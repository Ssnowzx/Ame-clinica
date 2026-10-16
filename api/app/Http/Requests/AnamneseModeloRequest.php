<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class AnamneseModeloRequest extends FormRequest
{
    /** Tipos de campo do builder (design D5). */
    public const TIPOS = ['texto', 'numero', 'opcoes', 'data', 'booleano'];

    /** Whitelist de chaves por campo — chave extra é rejeitada (parecer T-anm-01). */
    private const CHAVES_PERMITIDAS = ['id', 'tipo', 'rotulo', 'obrigatorio', 'opcoes'];

    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {

        return [
            'titulo' => [
                'required', 'string', 'max:255',
                Rule::unique('anamnese_modelos', 'titulo')
                    ->ignore($this->route('id')),
            ],
            'especialidade_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('especialidades', 'id'),
            ],
            'ativo' => ['sometimes', 'boolean'],
            // limites do parecer P3: ≤60 campos, ≤30 opções, rotulo ≤255
            'campos_json' => ['required', 'array', 'min:1', 'max:60'],
            'campos_json.*.id' => ['required', 'string', 'max:60', 'distinct'],
            'campos_json.*.tipo' => ['required', Rule::in(self::TIPOS)],
            'campos_json.*.rotulo' => ['required', 'string', 'max:255'],
            'campos_json.*.obrigatorio' => ['required', 'boolean'],
            'campos_json.*.opcoes' => ['required_if:campos_json.*.tipo,opcoes', 'array', 'min:1', 'max:30'],
            'campos_json.*.opcoes.*' => ['string', 'max:255'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            foreach ((array) $this->input('campos_json', []) as $indice => $campo) {
                if (! is_array($campo)) {
                    continue; // já rejeitado pelas rules
                }
                $extras = array_diff(array_keys($campo), self::CHAVES_PERMITIDAS);
                if ($extras !== []) {
                    $validator->errors()->add(
                        "campos_json.{$indice}",
                        'Chaves não permitidas no campo: '.implode(', ', $extras).'.'
                    );
                }
            }
        });
    }

    public function messages(): array
    {
        return [
            'titulo.unique' => 'Já existe um modelo de anamnese com este título.',
            'campos_json.*.tipo.in' => 'Tipo de campo inválido.',
            'campos_json.*.opcoes.required_if' => 'Campos do tipo opções exigem a lista de opções.',
        ];
    }
}
