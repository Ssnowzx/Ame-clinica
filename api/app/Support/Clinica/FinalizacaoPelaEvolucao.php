<?php

namespace App\Support\Clinica;

use App\Models\Agendamento;
use App\Models\StatusAgendamento;
use App\Support\Agenda\AgendamentoService;
use App\Support\Agenda\SerializadorDeAgendamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;

/**
 * Salvar a evolução finaliza a sessão (change evolucao-finaliza-a-sessao, D2).
 *
 * A clínica, em 02/10: "escrevemos a evolução e mesmo assim precisa apertar em finalizar com
 * evolução". O status aplicado é DADO (`evolucoes.status_ao_salvar`, §13), nasce desligado, e só
 * alcança a sessão EM ABERTO — status com a flag `em_aberto`, a mesma da baixa em lote ("Em Aberto",
 * "Aguardando Atendimento"). Falta, desmarque ou sessão já finalizada não mudam: salvar a evolução
 * não reescreve o que a recepção decidiu.
 *
 * Dois modos, decididos pelo bloqueio pós-status (`evolucoes.bloquear_apos_status`):
 * - **desligado** — `finalizar()`: roda DEPOIS do commit da evolução, em transação própria, e NUNCA
 *   lança. Pacote sem saldo, período fechado ou qualquer outra recusa voltam como
 *   `{finalizada: false, motivo}`: o registro clínico não se perde porque o status foi recusado;
 * - **ligado** — `finalizarJunto()`: a clínica escolheu "sem status final, sem evolução". A evolução
 *   só passa no bloqueio porque a sessão VAI ser finalizada, então as duas coisas acontecem na mesma
 *   transação, com a sessão travada: recusado o status, nada fica (gate SEC-EVO-01 — a previsão
 *   sozinha deixava evolução gravada em sessão de data futura ou sem saldo).
 *
 * O status passa pelo `AgendamentoService`, o mesmo caminho do menu de status — guardas de saldo,
 * data futura e ciclo fechado, e o encadeamento da próxima sessão do dia (gate CR-EVO-06: o aplicador
 * da baixa em lote o desliga por ser lote; aqui é uma sessão, como no chip).
 */
class FinalizacaoPelaEvolucao
{
    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly AgendamentoService $agendamentos,
    ) {}

    /**
     * O status configurado, RELIDO: só vale se ainda finaliza (desconta, ocupa horário, não é falta) — a
     * clínica pode ter editado o status depois de apontá-lo na configuração.
     */
    public function statusConfigurado(): ?StatusAgendamento
    {
        $statusId = (int) $this->configuracoes->get('evolucoes.status_ao_salvar');
        if ($statusId <= 0) {
            return null;
        }

        return StatusAgendamento::queFinalizaASessao()->whereKey($statusId)->first();
    }

    /** A sessão está em aberto e a chave aponta para um status que finaliza (D4: o bloqueio pós-status). */
    public function vaiFinalizar(Agendamento $agendamento): bool
    {
        return $this->statusConfigurado() !== null && $this->emAberto($agendamento);
    }

    /** Com o bloqueio ligado e a finalização ligada, a evolução e o status andam JUNTOS (SEC-EVO-01). */
    public function exigeFinalizacaoJunto(): bool
    {
        return (bool) $this->configuracoes->get('evolucoes.bloquear_apos_status') && $this->statusConfigurado() !== null;
    }

    /**
     * O resultado leva, quando finalizou, a versão do agendamento ANTES e DEPOIS do status, lidas sob a
     * trava: quem tem a sessão aberta num formulário só adota a versão nova se a de antes for a que ele
     * abriu — senão adotaria, junto, a mudança que outra pessoa fez enquanto a evolução era escrita, e o
     * "Salvar" a desfaria sem 409 (gate CR-EVO-R3-02).
     *
     * `$profissionalDaEscrita` é a dona da sessão quando a evolução foi gravada (lida sob a trava): entre
     * o commit da evolução e esta transação, a recepção pode ter passado a sessão a outra profissional —
     * aí a finalização não é desta evolução (gate SEC-EVO-R4-01).
     *
     * @return array{finalizada: bool, motivo: string|null, versao_antes: string|null, versao_depois: string|null}
     */
    public function finalizar(int $agendamentoId, ?int $profissionalDaEscrita = null): array
    {
        $status = $this->statusConfigurado();
        if ($status === null) {
            return self::naoFinalizada();
        }

        try {
            return DB::transaction(function () use ($agendamentoId, $status, $profissionalDaEscrita): array {
                $agendamento = Agendamento::query()->with('status')->lockForUpdate()->find($agendamentoId);
                if ($agendamento === null || ! $this->emAberto($agendamento)) {
                    return self::naoFinalizada();
                }
                if ($profissionalDaEscrita !== null && (int) $agendamento->profissional_id !== $profissionalDaEscrita) {
                    return self::naoFinalizada('a sessão passou para outra profissional; finalize pelo status');
                }

                // a versão de ANTES sai já: o serviço pode gravar na mesma instância
                $antes = self::versao($agendamento);
                try {
                    return self::finalizada($antes, $this->aplicar($agendamento, $status));
                } catch (ValidationException $recusa) {
                    return self::naoFinalizada(self::primeiraMensagem($recusa));
                }
            });
        } catch (Throwable $erro) {
            // a evolução já está gravada: um erro aqui não pode virar 500 para quem a escreveu. O log
            // recebe só a FORMA do erro, como em `RespostaAoLembrete::relatar`: a mensagem de uma
            // `QueryException` traz os bindings, e eles podem ser dado da criança
            report(new RuntimeException(sprintf('Finalização pela evolução não aplicada: %s em %s:%d', $erro::class, $erro->getFile(), $erro->getLine())));

            return self::naoFinalizada('não foi possível finalizar a sessão agora; finalize pelo status');
        }
    }

    /**
     * DENTRO da transação da evolução, com a sessão já travada por quem chama. A recusa do status
     * LANÇA: a transação inteira volta, e a evolução não fica sem o status final que o bloqueio exige.
     *
     * @return array{finalizada: bool, motivo: string|null, versao_antes: string|null, versao_depois: string|null}
     *
     * @throws ValidationException
     */
    public function finalizarJunto(Agendamento $travada): array
    {
        $status = $this->statusConfigurado();
        if ($status === null || ! $this->emAberto($travada)) {
            return self::naoFinalizada();
        }

        // a versão de ANTES sai já: o serviço pode gravar na mesma instância
        $antes = self::versao($travada);
        try {
            $depois = $this->aplicar($travada, $status);
        } catch (ValidationException $recusa) {
            throw ValidationException::withMessages([
                'evolucao' => 'A sessão não pode ser finalizada: '.self::primeiraMensagem($recusa)
                    .' Com o bloqueio após o status final, a evolução só é aceita junto com a finalização.',
            ]);
        }

        return self::finalizada($antes, $depois);
    }

    /**
     * `inicio` e `profissional_id` vão junto porque o serviço os lê sem fallback; reenviar os ATUAIS é
     * dizer "não move nada" (o molde do `AplicadorDeStatusEmLote`). O encadeamento segue o chip — com
     * uma trava a mais: só encadeia para um status-alvo SEM desfecho que segura o horário.
     */
    private function aplicar(Agendamento $agendamento, StatusAgendamento $status): Agendamento
    {
        return $this->agendamentos->atualizar($agendamento, [
            'status_id' => $status->id,
            'inicio' => $agendamento->inicio->format('Y-m-d H:i'),
            'profissional_id' => $agendamento->profissional_id,
        ], encadear: $this->encadeamentoSemRisco());
    }

    /**
     * O encadeamento muda a PRÓXIMA sessão da criança no dia — que pode ser de outra profissional. Pelo
     * chip, quem dispara tem `agenda.editar`; pela evolução, basta escrever a evolução. Com um alvo que
     * libera o horário ("Desmarcado pelo Paciente", aceito hoje pela configuração), salvar a evolução
     * desmarcaria em silêncio a sessão da colega (gate SEC-EVO-R2-02). Pela evolução, só um alvo em
     * aberto que segura o horário — "a criança está aqui, aguardando" — encadeia.
     */
    private function encadeamentoSemRisco(): bool
    {
        $alvoId = (int) $this->configuracoes->get('agenda.encadeamento_status_id');

        return $alvoId > 0 && StatusAgendamento::query()
            ->whereKey($alvoId)
            ->where('em_aberto', true)
            ->where('ocupa_horario', true)
            ->exists();
    }

    /**
     * A sessão que ainda não teve desfecho: a flag `em_aberto` do status (§13), a mesma que decide quem
     * entra na baixa em lote. A `GuardaDasFlagsDeDesfecho` garante que ela não convive com desconto,
     * falta, reserva nem horário liberado. Derivar das outras flags deixava passar a falta que segura o
     * horário: marcada e sem desconto, mas com desfecho.
     */
    private function emAberto(Agendamento $agendamento): bool
    {
        $status = $agendamento->status;

        return $agendamento->tipo === 'atendimento'
            && $status instanceof StatusAgendamento
            && (bool) $status->em_aberto;
    }

    /** @return array{finalizada: bool, motivo: string|null, versao_antes: null, versao_depois: null} */
    private static function naoFinalizada(?string $motivo = null): array
    {
        return ['finalizada' => false, 'motivo' => $motivo, 'versao_antes' => null, 'versao_depois' => null];
    }

    /**
     * `antes` é a versão lida sob a trava, ainda sem o status novo; `depois`, a do agendamento que o
     * serviço devolveu.
     *
     * @return array{finalizada: true, motivo: null, versao_antes: string|null, versao_depois: string|null}
     */
    private static function finalizada(?string $antes, Agendamento $depois): array
    {
        return ['finalizada' => true, 'motivo' => null, 'versao_antes' => $antes, 'versao_depois' => self::versao($depois)];
    }

    /** A versão pelo mesmo serializador do cartão — a mesma string que a tela manda no If-Match. */
    private static function versao(Agendamento $agendamento): ?string
    {
        $versao = SerializadorDeAgendamento::escalares($agendamento)['updated_at'] ?? null;

        return is_string($versao) ? $versao : null;
    }

    private static function primeiraMensagem(ValidationException $recusa): string
    {
        $primeira = collect($recusa->errors())->flatten()->first();

        return is_string($primeira) ? $primeira : 'recusado pelo servidor';
    }
}
