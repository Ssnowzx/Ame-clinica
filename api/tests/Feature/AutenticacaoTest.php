<?php

use App\Models\Usuario;

const SENHA_DE_TESTE = 'senha-de-teste-123';

it('deve autenticar com credenciais válidas e retornar o usuário', function () {
    // ARRANGE
    $usuario = Usuario::factory()->create(['email' => 'operadora@exemplo.com.br']);

    // ACT
    $resposta = $this->postJson('/api/login', [
        'email' => 'operadora@exemplo.com.br',
        'senha' => SENHA_DE_TESTE,
    ]);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('email', 'operadora@exemplo.com.br');
    $this->assertAuthenticatedAs($usuario);
});

it('deve recusar senha incorreta com mensagem genérica', function () {
    // ARRANGE
    Usuario::factory()->create(['email' => 'operadora@exemplo.com.br']);

    // ACT
    $resposta = $this->postJson('/api/login', [
        'email' => 'operadora@exemplo.com.br',
        'senha' => 'senha-errada',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()
        ->assertJsonPath('errors.email.0', 'Credenciais inválidas.');
    $this->assertGuest();
});

it('deve responder igual para email inexistente e senha errada', function () {
    // ARRANGE — abuse case 4 (enumeração de emails): respostas idênticas
    Usuario::factory()->create(['email' => 'existe@exemplo.com.br']);

    // ACT
    $senhaErrada = $this->postJson('/api/login', [
        'email' => 'existe@exemplo.com.br',
        'senha' => 'senha-errada',
    ]);
    $emailInexistente = $this->postJson('/api/login', [
        'email' => 'nao-existe@exemplo.com.br',
        'senha' => 'qualquer-senha',
    ]);

    // ASSERT
    expect($emailInexistente->getStatusCode())->toBe($senhaErrada->getStatusCode())
        ->and($emailInexistente->json('errors'))->toBe($senhaErrada->json('errors'));
});

it('deve recusar login de usuário inativo com a mesma mensagem genérica', function () {
    // ARRANGE
    Usuario::factory()->inativo()->create(['email' => 'desativada@exemplo.com.br']);

    // ACT
    $resposta = $this->postJson('/api/login', [
        'email' => 'desativada@exemplo.com.br',
        'senha' => SENHA_DE_TESTE,
    ]);

    // ASSERT
    $resposta->assertUnprocessable()
        ->assertJsonPath('errors.email.0', 'Credenciais inválidas.');
    $this->assertGuest();
});

it('deve limitar tentativas de login por email e ip', function () {
    // ARRANGE — abuse case 5 (brute force): limite de 5 tentativas
    Usuario::factory()->create(['email' => 'alvo@exemplo.com.br']);

    // ACT
    foreach (range(1, 5) as $tentativa) {
        $this->postJson('/api/login', [
            'email' => 'alvo@exemplo.com.br',
            'senha' => "senha-errada-{$tentativa}",
        ])->assertUnprocessable();
    }
    $sextaTentativa = $this->postJson('/api/login', [
        'email' => 'alvo@exemplo.com.br',
        'senha' => 'senha-errada-6',
    ]);

    // ASSERT
    $sextaTentativa->assertStatus(429);
});

it('deve rejeitar com 419 requisição mutável da origem stateful sem token csrf', function () {
    // ARRANGE — o VerifyCsrfToken é desligado em env testing; simular env real
    $this->app['env'] = 'local';
    Usuario::factory()->create(['email' => 'operadora@exemplo.com.br']);

    // ACT — Referer da SPA (domínio stateful) sem cookie/token XSRF
    $resposta = $this->postJson('/api/login', [
        'email' => 'operadora@exemplo.com.br',
        'senha' => SENHA_DE_TESTE,
    ], ['Referer' => 'http://localhost:5173']);

    // ASSERT
    $resposta->assertStatus(419);
});

it('deve invalidar a sessão no logout', function () {
    // ARRANGE
    $usuario = Usuario::factory()->create();
    $this->actingAs($usuario);

    // ACT
    $logout = $this->postJson('/api/logout');
    $this->app['auth']->forgetGuards();
    $depois = $this->getJson('/api/me');

    // ASSERT
    $logout->assertNoContent();
    $depois->assertUnauthorized();
});

it('deve retornar os dados do usuário autenticado no me', function () {
    // ARRANGE
    $usuario = Usuario::factory()->create(['nome' => 'Operadora Fictícia']);

    // ACT
    $resposta = $this->actingAs($usuario)->getJson('/api/me');

    // ASSERT
    $resposta->assertOk()
        ->assertJsonPath('nome', 'Operadora Fictícia')
        ->assertJsonPath('email', $usuario->email);
});

it('deve responder 401 no me sem autenticação', function () {
    // ACT
    $resposta = $this->getJson('/api/me');

    // ASSERT
    $resposta->assertUnauthorized();
});

it('deve barrar usuário desativado mesmo com sessão viva', function () {
    // ARRANGE — abuse case 7: desativação vale imediatamente
    $usuario = Usuario::factory()->create();
    $this->actingAs($usuario);
    $this->getJson('/api/me')->assertOk();
    $usuario->forceFill(['ativo' => false])->save();

    // ACT
    $this->app['auth']->forgetGuards();
    $resposta = $this->getJson('/api/me');

    // ASSERT
    $resposta->assertUnauthorized();
});

it('deve responder 401 em json mesmo sem o header accept', function () {
    // ARRANGE — achado F1 da auditoria: sem Accept, o 401 virava redirect → 500 Ignition

    // ACT — get() cru, sem Accept: application/json
    $resposta = $this->get('/api/me');

    // ASSERT
    $resposta->assertUnauthorized();
    expect($resposta->headers->get('content-type'))->toContain('application/json');
});

it('deve regenerar o id da sessão no login', function () {
    // ARRANGE — abuse case 6 (fixação de sessão)
    Usuario::factory()->create(['email' => 'operadora@exemplo.com.br']);
    $this->withSession([]);
    $idAntes = $this->app['session']->getId();

    // ACT
    $this->postJson('/api/login', [
        'email' => 'operadora@exemplo.com.br',
        'senha' => SENHA_DE_TESTE,
    ])->assertOk();

    // ASSERT
    expect($this->app['session']->getId())->not->toBe($idAntes);
});

it('deve nunca expor senha ou hash em respostas de usuário', function () {
    // ARRANGE
    $usuario = Usuario::factory()->create(['email' => 'operadora@exemplo.com.br']);

    // ACT
    $login = $this->postJson('/api/login', [
        'email' => 'operadora@exemplo.com.br',
        'senha' => SENHA_DE_TESTE,
    ]);
    $me = $this->actingAs($usuario)->getJson('/api/me');

    // ASSERT
    expect($login->getContent())->not->toContain('senha_hash')
        ->and($me->getContent())->not->toContain('senha_hash')
        ->and($me->getContent())->not->toContain('remember_token');
});
