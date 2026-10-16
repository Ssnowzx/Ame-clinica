<?php

namespace App\Http\Requests;

use App\Models\Subcategoria;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SubcategoriaRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // autorização é do middleware permission: das rotas
    }

    /** categoria vem da ROTA (agregado — padrão dos serviços de convênio). */
    public function rules(): array
    {
        return [
            'nome' => [
                'required', 'string', 'max:100',
                // O índice único é (categoria_id, nome). Sem esta regra, "Aluguel"
                // duas vezes dentro de "Despesas da clínica" subia UniqueConstraintViolation
                // e virava 500 na cara de quem cadastra — o MESMO defeito que a categoria
                // mãe já tinha, e que ficou de fora do primeiro conserto (achado B1 do gate).
                Rule::unique('subcategorias', 'nome')
                    ->where('categoria_id', $this->categoriaDaRota())
                    ->ignore($this->route('id')),
            ],
            'codigo_contabil' => ['sometimes', 'nullable', 'string', 'max:30'],
        ];
    }

    public function messages(): array
    {
        return ['nome.unique' => 'Já existe uma subcategoria com este nome nesta categoria.'];
    }

    /**
     * A mãe vem da URL ao CRIAR (`/categorias/{categoriaId}/subcategorias`) e da própria
     * linha ao EDITAR (`/subcategorias/{id}` não carrega a mãe no endereço).
     *
     * ⚠️ **MODO DE FALHA, dito porque o comentário anterior escondia:** quando isto devolve
     * `null` (id inexistente), o
     * `Rule::unique(...)->where('categoria_id', null)` vira `whereNull` — e como a coluna é
     * NOT NULL, **nada casa e a regra passa a aprovar qualquer nome**. Quem fecha o buraco
     * NÃO é esta classe: é o `findOrFail` do `CategoriaController::updateSubcategoria`, que
     * responde 404 antes de qualquer escrita. A dependência é entre arquivos e por isso
     * frágil — mover a validação, trocar por `firstOrNew` ou ligar route-model binding a
     * evapora. Os dois testes que a prendem estão em `FinanceiroCadastrosTest`
     * ("id inexistente → 404"); apagá-lo é apagar a trava.
     *
     * O IRMÃO do `null` tem o mesmo modo de falha e a mesma trava: no CRIAR, um
     * `categoriaId` não-nulo porém inexistente deixa o filtro com um
     * `categoria_id` que não casa com nada, e a regra também aprova qualquer nome — até o
     * `findOrFail` do `storeSubcategoria` responder 404. Coberto pela
     * mesma suíte.
     */
    private function categoriaDaRota(): ?int
    {
        $daUrl = $this->route('categoriaId');
        if ($daUrl !== null) {
            return (int) $daUrl;
        }

        $id = $this->route('id');

        return $id === null
            ? null
            : Subcategoria::whereKey($id)->value('categoria_id');
    }
}
