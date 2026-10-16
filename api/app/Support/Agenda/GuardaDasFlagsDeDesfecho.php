<?php

namespace App\Support\Agenda;

use App\Models\StatusAgendamento;
use Illuminate\Validation\ValidationException;

/**
 * "Em aberto" é o que ainda NÃO teve desfecho — e as outras flags do status são desfechos.
 *
 * A baixa em lote por status (D2) alcança todo agendamento cujo status tem `em_aberto`. Se a
 * clínica marcasse "Reserva de Agenda" ou "Não Compareceu" como em aberto, um Finalizar em
 * massa consumiria sessão de quem nem veio. Daí os invariantes, verificados no ESTADO FINAL
 * do status gravado (a mesma lição da `GuardaDoStatusInicial`: quem olha só o payload não vê
 * a flag que já estava ligada):
 *
 * - `em_aberto` não coexiste com `desconta_sessao`, `marca_falta`, `marca_reserva` nem com
 *   `ocupa_horario = false` — cada uma é um desfecho ou um compromisso provisório;
 * - `em_aberto` não coexiste com `aplicavel_em_lote` — o alvo nunca é a origem.
 *
 * A guarda vale nas duas direções (ligar `em_aberto` num status que desconta, ou ligar
 * `desconta_sessao` num status em aberto), e a recusa pousa na flag que a gravação ligou: se
 * o payload ligou `em_aberto`, é nela; senão, na flag de desfecho que entrou em conflito.
 *
 * Leitura SOB LOCK, dentro da transação da escrita — como a guarda vizinha, e pela mesma
 * razão (write-skew sob REPEATABLE READ).
 */
class GuardaDasFlagsDeDesfecho
{
    /** Textos do delta `status-agendamento` (baixa-em-lote-por-status) — a tela os exibe tal qual. */
    public const MENSAGEM_DESFECHO = 'Um status em aberto não pode descontar sessão, marcar falta, marcar reserva nem liberar o horário — em aberto é o que ainda não teve desfecho.';

    public const MENSAGEM_ALVO = 'Um status não pode estar em aberto e ser opção de baixa ao mesmo tempo.';

    /**
     * Flag de desfecho => valor que conflita com `em_aberto`. Remover uma entrada derruba
     * exatamente o teste dela (`StatusAgendamentoFlagsTest`, provado por mutação).
     *
     * @var array<string, bool>
     */
    private const DESFECHOS = [
        'desconta_sessao' => true,
        'marca_falta' => true,
        'marca_reserva' => true,
        'ocupa_horario' => false,
    ];

    /**
     * Verifica os invariantes DEPOIS da escrita, dentro da transação que a fez.
     *
     * @param  array<string, mixed>  $dados  o payload validado — decide em que flag a recusa pousa
     *
     * @throws ValidationException Se o estado final do status junta em aberto com um desfecho
     */
    public function verificar(int $statusId, array $dados = []): void
    {
        $status = StatusAgendamento::query()->whereKey($statusId)->lockForUpdate()->firstOrFail();

        if (! $status->em_aberto) {
            return;
        }

        $ligouEmAberto = (bool) ($dados['em_aberto'] ?? false);

        foreach (self::DESFECHOS as $flag => $valorEmConflito) {
            if ($status->{$flag} === $valorEmConflito) {
                throw ValidationException::withMessages([
                    ($ligouEmAberto ? 'em_aberto' : $flag) => self::MENSAGEM_DESFECHO,
                ]);
            }
        }

        if ($status->aplicavel_em_lote) {
            throw ValidationException::withMessages([
                ($ligouEmAberto ? 'em_aberto' : 'aplicavel_em_lote') => self::MENSAGEM_ALVO,
            ]);
        }
    }
}
