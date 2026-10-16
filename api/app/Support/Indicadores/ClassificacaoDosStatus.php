<?php

namespace App\Support\Indicadores;

use App\Models\StatusAgendamento;
use Illuminate\Support\Collection;

/**
 * O que cada status da clínica SIGNIFICA para os painéis (change indicadores-profissionais, D4) —
 * lido do cadastro numa consulta e decidido pelas FLAGS, nunca pelo nome (§13). É a fonte única das
 * definições: as contas do painel e a lista de nomes do "i" (`status_que_contam`) perguntam aqui,
 * então o que a tela diz que conta é o que a conta contou.
 *
 *  - **reserva** (`marca_reserva`): compromisso provisório — NÃO é sessão; sai de tudo;
 *  - **falta** (`marca_falta`): hoje só "Não Compareceu" (a "Falta Justificada" não tem a flag);
 *  - **realizada**: desconta a sessão e NÃO é falta — a régua do "realizado" de `ProdutividadeDoMes`
 *    ("Não Compareceu" também desconta, porque a clínica cobra a sessão perdida);
 *  - **desmarque**: liberou o horário (`ocupa_horario = false`) e não é falta nem realizada — o
 *    "liberado" da produtividade. A precedência falta → realizada → desmarque é a MESMA dos baldes
 *    de lá, e é ela que mantém as três contagens disjuntas (um status com duas flags não conta duas
 *    vezes na taxa);
 *  - **marcada**: ocupa o horário e não é reserva (`ehSessaoMarcada`) — o numerador da ocupação.
 *  - **em aberto** (`em_aberto`, a flag da baixa em lote): ainda sem desfecho — a sessão que já passou
 *    nele está SEM BAIXA (change inicio-dos-indicadores, D4).
 *
 * Agendamento sem status (não acontece pela API) não é reserva, falta, realizada nem desmarque,
 * mas segura o horário: é o "em aberto" do LEFT JOIN da produtividade.
 */
final class ClassificacaoDosStatus
{
    /** @param  Collection<int, StatusAgendamento>  $status  por id, na ordem do cadastro */
    private function __construct(private readonly Collection $status) {}

    public static function daClinica(): self
    {
        return new self(
            StatusAgendamento::query()
                ->orderBy('ordem')
                ->orderBy('id')
                ->get(['id', 'nome', 'cor', 'ordem', 'desconta_sessao', 'ocupa_horario', 'marca_falta', 'marca_reserva', 'em_aberto'])
                ->keyBy('id'),
        );
    }

    public function ehReserva(?int $statusId): bool
    {
        return (bool) $this->flag($statusId, 'marca_reserva');
    }

    public function ehFalta(?int $statusId): bool
    {
        return ! $this->ehReserva($statusId) && (bool) $this->flag($statusId, 'marca_falta');
    }

    public function ehRealizada(?int $statusId): bool
    {
        return ! $this->ehReserva($statusId) && ! $this->ehFalta($statusId)
            && (bool) $this->flag($statusId, 'desconta_sessao');
    }

    public function ehDesmarque(?int $statusId): bool
    {
        return ! $this->ehReserva($statusId) && ! $this->ehFalta($statusId) && ! $this->ehRealizada($statusId)
            && $this->flag($statusId, 'ocupa_horario') === false;
    }

    public function ehEmAberto(?int $statusId): bool
    {
        return ! $this->ehReserva($statusId) && (bool) $this->flag($statusId, 'em_aberto');
    }

    public function ehMarcada(?int $statusId): bool
    {
        $status = $statusId === null ? null : $this->status->get($statusId);

        return $status === null || $status->ehSessaoMarcada();
    }

    /**
     * Os NOMES que entram em falta e em desmarque, na ordem do cadastro — o "i" mostra à clínica o
     * que conta, e ela pode mudar a flag (D4).
     *
     * @return array{falta: list<string>, desmarque: list<string>}
     */
    public function quemConta(): array
    {
        return [
            'falta' => $this->nomesOnde(fn (int $id): bool => $this->ehFalta($id)),
            'desmarque' => $this->nomesOnde(fn (int $id): bool => $this->ehDesmarque($id)),
        ];
    }

    /**
     * Os status na ordem do cadastro — para a tabela de situação.
     *
     * @return Collection<int, StatusAgendamento>
     */
    public function emOrdem(): Collection
    {
        return $this->status->values();
    }

    /** @return list<string> */
    private function nomesOnde(callable $predicado): array
    {
        return $this->status
            ->filter(fn (StatusAgendamento $status): bool => $predicado((int) $status->id))
            ->map(fn (StatusAgendamento $status): string => (string) $status->nome)
            ->values()
            ->all();
    }

    /** O valor de uma flag do status; `null` quando o status não existe no cadastro. */
    private function flag(?int $statusId, string $flag): ?bool
    {
        $status = $statusId === null ? null : $this->status->get($statusId);

        return $status === null ? null : (bool) $status->{$flag};
    }
}
