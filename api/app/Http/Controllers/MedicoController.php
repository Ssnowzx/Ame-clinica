<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\MedicoRequest;
use App\Models\Medico;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class MedicoController extends Controller
{
    use ProtegeExclusaoEmUso;

    private const CAMPOS = [
        'id', 'nome', 'conselho', 'uf_conselho', 'num_conselho',
        'cbos_id', 'codigos_operadora_json',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    public function index(): JsonResponse
    {
        return response()->json(Medico::orderBy('nome')->get(self::CAMPOS));
    }

    public function store(MedicoRequest $request): JsonResponse
    {
        $medico = Medico::create($request->validated());

        return response()->json($medico->only(self::CAMPOS), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(Medico::findOrFail($id)->only(self::CAMPOS));
    }

    public function update(MedicoRequest $request, int $id): JsonResponse
    {
        $medico = Medico::findOrFail($id);
        ConcorrenciaOtimista::assegurar($medico, $request);
        $medico->update($request->validated());

        return response()->json($medico->only(self::CAMPOS));
    }

    public function destroy(int $id): Response
    {
        $this->excluirProtegido(
            Medico::findOrFail($id),
            'medico',
            'Este médico está vinculado a outros registros e não pode ser excluído.'
        );

        return response()->noContent();
    }
}
