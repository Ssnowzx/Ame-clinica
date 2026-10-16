<?php

namespace App\Support\Agenda;

use App\Models\Agendamento;
use App\Models\LancamentoCaixa;
use App\Models\Tratamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Validation\ValidationException;

/**
 * Reconciliação do consumo de sessão no ESTADO FINAL do agendamento (design D1,
 * lição da etapa 5: invariante avaliada no payload escapa por PUT parcial).
 *
 * Fonte da verdade: o marcador `sessao_consumida_em` (D2) — idempotente; o flip
 * da flag `desconta_sessao` de um status JAMAIS retro-reconcilia (T-ate-14).
 * Todo consumo/estorno roda SOB `lockForUpdate` na linha do tratamento, dentro
 * da transação da mutação que o disparou (T-ate-13, fecha o TOCTOU T-trat-05a).
 */
class ConsumoSessaoService
{
    public function __construct(private readonly ConfiguracaoService $configuracoes) {}

    /**
     * Chamar DENTRO da transação da mutação, com o agendamento JÁ salvo no seu
     * estado final. $tratamentoAnteriorId é o tratamento de ANTES da mutação —
     * é dele que um consumo pré-existente se estorna quando o vínculo troca.
     */
    public function reconciliar(Agendamento $agendamento, ?int $tratamentoAnteriorId): void
    {
        // o marcador é RELIDO SOB LOCK aqui dentro (gate r1, CR-01): a decisão
        // consumir/estornar nunca se apoia no modelo carregado pelo controller —
        // duas transições concorrentes do mesmo agendamento seriam dupla contagem.
        // Ordem de locks fixa em TODOS os caminhos: agendamento → tratamento.
        $marcadorAtual = Agendamento::whereKey($agendamento->id)
            ->lockForUpdate()->value('sessao_consumida_em');
        $agendamento->sessao_consumida_em = $marcadorAtual;
        $consumido = $marcadorAtual !== null;

        $tratamentoAtualId = $agendamento->tratamento_id === null
            ? null : (int) $agendamento->tratamento_id; // payload form-encoded chega string

        $deveConsumir = $agendamento->tipo === 'atendimento'
            && $tratamentoAtualId !== null
            && $agendamento->status_id !== null
            && (bool) $agendamento->status()->value('desconta_sessao');

        $tratamentoTrocou = $consumido && $tratamentoAnteriorId !== $tratamentoAtualId;

        if ($consumido && (! $deveConsumir || $tratamentoTrocou)) {
            $this->estornar($agendamento, $tratamentoAnteriorId);
            $consumido = false;
        }

        if ($deveConsumir && ! $consumido) {
            $this->consumir($agendamento);
        }
    }

    private function consumir(Agendamento $agendamento): void
    {
        // uma sessão não pode ter ocorrido no FUTURO (D9/P1 — trava a amplificação
        // de série do T-ate-15); mesmo dia é permitido em qualquer horário
        $hojeNaClinica = now($this->configuracoes->get('clinica.timezone'))->toDateString();
        if ($agendamento->inicio->toDateString() > $hojeNaClinica) {
            throw ValidationException::withMessages([
                'status_id' => 'Status que desconta sessão não pode ser aplicado a agendamento em data futura.',
            ]);
        }

        /** @var Tratamento $tratamento saldo revalidado SOB LOCK (T-ate-13) */
        $tratamento = Tratamento::whereKey($agendamento->tratamento_id)
            ->lockForUpdate()->firstOrFail();

        if ($tratamento->sessoes_realizadas >= $tratamento->sessoes_total) {
            throw ValidationException::withMessages([
                'tratamento_id' => 'O tratamento não tem saldo de sessões para descontar.',
            ]);
        }

        // save() Eloquent, nunca increment() cru: a trilha Auditavel precisa disparar (T-ate-16)
        $tratamento->sessoes_realizadas++;
        $tratamento->save();

        // parede da clínica, como todo datetime do domínio (CR-03) — nunca UTC do PHP
        $agendamento->sessao_consumida_em = now($this->configuracoes->get('clinica.timezone'))
            ->format('Y-m-d H:i');
        $agendamento->save(); // marcador em claro no diff do agendamento
    }

    private function estornar(Agendamento $agendamento, ?int $tratamentoAnteriorId): void
    {
        // sessão e dinheiro nunca divergem em silêncio (T-fin-18, decisão P5 da
        // etapa 7): agendamento FATURADO não estorna consumo — exclua/estorne o
        // lançamento primeiro, com trilha em cada passo
        if (LancamentoCaixa::where('agendamento_id', $agendamento->id)->exists()) {
            throw ValidationException::withMessages([
                'status_id' => 'Agendamento faturado não pode ter a sessão estornada — exclua ou estorne o lançamento primeiro.',
            ]);
        }

        // consumido implica tratamento de origem; sem ele, só limpa o marcador
        if ($tratamentoAnteriorId !== null) {
            $tratamento = Tratamento::whereKey($tratamentoAnteriorId)
                ->lockForUpdate()->first();

            if ($tratamento !== null && $tratamento->sessoes_realizadas > 0) {
                $tratamento->sessoes_realizadas--; // nunca abaixo de 0
                $tratamento->save();
            }
        }

        $agendamento->sessao_consumida_em = null;
        $agendamento->save();
    }
}
