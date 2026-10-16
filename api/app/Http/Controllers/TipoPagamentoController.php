<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\TipoPagamentoRequest;
use App\Models\TipoPagamento;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class TipoPagamentoController extends Controller
{
    use ProtegeExclusaoEmUso;

    public function index(): JsonResponse
    {
        return response()->json(TipoPagamento::orderBy('nome')->get());
    }

    public function store(TipoPagamentoRequest $request): JsonResponse
    {
        return response()->json(TipoPagamento::create($request->validated())->refresh(), 201);
    }

    public function update(TipoPagamentoRequest $request, int $id): JsonResponse
    {
        $tipo = TipoPagamento::findOrFail($id);
        ConcorrenciaOtimista::assegurar($tipo, $request);
        $tipo->update($request->validated());

        return response()->json($tipo->refresh());
    }

    public function destroy(int $id): Response
    {
        $this->excluirProtegido(
            TipoPagamento::findOrFail($id),
            'tipo_pagamento',
            'Esta forma de pagamento é referenciada por lançamentos e não pode ser excluída.'
        );

        return response()->noContent();
    }
}
