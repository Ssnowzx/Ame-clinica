<?php

namespace App\Http\Controllers;

use App\Http\Requests\FuncionarioRequest;
use App\Models\Funcionario;
use App\Models\LancamentoCaixa;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

class FuncionarioController extends Controller
{
    /** LIST minimalista (T-fin-05): documento/contatos/endereço são detail-only. */
    private const CAMPOS_LISTAGEM = ['id', 'nome', 'funcao', 'ativo'];

    public function index(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'busca' => ['sometimes', 'string', 'max:255'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $funcionarios = Funcionario::query()
            ->when($filtros['busca'] ?? null, fn ($q, $busca) => $q->where('nome', 'like', "%{$busca}%"))
            ->orderBy('nome')
            ->paginate($filtros['per_page'] ?? 50);

        $funcionarios->getCollection()->transform(
            fn (Funcionario $f) => collect($f->attributesToArray())->only(self::CAMPOS_LISTAGEM)->all()
        );

        return response()->json($funcionarios);
    }

    public function store(FuncionarioRequest $request): JsonResponse
    {
        return response()->json(Funcionario::create($request->validated())->refresh(), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(Funcionario::findOrFail($id));
    }

    public function update(FuncionarioRequest $request, int $id): JsonResponse
    {
        $funcionario = Funcionario::findOrFail($id);
        ConcorrenciaOtimista::assegurar($funcionario, $request);
        $funcionario->update($request->validated());

        return response()->json($funcionario->refresh());
    }

    public function destroy(int $id): Response
    {
        $funcionario = Funcionario::findOrFail($id);

        if (LancamentoCaixa::where('interessado_tipo', 'funcionario')
            ->where('interessado_id', $funcionario->id)->exists()) {
            throw ValidationException::withMessages([
                'funcionario' => 'Funcionário com lançamentos não pode ser excluído — inative-o.',
            ]);
        }

        $funcionario->delete();

        return response()->noContent();
    }
}
