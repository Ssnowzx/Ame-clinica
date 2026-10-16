<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * O 409 da corrida do ciclo (SEC-FC-10/11) — com CHAVE no corpo.
 *
 * ## Por que não basta o status
 *
 * O produto tem DOIS 409, e as recuperações são opostas:
 *
 * - **este** — o estado do ciclo do convênio está mudando agora (fechamento/reabertura em
 *   curso; 1020/1205/1213 traduzidos). A saída é *recarregar e tentar de novo*: o que o
 *   usuário digitou continua válido.
 * - **`ConcorrenciaOtimista`** — alguém salvou por cima enquanto o formulário estava aberto.
 *   A saída é o contrário: *os seus dados estão velhos*, releia antes de decidir o que ainda
 *   quer gravar.
 *
 * Com `abort(409, 'mensagem')` nos dois, o cliente só tinha a string para diferenciar — e
 * mensagem é copy, muda sem aviso. A chave é contrato, e é o mesmo desenho que o 422 já
 * usa (`ciclo_fechado`, a chave única que o front reconhece nos cinco boundaries).
 *
 * Continua sendo um `HttpException`: quem só olha o status (os testes de concorrência, o
 * handler) não muda de comportamento — o corpo é que ganhou a informação que faltava.
 */
final class CorridaDoCicloException extends HttpException
{
    /** Chave única deste 409 — o par da `GuardaDeCicloFechado::CHAVE` no 422. */
    public const CHAVE = 'ciclo_em_alteracao';

    /**
     * Minimização (SEC-FC-07): nem o convênio, nem o período, nem quem está mexendo.
     */
    private const MENSAGEM = 'O ciclo de faturamento deste convênio está sendo alterado neste momento. '
        .'Recarregue a tela e tente novamente.';

    public function __construct()
    {
        parent::__construct(409, self::MENSAGEM);
    }

    public function render(Request $request): JsonResponse
    {
        return response()->json([
            'erro' => self::CHAVE,
            'message' => $this->getMessage(),
        ], 409);
    }
}
