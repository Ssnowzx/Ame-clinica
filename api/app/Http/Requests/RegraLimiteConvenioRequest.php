<?php

namespace App\Http\Requests;

use App\Models\RegraLimiteConvenio;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * Regras de limite do convênio (limites-e-pedidos, D1): domínio FECHADO no
 * boundary — período/ação fora do enum → 422 sem ecoar o valor recebido
 * (SEC-LP-08); especialidade sempre existente (SEC-LP-07); unicidade
 * (convênio, especialidade, período) validada no ESTADO FINAL aqui e
 * garantida no BANCO pelo índice sobre a coluna gerada.
 */
class RegraLimiteConvenioRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {

        return [
            // NULL = todas as especialidades; específica inexistente → 422
            'especialidade_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('especialidades', 'id'),
            ],
            'periodo' => ['required', Rule::in(RegraLimiteConvenio::PERIODOS)],
            'limite' => ['required', 'integer', 'min:1', 'max:99'],
            'acao' => ['required', Rule::in(RegraLimiteConvenio::ACOES)],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return; // forma primeiro — unicidade só sobre payload válido
            }

            $this->validarUnicidade($validator);
        });
    }

    /**
     * Unicidade sobre o ESTADO FINAL (update parcial não burla): outra regra do
     * mesmo convênio com a MESMA especialidade (NULL-safe) e o MESMO período.
     * O índice único do banco é o backstop; aqui a recusa vira 422 legível.
     */
    private function validarUnicidade(Validator $validator): void
    {
        // a regra é buscada DENTRO do convênio da rota: um `id` de outro convênio
        // não deve virar a "atual" — ele se auto-excluiria do `whereKeyNot` e
        // deixaria passar uma duplicata neste convênio, que só o índice do banco pegaria
        $atual = $this->route('id') !== null
            ? RegraLimiteConvenio::query()
                ->where('convenio_id', (int) $this->route('convenioId'))
                ->find($this->route('id'))
            : null;

        $especialidadeFinal = $this->has('especialidade_id')
            ? $this->input('especialidade_id')
            : $atual?->especialidade_id;

        $duplicada = RegraLimiteConvenio::query()
            ->where('convenio_id', (int) $this->route('convenioId'))
            ->where('periodo', $this->input('periodo'))
            ->when(
                $especialidadeFinal === null,
                fn ($q) => $q->whereNull('especialidade_id'),
                fn ($q) => $q->where('especialidade_id', (int) $especialidadeFinal),
            )
            ->when($atual, fn ($q) => $q->whereKeyNot($atual->id))
            ->exists();

        if ($duplicada) {
            $validator->errors()->add(
                'periodo',
                'Já existe uma regra deste convênio para esta especialidade e período.'
            );
        }
    }

    public function messages(): array
    {
        // sem ecoar o valor recebido (SEC-LP-08)
        return [
            'periodo.in' => 'O período informado não é válido.',
            'acao.in' => 'A ação informada não é válida.',
        ];
    }
}
