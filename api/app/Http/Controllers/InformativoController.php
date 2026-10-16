<?php

namespace App\Http\Controllers;

use App\Http\Requests\InformativoRequest;
use App\Models\Informativo;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;

/** Gestão dos comunicados (T-not-06): rascunho só aqui; o publicado vai ao centro. */
class InformativoController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        return response()->json(
            Informativo::latest('id')->paginate($filtros['per_page'] ?? 50)
        );
    }

    public function store(InformativoRequest $request): JsonResponse
    {
        $informativo = new Informativo($request->validated());
        $informativo->criado_por = Auth::id(); // server-set

        $informativo->save();

        return response()->json($informativo->refresh(), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(Informativo::findOrFail($id));
    }

    public function update(InformativoRequest $request, int $id): JsonResponse
    {
        $informativo = Informativo::findOrFail($id);
        ConcorrenciaOtimista::assegurar($informativo, $request);
        $informativo->update($request->validated());

        return response()->json($informativo->refresh());
    }

    public function destroy(int $id): Response
    {
        Informativo::findOrFail($id)->delete(); // auditado

        return response()->noContent();
    }
}
