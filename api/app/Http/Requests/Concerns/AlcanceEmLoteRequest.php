<?php

namespace App\Http\Requests\Concerns;

use App\Support\Rbac\EscopoDoProfissional;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Validation\Rule;

/**
 * O alcance de uma operação em lote da agenda de um profissional (change
 * `baixa-em-lote-por-status`, D1): posse, profissional existente e o teto de dias — o que o
 * desmarque e a baixa por status validam do MESMO jeito. Extraído da `DesmarqueEmLoteRequest`,
 * porque a régua de dias que o gate já provou furada uma vez não pode existir em duas Requests.
 *
 * Pressupõe, na Request que o usa, `LeIdDoPayload` (`idInformado`) e `GuardaProfissionalDesligado`
 * (`regraProfissionalAtivoOuVinculado`) — a régua do profissional é a mesma do `AgendamentoRequest`.
 *
 * POSSE ANTES DA VALIDAÇÃO (`SEC-VP-20`/`SEC-VP-32`): com a posse só no controller, ela vinha
 * DEPOIS de `validated()`, e o par colega × inexistente se separava por status (403 × 422),
 * enumerando o quadro de profissionais que o escopado não vê pela seleção da agenda.
 *
 * EIXO DA AGENDA, não os dois (CR4b-02, `SEC-VP-44`): mudar status em massa não cria vínculo com
 * criança nenhuma; quem é plano na agenda e escopado no clínico não pode receber 403 aqui.
 */
trait AlcanceEmLoteRequest
{
    /** Teto de dias do intervalo — o teto de LINHAS não impede um intervalo de 100 anos. */
    public const MAXIMO_DE_DIAS = 62;

    public function authorize(): bool
    {
        $solicitado = $this->idInformado('profissional_id');

        if ($solicitado !== null) {
            app(EscopoDoProfissional::class)->agenda($this->user())->assegurarPosse($solicitado);
        }

        return true; // o resto da autorização é do middleware permission: da rota
    }

    /**
     * As regras comuns do alcance, para espalhar no `rules()` de cada Request.
     *
     * `bail` no profissional: o `exists` curto-circuita antes da checagem de status, como no
     * `AgendamentoRequest`. O teto de DIAS é comparado no `withValidator`, não aqui: a forma
     * `before_or_equal:<n> days after <campo>` NÃO existe em Laravel — `strtotime` a resolve
     * como `false` e a regra passa a aceitar qualquer intervalo (achado do gate, 10 anos passando).
     *
     * @return array<string, list<mixed>>
     */
    protected function regrasDoAlcance(): array
    {

        return [
            'profissional_id' => [
                'bail', 'required', 'integer',
                Rule::exists('profissionais', 'id'),
                $this->regraProfissionalAtivoOuVinculado(null),
            ],
            'de' => ['required', 'date_format:Y-m-d', 'after_or_equal:1900-01-01'],
            'ate' => ['required', 'date_format:Y-m-d'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $v) => $this->assegurarTetoDeDias($v));
    }

    /**
     * O teto de DIAS, comparado DE VERDADE. Irmão do teto de LINHAS de cada operação, não
     * substituível por ele: um intervalo de anos com poucos agendamentos passa no teto de linhas
     * e ainda assim manda o desmarque criar um bloqueio POR DIA (1096 bloqueios em 3,12s no gate).
     */
    protected function assegurarTetoDeDias(Validator $validator): void
    {
        $datas = $this->datasDoAlcance();
        if ($datas === null) {
            return;
        }

        if ($datas[0]->diffInDays($datas[1], false) > self::MAXIMO_DE_DIAS) {
            $validator->errors()->add('ate', 'O intervalo não pode passar de '.self::MAXIMO_DE_DIAS
                .' dias. Estreite as datas.');
        }
    }

    /**
     * `[de, ate]` já interpretados, ou nulo quando alguma data está ausente ou malformada — o
     * `date_format` já a recusou, e a régua de dias não tem o que comparar.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}|null
     */
    protected function datasDoAlcance(): ?array
    {
        $de = $this->input('de');
        $ate = $this->input('ate');
        if (! is_string($de) || ! is_string($ate)) {
            return null;
        }

        try {
            return [CarbonImmutable::parse($de), CarbonImmutable::parse($ate)];
        } catch (\Throwable) {
            return null;
        }
    }
}
