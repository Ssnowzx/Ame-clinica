<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Faturamento do atendimento (§9/D3): o payload NUNCA define o valor base —
 * o preço vem de servicos.valor no servidor (T-fin-15). A categoria DEVE ser
 * de receita (o lançamento gerado é receita).
 */
class FaturamentoRequest extends FormRequest
{
    public function authorize(): bool
    {
        // o módulo é do middleware `permission:` da rota (lancamentos.criar). Faturar já pago é
        // também dar baixa (change `caixa-do-dia-a-dia`, D3): 403 antes da validação
        abort_if(
            $this->boolean('pagar_agora') && $this->user()?->can('lancamentos.pagar') !== true,
            403,
            'Faturar já pago exige a permissão de dar baixa.',
        );

        return true;
    }

    public function rules(): array
    {

        return [
            'categoria_id' => [
                'required', 'integer',
                Rule::exists('categorias', 'id')->where('tipo', 'receita'),
            ],
            // coerência subcategoria ∈ categoria vale em TODO create de lançamento
            // (gate r1, CR-01/SEC-fin-01): o faturamento não escapa do D7
            'subcategoria_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('subcategorias', 'id')
                    ->where('categoria_id', (int) $this->input('categoria_id')),
            ],
            'tipo_pagamento_id' => [
                'required', 'integer',
                Rule::exists('tipos_pagamento', 'id'),
            ],
            'conta_id' => [
                'required', 'integer',
                Rule::exists('contas', 'id'),
            ],
            'desconto' => ['sometimes', 'numeric', 'decimal:0,2', 'min:0', 'max:99999999.99'],
            'vencimento' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:1900-01-01'],
            'contabil' => ['sometimes', 'boolean'],
            'documento' => ['sometimes', 'nullable', 'string', 'max:60'],
            'obs' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'valor' => ['missing'], // T-fin-15: preço é do servidor
            'pagar_agora' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'valor.missing' => 'O valor do faturamento vem da tabela de serviços — não é aceito no payload.',
            'categoria_id.exists' => 'Categoria inválida (o faturamento exige categoria de receita).',
        ];
    }
}
