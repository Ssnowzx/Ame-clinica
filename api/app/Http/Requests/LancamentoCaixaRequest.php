<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\LeIdDoPayload;
use App\Models\LancamentoCaixa;
use App\Support\Financeiro\AutorizacaoDoVinculo;
use App\Support\Financeiro\LancamentoCaixaService;
use App\Support\Financeiro\LancamentosVisiveis;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Forma e FKs escopadas; as coerências de ESTADO FINAL (categoria×tipo,
 * subcategoria×categoria, interessado polimórfico, líquido ≥ 0) vivem no
 * LancamentoCaixaService. pago_em/grupo_parcelamento NUNCA são aceitos do
 * payload (fora de $fillable — T-fin-07/10).
 */
class LancamentoCaixaRequest extends FormRequest
{
    use LeIdDoPayload;

    /**
     * O que a autorização do vínculo VIU do lançamento (`tratamento_id` e se estava pago). O
     * serviço confere sob lock que o registro ainda é esse (CR-RPP-18): a decisão de posse e de
     * `lancamentos.pagar` foi tomada sobre esta leitura, e ela não pode valer para outro estado.
     *
     * @var array{tratamento_id: int|null, pago: bool}|null
     */
    public ?array $estadoAutorizado = null;

    public function authorize(): bool
    {
        // o módulo é do middleware `permission:` das rotas; aqui só o que depende do REGISTRO
        // e do que o pedido QUER fazer além de criar
        $this->assegurarQuemPagaAoRegistrar();
        $this->assegurarQuemLancaParaFuncionario();
        $this->assegurarQuemMexeNoVinculo();

        return true;
    }

    /**
     * Registrar já pago é dar baixa (change `caixa-do-dia-a-dia`, D3): pede `lancamentos.pagar`
     * além do `lancamentos.criar` da rota — a MESMA separação de quem lança e de quem recebe.
     * Antes da validação: quem não pode dar baixa leva 403, nunca um 422 que descreve o pedido.
     */
    private function assegurarQuemPagaAoRegistrar(): void
    {
        abort_if(
            $this->boolean('pagar_agora') && $this->user()?->can('lancamentos.pagar') !== true,
            403,
            'Registrar já pago exige a permissão de dar baixa.',
        );
    }

    /**
     * Lançamento de funcionário é de quem vê a folha (change `financeiro-sem-faturamento-total`,
     * D3): criar um, ou apontar outro para funcionário, sem `funcionarios.ver` é 403. Antes da
     * validação: o serviço respondia 422 ao funcionário inexistente e aceitava o que existe — e a
     * diferença enumerava os funcionários.
     */
    private function assegurarQuemLancaParaFuncionario(): void
    {
        abort_if(
            $this->input('interessado_tipo') === 'funcionario' && ! LancamentosVisiveis::veAFolha(),
            403,
            'Lançamento de funcionário exige acesso aos funcionários.',
        );
    }

    /**
     * QUEM pode apontar o dinheiro para um tratamento (change `recebido-por-profissional`). O
     * vínculo decide de qual profissional é o pagamento no fechamento do mês, então MEXER nele
     * (reenviar o mesmo valor não é mexer — o formulário reenvia sempre) pede:
     *
     * - no lançamento PAGO, `lancamentos.pagar` (SEC-RPP-03): trocar o vínculo move dinheiro já
     *   recebido entre profissionais, e até esta change só quem dá baixa mexia em lançamento pago;
     * - posse, pelo eixo AGENDA, do tratamento de ORIGEM e do de DESTINO — a régua do
     *   faturamento: o escopado não leva o pagamento do colega para o próprio pacote, nem o seu
     *   para o do colega.
     *
     * Mora no `authorize()`, ANTES da validação (CR-RPP-17/SEC-RPP-05, o padrão do `SEC-VP-20`):
     * no controller, o `exists` respondia 422 ao id inexistente e a posse 403 ao do colega, e a
     * diferença enumerava os tratamentos da clínica. Aqui o inexistente vira dono `null`, e o
     * escopado leva o MESMO 403. O id é lido pelo `LeIdDoPayload` (presente é presente).
     */
    private function assegurarQuemMexeNoVinculo(): void
    {
        $id = $this->route('id');
        $atual = $id !== null ? LancamentosVisiveis::filtrar(LancamentoCaixa::query())->find($id) : null;
        // 404 AQUI, antes da validação (SEC-RPP-08/09): "o 404 é do controller" deixava a
        // autorização do vínculo PULAR quando o `find` não achava o registro — e a validação
        // respondia antes do 404, reabrindo o oráculo de existência de tratamento
        abort_if($id !== null && $atual === null, 404);
        if ($atual !== null) {
            $this->estadoAutorizado = ['tratamento_id' => $atual->tratamento_id, 'pago' => $atual->pago_em !== null];
        }

        if (! array_key_exists('tratamento_id', $this->all())) {
            return;
        }

        // a régua mora em `AutorizacaoDoVinculo`, a MESMA do lote (`vincular-tratamentos`)
        app(AutorizacaoDoVinculo::class)->assegurar($this->user(), $atual, $this->idInformado('tratamento_id'));
    }

    public function rules(): array
    {
        $criando = $this->route('id') === null;

        return [
            'tipo' => [$criando ? 'required' : 'sometimes', Rule::in(LancamentoCaixa::TIPOS)],
            'competencia' => [$criando ? 'required' : 'sometimes', 'date_format:Y-m-d', 'after_or_equal:1900-01-01'],
            'vencimento' => [$criando ? 'required' : 'sometimes', 'date_format:Y-m-d', 'after_or_equal:1900-01-01'],
            'interessado_tipo' => ['sometimes', 'nullable', Rule::in(LancamentoCaixa::INTERESSADOS)],
            'interessado_id' => ['sometimes', 'nullable', 'integer'],
            // vínculo manual com tratamento (change `recebido-por-profissional`): existe
            // aqui; ser da MESMA criança é coerência do estado final, no serviço
            'tratamento_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('tratamentos', 'id'),
            ],
            'categoria_id' => [
                $criando ? 'required' : 'sometimes', 'integer',
                Rule::exists('categorias', 'id'),
            ],
            'subcategoria_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('subcategorias', 'id'),
            ],
            // dinheiro: máx 2 casas, rejeitar — nunca arredondar (T-fin-06)
            'valor' => [$criando ? 'required' : 'sometimes', 'numeric', 'decimal:0,2', 'gt:0', 'max:99999999.99'],
            'juros' => ['sometimes', 'numeric', 'decimal:0,2', 'min:0', 'max:99999999.99'],
            'multa' => ['sometimes', 'numeric', 'decimal:0,2', 'min:0', 'max:99999999.99'],
            'desconto' => ['sometimes', 'numeric', 'decimal:0,2', 'min:0', 'max:99999999.99'],
            'tipo_pagamento_id' => [
                $criando ? 'required' : 'sometimes', 'integer',
                Rule::exists('tipos_pagamento', 'id'),
            ],
            'conta_id' => [
                $criando ? 'required' : 'sometimes', 'integer',
                Rule::exists('contas', 'id'),
            ],
            'contabil' => ['sometimes', 'boolean'],
            'documento' => ['sometimes', 'nullable', 'string', 'max:60'],
            'obs' => ['sometimes', 'nullable', 'string', 'max:1000'],
            // parcelamento materializado (D4) — só na criação
            'parcelas' => $criando
                ? ['sometimes', 'integer', 'min:2', 'max:'.LancamentoCaixaService::MAX_PARCELAS]
                : ['missing'],
            'aplicar_no_grupo' => ['sometimes', 'boolean'],
            // registrar já pago (change `caixa-do-dia-a-dia`) — só na criação; na edição a baixa
            // é a transição própria `POST /lancamentos/{id}/pagamento`
            'pagar_agora' => $criando ? ['sometimes', 'boolean'] : ['missing'],
        ];
    }

    public function messages(): array
    {
        return [
            'parcelas.max' => 'Máximo de '.LancamentoCaixaService::MAX_PARCELAS.' parcelas.',
            'parcelas.missing' => 'Parcelamento só na criação do lançamento.',
            'pagar_agora.missing' => 'Na edição, dê baixa pelo botão Pagar.',
        ];
    }
}
