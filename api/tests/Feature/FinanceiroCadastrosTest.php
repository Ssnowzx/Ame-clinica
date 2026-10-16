<?php

use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Subcategoria;
use App\Models\TipoPagamento;
use App\Models\Usuario;

/** Conta + categoria de despesa + tipo de pagamento. */
function baseFinanceira(): array
{
    return [
        Conta::create(['nome' => 'Caixa Fictício '.fake()->unique()->numberBetween(1, 9999)]),
        Categoria::create(['nome' => 'Despesas Gerais '.fake()->unique()->numberBetween(1, 9999), 'tipo' => 'despesa']),
        TipoPagamento::create(['nome' => 'PIX '.fake()->unique()->numberBetween(1, 9999)]),
    ];
}

/** Lançamento mínimo válido para prender referências (exclusão protegida). */
function lancamentoMinimo(Conta $conta, Categoria $categoria, TipoPagamento $tipo, array $extra = []): int
{
    $resposta = test()->postJson('/api/lancamentos', [
        'tipo' => $categoria->tipo,
        'competencia' => agoraNaClinica()->toDateString(),
        'vencimento' => agoraNaClinica()->toDateString(),
        'categoria_id' => $categoria->id,
        'valor' => '100.00',
        'tipo_pagamento_id' => $tipo->id,
        'conta_id' => $conta->id,
        ...$extra,
    ]);

    return $resposta->assertCreated()->json('id');
}

it('deve criar contas e bloquear exclusão em uso', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$conta, $categoria, $tipoPagamento] = baseFinanceira();

    // ACT + ASSERT — CRUD básico
    // a clínica NASCE com o catálogo padrão (conta "Caixa"), e a listagem vem ordenada por
    // nome — asserir a POSIÇÃO 0 era acoplar o teste ao alfabeto; o que importa é ESTAR lá
    $this->getJson('/api/contas')->assertOk()
        ->assertJsonFragment(['nome' => $conta->nome]);
    $this->postJson('/api/contas', ['nome' => $conta->nome])
        ->assertUnprocessable()->assertJsonValidationErrors('nome'); // unique

    // exclusão em uso → 422 via FK restrict (T-fin-04), nunca 500
    lancamentoMinimo($conta, $categoria, $tipoPagamento);
    $this->deleteJson("/api/contas/{$conta->id}")
        ->assertUnprocessable()->assertJsonValidationErrors('conta');

    $livre = Conta::create(['nome' => 'Conta Livre Fictícia']);
    $this->deleteJson("/api/contas/{$livre->id}")->assertNoContent();
});

it('deve validar faixas do cartão e a conta', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$conta] = baseFinanceira();
    $payload = [
        'nome' => 'Cartão Fictício', 'tipo' => 'credito',
        'pct_a_vista' => '2.50', 'dias_recebimento' => 30, 'conta_id' => $conta->id,
    ];

    // ACT + ASSERT — faixas (T-fin-03): rejeitar, não arredondar
    $this->postJson('/api/cartoes', [...$payload, 'pct_a_vista' => '12.345'])
        ->assertUnprocessable()->assertJsonValidationErrors('pct_a_vista');
    $this->postJson('/api/cartoes', [...$payload, 'pct_a_vista' => '100.01'])
        ->assertUnprocessable()->assertJsonValidationErrors('pct_a_vista');
    $this->postJson('/api/cartoes', [...$payload, 'dias_recebimento' => 366])
        ->assertUnprocessable()->assertJsonValidationErrors('dias_recebimento');
    $this->postJson('/api/cartoes', $payload)->assertCreated();

    // conta inexistente → 422
    $this->postJson('/api/cartoes', [...$payload, 'conta_id' => 99999999])
        ->assertUnprocessable()->assertJsonValidationErrors('conta_id');
});

it('deve manter tipos de pagamento únicos e protegidos em uso', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$conta, $categoria, $tipoPagamento] = baseFinanceira();

    // ACT + ASSERT — a MENSAGEM importa: é o texto que a operadora lê, e a tela o repete
    // tal qual. Asserir só a chave deixava os dois lados livres para divergir (achado I3).
    $this->postJson('/api/tipos-pagamento', ['nome' => $tipoPagamento->nome])
        ->assertUnprocessable()->assertJsonValidationErrors('nome')
        ->assertJsonPath('errors.nome.0', 'Já existe uma forma de pagamento com este nome.');

    lancamentoMinimo($conta, $categoria, $tipoPagamento);
    $this->deleteJson("/api/tipos-pagamento/{$tipoPagamento->id}")
        ->assertUnprocessable()->assertJsonValidationErrors('tipo_pagamento')
        ->assertJsonPath(
            'errors.tipo_pagamento.0',
            'Esta forma de pagamento é referenciada por lançamentos e não pode ser excluída.'
        );
});

it('deve validar natureza de categorias e proteger exclusão com filhos', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);

    // ACT + ASSERT — natureza fora do enum → 422
    $this->postJson('/api/categorias', ['nome' => 'Coisas Fictícias', 'tipo' => 'investimento'])
        ->assertUnprocessable()->assertJsonValidationErrors('tipo');

    // categoria + subcategoria (agregado)
    $categoria = $this->postJson('/api/categorias', ['nome' => 'Despesas Fixas Fictícias', 'tipo' => 'despesa'])
        ->assertCreated()->json('id');
    $this->postJson("/api/categorias/{$categoria}/subcategorias", [
        'nome' => 'Aluguel Fictício', 'codigo_contabil' => '3.1.1',
    ])->assertCreated();
    $lista = $this->getJson('/api/categorias')->assertOk();
    expect(collect($lista->json())->firstWhere('id', $categoria)['subcategorias'])->toHaveCount(1);

    // com subcategorias → 422 (FK restrict)
    $this->deleteJson("/api/categorias/{$categoria}")
        ->assertUnprocessable()->assertJsonValidationErrors('categoria');

    // com LANÇAMENTOS (sem subcategorias) também → 422 (abuse §5.19)
    [$conta, $categoriaComLancamento, $tipoPagamento] = baseFinanceira();
    lancamentoMinimo($conta, $categoriaComLancamento, $tipoPagamento);
    $this->deleteJson("/api/categorias/{$categoriaComLancamento->id}")
        ->assertUnprocessable()->assertJsonValidationErrors('categoria');

    // subcategoria de categoria inexistente → 404 na rota aninhada
    $this->postJson('/api/categorias/99999999/subcategorias', ['nome' => 'Invasão'])
        ->assertNotFound();
});

it('deve negar os cadastros financeiros sem permissão', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $semPermissao = Usuario::factory()->create();

    // ACT + ASSERT — módulos próprios do dinheiro (parecer §3)
    $this->actingAs($semPermissao)->getJson('/api/contas')->assertForbidden();
    $this->actingAs($semPermissao)->getJson('/api/cartoes')->assertForbidden();
    $this->actingAs($semPermissao)->getJson('/api/tipos-pagamento')->assertForbidden();
    $this->actingAs($semPermissao)->getJson('/api/categorias')->assertForbidden();
});

it('deve recusar categoria de nome repetido na mesma natureza com 422, nunca 500', function () {
    // ARRANGE — o índice único é (nome, tipo); sem regra no request o nome
    // repetido subia UniqueConstraintViolation e chegava ao operador como 500 genérico
    // nome PRÓPRIO do teste: "Atendimentos" e "Despesas da clínica" já vêm do catálogo
    // padrão que a clínica recebe ao nascer
    $this->actingAs(admin());
    $nome = 'Materiais Fictícios '.fake()->unique()->numberBetween(1, 9999);
    $this->postJson('/api/categorias', ['nome' => $nome, 'tipo' => 'receita'])
        ->assertCreated();

    // ACT + ASSERT — mesma natureza: recusa no CAMPO
    $this->postJson('/api/categorias', ['nome' => $nome, 'tipo' => 'receita'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('nome')
        ->assertJsonPath('errors.nome.0', 'Já existe uma categoria com este nome nesta natureza.');

    // ACT + ASSERT — natureza DIFERENTE é outro registro: o índice permite, e a clínica
    // pode ter "Materiais" como receita (revenda) e como despesa (compra)
    $this->postJson('/api/categorias', ['nome' => $nome, 'tipo' => 'despesa'])
        ->assertCreated();
});

it('deve deixar a categoria manter o próprio nome ao ser editada', function () {
    // ARRANGE — sem o `ignore()`, salvar sem trocar o nome se acusaria de duplicata
    $this->actingAs(admin());
    $nome = 'Aluguel Fictício '.fake()->unique()->numberBetween(1, 9999);
    $id = $this->postJson('/api/categorias', ['nome' => $nome, 'tipo' => 'despesa'])
        ->assertCreated()->json('id');
    $versao = Categoria::findOrFail($id)->updated_at->toJSON();

    // ACT + ASSERT
    $this->withHeader('If-Match', $versao)
        ->putJson("/api/categorias/{$id}", ['nome' => $nome, 'tipo' => 'despesa'])
        ->assertOk();
});

it('deve recusar subcategoria de nome repetido na mesma categoria com 422, nunca 500', function () {
    // ARRANGE — o índice é (categoria_id, nome); a tela nova da categoria é o
    // primeiro caminho humano até este endpoint (achado B1 do gate)
    $this->actingAs(admin());
    $mae = $this->postJson('/api/categorias', [
        'nome' => 'Despesas Fictícias '.fake()->unique()->numberBetween(1, 9999),
        'tipo' => 'despesa',
    ])->assertCreated()->json('id');
    $outra = $this->postJson('/api/categorias', [
        'nome' => 'Outras Fictícias '.fake()->unique()->numberBetween(1, 9999),
        'tipo' => 'despesa',
    ])->assertCreated()->json('id');

    $this->postJson("/api/categorias/{$mae}/subcategorias", ['nome' => 'Aluguel'])
        ->assertCreated();

    // ACT + ASSERT — repetido na MESMA mãe: recusa no campo
    $this->postJson("/api/categorias/{$mae}/subcategorias", ['nome' => 'Aluguel'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('nome')
        ->assertJsonPath('errors.nome.0', 'Já existe uma subcategoria com este nome nesta categoria.');

    // ACT + ASSERT — o MESMO nome em OUTRA categoria é outro registro
    $this->postJson("/api/categorias/{$outra}/subcategorias", ['nome' => 'Aluguel'])
        ->assertCreated();
});

it('deve deixar a subcategoria manter o próprio nome ao ser editada', function () {
    // ARRANGE — sem o `ignore()`, salvar sem trocar o nome se acusaria de duplicata; e a
    // rota de edição NÃO traz a mãe na URL, então a regra tem de descobri-la pela linha
    $this->actingAs(admin());
    $mae = $this->postJson('/api/categorias', [
        'nome' => 'Despesas Fictícias '.fake()->unique()->numberBetween(1, 9999),
        'tipo' => 'despesa',
    ])->assertCreated()->json('id');
    $id = $this->postJson("/api/categorias/{$mae}/subcategorias", ['nome' => 'Água e luz'])
        ->assertCreated()->json('id');
    $versao = Subcategoria::findOrFail($id)->updated_at->toJSON();

    // ACT + ASSERT
    $this->withHeader('If-Match', $versao)
        ->putJson("/api/subcategorias/{$id}", ['nome' => 'Água e luz', 'codigo_contabil' => '4.1.02'])
        ->assertOk();
});

it('deve responder 404 ao editar subcategoria inexistente', function () {
    // ARRANGE — a regra `unique` da subcategoria DESLIGA quando não acha a categoria mãe
    // (o `whereNull` não casa com a coluna NOT NULL). Quem fecha é o `findOrFail` do
    // controlador, e é esta dependência entre arquivos que este cenário prende.
    $this->actingAs(admin());
    $mae = $this->postJson('/api/categorias', [
        'nome' => 'Despesas Fictícias '.fake()->unique()->numberBetween(1, 9999),
        'tipo' => 'despesa',
    ])->assertCreated()->json('id');
    $existente = $this->postJson("/api/categorias/{$mae}/subcategorias", ['nome' => 'Aluguel'])
        ->assertCreated()->json('id');
    $versao = Subcategoria::findOrFail($existente)->updated_at->toJSON();

    // ACT + ASSERT — id que não existe
    $inexistente = Subcategoria::max('id') + 1000;
    $this->withHeader('If-Match', $versao)
        ->putJson("/api/subcategorias/{$inexistente}", ['nome' => 'Qualquer'])
        ->assertNotFound();
});
