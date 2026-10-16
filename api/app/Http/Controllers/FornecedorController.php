<?php

namespace App\Http\Controllers;

use App\Http\Requests\FornecedorRequest;
use App\Models\Fornecedor;
use App\Models\LancamentoCaixa;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

class FornecedorController extends Controller
{
    /** LIST minimalista (T-fin-05): documento/contatos/endereço são detail-only. */
    private const CAMPOS_LISTAGEM = [
        'id', 'razao_social', 'nome_fantasia', 'categoria_id', 'subcategoria_id',
        'centro_custo', 'ativo',
    ];

    public function index(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'busca' => ['sometimes', 'string', 'max:255'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $fornecedores = Fornecedor::query()
            ->when($filtros['busca'] ?? null, fn ($q, $busca) => $q->where(
                fn ($sub) => $sub->where('razao_social', 'like', "%{$busca}%")
                    ->orWhere('nome_fantasia', 'like', "%{$busca}%")
            ))
            ->orderBy('razao_social')
            ->paginate($filtros['per_page'] ?? 50);

        $fornecedores->getCollection()->transform(
            fn (Fornecedor $f) => collect($f->attributesToArray())->only(self::CAMPOS_LISTAGEM)->all()
        );

        return response()->json($fornecedores);
    }

    public function store(FornecedorRequest $request): JsonResponse
    {
        return response()->json(Fornecedor::create($request->validated())->refresh(), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(Fornecedor::findOrFail($id));
    }

    public function update(FornecedorRequest $request, int $id): JsonResponse
    {
        $fornecedor = Fornecedor::findOrFail($id);
        ConcorrenciaOtimista::assegurar($fornecedor, $request);
        $fornecedor->update($request->validated());

        return response()->json($fornecedor->refresh());
    }

    public function destroy(int $id): Response
    {
        $fornecedor = Fornecedor::findOrFail($id);

        // interessado é polimórfico (sem FK física) — a checagem explícita é a
        // proteção (T-fin-04/D2): retenção fiscal manda manter; inative-o
        if (LancamentoCaixa::where('interessado_tipo', 'fornecedor')
            ->where('interessado_id', $fornecedor->id)->exists()) {
            throw ValidationException::withMessages([
                'fornecedor' => 'Fornecedor com lançamentos não pode ser excluído — inative-o.',
            ]);
        }

        $fornecedor->delete();

        return response()->noContent();
    }
}
