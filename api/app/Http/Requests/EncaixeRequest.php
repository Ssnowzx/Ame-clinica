<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\GuardaProfissionalDesligado;
use App\Http\Requests\Concerns\LeIdDoPayload;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Encaixe da fila (§6) — FormRequest PRÓPRIA de propósito.
 *
 * A AgendamentoRequest decide "criação vs. edição" por `route('id')`, e aqui o
 * `{id}` é o da ENTRADA DA FILA: reusá-la faria a request procurar um
 * Agendamento com o id da fila.
 *
 * O paciente NÃO é campo: vem da entrada (design D3). Aceitá-lo transformaria a
 * rota da fila num segundo caminho para criar agendamento arbitrário — com o
 * RBAC do encaixe, não o da agenda.
 */
class EncaixeRequest extends FormRequest
{
    use GuardaProfissionalDesligado;
    use LeIdDoPayload;

    /**
     * POSSE ANTES DA VALIDAÇÃO — a mesma doutrina do `AgendamentoRequest` (`SEC-VP-20`), aplicada
     * aqui na rodada 3 (`SEC-VP-32`): com a posse só no controller, ela vinha DEPOIS de
     * `validated()`, e o par colega × inexistente se separava por status (403 × 422), enumerando o
     * quadro de profissionais que o escopado não vê pela seleção da agenda.
     *
     * A doutrina só vale se valer em TODA superfície: enquanto duas Requests decidissem posse
     * depois da validação, a fronteira apenas mudava de lugar — foi o que o gate viu acontecer
     * três rodadas seguidas.
     */
    public function authorize(): bool
    {
        $solicitado = $this->idInformado('profissional_id');

        if ($solicitado !== null) {
            app(EscopoDoProfissional::class)
                ->assegurarPosseDoProfissional($this->user(), $solicitado);
        }

        return true; // o resto da autorização é do middleware permission: da rota
    }

    /**
     * Encaixe é SEMPRE criação de agendamento; o `{id}` da rota é a ENTRADA DA FILA,
     * não um agendamento — por isso `recurso_id` fica null e `operacao` é sempre `criar`.
     *
     * @return array{recurso: string, operacao: string, recurso_id: int|null}
     */
    protected function dadosDoRecursoDesligado(): array
    {
        return ['recurso' => 'encaixe', 'operacao' => 'criar', 'recurso_id' => null];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {

        return [
            'inicio' => ['required', 'date_format:Y-m-d H:i', 'after_or_equal:1900-01-01'],
            'fim' => ['sometimes', 'nullable', 'date_format:Y-m-d H:i', 'after:inicio'],
            'duracao_minutos' => ['sometimes', 'nullable', 'integer', 'min:5', 'max:480'],
            // ATIVO (gatilho PROF-DESLIGADO): encaixe é sempre CRIAÇÃO, sem exceção
            // histórica → `ProfissionalAtivoOuVinculado(null)`. `bail` antes do status.
            'profissional_id' => [
                'bail', 'required', 'integer',
                Rule::exists('profissionais', 'id'),
                $this->regraProfissionalAtivoOuVinculado(null),
            ],
            // a entrada pode não ter especialidade desejada — o encaixe sempre tem
            'especialidade_id' => [
                'required', 'integer',
                Rule::exists('especialidades', 'id'),
            ],
            'tratamento_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('tratamentos', 'id'),
            ],
            'sala_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('salas', 'id'),
            ],
            'equipamento_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('equipamentos', 'id'),
            ],
            'medico_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('medicos', 'id'),
            ],
            'status_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('status_agendamento', 'id'),
            ],
            'obs' => ['sometimes', 'nullable', 'string', 'max:1000'],

            // encaixe é UM horário que abriu, para O paciente que esperava
            'paciente_id' => ['missing'],
            'tipo' => ['missing'],
            'recorrencia' => ['missing'],
            'aplicar_na_serie' => ['missing'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'paciente_id.missing' => 'O paciente do encaixe vem da fila.',
            'tipo.missing' => 'Encaixe é sempre atendimento.',
            'recorrencia.missing' => 'Encaixe é um horário que abriu, não uma série.',
        ];
    }
}
