<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\SalaRequest;
use App\Models\Sala;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class SalaController extends Controller
{
    use ProtegeExclusaoEmUso;

    /** Whitelist de colunas — `capacidade` entra com a change atendimento-em-grupo. */
    private const CAMPOS = ['id', 'nome', 'capacidade', 'ativo', 'updated_at'];

    public function index(): JsonResponse
    {
        return response()->json(Sala::orderBy('nome')->get(self::CAMPOS));
    }

    public function store(SalaRequest $request): JsonResponse
    {
        $sala = Sala::create($request->validated());

        return response()->json($sala->only(self::CAMPOS), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(Sala::findOrFail($id)->only(self::CAMPOS));
    }

    public function update(SalaRequest $request, int $id): JsonResponse
    {
        $sala = Sala::findOrFail($id);
        ConcorrenciaOtimista::assegurar($sala, $request);
        $sala->update($request->validated());

        return response()->json($sala->only(self::CAMPOS));
    }

    public function destroy(int $id): Response
    {
        $this->excluirProtegido(
            Sala::findOrFail($id),
            'sala',
            'Esta sala está vinculada a outros registros e não pode ser excluída.'
        );

        return response()->noContent();
    }
}
