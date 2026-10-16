<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\GuardaProfissionalDesligado;
use App\Http\Requests\Concerns\LeIdDoPayload;
use App\Models\Servico;
use App\Models\Tratamento;
use App\Rules\PacienteVinculadoAoEscopo;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\EscopoDoProfissional;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class TratamentoRequest extends FormRequest
{
    use GuardaProfissionalDesligado;
    use LeIdDoPayload;

    /**
     * Posse ANTES da validação — mesmo conserto do `AgendamentoRequest` (`SEC-VP-20`), e mais o
     * `SEC-VP-21`, que a rodada 2 mediu: o `store` de tratamento **não tinha `assegurarPosse`
     * nenhum**. Duas consequências, as duas abertas até aqui:
     *
     * 1. o escopado criava pacote **em nome do colega**, concedendo a ELE, unilateralmente, o
     *    vínculo clínico com aquela criança (art. 11);
     * 2. um usuário de escopo `nenhum` (papel sem as flags e sem `profissional_id`) criava pacote
     *    à vontade — **201**, enquanto `POST /agendamentos` no mesmo escopo dava 403. Isso
     *    contradizia a invariante escrita no próprio `Escopo.php`: *"nenhum → mutações 403"*.
     *    `podeVincularPaciente` devolve `true` para `nenhum` de propósito (para não barrar a
     *    recepção), contando com um portão de controller que aqui não existia.
     */
    public function authorize(): bool
    {
        $escopos = app(EscopoDoProfissional::class);
        $atual = $this->route('id') !== null ? Tratamento::find($this->route('id')) : null;

        // POSSE DO PACOTE QUE JÁ EXISTE — eixo da AGENDA, como em `show`/`destroy` (`SEC-VP-44`):
        // editar o total de sessões do pacote do colega não vincula ninguém a ninguém.
        if ($this->route('id') !== null) {
            $escopos->agenda($this->user())->assegurarPosse($atual?->profissional_id);
        }

        // POSSE DO VÍNCULO QUE A OPERAÇÃO CRIA — DOIS EIXOS (`SEC-VP-31`): o pacote é vínculo
        // CLÍNICO, e quem é plano na agenda e escopado no clínico criava pacote em nome do colega,
        // abrindo o prontuário da criança para ele. Criar sempre vincula; no PUT, trocar o dono
        // (a criança não muda — `recusarMudancaDeIdentidade` — mas a posse não depende disso).
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
    private function criaVinculo(?Tratamento $atual): bool
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
            'recurso' => 'tratamento',
            'operacao' => $id !== null ? 'editar' : 'criar',
            'recurso_id' => $id !== null ? (int) $id : null,
        ];
    }

    public function rules(): array
    {
        $profissionalAtual = $this->route('id') !== null
            ? Tratamento::find($this->route('id'))?->profissional_id
            : null;

        return [
            // as 5 pontas SEMPRE existentes (T-fk-01)
            'paciente_id' => [
                'required', 'integer',
                Rule::exists('pacientes', 'id'),
                // segunda perna do `SEC-CP-04`, no mesmo passe da inexistência (SEC-VP-13):
                // criar pacote concede vínculo tanto quanto marcar
                new PacienteVinculadoAoEscopo($this->route('id') !== null
                    ? Tratamento::find($this->route('id'))?->paciente_id
                    : null),
            ],
            'convenio_id' => [
                'required', 'integer',
                Rule::exists('convenios', 'id'),
            ],
            'especialidade_id' => [
                'required', 'integer',
                Rule::exists('especialidades', 'id'),
            ],
            // ATIVO ou o mesmo já vinculado (gatilho PROF-DESLIGADO): `bail` para o
            // `exists` curto-circuitar antes do Rule de status (sem erro duplo)
            'profissional_id' => [
                'bail', 'required', 'integer',
                Rule::exists('profissionais', 'id'),
                $this->regraProfissionalAtivoOuVinculado(
                    $profissionalAtual !== null ? (int) $profissionalAtual : null
                ),
            ],
            // o serviço só precisa existir aqui; a coerência serviço×convênio valida o ESTADO FINAL no
            // withValidator (parecer T-trat-03 — update parcial não pode burlar)
            'servico_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('servicos', 'id'),
            ],
            // `tipo` NÃO é gravável: no sistema real ele é um select cuja lista tem UMA
            // opção ("Pacote" — anexo dos formulários de cadastro em `docs/`), a coluna
            // já nasce com esse default, e NADA no produto o lê. Aceitar `string|max:30`
            // era uma porta aberta para um campo que ninguém guarda: no dia em que alguém
            // pendurar comportamento nele, o valor arbitrário já estaria gravado. Um
            // segundo tipo entra por change — com enum e com quem o consome.
            // matricula/guia: armazenamento (§14) — nenhum comportamento
            'matricula' => ['sometimes', 'nullable', 'string', 'max:60'],
            'guia' => ['sometimes', 'nullable', 'string', 'max:60'],
            'sessoes_total' => ['required', 'integer', 'min:1', 'max:1000'],
            'data_inicio' => [
                'sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:1900-01-01',
            ],
            'validade_dias' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:3650'],
            // pedido médico como DADO (limites-e-pedidos, D4/SEC-LP-05): emissão nunca
            // no futuro — comparada NO FUSO DA CLÍNICA (amanhã na parede ≠ amanhã UTC);
            // vencimento é DERIVADO no serializer, jamais aceito por payload
            'pedido_emitido_em' => [
                'sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:1900-01-01',
                $this->regraPedidoNaoFuturo(),
            ],
            // override semanal "conforme pedido" (Pladisa) — só tem efeito na guarda
            // quando a emissão está preenchida (cerca SEC-LP-12, no serviço)
            'pedido_sessoes_por_semana' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:40'],
            'status' => ['sometimes', Rule::in(Tratamento::STATUS)],
        ];
    }

    /** Emissão do pedido não-futura NO FUSO DA CLÍNICA (§13 · SEC-LP-05). */
    private function regraPedidoNaoFuturo(): Closure
    {
        return function (string $atributo, mixed $valor, Closure $recusar): void {
            if (! is_string($valor)) {
                return; // date_format já recusa o resto
            }

            $hojeNaClinica = now(app(ConfiguracaoService::class)->get('clinica.timezone'))
                ->toDateString();
            if ($valor > $hojeNaClinica) {
                $recusar('A emissão do pedido médico não pode ser uma data futura.');
            }
        };
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $atual = $this->route('id') !== null
                ? Tratamento::find($this->route('id'))
                : null;

            $this->validarPisoDeSessoes($validator, $atual);
            $this->validarCoerenciaServicoConvenio($validator, $atual);
            $this->validarDuplicidadeConfiguravel($validator, $atual);
        });
    }

    /**
     * Coerência serviço×convênio sobre o ESTADO FINAL (design D5, parecer
     * T-trat-03): trocar só o convênio mantendo serviço antigo não passa.
     */
    private function validarCoerenciaServicoConvenio(Validator $validator, ?Tratamento $atual): void
    {
        $servicoFinal = $this->has('servico_id')
            ? $this->input('servico_id')
            : $atual?->servico_id;

        if ($servicoFinal === null) {
            return;
        }

        $coerente = Servico::whereKey((int) $servicoFinal)
            ->where('convenio_id', (int) $this->input('convenio_id'))
            ->exists();

        if (! $coerente) {
            $validator->errors()->add(
                'servico_id',
                'O serviço deve pertencer à tabela do convênio informado.'
            );
        }
    }

    /** Não se encolhe pacote abaixo do já consumido — piso lido do BANCO (design D3). */
    private function validarPisoDeSessoes(Validator $validator, ?Tratamento $atual): void
    {
        if ($atual !== null && (int) $this->input('sessoes_total') < $atual->sessoes_realizadas) {
            $validator->errors()->add(
                'sessoes_total',
                "O total não pode ser menor que as {$atual->sessoes_realizadas} sessões já realizadas."
            );
        }
    }

    /**
     * Regra configurável é DADO (§13, design D4). Avaliada sobre o ESTADO FINAL
     * (parecer T-trat-04): criar como parado e mover para andamento não burla.
     */
    private function validarDuplicidadeConfiguravel(Validator $validator, ?Tratamento $atual): void
    {
        $bloquear = app(ConfiguracaoService::class)
            ->get('tratamentos.bloquear_duplicado_mesmo_servico');

        $statusFinal = $this->has('status') ? $this->input('status') : ($atual?->status ?? 'andamento');
        $servicoFinal = $this->has('servico_id') ? $this->input('servico_id') : $atual?->servico_id;

        if (! $bloquear || $statusFinal !== 'andamento' || $servicoFinal === null) {
            return;
        }

        $duplicado = Tratamento::where('paciente_id', (int) $this->input('paciente_id'))
            ->where('servico_id', (int) $servicoFinal)
            ->where('status', 'andamento')
            ->when($atual, fn ($q) => $q->whereKeyNot($atual->id))
            ->exists();

        if ($duplicado) {
            $validator->errors()->add(
                'servico_id',
                'Já existe um tratamento em andamento deste paciente com este serviço.'
            );
        }
    }
}
