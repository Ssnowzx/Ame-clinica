<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\FeriadoRequest;
use App\Models\Feriado;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class FeriadoController extends Controller
{
    use ProtegeExclusaoEmUso;

    private const CAMPOS = ['id', 'nome', 'data', 'recorrente', 'ativo',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    public function index(): JsonResponse
    {
        return response()->json(
            Feriado::orderBy('data')->get()
                ->map(fn (Feriado $feriado) => collect($feriado->attributesToArray())->only(self::CAMPOS))
        );
    }

    public function store(FeriadoRequest $request): JsonResponse
    {
        $feriado = Feriado::create($request->validated());
        $feriado->refresh();

        return response()->json(collect($feriado->attributesToArray())->only(self::CAMPOS), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(
            collect(Feriado::findOrFail($id)->attributesToArray())->only(self::CAMPOS)
        );
    }

    public function update(FeriadoRequest $request, int $id): JsonResponse
    {
        $feriado = Feriado::findOrFail($id);
        ConcorrenciaOtimista::assegurar($feriado, $request);
        $feriado->update($request->validated());

        return response()->json(collect($feriado->attributesToArray())->only(self::CAMPOS));
    }

    public function destroy(int $id): Response
    {
        $this->excluirProtegido(
            Feriado::findOrFail($id),
            'feriado',
            'Este feriado está vinculado a outros registros e não pode ser excluído.'
        );

        return response()->noContent();
    }
}
