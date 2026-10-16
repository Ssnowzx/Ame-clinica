<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Reabertura de ciclo — a EXCEÇÃO (D6).
 *
 * O gate de `ciclos.reabrir` mora AQUI, no `authorize()`, e não no controller
 * (SEC-FC-01, molde `EvolucaoRequest`): o FormRequest autoriza na resolução da request,
 * antes de qualquer linha do controller — é o único ponto em que o **403 vence o 422 e o
 * 404**. Um gate no controller deixaria alguém com apenas `ciclos.fechar` descobrir, pelo
 * 422 "este ciclo já foi reaberto" ou pelo 404, o estado do faturamento de um convênio
 * que ele não pode destravar; e a 422 nomearia `motivo` a quem nem tem a permissão,
 * vazando o mecanismo.
 *
 * A rota carrega `permission:ciclos.fechar` (o acesso base ao módulo); a exceção é este
 * segundo gate, e ela é AND com ele, nunca OR.
 */
class ReaberturaDeCicloRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('ciclos.reabrir') === true;
    }

    public function rules(): array
    {
        return [
            // SEC-FC-06: obrigatório e ≤ 500 chars (o mesmo teto do motivo_assinatura).
            // A copy da tela instrui a não nomear paciente; o campo NUNCA entra em
            // payload de atendimento/lançamento/evolução.
            'motivo' => ['required', 'string', 'max:500'],
        ];
    }

    public function messages(): array
    {
        // estáticas de propósito: nunca ecoar o valor digitado
        return [
            'motivo.required' => 'Informe o motivo da reabertura do ciclo.',
            'motivo.max' => 'O motivo deve ter no máximo 500 caracteres.',
        ];
    }
}
