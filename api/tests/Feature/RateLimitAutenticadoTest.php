<?php

/**
 * RL — throttle nas rotas autenticadas (change endurecimento-de-rede).
 *
 * Tetos rebaixados via `config()` em cada teste: mantém a suíte rápida E prova que o
 * closure lê `config('seguranca.*')` em runtime (SEC-ER: config, nunca `env()` cru). A
 * invariante central é a SEPARAÇÃO de buckets: ler nunca esfomeia escrever.
 */
it('deve barrar a leitura no teto sem barrar a mutação (buckets separados r:/w:)', function () {
    // ARRANGE — leitura curtíssima, mutação folgada
    config(['seguranca.throttle_leitura' => 2, 'seguranca.throttle_mutacao' => 5]);
    $admin = admin();

    // ACT + ASSERT — 2 GET passam, o 3º estoura o bucket de LEITURA
    $this->actingAs($admin)->getJson('/api/me')->assertOk();
    $this->actingAs($admin)->getJson('/api/me')->assertOk();
    $this->actingAs($admin)->getJson('/api/me')->assertStatus(429);

    // a MUTAÇÃO segue livre — o bucket w: não foi tocado pela enxurrada de GET
    $this->actingAs($admin)->postJson('/api/niveis-permissao', [
        'nome' => 'Recepção', 'permissoes' => [],
    ])->assertCreated();
});

it('deve barrar a mutação no teto sem barrar a leitura (buckets separados r:/w:)', function () {
    // ARRANGE — mutação curtíssima, leitura folgada
    config(['seguranca.throttle_leitura' => 5, 'seguranca.throttle_mutacao' => 2]);
    $admin = admin();

    // ACT + ASSERT — 2 POST passam, o 3º estoura o bucket de MUTAÇÃO
    $this->actingAs($admin)->postJson('/api/niveis-permissao', ['nome' => 'Papel A', 'permissoes' => []])->assertCreated();
    $this->actingAs($admin)->postJson('/api/niveis-permissao', ['nome' => 'Papel B', 'permissoes' => []])->assertCreated();
    $this->actingAs($admin)->postJson('/api/niveis-permissao', ['nome' => 'Papel C', 'permissoes' => []])->assertStatus(429);

    // a LEITURA segue livre — o bucket r: não foi tocado pelas mutações
    $this->actingAs($admin)->getJson('/api/me')->assertOk();
});

it('deve isolar o teto por usuário — A esgotado não barra B', function () {
    // ARRANGE — teto de 1 leitura; ambos os usuários criados ANTES de qualquer request
    // autenticado (o auth:sanctum fixa o guard default em `sanctum` e quebraria a criação
    // de role do usuarioCom depois — padrão da base: usuarioCom antes do actingAs).
    config(['seguranca.throttle_leitura' => 1]);
    $a = admin();
    $b = usuarioCom([], 'Recepcao');

    // ACT + ASSERT — A esgota o próprio bucket
    $this->actingAs($a)->getJson('/api/me')->assertOk();
    $this->actingAs($a)->getJson('/api/me')->assertStatus(429);

    // troca limpa de identidade (a sessão stateful de A ficaria no cliente)
    $this->flushSession();
    app('auth')->forgetGuards();

    // B tem bucket PRÓPRIO (chave por user id) — não herda o 429 de A
    $this->actingAs($b)->getJson('/api/me')->assertOk();
});

it('deve responder 429 em JSON com Retry-After ao estourar', function () {
    // ARRANGE
    config(['seguranca.throttle_leitura' => 1]);
    $admin = admin();

    // ACT
    $this->actingAs($admin)->getJson('/api/me')->assertOk();
    $bloqueado = $this->actingAs($admin)->getJson('/api/me');

    // ASSERT — 429 com Retry-After, corpo JSON (nunca página HTML)
    $bloqueado->assertStatus(429)->assertHeader('Retry-After');
    expect($bloqueado->headers->get('content-type'))->toContain('application/json');
});

it('deve manter o login fora do bucket do throttle:api', function () {
    // ARRANGE — esgota a leitura autenticada
    config(['seguranca.throttle_leitura' => 1]);
    $admin = admin();
    $this->actingAs($admin)->getJson('/api/me')->assertOk();
    $this->actingAs($admin)->getJson('/api/me')->assertStatus(429);

    // ACT + ASSERT — o login tem limiter PRÓPRIO (email+IP, 5/5min): não herda o 429
    $this->postJson('/api/login', [
        'email' => $admin->email, 'senha' => 'senha-de-teste-123',
    ])->assertOk();
});

it('deve barrar o csrf-cookie por IP após o teto (SEC-ER-01)', function () {
    // ARRANGE + ACT — o grupo web tem throttle:60,1: sem isto um laço no csrf-cookie
    // persiste uma sessão por hit (SESSION_DRIVER=database) e infla a tabela `sessions`
    foreach (range(1, 60) as $i) {
        $this->get('/sanctum/csrf-cookie')->assertNoContent();
    }

    // ASSERT — o 61º hit do mesmo IP é barrado
    $this->get('/sanctum/csrf-cookie')->assertStatus(429);
});
