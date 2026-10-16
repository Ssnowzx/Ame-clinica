<?php

namespace App\Support\Financeiro;

use App\Models\Agendamento;
use App\Models\LancamentoCaixa;
use App\Models\Servico;
use App\Models\Tratamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Faturamento clínico → caixa (§9, design D3): o atendimento consumido (marcador
 * da etapa 6) vira lançamento Receita com o valor da tabela de serviços do
 * convênio. Fronteira §14 FAIL-CLOSED (T-fin-17): convênio só cai no caixa por
 * flag `particular` ou config — regra é DADO, nunca string-match de nome.
 */
class FaturamentoService
{
    private const ERRO_UNIQUE = 1062;

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly LancamentoCaixaService $lancamentos,
    ) {}

    /** @param array<string, mixed> $dados */
    public function faturar(int $agendamentoId, array $dados): LancamentoCaixa
    {
        try {
            return DB::transaction(function () use ($agendamentoId, $dados): LancamentoCaixa {
                // pré-condições relidas DO BANCO sob lock, ordem agendamento →
                // tratamento — a mesma do ConsumoSessaoService (T-fin-14)
                $agendamento = Agendamento::whereKey($agendamentoId)
                    ->lockForUpdate()->firstOrFail(); // inexistente → 404

                if ($agendamento->tipo !== 'atendimento' || $agendamento->sessao_consumida_em === null) {
                    throw ValidationException::withMessages([
                        'agendamento_id' => 'Só atendimento com sessão consumida é faturável.',
                    ]);
                }

                $tratamento = $agendamento->tratamento_id !== null
                    ? Tratamento::whereKey($agendamento->tratamento_id)->lockForUpdate()->first()
                    : null;
                $servico = $tratamento?->servico_id !== null
                    ? Servico::find($tratamento->servico_id)
                    : null;
                if ($servico === null) {
                    throw ValidationException::withMessages([
                        'agendamento_id' => 'O tratamento não tem serviço definido para precificar o faturamento.',
                    ]);
                }

                // fronteira §14 (T-fin-17): flag por convênio OU config global
                $particular = (bool) $tratamento->convenio()->value('particular');
                if (! $particular && ! $this->configuracoes->get('financeiro.lancar_convenio_no_caixa')) {
                    throw ValidationException::withMessages([
                        'agendamento_id' => 'Tratamento de convênio não cai no caixa — segue a esteira de convênios.',
                    ]);
                }

                // preço é do SERVIDOR (T-fin-15); desconto ≤ teto da clínica (T-fin-16)
                $valor = (string) $servico->valor;
                $desconto = (string) ($dados['desconto'] ?? '0');
                $tetoPct = (string) $this->configuracoes->get('financeiro.desconto_maximo_pct');
                $descontoMaximo = bcdiv(bcmul($valor, $tetoPct, 4), '100', 2);
                if (bccomp($desconto, $descontoMaximo, 2) > 0) {
                    throw ValidationException::withMessages([
                        'desconto' => 'Desconto acima do máximo configurado pela clínica.',
                    ]);
                }

                $lancamento = new LancamentoCaixa([
                    'tipo' => 'receita',
                    // competência = a data da sessão; vencimento default = hoje na parede
                    'competencia' => $agendamento->inicio->toDateString(),
                    'vencimento' => $dados['vencimento']
                        ?? now($this->configuracoes->get('clinica.timezone'))->toDateString(),
                    'interessado_tipo' => 'paciente',
                    'interessado_id' => $agendamento->paciente_id,
                    'categoria_id' => $dados['categoria_id'],
                    'subcategoria_id' => $dados['subcategoria_id'] ?? null,
                    'valor' => $valor,
                    'desconto' => $desconto,
                    'tipo_pagamento_id' => $dados['tipo_pagamento_id'],
                    'conta_id' => $dados['conta_id'],
                    'contabil' => $dados['contabil']
                        ?? (bool) $this->configuracoes->get('financeiro.contabil_padrao'),
                    'documento' => $dados['documento'] ?? null,
                    'obs' => $dados['obs'] ?? null,
                ]);
                // vínculo clínico server-set — anti-duplo-faturamento é o unique (T-fin-13)
                $lancamento->agendamento_id = $agendamento->id;
                $lancamento->tratamento_id = $tratamento->id;
                if ($dados['pagar_agora'] ?? false) {
                    // a família pagou na sessão: a MESMA régua da baixa, antes do `save()`
                    // (change `caixa-do-dia-a-dia`, D1) — a auditoria registra uma criação já paga
                    $this->lancamentos->marcarComoPago($lancamento);
                }
                $lancamento->save();

                return $lancamento->refresh();
            });
        } catch (QueryException $excecao) {
            if (($excecao->errorInfo[1] ?? null) !== self::ERRO_UNIQUE) {
                throw $excecao;
            }
            throw ValidationException::withMessages([
                'agendamento_id' => 'Este agendamento já foi faturado.',
            ]);
        }
    }
}
