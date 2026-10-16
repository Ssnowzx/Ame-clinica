<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Forma do fechamento de ciclo. Só isso: a invariante que importa — o par corresponder a
 * uma janela DERIVÁVEL do calendário do convênio, e não se sobrepor a outro ciclo aberto —
 * é decidida sob o lock da linha do convênio (`FechamentoDeCiclo::fechar`), porque o
 * calendário e os fechamentos podem mudar entre a validação e a gravação (SEC-FC-11).
 * Validar isso aqui seria uma checagem que expira antes de ser usada.
 */
class FechamentoCicloRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission:ciclos.fechar da rota
    }

    public function rules(): array
    {
        return [
            'periodo_inicio' => ['required', 'date_format:Y-m-d'],
            'periodo_fim' => ['required', 'date_format:Y-m-d', 'after_or_equal:periodo_inicio'],
        ];
    }

    public function messages(): array
    {
        return [
            'periodo_inicio.date_format' => 'A data de início do período é inválida.',
            'periodo_fim.date_format' => 'A data de fim do período é inválida.',
            'periodo_fim.after_or_equal' => 'O fim do período não pode ser anterior ao início.',
        ];
    }
}
