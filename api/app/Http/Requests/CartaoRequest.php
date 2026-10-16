<?php

namespace App\Http\Requests;

use App\Models\Cartao;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Cadastro DORMENTE (T-fin-03): faixas rígidas hoje evitam cálculo podre na f2. */
class CartaoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        return [
            'nome' => ['required', 'string', 'max:255'],
            'tipo' => ['required', Rule::in(Cartao::TIPOS)],
            // catálogo GLOBAL e fechado (as operadoras não são dado da clínica)
            'bandeira' => ['sometimes', 'nullable', Rule::in(Cartao::BANDEIRAS)],
            // rejeitar, não arredondar (precedente T-fin-01)
            'pct_a_vista' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:100'],
            // a CHAVE ("2".."12") é validada aqui; o VALOR de cada faixa presente leva a
            // MESMA regra de pct_a_vista, via Rule::forEach — faixa sem valor fica ausente,
            // sem exigir as onze
            'pct_parcelas' => ['sometimes', 'nullable', 'array', function ($attribute, $value, $fail): void {
                // a regra `array` acima já recusa tipo errado (string/int/bool) e para a
                // cadeia dele — MAS o Laravel roda TODAS as regras do campo mesmo quando uma
                // falhou (não há `bail` implícito): sem este guard, `array_keys($value)`
                // explodia em TypeError → 500 na cara de quem manda o tipo errado, em vez do
                // 422 limpo que esta regra existe para dar (achado SEC-CART-01 do gate).
                if (! is_array($value)) {
                    return;
                }
                $foraDoDominio = array_diff(array_keys($value), Cartao::PARCELAS);
                if ($foraDoDominio !== []) {
                    $fail('As parcelas válidas vão de 2x a 12x ou mais.');
                }
            }],
            'pct_parcelas.*' => Rule::forEach(function () {
                // `string` primeiro: sem ela, um número puro (`3.5`, `5`) passava —
                // `numeric`/`decimal` aceitam int/float e o cast `array` do model não
                // normaliza, então persistia FLOAT no JSON em vez de STRING decimal (D1),
                // exatamente o "cálculo podre" que a validação rígida existe para evitar
                // (achado do gate; hoje inofensivo, mas mina para a engine de recebíveis).
                return ['string', 'numeric', 'decimal:0,2', 'min:0', 'max:100'];
            }),
            'dias_recebimento' => ['required', 'integer', 'min:0', 'max:365'],
            'conta_id' => [
                'required', 'integer',
                Rule::exists('contas', 'id'),
            ],
            'liquidar_auto' => ['sometimes', 'boolean'],
            // cadastro, sem cálculo de custo de antecipação (fase 2, junto da engine de recebíveis)
            'antecipacao_credito' => ['sometimes', 'boolean'],
        ];
    }
}
