<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\EquipamentoRequest;
use App\Models\Equipamento;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class EquipamentoController extends Controller
{
    use ProtegeExclusaoEmUso;

    private const CAMPOS = ['id', 'nome', 'especialidade_id', 'quantidade_total',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    public function index(): JsonResponse
    {
        return response()->json(Equipamento::orderBy('nome')->get(self::CAMPOS));
    }

    public function store(EquipamentoRequest $request): JsonResponse
    {
        $equipamento = Equipamento::create($request->validated());

        return response()->json($equipamento->only(self::CAMPOS), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(Equipamento::findOrFail($id)->only(self::CAMPOS));
    }

    public function update(EquipamentoRequest $request, int $id): JsonResponse
    {
        $equipamento = Equipamento::findOrFail($id);
        ConcorrenciaOtimista::assegurar($equipamento, $request);
        $equipamento->update($request->validated());

        return response()->json($equipamento->only(self::CAMPOS));
    }

    public function destroy(int $id): Response
    {
        $this->excluirProtegido(
            Equipamento::findOrFail($id),
            'equipamento',
            'Este equipamento está vinculado a outros registros e não pode ser excluído.'
        );

        return response()->noContent();
    }
}
