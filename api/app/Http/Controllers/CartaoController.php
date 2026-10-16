<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\CartaoRequest;
use App\Models\Cartao;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/** Cadastro DORMENTE no v1 (T-fin-03) — engine de recebíveis é fase 2. */
class CartaoController extends Controller
{
    use ProtegeExclusaoEmUso;

    public function index(): JsonResponse
    {
        return response()->json(Cartao::orderBy('nome')->get());
    }

    public function store(CartaoRequest $request): JsonResponse
    {
        return response()->json(Cartao::create($request->validated())->refresh(), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(Cartao::findOrFail($id));
    }

    public function update(CartaoRequest $request, int $id): JsonResponse
    {
        $cartao = Cartao::findOrFail($id);
        ConcorrenciaOtimista::assegurar($cartao, $request);
        $cartao->update($request->validated());

        return response()->json($cartao->refresh());
    }

    public function destroy(int $id): Response
    {
        $this->excluirProtegido(
            Cartao::findOrFail($id),
            'cartao',
            'Este cartão é referenciado por outros registros e não pode ser excluído.'
        );

        return response()->noContent();
    }
}
