<?php

use Illuminate\Http\Middleware\TrustProxies;
use Illuminate\Testing\TestResponse;

/**
 * Headers de segurança + HSTS trava dupla (change endurecimento-de-rede).
 * Strings FIXADAS pelo parecer — o teste guarda o TEXTO exato.
 */
const CSP_ESPERADA = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** O piso que TODA resposta deve trazer, mais a CSP exata. */
function assertPisoDeSeguranca(TestResponse $resposta): void
{
    $resposta
        ->assertHeader('X-Content-Type-Options', 'nosniff')
        ->assertHeader('X-Frame-Options', 'DENY')
        ->assertHeader('Referrer-Policy', 'no-referrer')
        ->assertHeader('X-Permitted-Cross-Domain-Policies', 'none')
        ->assertHeader('Cross-Origin-Resource-Policy', 'same-origin')
        ->assertHeader('Content-Security-Policy', CSP_ESPERADA);
}

it('deve trazer o piso e a CSP exata numa resposta de API', function () {
    // ARRANGE + ACT
    $resposta = $this->getJson('/api/health');

    // ASSERT
    $resposta->assertOk();
    assertPisoDeSeguranca($resposta);
});

it('deve trazer o piso e a CSP exata no healthcheck /up (fora do grupo api)', function () {
    // ARRANGE + ACT — o middleware é GLOBAL: /up também sai endurecido
    $resposta = $this->get('/up');

    // ASSERT
    assertPisoDeSeguranca($resposta);
});

it('deve trazer o piso e a CSP exata no /sanctum/csrf-cookie', function () {
    // ARRANGE + ACT — 204 do grupo web, ainda assim endurecido
    $resposta = $this->get('/sanctum/csrf-cookie');

    // ASSERT
    $resposta->assertNoContent();
    assertPisoDeSeguranca($resposta);
});

it('deve OMITIR o HSTS sem a flag (dev, http://localhost)', function () {
    // ARRANGE + ACT — flag desligada (default)
    $resposta = $this->getJson('/api/health');

    // ASSERT — trava dupla: sem flag, jamais HSTS
    $resposta->assertHeaderMissing('Strict-Transport-Security');
});

it('deve OMITIR o HSTS com a flag ligada mas em http (trava dupla)', function () {
    // ARRANGE — flag LIGADA, porém a conexão é http (isSecure() false)
    config(['seguranca.hsts' => true]);

    // ACT
    $resposta = $this->getJson('/api/health');

    // ASSERT — a segunda trava (isSecure) segura: sem HTTPS não há HSTS
    $resposta->assertHeaderMissing('Strict-Transport-Security');
});

it('deve EMITIR o HSTS com a flag ligada e conexão segura (isSecure via X-Forwarded-Proto)', function () {
    // ARRANGE — flag ligada + proxy confiado que anuncia TLS via X-Forwarded-Proto.
    // A presença do HSTS PROVA que isSecure() devolveu true atrás do proxy (SEC-ER-04).
    config(['seguranca.hsts' => true]);
    TrustProxies::at(['127.0.0.1']);

    // ACT
    $resposta = $this->getJson('/api/health', ['X-Forwarded-Proto' => 'https']);

    // ASSERT — trava dupla satisfeita: HSTS exato, sem preload
    $resposta->assertHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});
