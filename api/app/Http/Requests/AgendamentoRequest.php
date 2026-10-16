<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\GuardaProfissionalDesligado;
use App\Http\Requests\Concerns\LeIdDoPayload;
use App\Models\Agendamento;
use App\Rules\PacienteVinculadoAoEscopo;
use App\Support\Agenda\AgendamentoService;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * Forma e FKs escopadas; as invariantes de domínio (N:M, conflitos, tratamento,
 * retroativo, reposição) vivem no AgendamentoService.
 */
class AgendamentoRequest extends FormRequest
{
    use GuardaProfissionalDesligado;
    use LeIdDoPayload;

    /**
     * A POSSE É DECIDIDA AQUI, e a ordem é o ponto: o Laravel roda `authorize()` **antes** de
     * `rules()`, então a autorização precede a regra de negócio.
     *
     * Não é organização — é o conserto do `SEC-VP-20` (rodada 2 do gate). Com a posse só no
     * controller, ela vinha DEPOIS da validação, e a trava de vínculo criava um oráculo novo num
     * `PUT` sobre agendamento do colega: palpite errado de `paciente_id` → 422 (a regra recusa),
     * palpite CERTO → 403 (a regra tem early-return quando o paciente não muda, e o pedido chegava
     * ao controller). Medido: cinco palpites errados `422 422 422 422 422`, o acerto `403` — e o
     * acerto era o único que NÃO deixava registro. Decidindo a posse antes, os dois dão 403.
     *
     * As checagens do controller CONTINUAM lá de propósito: elas cobrem quem não passe por esta
     * FormRequest, e tirar guarda de segurança por estar "inalcançável hoje" é como o buraco volta.
     */
    public function authorize(): bool
    {
        $escopos = app(EscopoDoProfissional::class);
        $atual = $this->route('id') !== null ? Agendamento::find($this->route('id')) : null;

        // POSSE DO REGISTRO QUE JÁ EXISTE — eixo da AGENDA, como em `show`/`serie`/`destroy`.
        // A rodada 3 aplicou os dois eixos também aqui, e quem é plano na agenda e escopado no
        // clínico perdeu a remarcação da sessão do colega (`SEC-VP-44`): sobrou-lhe apagar (204)
        // sem conseguir recriar. Remarcar e mudar status não concedem vínculo a ninguém.
        if ($this->route('id') !== null) {
            $escopos->agenda($this->user())->assegurarPosse($atual?->profissional_id);
        }

        // POSSE DO VÍNCULO QUE A OPERAÇÃO CRIA — DOIS EIXOS (`SEC-VP-31`): marcar na agenda de um
        // colega cria vínculo (`EXISTS` em agendamentos), e quem é plano na agenda e escopado no
        // clínico passava direto, concedendo ao colega a leitura clínica daquela criança. Vínculo
        // nasce ao CRIAR, ao TROCAR a criança e ao TROCAR o dono — nunca ao remarcar.
        $dono = $this->idInformado('profissional_id') ?? $atual?->profissional_id;
        if ($this->criaVinculo($atual) && $dono !== null) {
            $escopos->assegurarPosseDoProfissional($this->user(), (int) $dono);

            // TROCA DE DONO com a MESMA criança é vínculo novo (novo dono × criança), e a regra
            // `PacienteVinculadoAoEscopo` pula quando a criança não muda — sem isto, quem é plano
            // na agenda e escopado no clínico re-parenteava a sessão do colega para si e ganhava
            // a criança sem passar pela recepção (rodada 4, ao consertar o `SEC-VP-44`).
            if ($atual !== null && $atual->paciente_id !== null && (int) $dono !== (int) $atual->profissional_id) {
                abort_unless(
                    $escopos->podeVincularPaciente($this->user(), (int) $atual->paciente_id),
                    403,
                    'Fora do seu escopo de profissional.',
                );
            }
        }

        return true; // o resto da autorização é do middleware permission: das rotas
    }

    /** Criar sempre vincula; no PUT, só a troca de criança ou de dono. */
    private function criaVinculo(?Agendamento $atual): bool
    {
        if ($this->route('id') === null) {
            return true;
        }

        $paciente = $this->idInformado('paciente_id');
        $profissional = $this->idInformado('profissional_id');

        return ($paciente !== null && $paciente !== (int) $atual?->paciente_id)
            || ($profissional !== null && $profissional !== (int) $atual?->profissional_id);
    }

    /** @return array{recurso: string, operacao: string, recurso_id: int|null} */
    protected function dadosDoRecursoDesligado(): array
    {
        $id = $this->route('id');

        return [
            'recurso' => 'agendamento',
            'operacao' => $id !== null ? 'editar' : 'criar',
            'recurso_id' => $id !== null ? (int) $id : null,
        ];
    }

    /** No update, o tipo default é o do registro (gate r1, I3 — PUT de bloqueio sem tipo). */
    protected function prepareForValidation(): void
    {
        if ($this->route('id') !== null && ! $this->has('tipo')) {
            $tipoAtual = Agendamento::find($this->route('id'))?->tipo;
            if ($tipoAtual !== null) {
                $this->merge(['tipo' => $tipoAtual]);
            }
        }
    }

    public function rules(): array
    {
        $editando = $this->route('id') !== null;
        $profissionalAtual = $editando
            ? Agendamento::find($this->route('id'))?->profissional_id
            : null;

        // No UPDATE, paciente e especialidade são OPCIONAIS: quem não os manda
        // mantém os do registro, e o serviço garante a invariante no ESTADO
        // FINAL ("Atendimento exige paciente e especialidade"). Exigi-los aqui
        // obrigaria toda edição parcial — trocar o status pelo card, aplicar na
        // série — a ecoar campos que ela não está mudando; e, na série, campo
        // ecoado é campo PROPAGADO para as irmãs (gate agenda-escrita, B-01/B-02).
        $obrigatorioNoAtendimento = $editando ? ['sometimes'] : ['required_unless:tipo,bloqueio'];

        return [
            'tipo' => ['sometimes', Rule::in(Agendamento::TIPOS)],
            'inicio' => ['required', 'date_format:Y-m-d H:i', 'after_or_equal:1900-01-01'],
            'fim' => ['sometimes', 'nullable', 'date_format:Y-m-d H:i', 'after:inicio'],
            'duracao_minutos' => ['sometimes', 'nullable', 'integer', 'min:5', 'max:480'],
            // ATIVO ou o mesmo já vinculado (gatilho PROF-DESLIGADO); uniforme para
            // atendimento e bloqueio. `bail`: o `exists` curto-circuita antes do status.
            'profissional_id' => [
                'bail', 'required', 'integer',
                Rule::exists('profissionais', 'id'),
                $this->regraProfissionalAtivoOuVinculado(
                    $profissionalAtual !== null ? (int) $profissionalAtual : null
                ),
            ],
            // atendimento exige paciente+especialidade; bloqueio proíbe (design D3)
            'paciente_id' => [
                ...$obrigatorioNoAtendimento, 'prohibited_if:tipo,bloqueio',
                'nullable', 'integer',
                Rule::exists('pacientes', 'id'),
                // A trava de vínculo prévio roda AQUI, no mesmo passe da inexistência, para que
                // as duas recusas sejam indistinguíveis também quando o payload tem outro erro
                // (SEC-VP-13). O serviço mantém a sua — é o funil, e cobre quem não passa por
                // esta FormRequest.
                new PacienteVinculadoAoEscopo($editando
                    ? Agendamento::find($this->route('id'))?->paciente_id
                    : null),
            ],
            'especialidade_id' => [
                ...$obrigatorioNoAtendimento, 'prohibited_if:tipo,bloqueio',
                'nullable', 'integer',
                Rule::exists('especialidades', 'id'),
            ],
            'tratamento_id' => [
                'sometimes', 'prohibited_if:tipo,bloqueio', 'nullable', 'integer',
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
                'sometimes', 'prohibited_if:tipo,bloqueio', 'nullable', 'integer',
                Rule::exists('medicos', 'id'),
            ],
            'status_id' => [
                'sometimes', 'prohibited_if:tipo,bloqueio', 'nullable', 'integer',
                Rule::exists('status_agendamento', 'id'),
            ],
            'origem' => ['sometimes', 'string', 'max:20'],
            'is_reposicao' => ['sometimes', 'boolean'],
            // lembrete automático por WhatsApp (mensageria-whatsapp): `sometimes` porque a
            // AUSÊNCIA tem significado — na criação, herda `whatsapp.pre_selecionado` do
            // da clínica; na edição, preserva o gravado. Bloqueio de agenda não tem família a
            // avisar, então o marcador não faz sentido lá.
            'lembrete_whatsapp' => ['sometimes', 'prohibited_if:tipo,bloqueio', 'boolean'],
            'reposicao_de_id' => [
                'required_if:is_reposicao,true', 'nullable', 'integer',
                Rule::exists('agendamentos', 'id'),
            ],
            'obs' => ['sometimes', 'nullable', 'string', 'max:1000'], // T-agd-08
            // recorrência (design D6, ampliada pela change `repeticao-da-serie`) — só na
            // criação (PUT → proibida). O INTERVALO é número de semanas, não enum: "semanal" e
            // "quinzenal" são 1 e 2, e "a cada 3" nasce de graça (design D1). Omitido = 1, que é
            // o comportamento de antes — o pedido antigo `{ate}` continua literal.
            'recorrencia' => $this->route('id') !== null ? ['missing'] : ['sometimes', 'array'],
            'recorrencia.intervalo_semanas' => ['sometimes', 'integer', 'min:1', 'max:8'],
            // cadência em MESES (change `recorrencia-mensal`): alternativa à de semanas, nunca junta
            'recorrencia.intervalo_meses' => ['sometimes', 'integer', 'min:1', 'max:12'],
            // os DOIS modos de término, exatamente um deles — a exclusividade é conferida no
            // `after()`, porque `required_without` dispararia também quando `recorrencia` nem vem
            'recorrencia.ate' => ['sometimes', 'date_format:Y-m-d', 'after:inicio'],
            'recorrencia.ocorrencias' => ['sometimes', 'integer', 'min:1', 'max:'.AgendamentoService::MAX_OCORRENCIAS_SERIE],
            'aplicar_na_serie' => ['sometimes', 'boolean'],
            // pedido explícito de quem remarcou para avisar a família (avisos-do-agendamento-por-whatsapp)
            // na CRIAÇÃO não há o que avisar por pedido (a confirmação é automática): recusa a chave
            // (`missing`, nunca `prohibited` — que deixa a chave nula passar; ContratoDeBoundaryTest)
            'avisar_familia' => $editando ? ['sometimes', 'boolean'] : ['missing'],
        ];
    }

    public function messages(): array
    {
        return [
            'paciente_id.prohibited_if' => 'Bloqueio de agenda não tem paciente.',
            'reposicao_de_id.required_if' => 'Reposição exige o agendamento original.',
            'recorrencia.ocorrencias.max' => 'A série excede o máximo de '
                .AgendamentoService::MAX_OCORRENCIAS_SERIE.' ocorrências.',
        ];
    }

    /**
     * A série termina por UM dos dois modos: até uma data OU por número de sessões.
     *
     * Fica aqui, e não nas regras de campo, porque `required_without` olharia os dois campos
     * mesmo quando `recorrencia` nem foi pedida — e todo agendamento avulso passaria a exigir
     * data de fim de série. A tela também impede escolher os dois; a lei é esta.
     *
     * @return list<callable>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $recorrencia = $this->input('recorrencia');
                if (! is_array($recorrencia)) {
                    return;
                }

                // uma série tem UMA cadência: semanas ou meses, nunca as duas (change
                // `recorrencia-mensal`). Aceitar as duas obrigaria a eleger uma em silêncio.
                $temSemanas = array_key_exists('intervalo_semanas', $recorrencia) && $recorrencia['intervalo_semanas'] !== null;
                $temMeses = array_key_exists('intervalo_meses', $recorrencia) && $recorrencia['intervalo_meses'] !== null;
                if ($temSemanas && $temMeses) {
                    $validator->errors()->add(
                        'recorrencia.intervalo_meses',
                        'Escolha só uma cadência: repetir por semanas OU por meses.',
                    );
                }

                $temAte = array_key_exists('ate', $recorrencia) && $recorrencia['ate'] !== null;
                $temOcorrencias = array_key_exists('ocorrencias', $recorrencia) && $recorrencia['ocorrencias'] !== null;

                if ($temAte === $temOcorrencias) {
                    $validator->errors()->add(
                        'recorrencia.ate',
                        $temAte
                            ? 'Escolha só um: repetir até uma data OU por número de sessões.'
                            : 'Informe até quando repetir, ou por quantas sessões.',
                    );
                }
            },
        ];
    }
}
