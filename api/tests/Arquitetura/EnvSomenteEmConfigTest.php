<?php

use Tests\Arquitetura\Fontes;

/**
 * GUARDA — `env()` só em config/ (nunca em app/).
 *
 * Dentro de closures de RUNTIME (o `RateLimiter::for('api')` do throttle, os middlewares)
 * `env()` cru devolve NULL sob `config:cache`: o `.env` não é lido no boot cacheado, e o
 * teto de throttle / a flag de HSTS virariam 0/false em produção — a defesa desligada, em
 * silêncio. O valor derivado de env mora em `config/seguranca.php` e é lido via `config()`.
 *
 * A leitura de `env('TRUSTED_PROXIES')` no `bootstrap/app.php` é a exceção correta (o
 * withMiddleware roda ANTES de a config existir) — e `bootstrap/` não é `app/`, então a
 * guarda não o alcança. É exatamente a fronteira certa.
 */
it('deve manter env() fora de app/ — só config/ lê env (bug do config:cache)', function () {
    // ARRANGE + ACT — só a chamada GLOBAL env() conta (comentários/docblocks que citam
    // "env()" são ignorados via token_get_all — senão a guarda reprovaria a própria doc)
    $reincidentes = [];
    foreach (Fontes::doApp() as $arquivo => $fonte) {
        if (Fontes::chamaFuncaoGlobal($fonte, 'env')) {
            $reincidentes[] = $arquivo;
        }
    }

    // ASSERT
    expect($reincidentes)->toBe([], implode(PHP_EOL, [
        '`env()` em app/ vira NULL sob `config:cache` — mova o valor para config/seguranca.php',
        'e leia via config(). Reincidentes: '.implode(', ', $reincidentes),
    ]));
});
