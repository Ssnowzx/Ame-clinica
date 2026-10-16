<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\AlcanceEmLoteRequest;
use App\Http\Requests\Concerns\GuardaProfissionalDesligado;
use App\Http\Requests\Concerns\LeIdDoPayload;
use App\Support\Agenda\DesmarqueEmLote;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Baixa em massa da agenda de um profissional (change `desmarque-do-profissional`).
 *
 * Nasceu do gate: a validação vivia inline no controller, e era o único caminho de escrita da
 * agenda que aceitava profissional DESLIGADO (gatilho PROF-DESLIGADO).
 *
 * A posse no `authorize()` (eixo AGENDA, `SEC-VP-32`/CR4b-02), o profissional existente e o teto de 62 dias comparado de verdade vivem no trait `AlcanceEmLoteRequest`, partilhado
 * com a baixa em lote por status (D1 de `baixa-em-lote-por-status`): a régua que o gate provou
 * decorativa uma vez não pode existir em duas Requests.
 */
class DesmarqueEmLoteRequest extends FormRequest
{
    use AlcanceEmLoteRequest;
    use GuardaProfissionalDesligado;
    use LeIdDoPayload;

    /** Rótulos do log de segurança do gatilho PROF-DESLIGADO. */
    protected function dadosDoRecursoDesligado(): array
    {
        return ['recurso' => 'desmarque_em_lote', 'operacao' => 'criar', 'recurso_id' => null];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            ...$this->regrasDoAlcance(),
            'periodo' => ['required', Rule::in(DesmarqueEmLote::PERIODOS)],
            'status_id' => ['sometimes', 'nullable', 'integer'],
            'bloquear' => ['sometimes', 'boolean'],
            // a INTENÇÃO de quem opera; quem decide se pode enviar é o servidor, pela
            // permissão do módulo de mensagens (achado do gate: a tela mandava `false` sem a
            // permissão e a lista de famílias a avisar nunca chegava a ninguém)
            'avisar' => ['sometimes', 'boolean'],
            'motivo' => ['sometimes', 'nullable', 'string', 'max:200'],
        ];
    }

    /** Defaults do payload — o aviso nasce MARCADO (decisão da clínica). */
    public function validated($key = null, $default = null): mixed
    {
        $dados = parent::validated();
        $dados['bloquear'] = $dados['bloquear'] ?? false;
        $dados['avisar'] = $dados['avisar'] ?? true;
        $dados['motivo'] = $dados['motivo'] ?? 'Agenda desmarcada';
        $dados['status_id'] = $dados['status_id'] ?? null;

        return $key === null ? $dados : ($dados[$key] ?? $default);
    }
}
