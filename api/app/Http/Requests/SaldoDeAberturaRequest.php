<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * O saldo de abertura da conta (change `saldo-das-contas`): o valor pode ser NEGATIVO (conta no
 * cheque especial); a data é opcional — sem ela, a conta parte do valor e soma tudo.
 */
class SaldoDeAberturaRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // `contas.editar` E `fluxo_caixa.ver`: middleware da rota
    }

    public function rules(): array
    {
        return [
            // dinheiro: duas casas, rejeitar — nunca arredondar (T-fin-06)
            'saldo_inicial' => ['required', 'numeric', 'decimal:0,2', 'min:-9999999999.99', 'max:9999999999.99'],
            'saldo_inicial_em' => ['present', 'nullable', 'date_format:Y-m-d', 'after_or_equal:1900-01-01'],
        ];
    }
}
