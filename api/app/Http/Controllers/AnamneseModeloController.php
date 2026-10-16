<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\AnamneseModeloRequest;
use App\Models\AnamneseModelo;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class AnamneseModeloController extends Controller
{
    use ProtegeExclusaoEmUso;

    private const CAMPOS = ['id', 'titulo', 'especialidade_id', 'campos_json', 'ativo',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    public function index(): JsonResponse
    {
        return response()->json(AnamneseModelo::orderBy('titulo')->get(self::CAMPOS));
    }

    public function store(AnamneseModeloRequest $request): JsonResponse
    {
        $modelo = AnamneseModelo::create($request->validated());

        return response()->json($modelo->only(self::CAMPOS), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(AnamneseModelo::findOrFail($id)->only(self::CAMPOS));
    }

    public function update(AnamneseModeloRequest $request, int $id): JsonResponse
    {
        $modelo = AnamneseModelo::findOrFail($id);
        ConcorrenciaOtimista::assegurar($modelo, $request);
        $modelo->update($request->validated());

        return response()->json($modelo->only(self::CAMPOS));
    }

    public function destroy(int $id): Response
    {
        $this->excluirProtegido(
            AnamneseModelo::findOrFail($id),
            'anamnese_modelo',
            'Este modelo está vinculado a anamneses e não pode ser excluído.'
        );

        return response()->noContent();
    }
}
