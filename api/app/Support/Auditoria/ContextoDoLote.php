<?php

namespace App\Support\Auditoria;

use App\Support\Ciclos\CorridaDoMotor;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;
use PDOException;

/**
 * O lote em que a requisição está escrevendo — ou nenhum (change `baixa-em-lote-por-status`, D11).
 *
 * A baixa em lote por status e o desmarque em lote alteram dezenas de agendamentos (e os
 * tratamentos cujo saldo muda por causa deles) numa transação só. Cada linha continua sendo
 * auditada pelo caminho de sempre (`Auditavel` → `RegistroDeAuditoria`); o que este contexto
 * acrescenta é a chave que liga todas elas: enquanto um lote está aberto, a fonte única grava o
 * mesmo `lote_id` em toda linha que nasce. Fora de lote, `id()` é nulo e a linha nasce sem lote —
 * o campo diz "isto foi um lote" ou não diz nada.
 *
 * Molde de `OrigemDaOperacao`: escopo de requisição (`scoped` no container), nunca singleton —
 * num worker de fila o singleton carregaria o lote de uma requisição para a seguinte. E mesmo
 * dentro da requisição a marca não pode sobreviver ao lote: `executar()` fecha o contexto em
 * `finally`, com ou sem commit. Um lote revertido não deixa rastro (a transação apaga as linhas)
 * e não contamina a escrita seguinte (o contexto já está fechado).
 */
final class ContextoDoLote
{
    private ?string $id = null;

    /** Só para nomear, na exceção, o lote que já está aberto — não é lido por mais ninguém. */
    private ?string $operacao = null;

    /**
     * Abre o lote e devolve o identificador que toda linha auditada daqui em diante carrega.
     * Uuid v7: ordenável pelo tempo, o que mantém o índice de `lote_id` crescendo
     * na ponta em vez de espalhar inserções.
     *
     * @param  string  $operacao  a ação da linha-mãe (`baixa_em_lote`, `desmarque_em_lote`)
     *
     * @throws LogicException se já há um lote aberto — lote dentro de lote é bug de quem
     *                        chamou, não um caso a acomodar em silêncio
     */
    public function abrir(string $operacao): string
    {
        if ($this->id !== null) {
            throw new LogicException(
                "Já existe um lote aberto nesta requisição ({$this->operacao}); feche-o antes de abrir '{$operacao}'."
            );
        }

        $this->operacao = $operacao;
        $this->id = (string) Str::uuid7();

        return $this->id;
    }

    /** Nulo fora de lote — é o valor que vai para `auditoria.lote_id`. */
    public function id(): ?string
    {
        return $this->id;
    }

    public function fechar(): void
    {
        $this->id = null;
        $this->operacao = null;
    }

    /**
     * A forma que os controllers de lote usam: abre o lote DENTRO de uma transação única e o
     * fecha em `finally`, aconteça o que acontecer. O corpo recebe o identificador (para a
     * resposta e para a linha-mãe) e devolve o que quiser.
     *
     * Um passo que falha no meio reverte a transação — nenhuma linha com este `lote_id`
     * sobrevive — e o `finally` garante que a próxima escrita auditada da mesma requisição
     * (ou do mesmo worker) nasce sem lote. Sem o `finally`, o rollback deixaria o contexto
     * aberto e a escrita seguinte herdaria um lote que não existe.
     *
     * A CORRIDA DO MOTOR é traduzida AQUI, para os dois lotes (achado CR-06 do gate): a espinha
     * trava `agendamentos` → `atendimentos` → `tratamentos` antes do loop, e um lock wait ou
     * deadlock nesses locks — ou nos de `convenios`/`fechamentos_ciclo` que cada linha toma
     * depois — é 409 `ciclo_em_alteracao`, nunca 500. A tradução vivia só no controller da
     * baixa; o desmarque, que toma os mesmos locks, subia como erro genérico. O que não é
     * corrida sobe intacto (`CorridaDoMotor::traduzir` devolve o próprio erro).
     *
     * @template T
     *
     * @param  Closure(string): T  $corpo
     * @return T
     */
    public function executar(string $operacao, Closure $corpo): mixed
    {
        try {
            return DB::transaction(fn () => $corpo($this->abrir($operacao)));
        } catch (PDOException $erro) {
            throw CorridaDoMotor::traduzir($erro);
        } finally {
            $this->fechar();
        }
    }
}
