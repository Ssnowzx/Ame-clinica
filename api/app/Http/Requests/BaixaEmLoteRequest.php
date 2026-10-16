<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\AlcanceEmLoteRequest;
use App\Http\Requests\Concerns\GuardaProfissionalDesligado;
use App\Http\Requests\Concerns\LeIdDoPayload;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Baixa em lote por status da agenda de um profissional (change `baixa-em-lote-por-status`).
 *
 * A mesma Request serve a prévia e a execução: o alcance (posse no `authorize()`, profissional
 * existente e ativo, teto de 62 dias comparado de verdade) vem do trait partilhado com o
 * desmarque; o que é só da baixa fica aqui — o status alvo existente, a régua
 * "nunca o futuro" (D3) e a assinatura/referência da prévia, exigidas SÓ na execução (D5).
 *
 * `periodo` NÃO existe neste contrato (D16): um `periodo` no payload não é validado nem lido —
 * `validated()` o descarta, e o serviço fixa o dia inteiro. A semântica do status
 * (`aplicavel_em_lote`, `!em_aberto`) é de `BaixaEmLote::statusAplicado()`, antes da transação
 * e relida dentro dela; aqui só se garante que ele existe.
 */
class BaixaEmLoteRequest extends FormRequest
{
    use AlcanceEmLoteRequest {
        withValidator as private withValidatorDoAlcance;
    }
    use GuardaProfissionalDesligado;
    use LeIdDoPayload;

    /** Rótulos do log de segurança do gatilho PROF-DESLIGADO. */
    protected function dadosDoRecursoDesligado(): array
    {
        return ['recurso' => 'baixa_em_lote', 'operacao' => 'criar', 'recurso_id' => null];
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $exigidoNaExecucao = $this->ehExecucao() ? 'required' : 'sometimes';

        return [
            ...$this->regrasDoAlcance(),
            'status_id' => [
                'bail', 'required', 'integer',
                Rule::exists('status_agendamento', 'id'),
            ],
            // 64 hex minúsculos — a forma do sha256 que a prévia devolve; qualquer outra coisa é
            // payload montado à mão, e a execução não roda sobre prévia que ela não emitiu
            'assinatura' => [$exigidoNaExecucao, 'string', 'regex:/^[0-9a-f]{64}$/'],
            'referencia' => [$exigidoNaExecucao, 'string', 'date_format:Y-m-d H:i'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $this->withValidatorDoAlcance($validator);
        $validator->after(fn (Validator $v) => $this->assegurarAlcanceNaoFuturo($v));
    }

    /**
     * A régua do alcance que é só da baixa (D3): `ate >= de` e `ate <= hoje` na parede da
     * clínica. Status descontante já recusa data futura no consumo, mas "Falta Justificada"
     * (não-descontante) não tem guarda de data nenhuma — sem esta, o lote lançaria desfecho
     * antes do fato. O teto de 62 dias é do trait, comparado antes.
     */
    private function assegurarAlcanceNaoFuturo(Validator $validator): void
    {
        $datas = $this->datasDoAlcance();
        if ($datas === null) {
            return;
        }

        [$de, $ate] = $datas;

        if ($ate->lessThan($de)) {
            $validator->errors()->add('ate', 'A data final não pode ser anterior à inicial.');
        }

        $hoje = now(app(ConfiguracaoService::class)->get('clinica.timezone'))->toDateString();
        if ($ate->format('Y-m-d') > $hoje) {
            $validator->errors()->add('ate', 'A baixa só alcança o que já aconteceu: a data final não pode passar de hoje.');
        }
    }

    /** A execução é a rota que ESCREVE — só ela exige a prova de que a prévia foi lida. */
    private function ehExecucao(): bool
    {
        return $this->route()?->getActionMethod() === 'executar';
    }
}
