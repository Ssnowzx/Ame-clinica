<?php

namespace App\Support\Agenda;

use App\Models\Agendamento;
use App\Models\LancamentoCaixa;
use App\Models\StatusAgendamento;
use App\Support\Configuracoes\ConfiguracaoService;

/**
 * Encadeamento (§6, etapa 8 — T-not-09..12): ao TRANSICIONAR para status
 * descontante, puxa o primeiro agendamento posterior do mesmo paciente no dia
 * para o status-alvo — SOMENTE em estado virgem, sob lock, profundidade 1.
 * Fail-closed: qualquer inelegibilidade é skip silencioso (a automação é
 * conveniência — jamais aborta a mutação origem, jamais toca sessão/dinheiro).
 */
class EncadeamentoService
{
    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /** Chamar DENTRO da transação da mutação, após a reconciliação de consumo. */
    public function aoMudarStatus(Agendamento $origem, ?int $statusAnteriorId): void
    {
        // gatilho (D9/P2): TRANSIÇÃO para status descontante
        if ($origem->tipo !== 'atendimento' || $origem->paciente_id === null
            || $origem->status_id === null || $origem->status_id === $statusAnteriorId) {
            return;
        }
        if (! (bool) $origem->status()->value('desconta_sessao')) {
            return;
        }

        if (! $this->configuracoes->get('agenda.encadeamento_ativo')) {
            return;
        }

        // alvo RELIDO na execução (T-not-09/10a): some/flipou → inerte, nunca 500
        $alvoId = (int) $this->configuracoes->get('agenda.encadeamento_status_id');
        $alvo = $alvoId > 0
            ? StatusAgendamento::whereKey($alvoId)->where('desconta_sessao', false)->first()
            : null;
        if ($alvo === null) {
            return;
        }

        // primeiro agendamento posterior do MESMO paciente no MESMO dia (parede
        // da clínica), ainda no status inicial — estado virgem sob lock (T-not-10b)
        $statusInicialId = StatusAgendamento::inicialId(); // definição única (CR-06)
        $proximo = Agendamento::query()
            ->where('tipo', 'atendimento')
            ->where('paciente_id', $origem->paciente_id)
            ->whereKeyNot($origem->id)
            ->where('inicio', '>', $origem->inicio)
            ->whereDate('inicio', $origem->inicio->toDateString())
            ->where('status_id', $statusInicialId)
            ->whereNull('sessao_consumida_em')
            ->orderBy('inicio')
            ->lockForUpdate()
            ->first();

        if ($proximo === null
            || $proximo->atendimento()->exists()
            || LancamentoCaixa::where('agendamento_id', $proximo->id)->exists()) {
            return;
        }

        // profundidade 1 (T-not-12): transição direta via save()/Auditavel com o
        // usuário causal — nunca via atualizar() (não reavalia encadeamento);
        // alvo não desconta → o consumo jamais é tocado (T-not-10)
        $proximo->status_id = $alvo->id;
        $proximo->save();
    }
}
