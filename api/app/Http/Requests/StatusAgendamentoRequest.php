<?php

namespace App\Http\Requests;

use App\Support\Agenda\CatalogoIconesStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StatusAgendamentoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        return [
            'nome' => [
                'required', 'string', 'max:255',
                Rule::unique('status_agendamento', 'nome')
                    ->ignore($this->route('id')),
            ],
            'cor' => ['required', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'cor_borda' => ['sometimes', 'nullable', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'desconta_sessao' => ['sometimes', 'boolean'],
            'ocupa_horario' => ['sometimes', 'boolean'],
            'marca_falta' => ['sometimes', 'boolean'], // falta é FLAG (T-not-07)
            // reserva também é flag da clínica (lembretes-automaticos) — ficava fora do
            // Request e só entrava pela semente da migration (achado de carona, D2)
            'marca_reserva' => ['sometimes', 'boolean'],
            // baixa em lote por status (D2): origem e alvo do lote são DADO; os invariantes
            // entre elas e as demais flags vivem na GuardaDasFlagsDeDesfecho, no estado final
            'em_aberto' => ['sometimes', 'boolean'],
            'aplicavel_em_lote' => ['sometimes', 'boolean'],
            // `tipo` é o ÍCONE do status na grade (§2.3 do design system):
            // whitelist do catálogo — slug livre viraria lookup dinâmico no front
            'tipo' => ['sometimes', 'nullable', 'string', Rule::in(CatalogoIconesStatus::ICONES)],
            'ordem' => ['sometimes', 'integer', 'min:0', 'max:999'],
        ];
    }

    public function messages(): array
    {
        return [
            'nome.unique' => 'Já existe um status de agendamento com este nome.',
            'cor.regex' => 'A cor deve estar no formato #RRGGBB.',
            'cor_borda.regex' => 'A cor da borda deve estar no formato #RRGGBB.',
            'tipo.in' => 'O ícone do status não está no catálogo de ícones do sistema.',
        ];
    }
}
