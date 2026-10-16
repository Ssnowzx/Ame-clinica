<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\CategoriaRequest;
use App\Http\Requests\SubcategoriaRequest;
use App\Models\Categoria;
use App\Models\LancamentoCaixa;
use App\Models\Subcategoria;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

/** Categorias e subcategorias no mesmo módulo de permissão (parecer §3). */
class CategoriaController extends Controller
{
    use ProtegeExclusaoEmUso;

    public function index(): JsonResponse
    {
        return response()->json(Categoria::with('subcategorias')->orderBy('nome')->get());
    }

    public function store(CategoriaRequest $request): JsonResponse
    {
        return response()->json(Categoria::create($request->validated())->refresh(), 201);
    }

    public function update(CategoriaRequest $request, int $id): JsonResponse
    {
        $categoria = Categoria::findOrFail($id);
        ConcorrenciaOtimista::assegurar($categoria, $request);
        $dados = $request->validated();

        // a natureza de uma categoria EM USO não muda (SEC-FIN-01): os lançamentos dela seriam
        // receitas numa categoria de despesa, e o DRE — cuja linha padrão sai da natureza —
        // inverteria o resultado da clínica por quem nem pode ver o DRE
        if ($dados['tipo'] !== $categoria->tipo
            && ($categoria->subcategorias()->exists() || LancamentoCaixa::where('categoria_id', $categoria->id)->exists())) {
            throw ValidationException::withMessages([
                'tipo' => 'Esta categoria já tem lançamentos ou subcategorias: a natureza não muda. Crie uma categoria nova.',
            ]);
        }

        // a linha do DRE é da natureza (CR-API1-01): trocada a natureza, a linha volta ao padrão
        if ($dados['tipo'] !== $categoria->tipo) {
            $categoria->forceFill(['linha_dre' => null]);
        }
        $categoria->update($dados);

        return response()->json($categoria->refresh());
    }

    public function destroy(int $id): Response
    {
        // com subcategorias ou lançamentos → FK restrict (T-fin-04)
        $this->excluirProtegido(
            Categoria::findOrFail($id),
            'categoria',
            'Esta categoria tem subcategorias ou lançamentos e não pode ser excluída.'
        );

        return response()->noContent();
    }

    /** Agregado da categoria (padrão dos serviços de convênio). */
    public function storeSubcategoria(SubcategoriaRequest $request, int $categoriaId): JsonResponse
    {
        $categoria = Categoria::findOrFail($categoriaId);

        $subcategoria = new Subcategoria($request->validated());
        $subcategoria->categoria_id = $categoria->id;
        $subcategoria->save();

        return response()->json($subcategoria->refresh(), 201);
    }

    public function updateSubcategoria(SubcategoriaRequest $request, int $id): JsonResponse
    {
        $subcategoria = Subcategoria::findOrFail($id);
        ConcorrenciaOtimista::assegurar($subcategoria, $request);
        $subcategoria->update($request->validated());

        return response()->json($subcategoria->refresh());
    }

    public function destroySubcategoria(int $id): Response
    {
        $this->excluirProtegido(
            Subcategoria::findOrFail($id),
            'subcategoria',
            'Esta subcategoria é referenciada por lançamentos e não pode ser excluída.'
        );

        return response()->noContent();
    }
}
