<?php

namespace App\Http\Controllers;

use App\Models\Categoria;
use App\Models\Subcategoria;
use App\Support\Financeiro\EscadaDoDre;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * A configuração do DRE (change `dre-gerencial`): a escada explicada, onde cada categoria cai, e a
 * troca da linha. Ler exige `fluxo_caixa.ver` (o DRE é o resultado da clínica); trocar exige
 * `categorias.editar` E `fluxo_caixa.ver` — mexer no que o DRE mostra é de quem pode vê-lo (D6).
 */
class DreController extends Controller
{
    /** `GET /dre/linhas` — a escada, as linhas com a explicação, e as categorias com a linha em vigor. */
    public function linhas(): JsonResponse
    {
        $categorias = Categoria::with('subcategorias')->orderBy('nome')->get();

        return response()->json([
            'escada' => EscadaDoDre::ESCADA,
            'linhas' => collect(EscadaDoDre::LINHAS)->map(fn (array $linha, string $codigo): array => ['codigo' => $codigo, ...$linha])->values(),
            'padrao' => EscadaDoDre::PADRAO,
            'categorias' => $categorias->map(fn (Categoria $categoria): array => [
                'id' => $categoria->id,
                'nome' => $categoria->nome,
                'tipo' => $categoria->tipo,
                'linha_dre' => $categoria->linha_dre,
                'linha_efetiva' => EscadaDoDre::efetiva(null, $categoria->linha_dre, $categoria->tipo),
                'updated_at' => $categoria->updated_at,
                'subcategorias' => $categoria->subcategorias->sortBy('nome')->values()->map(fn (Subcategoria $sub): array => [
                    'id' => $sub->id,
                    'nome' => $sub->nome,
                    'linha_dre' => $sub->linha_dre,
                    'linha_efetiva' => EscadaDoDre::efetiva($sub->linha_dre, $categoria->linha_dre, $categoria->tipo),
                    'updated_at' => $sub->updated_at,
                ]),
            ]),
            // configurar é conferir, não condição para funcionar (D2): quantas estão no padrão
            'no_padrao' => $categorias->whereNull('linha_dre')->count(),
        ]);
    }

    /** `PUT /categorias/{id}/linha-dre` — `null` volta ao padrão da natureza. */
    public function definirDaCategoria(Request $request, int $id): JsonResponse
    {
        $categoria = Categoria::findOrFail($id);
        ConcorrenciaOtimista::assegurar($categoria, $request);

        return response()->json($this->definir($request, $categoria, $categoria->tipo));
    }

    /** `PUT /subcategorias/{id}/linha-dre` — `null` volta à linha da categoria. */
    public function definirDaSubcategoria(Request $request, int $id): JsonResponse
    {
        $subcategoria = Subcategoria::with('categoria')->findOrFail($id);
        ConcorrenciaOtimista::assegurar($subcategoria, $request);

        return response()->json($this->definir($request, $subcategoria, $subcategoria->categoria->tipo));
    }

    /** @return array{id: int, linha_dre: string|null, updated_at: mixed} */
    private function definir(Request $request, Model $registro, string $natureza): array
    {
        $dados = $request->validate([
            'linha_dre' => ['present', 'nullable', 'string', Rule::in(array_keys(EscadaDoDre::LINHAS))],
        ]);
        $linha = $dados['linha_dre'];

        // a natureza manda (D5): despesa numa linha de receita somaria para o lado errado
        if ($linha !== null && ! EscadaDoDre::aceita($linha, $natureza)) {
            throw ValidationException::withMessages([
                'linha_dre' => 'Esta linha do DRE é de '.(EscadaDoDre::LINHAS[$linha]['natureza'] === 'receita' ? 'receita' : 'despesa')
                    .', e a categoria é de '.$natureza.'.',
            ]);
        }

        // fora do `$fillable` de propósito: a linha só muda por esta rota (auditada pelo Auditavel)
        $registro->forceFill(['linha_dre' => $linha])->save();
        $registro->refresh();

        return ['id' => $registro->getKey(), 'linha_dre' => $registro->linha_dre, 'updated_at' => $registro->updated_at];
    }
}
