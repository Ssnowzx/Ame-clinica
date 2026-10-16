<?php

use App\Models\Auditoria;
use App\Models\Usuario;

it('deve criar usuário que consegue autenticar com a senha inicial', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/usuarios', [
        'nome' => 'Recepcionista Fictícia',
        'email' => 'recepcao@exemplo.com.br',
        'senha' => 'senha-inicial-forte-1',
    ]);

    // ASSERT
    $criar->assertCreated()->assertJsonPath('email', 'recepcao@exemplo.com.br');

    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->postJson('/api/login', [
        'email' => 'recepcao@exemplo.com.br',
        'senha' => 'senha-inicial-forte-1',
    ])->assertOk();
});

it('deve rejeitar senha inicial fraca', function () {
    // ARRANGE — abuse case 3 (política mínima de 10 caracteres)
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/usuarios', [
        'nome' => 'X', 'email' => 'x@exemplo.com.br', 'senha' => '123',
    ])->assertUnprocessable()->assertJsonValidationErrors('senha');
});

it('deve exigir letras E números na composição da senha (decisão da clínica, gatilho PWD)', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $criar = fn (string $senha, string $email) => $this->postJson('/api/usuarios', [
        'nome' => 'Fulana Fictícia', 'email' => $email, 'senha' => $senha,
    ]);

    // ACT + ASSERT — só letras e só números recusam; a composição correta passa,
    // inclusive na REDEFINIÇÃO (o modelo é admin-gerido — bloco 8)
    $criar('somenteletras', 'a@exemplo.com.br')
        ->assertUnprocessable()->assertJsonValidationErrors('senha');
    $criar('12345678901234', 'b@exemplo.com.br')
        ->assertUnprocessable()->assertJsonValidationErrors('senha');
    $id = $criar('letras1e2numeros', 'c@exemplo.com.br')->assertCreated()->json('id');
    $this->putJsonComVersao("/api/usuarios/{$id}", ['senha' => '9999999999'])
        ->assertUnprocessable()->assertJsonValidationErrors('senha');
    $this->putJsonComVersao("/api/usuarios/{$id}", ['senha' => 'redefinida2026ok'])
        ->assertOk();
});

it('deve rejeitar email já usado', function () {
    // ARRANGE — o email é a identidade do login: único
    Usuario::factory()->create(['email' => 'ocupado@exemplo.com.br']);
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/usuarios', [
        'nome' => 'X', 'email' => 'ocupado@exemplo.com.br', 'senha' => 'senha-forte-123',
    ])->assertUnprocessable()->assertJsonValidationErrors('email');
});

it('deve ignorar nível enviado no payload de criação', function () {
    // ARRANGE — abuse case 1 (escalada via criação de usuário)
    $adminDaClinica = admin();

    // ACT
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/usuarios', [
        'nome' => 'Golpista',
        'email' => 'golpe@exemplo.com.br',
        'senha' => 'senha-forte-123',
        'nivel_permissao_id' => 1,
        'roles' => ['Administrador'],
    ]);

    // ASSERT — nasce SEM nível; atribuição só pelo endpoint dedicado
    $criar->assertCreated()->assertJsonPath('nivel_permissao_id', null);
    $novo = Usuario::where('email', 'golpe@exemplo.com.br')->firstOrFail();
    expect($novo->roles()->count())->toBe(0);
});

it('deve não expor rota de exclusão de usuário', function () {
    // ARRANGE — abuse case 12 (design D6: sem delete físico)
    $adminDaClinica = admin();
    $colega = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/usuarios/{$colega->id}")
        ->assertStatus(405);
    expect(Usuario::whereKey($colega->id)->exists())->toBeTrue();
});

it('deve bloquear auto-desativação', function () {
    // ARRANGE — abuse case 2 (T-usr-03: lockout)
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/usuarios/{$adminDaClinica->id}", [
        'ativo' => false,
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ativo');
    expect($adminDaClinica->fresh()->ativo)->toBeTrue();
});

it('deve bloquear auto-desativação também com zero e string zero', function (mixed $valorFalsy) {
    // ARRANGE — regressão do gate r1: a rule boolean aceita 0/"0" e a comparação
    // estrita com false deixava o bypass passar
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/usuarios/{$adminDaClinica->id}", [
        'ativo' => $valorFalsy,
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ativo');
    expect($adminDaClinica->fresh()->ativo)->toBeTrue();
})->with([0, '0']);

it('deve redefinir a senha pelo put com política mínima e diff mascarado', function () {
    // ARRANGE — decisão P2 do parecer incremental
    $adminDaClinica = admin();
    $colega = Usuario::factory()->create();

    // senha fraca na redefinição → 422
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/usuarios/{$colega->id}", [
        'senha' => 'curta',
    ])->assertUnprocessable()->assertJsonValidationErrors('senha');

    // ACT — redefinição válida
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/usuarios/{$colega->id}", [
        'senha' => 'senha-redefinida-forte-1',
    ])->assertOk();

    // ASSERT — autentica com a nova senha e o diff do update mascara o hash
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->postJson('/api/login', [
        'email' => $colega->email,
        'senha' => 'senha-redefinida-forte-1',
    ])->assertOk();

    $registro = Auditoria::where('entidade', 'usuarios')
        ->where('entidade_id', $colega->id)
        ->where('acao', 'atualizou')
        ->orderByDesc('id')
        ->firstOrFail();
    expect($registro->diff_json['depois']['senha_hash'])->toBe('***')
        ->and($registro->diff_json['antes']['senha_hash'])->toBe('***');
});

it('deve desativar colega e barrar o login imediatamente', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $colega = Usuario::factory()->create();

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/usuarios/{$colega->id}", [
        'ativo' => false,
    ])->assertOk()->assertJsonPath('ativo', false);

    // ASSERT — login recusado com a mensagem genérica
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->postJson('/api/login', [
        'email' => $colega->email,
        'senha' => 'senha-de-teste-123',
    ])->assertUnprocessable();
});

it('deve negar gestão de usuários sem permissão', function () {
    // ARRANGE
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)->getJson('/api/usuarios')->assertForbidden();
    $this->actingAs($usuarioSemNivel)->postJson('/api/usuarios', [
        'nome' => 'X', 'email' => 'x@exemplo.com.br', 'senha' => 'senha-forte-123',
    ])->assertForbidden();
});

it('deve nunca expor senha e sempre auditar a gestão de usuários', function () {
    // ARRANGE — abuse case 4
    $adminDaClinica = admin();

    // ACT
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/usuarios', [
        'nome' => 'Auditada',
        'email' => 'auditada@exemplo.com.br',
        'senha' => 'senha-forte-123',
    ]);

    // ASSERT — resposta sem hash; auditoria com autor e senha mascarada
    $criar->assertCreated();
    expect($criar->getContent())->not->toContain('senha_hash');

    $registro = Auditoria::where('entidade', 'usuarios')->where('acao', 'criou')
        ->orderByDesc('id')->firstOrFail();
    expect($registro->usuario_id)->toBe($adminDaClinica->id)
        ->and($registro->diff_json['depois']['senha_hash'])->toBe('***');
});

it('deve editar com o token vindo da PRÓPRIA leitura que hidrata o formulário', function () {
    // ARRANGE — o contrato real da tela (USUARIOS-EDIT-428): o formulário só
    // conhece o payload do GET; token do MODEL (putJsonComVersao) não prova nada
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $id = $this->postJson('/api/usuarios', [
        'nome' => 'Usuária Fictícia Editável',
        'email' => 'editavel@clinica-exemplo-ficticia.com.br',
        'senha' => 'senhaForte2026ok',
    ])->assertCreated()->json('id');

    // ACT — GET → PUT com o If-Match VERBATIM da resposta
    $leitura = $this->getJson("/api/usuarios/{$id}")->assertOk();
    $token = $leitura->json('updated_at');
    $resposta = $this->withHeader('If-Match', (string) $token)
        ->putJson("/api/usuarios/{$id}", ['nome' => 'Usuária Fictícia Renomeada']);

    // ASSERT — a leitura expõe o token (contratos-de-front) e o PUT passa
    expect($token)->not->toBeNull()->not->toBe('');
    $resposta->assertOk();
    expect($resposta->json('nome'))->toBe('Usuária Fictícia Renomeada');
});
