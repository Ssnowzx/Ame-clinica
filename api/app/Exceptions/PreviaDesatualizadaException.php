<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * O 409 da prévia envelhecida (change `baixa-em-lote-por-status`, D5) — com CHAVE e com a
 * PRÉVIA NOVA no corpo.
 *
 * Molde de `CorridaDoCicloException`: o produto já tem dois 409 com recuperações opostas, e
 * este é o terceiro — "o conjunto que você conferiu não é mais o conjunto que rodaria". A
 * recuperação é ler os números novos (que vêm aqui, sem uma segunda ida ao servidor) e
 * confirmar de novo. O status sozinho não diferenciaria os três; a chave é contrato.
 *
 * Lançada DENTRO da transação da execução, depois dos locks: a transação reverte, nada fica
 * gravado, e a prévia carregada aqui foi calculada sobre o estado que a execução viu.
 */
final class PreviaDesatualizadaException extends HttpException
{
    public const CHAVE = 'previa_desatualizada';

    private const MENSAGEM = 'A agenda mudou desde que você conferiu os números. Confira e confirme de novo.';

    /**
     * @param  array<string, mixed>  $previa  o corpo da prévia nova (`BaixaEmLote::serializarPrevia`)
     */
    public function __construct(private readonly array $previa)
    {
        parent::__construct(409, self::MENSAGEM);
    }

    /** @return array<string, mixed> */
    public function previa(): array
    {
        return $this->previa;
    }

    public function render(Request $request): JsonResponse
    {
        return response()->json([
            'erro' => self::CHAVE,
            'message' => $this->getMessage(),
            'previa' => $this->previa,
        ], 409);
    }
}
