<?php

namespace App\Http\Requests;

use App\Models\Convenio;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class MedicoRequest extends FormRequest
{
    private const UFS = [
        'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
        'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
    ];

    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        return [
            'nome' => ['required', 'string', 'max:255'],
            'conselho' => ['required', 'string', 'max:20'],
            'uf_conselho' => ['required', Rule::in(self::UFS)],
            'num_conselho' => [
                'required', 'string', 'max:20',
                // registro de conselho único (conselho+UF+número)
                Rule::unique('medicos', 'num_conselho')
                    ->where('conselho', (string) $this->input('conselho'))
                    ->where('uf_conselho', (string) $this->input('uf_conselho'))
                    ->ignore($this->route('id')),
            ],
            'cbos_id' => ['sometimes', 'nullable', 'integer', Rule::exists('cbos', 'id')],
            'codigos_operadora_json' => ['sometimes', 'nullable', 'array'],
            'codigos_operadora_json.*' => ['string', 'max:30'],
        ];
    }

    /**
     * As chaves do mapa {convenio_id: codigo} DEVEM ser convênios existentes
     * (parecer T-fk-01, abuse case 7).
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $mapa = $this->input('codigos_operadora_json');
            if (! is_array($mapa) || $mapa === []) {
                return;
            }

            $idsInformados = array_map('intval', array_keys($mapa));
            $idsExistentes = Convenio::whereIn('id', $idsInformados)->pluck('id')->all();

            if (count($idsExistentes) !== count($idsInformados)) {
                $validator->errors()->add(
                    'codigos_operadora_json',
                    'Todos os convênios do mapa de códigos devem pertencer à clínica.'
                );
            }
        });
    }

    public function messages(): array
    {
        return [
            'num_conselho.unique' => 'Já existe um médico com este registro de conselho.',
        ];
    }
}
