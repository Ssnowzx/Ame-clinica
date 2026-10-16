<?php

namespace App\Http\Requests;

use App\Models\Convenio;
use App\Support\Ciclos\CalendarioDoCiclo;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ConvenioRequest extends FormRequest
{
    /**
     * Teto do mapa TISS dormente (gatilho TISS-BLOB, parecer SEC-CA-04/14): sem
     * shape, `convenios.editar` gravaria um blob arbitrário que o `Auditavel` copia
     * para a trilha append-only, sem exclusão — por onde PII entraria de vez.
     */
    private const MAX_FLAGS_TISS = 30;

    private const MAX_VALOR_TISS = 255;

    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    public function rules(): array
    {
        return [
            'nome' => [
                'required', 'string', 'max:255',
                Rule::unique('convenios', 'nome')
                    ->ignore($this->route('id')),
            ],
            // campos TISS: armazenamento dormente (§14) — validação só de forma
            'registro_ans' => ['sometimes', 'nullable', 'string', 'max:20'],
            'codigo_operadora' => ['sometimes', 'nullable', 'string', 'max:30'],
            'versao_tiss' => ['sometimes', 'nullable', 'string', 'max:10'],
            'guia_sequencial' => ['sometimes', 'boolean'],
            'alerta_agend_mesmo_dia' => ['sometimes', 'boolean'],
            // mapa RASO e bounded (§14 dormente): teto de chaves; chaves E valores
            // escalares curtos; aninhamento PROIBIDO — é onde um blob/PII se esconde.
            // As mensagens NUNCA ecoam o valor recebido (dado sensível).
            'flags_tiss_json' => ['sometimes', 'nullable', 'array', 'max:'.self::MAX_FLAGS_TISS, $this->flagsTissBounded()],
            // validade do PEDIDO MÉDICO em meses (limites-e-pedidos, D4/SEC-LP-05):
            // dado por operadora; sem valor, nenhum vencimento de pedido é derivado
            'pedido_validade_meses' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:36'],
            // calendário do CICLO (fechamento-de-ciclo, D1): domínio FECHADO no boundary.
            // O teto 28 é o que garante que a derivação particiona o calendário sem
            // buraco (SEC-FC-21 — ver CalendarioDoCiclo); a coerência tipo×dia é validada
            // no estado final, em withValidator.
            'ciclo_dia_corte' => [
                'sometimes', 'nullable', 'integer',
                'min:'.CalendarioDoCiclo::DIA_CORTE_MIN,
                'max:'.CalendarioDoCiclo::DIA_CORTE_MAX,
            ],
            'ciclo_tipo_corte' => ['sometimes', 'nullable', Rule::in(CalendarioDoCiclo::TIPOS)],
            // fronteira §14 como DADO (T-fin-17): decide o destino do faturamento
            'particular' => ['sometimes', 'boolean'],
            'ativo' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * Coerência tipo × dia de corte no ESTADO FINAL (update parcial não burla).
     *
     * `dia_fixo` sem dia não deriva período algum, e um dia solto (ou preso a
     * `ultimo_dia`) é lixo que a próxima leitura interpretaria como calendário. Sem esta
     * checagem, um convênio ficaria "meio configurado": `CalendarioDoCiclo::configurado`
     * diria não, e o cadastro diria sim.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return; // forma primeiro — coerência só sobre payload válido
            }

            $atual = $this->route('id') !== null ? Convenio::find($this->route('id')) : null;
            $tipo = $this->has('ciclo_tipo_corte')
                ? $this->input('ciclo_tipo_corte')
                : $atual?->ciclo_tipo_corte;
            $dia = $this->has('ciclo_dia_corte')
                ? $this->input('ciclo_dia_corte')
                : $atual?->ciclo_dia_corte;

            if ($tipo === CalendarioDoCiclo::TIPO_DIA_FIXO && $dia === null) {
                $validator->errors()->add(
                    'ciclo_dia_corte',
                    'Informe o dia de corte do ciclo (de 1 a '.CalendarioDoCiclo::DIA_CORTE_MAX.').'
                );
            }

            if ($tipo !== CalendarioDoCiclo::TIPO_DIA_FIXO && $dia !== null) {
                $validator->errors()->add(
                    'ciclo_dia_corte',
                    'O dia de corte só se aplica ao ciclo de dia fixo.'
                );
            }
        });
    }

    /**
     * Recusa o que faria de `flags_tiss_json` um blob: chave/valor longos ou valor
     * ANINHADO. Uma única passada sobre o mapa raso — sem ecoar o conteúdo.
     */
    private function flagsTissBounded(): Closure
    {
        return function (string $atributo, mixed $valor, Closure $recusar): void {
            if (! is_array($valor)) {
                return; // a regra 'array' já recusa não-array
            }

            foreach ($valor as $chave => $conteudo) {
                if (is_string($chave) && mb_strlen($chave) > self::MAX_VALOR_TISS) {
                    $recusar('Uma chave de flag TISS excede o comprimento máximo.');

                    return;
                }
                if (is_array($conteudo)) {
                    $recusar('As flags TISS não podem conter valores aninhados.');

                    return;
                }
                if (is_string($conteudo) && mb_strlen($conteudo) > self::MAX_VALOR_TISS) {
                    $recusar('Uma flag TISS excede o comprimento máximo.');

                    return;
                }
            }
        };
    }

    public function messages(): array
    {
        return [
            'nome.unique' => 'Já existe um convênio com este nome.',
            // sem ecoar o valor recebido, como o resto do cadastro
            'ciclo_tipo_corte.in' => 'O tipo de corte do ciclo informado não é válido.',
            'ciclo_dia_corte.min' => 'O dia de corte do ciclo deve ficar entre 1 e '.CalendarioDoCiclo::DIA_CORTE_MAX.'.',
            'ciclo_dia_corte.max' => 'O dia de corte do ciclo deve ficar entre 1 e '.CalendarioDoCiclo::DIA_CORTE_MAX.'.',
        ];
    }
}
