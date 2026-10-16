<?php

namespace App\Support\Agenda;

use App\Models\StatusAgendamento;
use Illuminate\Validation\ValidationException;

/**
 * O status INICIAL é um invariante, não uma preferência de exibição.
 *
 * Todo agendamento nasce com o status de MENOR `ordem` (`StatusAgendamento::inicialId()`,
 * usado por `AgendamentoService`). Isso faz de `ordem` uma REGRA: reordenar a lista
 * muda o comportamento de nascimento da agenda inteira. Sem esta guarda, a clínica
 * se tranca para fora do próprio sistema com um campo numérico:
 *
 * - inicial com `desconta_sessao = true` → o consumo de sessão recusa status
 *   descontante em data futura, e NENHUM agendamento futuro pode mais ser criado;
 * - inicial com `ocupa_horario = false` → o `VerificadorDeConflitos` deixa de
 *   enxergar os cards e a agenda passa a aceitar DUPLA MARCAÇÃO;
 * - sem nenhum status → `inicialId()` devolve `null` e a criação morre.
 *
 * A avaliação é no ESTADO FINAL da clínica, nunca no payload: mudar a `ordem` de um
 * status qualquer pode promover OUTRO a inicial, e uma guarda que só olha o corpo da
 * requisição não veria isso (a mesma lição de `ConsumoSessaoService`).
 *
 * E a leitura é SOB LOCK. Sem ele o invariante volta pela porta dos fundos: sob
 * REPEATABLE READ, duas transações concorrentes leem cada uma o seu snapshot, cada
 * uma aprova um estado que nunca coexistiu (T1 despromove o inicial íntegro; T2, sem
 * ver T1, liga `desconta_sessao` no que vai ser promovido) e o commit das duas deixa
 * a agenda travada. É write-skew clássico, e o resto do repo já trava assim
 * (`ConsumoSessaoService`, `EncadeamentoService`, `ListaEsperaController`).
 */
class GuardaDoStatusInicial
{
    /** Texto do delta `status-agendamento` (baixa-em-lote-por-status) — a tela o exibe tal qual. */
    public const MENSAGEM_INICIAL_FORA_DO_EM_ABERTO = 'O status inicial precisa estar em aberto: é com ele que todo agendamento nasce.';

    /**
     * Verifica o invariante DEPOIS da escrita, dentro da transação que a fez.
     *
     * @throws ValidationException Se o status inicial resultante quebra a agenda
     */
    public function verificar(): void
    {
        // `lockForUpdate` na MESMA ordenação que define o inicial (ordem, id): as
        // linhas de status ficam travadas até o commit, e a transação concorrente
        // espera em vez de decidir sobre um estado velho
        $inicial = StatusAgendamento::query()
            ->orderBy('ordem')
            ->orderBy('id')
            ->lockForUpdate()
            ->first();

        if ($inicial === null) {
            throw ValidationException::withMessages([
                'status_agendamento' => 'A clínica precisa de ao menos um status de agendamento: '
                    .'é o status de menor ordem que todo agendamento novo recebe ao nascer.',
            ]);
        }

        if ($inicial->desconta_sessao) {
            throw ValidationException::withMessages([
                'status_agendamento' => sprintf(
                    'O status "%s" ficaria em primeiro lugar na ordem — e é com ele que todo agendamento '
                    .'nasce. Um status que desconta sessão não pode ser o inicial: nenhum agendamento futuro '
                    .'poderia mais ser criado. Deixe um status sem desconto de sessão na primeira posição.',
                    $inicial->nome,
                ),
            ]);
        }

        if (! $inicial->ocupa_horario) {
            throw ValidationException::withMessages([
                'status_agendamento' => sprintf(
                    'O status "%s" ficaria em primeiro lugar na ordem — e é com ele que todo agendamento '
                    .'nasce. Um status que não ocupa horário não pode ser o inicial: o mesmo horário passaria '
                    .'a aceitar dois agendamentos. Deixe um status que ocupa horário na primeira posição.',
                    $inicial->nome,
                ),
            ]);
        }

        // baixa em lote por status (D2, invariante 1): o alcance do lote é a flag `em_aberto`,
        // e todo agendamento nasce no inicial — um inicial fora do em aberto faria a agenda
        // inteira nascer fora do alcance, e o "Dar baixa" não encontraria ninguém.
        if (! $inicial->em_aberto) {
            throw ValidationException::withMessages([
                'status_agendamento' => self::MENSAGEM_INICIAL_FORA_DO_EM_ABERTO,
            ]);
        }
    }
}
