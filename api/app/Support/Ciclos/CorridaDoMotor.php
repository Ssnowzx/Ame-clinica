<?php

namespace App\Support\Ciclos;

use App\Exceptions\CorridaDoCicloException;
use PDOException;
use Throwable;

/**
 * A corrida que o MOTOR recusa — traduzida em 409 `ciclo_em_alteracao`, jamais em 500
 * (SEC-FC-10/11), num lugar SÓ.
 *
 * Três códigos do MariaDB chegam aqui, e todos significam a mesma coisa do ponto de vista de
 * quem opera: **outra transação está mexendo agora no que esta ia travar**. Um quarto, o 1305, só
 * quando a mensagem é de SAVEPOINT (ver `SAVEPOINT_INEXISTENTE`).
 *
 * - **1205** (lock wait timeout) e **1213** (deadlock) — outra sessão segura uma linha que o
 *   caminho de escrita precisa: um fechamento ou uma reabertura de ciclo em curso, ou um lote
 *   de outro profissional serializando no mesmo convênio.
 * - **1020** (`ER_CHECKREAD`, "record has changed since last read") — específico do MariaDB:
 *   sob REPEATABLE READ, uma leitura TRAVANTE que encontra linha mais nova que o snapshot da
 *   transação recusa em vez de devolver o estado antigo. É o motor detectando o TOCTOU do
 *   SEC-FC-10 e se negando a mentir — o comportamento desejado, com o rótulo errado.
 *
 * Nasceu em `GuardaDeCicloFechado::recusarCorridaDoCiclo` (os locks de `convenios` →
 * `fechamentos_ciclo`) e foi COPIADA para o controller da baixa em lote, que toma os locks
 * anteriores da ordem da casa (`agendamentos` → `atendimentos` → `tratamentos`) antes de chegar
 * à guarda. Duas cópias da mesma lista de códigos divergem em silêncio — e o desmarque em lote,
 * que passou a tomar os mesmos locks pela espinha partilhada, ficou sem tradução nenhuma
 * (achado CR-06 do gate: lock wait ali subia como 500). Agora a guarda e a espinha
 * (`ContextoDoLote::executar`) delegam para cá.
 *
 * **O código vem da CADEIA, não do topo.** Dentro de uma transação aninhada (savepoint) o
 * Laravel embrulha o erro de concorrência num `DeadlockException` construído com
 * `getMessage()`/`getCode()` — **sem `errorInfo`** (`ManagesTransactions::handleTransactionException`).
 * Olhar só o objeto de topo devolveria `null`, a tradução não aconteceria e a corrida voltaria
 * a ser 500 — foi exatamente assim que os testes de duas conexões falharam antes desta descida.
 *
 * O que NÃO é corrida do motor (um `NOT NULL` violado, por exemplo) volta INTACTO: erro de
 * verdade não vira 409 por conveniência. Fail-closed em todos os casos — quem chama relança
 * o que recebe, e a transação inteira desfaz.
 */
final class CorridaDoMotor
{
    /** 1020 record-has-changed · 1205 lock wait timeout · 1213 deadlock. */
    public const CODIGOS = [1020, 1205, 1213];

    /**
     * O 1305 do SAVEPOINT é o eco de um deadlock dentro de transação ANINHADA: o banco já desfez a
     * transação inteira, e o Laravel ainda tenta `ROLLBACK TO SAVEPOINT` num savepoint que não existe
     * mais. Duas evoluções da mesma criança ao mesmo tempo davam 500 por isso (gate SEC-EVO-R2-03).
     * Mas o MariaDB usa o MESMO código para "FUNCTION … does not exist" — um erro de programação que
     * nunca se resolve e não pode virar "tente de novo" (gate CR-EVO-R3-03). Daí a mensagem decidir.
     */
    public const SAVEPOINT_INEXISTENTE = 1305;

    /**
     * O que relançar: `CorridaDoCicloException` quando a cadeia de causas carrega um dos
     * códigos de corrida; o próprio `$erro` quando não.
     */
    public static function traduzir(PDOException $erro): Throwable
    {
        [$codigo, $mensagem] = self::origemDaCadeia($erro);
        // a mensagem do motor COMEÇA com "SAVEPOINT …"; uma função chamada `savepoint_x` não pode virar 409
        $savepointDesfeito = $codigo === self::SAVEPOINT_INEXISTENTE && str_starts_with(strtoupper(ltrim($mensagem)), 'SAVEPOINT ');

        return in_array($codigo, self::CODIGOS, true) || $savepointDesfeito
            ? new CorridaDoCicloException
            : $erro;
    }

    /**
     * O primeiro `errorInfo[1]` encontrado descendo a cadeia de causas, com a mensagem do motor.
     *
     * @return array{0: int|null, 1: string}
     */
    private static function origemDaCadeia(?Throwable $excecao): array
    {
        while ($excecao !== null) {
            $codigo = $excecao instanceof PDOException ? ($excecao->errorInfo[1] ?? null) : null;
            if ($codigo !== null) {
                return [(int) $codigo, (string) ($excecao->errorInfo[2] ?? $excecao->getMessage())];
            }
            $excecao = $excecao->getPrevious();
        }

        return [null, ''];
    }
}
