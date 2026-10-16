<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\LeIdDoPayload;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Forma e FKs escopadas; as invariantes clínicas (autoria vinculada, prazo,
 * bloqueio pós-status, responsável técnico no estado final) vivem no controller.
 * preenchida_em NUNCA é aceito do payload (T-ate-07) — fora de $fillable.
 */
class EvolucaoRequest extends FormRequest
{
    use LeIdDoPayload;

    /**
     * O gate da EXCEÇÃO DE AUTORIA mora AQUI, não no controller (SEC-AE-01): o
     * FormRequest valida na resolução da request, ANTES de qualquer linha do
     * controller — só o authorize() garante que o 403 vence o 422 (um gate no
     * controller deixaria o 422 nomear `motivo_assinatura` a quem nem tem a
     * permissão, vazando o mecanismo). As demais autorizações seguem no
     * middleware permission: das rotas.
     *
     * Usuário SEM vínculo criando evolução está, por definição, assinando EM
     * NOME DE OUTRO (FA-04, decisão da clínica 2026-07-16): exige a permissão
     * dedicada. A permissão é AND com o escopo D11, nunca OR — sem
     * `clinico.ver_todos`, o assegurarPosse do controller continua negando.
     */
    public function authorize(): bool
    {
        // AUTORIA ANTES DA VALIDAÇÃO (`SEC-VP-48`, rodada 4): o escopado que assinava com o
        // `profissional_id` do colega levava 422 "só registra em nome próprio", e com um id
        // inexistente 422 "não existe" — a diferença enumerava o quadro pela mensagem. Decidida
        // aqui, pelo eixo CLÍNICO (autoria é prontuário), as duas viram 403 iguais. A invariante
        // do controller (`validarInvariantes`) continua lá: é a rede de quem chegar por outro caminho.
        $autor = $this->idInformado('profissional_id');
        if ($this->route('id') === null && $autor !== null) {
            app(EscopoDoProfissional::class)->clinico($this->user())->assegurarPosse($autor);
        }

        if (! $this->assinandoPorOutro()) {
            return true;
        }

        return $this->user()?->can('evolucoes.assinar_por_outro') === true;
    }

    public function rules(): array
    {
        $criando = $this->route('id') === null;

        return [
            // autoria é IMUTÁVEL na edição (SEC-R2-01): esconder o campo na tela é
            // reforço; o controle é o boundary recusar qualquer tentativa de reassinar.
            // `missing`, NUNCA `prohibited`: prohibited = "ausente OU VAZIO" — deixava
            // `profissional_id: null` passar, o validated() carregava o null até o
            // update() e a coluna NOT NULL virava 500 (re-review rodada 3, bloqueante)
            'profissional_id' => $criando
                ? [
                    'required', 'integer',
                    Rule::exists('profissionais', 'id'),
                ]
                : ['missing'],
            'responsavel_tecnico_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('profissionais', 'id'),
            ],
            'conteudo' => [$criando ? 'required' : 'sometimes', 'string', 'max:20000'], // teto P4
            // o MOTIVO da exceção de autoria (SEC-AE-03): obrigatório exatamente no
            // ramo da exceção; para quem assina em nome próprio (ou edita), a chave é
            // `missing` — presença com qualquer valor, inclusive null, é recusada
            'motivo_assinatura' => $this->assinandoPorOutro()
                ? ['required', 'string', 'max:500']
                : ['missing'],
        ];
    }

    public function messages(): array
    {
        // estáticas de propósito (SEC-AE-03): nunca ecoar o valor digitado
        return [
            'motivo_assinatura.required' => 'Informe o motivo de registrar em nome de outro profissional.',
            'motivo_assinatura.max' => 'O motivo deve ter no máximo 500 caracteres.',
            'motivo_assinatura.missing' => 'Motivo de assinatura só se aplica ao registrar em nome de outro profissional.',
        ];
    }

    /** Criação por usuário sem vínculo = assinatura em nome de outro (FA-04). */
    public function assinandoPorOutro(): bool
    {
        return $this->route('id') === null
            && $this->user()?->profissional_id === null;
    }
}
