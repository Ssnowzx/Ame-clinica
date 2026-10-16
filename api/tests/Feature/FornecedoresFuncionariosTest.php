<?php

use App\Models\Auditoria;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Fornecedor;
use App\Models\Funcionario;
use App\Models\TipoPagamento;
use App\Models\Usuario;

const CPF_FICTICIO_VALIDO = '52998224725'; // gerado por algoritmo — não é real
const CNPJ_FICTICIO_VALIDO = '11222333000181';

it('deve cadastrar fornecedor com documento validado e único na clínica', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $payload = [
        'razao_social' => 'Fornecedora Fictícia LTDA',
        'cpf_cnpj' => CNPJ_FICTICIO_VALIDO,
        'contatos_json' => [['tipo' => 'email', 'valor' => 'contato@ficticia.example']],
        'endereco_json' => ['cidade' => 'Florianópolis', 'uf' => 'SC'],
    ];

    // ACT + ASSERT
    $this->postJson('/api/fornecedores', $payload)->assertCreated();
    $this->postJson('/api/fornecedores', $payload)
        ->assertUnprocessable()->assertJsonValidationErrors('cpf_cnpj'); // unique

    // DV inválido e tamanho errado → 422 (T-fin-05)
    $this->postJson('/api/fornecedores', [...$payload, 'cpf_cnpj' => '11111111111111'])
        ->assertUnprocessable()->assertJsonValidationErrors('cpf_cnpj');
    $this->postJson('/api/fornecedores', [...$payload, 'cpf_cnpj' => '123'])
        ->assertUnprocessable()->assertJsonValidationErrors('cpf_cnpj');

    // chave extra no JSON → 422 (whitelist)
    $this->postJson('/api/fornecedores', [
        'razao_social' => 'Outra Fictícia',
        'endereco_json' => ['cidade' => 'X', 'campo_estranho' => 'contrabando'],
    ])->assertUnprocessable()->assertJsonValidationErrors('endereco_json');
});

it('deve cadastrar funcionário com cpf validado', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);

    // ACT + ASSERT
    $this->postJson('/api/funcionarios', [
        'nome' => 'Funcionária Fictícia', 'funcao' => 'Recepção', 'cpf' => CPF_FICTICIO_VALIDO,
    ])->assertCreated();
    $this->postJson('/api/funcionarios', [
        'nome' => 'Outro Fictício', 'funcao' => 'Limpeza', 'cpf' => '11111111111',
    ])->assertUnprocessable()->assertJsonValidationErrors('cpf');
});

it('deve minimizar listagens e mascarar documento, contatos e endereço no diff', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $id = $this->postJson('/api/fornecedores', [
        'razao_social' => 'Fornecedora Sigilosa Fictícia',
        'cpf_cnpj' => CNPJ_FICTICIO_VALIDO,
        'contatos_json' => [['tipo' => 'celular', 'valor' => '48999990000']],
        'endereco_json' => ['logradouro' => 'Rua Fictícia', 'cidade' => 'Fpolis'],
    ])->assertCreated()->json('id');

    // ASSERT — LIST minimalista (T-fin-05): detail-only
    $lista = $this->getJson('/api/fornecedores')->assertOk();
    expect(json_encode($lista->json()))->not->toContain(CNPJ_FICTICIO_VALIDO)
        ->and(json_encode($lista->json()))->not->toContain('48999990000');
    semVazamento($lista->json(), 'Rua Fictícia');
    expect($this->getJson("/api/fornecedores/{$id}")->json('cpf_cnpj'))->toBe(CNPJ_FICTICIO_VALIDO);

    // diff mascarado (§1.1) — razão social em claro
    $registro = Auditoria::where('entidade', 'fornecedores')->where('acao', 'criou')->firstOrFail();
    expect($registro->diff_json['depois']['cpf_cnpj'])->toBe('***')
        ->and($registro->diff_json['depois']['contatos_json'])->toBe('***')
        ->and($registro->diff_json['depois']['endereco_json'])->toBe('***')
        ->and($registro->diff_json['depois']['razao_social'])->toBe('Fornecedora Sigilosa Fictícia');
});

it('deve bloquear exclusão de interessado com lançamentos e permitir inativar', function () {
    // ARRANGE — funcionário interessado em uma despesa
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $funcionario = Funcionario::create(['nome' => 'Interessado Fictício', 'funcao' => 'Aux.']);
    $conta = Conta::create(['nome' => 'Caixa Fictício RH']);
    $categoria = Categoria::create(['nome' => 'Salários Fictícios', 'tipo' => 'despesa']);
    $tipoPagamento = TipoPagamento::create(['nome' => 'Transferência Fictícia']);
    $this->postJson('/api/lancamentos', [
        'tipo' => 'despesa',
        'competencia' => agoraNaClinica()->toDateString(),
        'vencimento' => agoraNaClinica()->toDateString(),
        'categoria_id' => $categoria->id,
        'valor' => '1500.00',
        'tipo_pagamento_id' => $tipoPagamento->id,
        'conta_id' => $conta->id,
        'interessado_tipo' => 'funcionario',
        'interessado_id' => $funcionario->id,
    ])->assertCreated();

    // ACT + ASSERT — sem FK física: a checagem explícita protege (D2)
    $this->deleteJson("/api/funcionarios/{$funcionario->id}")
        ->assertUnprocessable()->assertJsonValidationErrors('funcionario');

    // o branch do FORNECEDOR também (CR-05b: código por controller, não compartilhado)
    $fornecedorInteressado = Fornecedor::create(['razao_social' => 'Fornecedor Interessado Fictício']);
    $this->postJson('/api/lancamentos', [
        'tipo' => 'despesa',
        'competencia' => agoraNaClinica()->toDateString(),
        'vencimento' => agoraNaClinica()->toDateString(),
        'categoria_id' => $categoria->id,
        'valor' => '30.00',
        'tipo_pagamento_id' => $tipoPagamento->id,
        'conta_id' => $conta->id,
        'interessado_tipo' => 'fornecedor',
        'interessado_id' => $fornecedorInteressado->id,
    ])->assertCreated();
    $this->deleteJson("/api/fornecedores/{$fornecedorInteressado->id}")
        ->assertUnprocessable()->assertJsonValidationErrors('fornecedor');
    $this->putJsonComVersao("/api/funcionarios/{$funcionario->id}", [
        'nome' => $funcionario->nome, 'funcao' => $funcionario->funcao, 'ativo' => false,
    ])->assertOk()->assertJsonPath('ativo', false);

    // sem lançamentos exclui normalmente
    $livre = Fornecedor::create(['razao_social' => 'Fornecedor Livre Fictício']);
    $this->deleteJson("/api/fornecedores/{$livre->id}")->assertNoContent();
});

it('deve responder 403 sem permissão', function () {
    // ARRANGE
    $semPermissao = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($semPermissao)->getJson('/api/funcionarios')->assertForbidden();
});
