<?php

namespace App\Http\Controllers;

use App\Http\Requests\TransferenciaRequest;
use App\Models\Transferencia;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class TransferenciaController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        return response()->json(
            Transferencia::orderByDesc('data')->paginate($filtros['per_page'] ?? 50)
        );
    }

    public function store(TransferenciaRequest $request): JsonResponse
    {
        return response()->json(Transferencia::create($request->validated())->refresh(), 201);
    }

    /**
     * Uma transferência, para a EDIÇÃO pela linha do Fluxo (change `caixa-do-dia-a-dia`): o
     * extrato não traz `obs` nem `updated_at`, e o `PUT` precisa do segundo (concorrência
     * otimista). A inexistente é 404.
     */
    public function show(int $id): JsonResponse
    {
        $transferencia = Transferencia::findOrFail($id);

        return response()->json([
            'id' => $transferencia->id,
            'conta_origem_id' => $transferencia->conta_origem_id,
            'conta_destino_id' => $transferencia->conta_destino_id,
            'valor' => (string) $transferencia->valor,
            'data' => $transferencia->data->format('Y-m-d'),
            'obs' => $transferencia->obs,
            'updated_at' => $transferencia->updated_at,
        ]);
    }

    public function update(TransferenciaRequest $request, int $id): JsonResponse
    {
        $transferencia = Transferencia::findOrFail($id);
        ConcorrenciaOtimista::assegurar($transferencia, $request);
        $transferencia->update($request->validated());

        return response()->json($transferencia->refresh());
    }

    public function destroy(int $id): Response
    {
        Transferencia::findOrFail($id)->delete(); // auditada (Auditavel)

        return response()->noContent();
    }
}
