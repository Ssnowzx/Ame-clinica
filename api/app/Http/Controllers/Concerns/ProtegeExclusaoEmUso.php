<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;

/**
 * Padrão D1: cadastro referenciado por outros registros (FK restrictOnDelete)
 * não pode ser excluído — a violação vira 422 com mensagem, nunca 500.
 */
trait ProtegeExclusaoEmUso
{
    /** Código MySQL/MariaDB de violação de FK ao excluir linha referenciada. */
    private const ERRO_FK_RESTRICT = 1451;

    protected function excluirProtegido(Model $registro, string $campo, string $mensagem): void
    {
        try {
            $registro->delete();
        } catch (QueryException $excecao) {
            // só violação de FK vira 422 — deadlock/timeout/conexão continuam 500 (gate r1)
            if (($excecao->errorInfo[1] ?? null) !== self::ERRO_FK_RESTRICT) {
                throw $excecao;
            }

            throw ValidationException::withMessages([$campo => $mensagem]);
        }
    }
}
