<?php

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;

/**
 * LOG app-side (change endurecimento-de-rede) — a busca de paciente leva NOME DE MENOR
 * na query, e o log é retenção de disco (LGPD). O app NÃO pode registrar a query string
 * nos próprios logs. Prova: um erro forçado numa rota com `?busca=<termo>` e o log limpo.
 */
it('não deve registrar a chave nem o valor da query string no log do app', function () {
    // ARRANGE — aponta o log para um arquivo temporário e limpa o canal já resolvido
    $arquivo = storage_path('logs/teste-query-'.uniqid().'.log');
    config([
        'logging.default' => 'single',
        'logging.channels.single.path' => $arquivo,
        'logging.channels.single.level' => 'debug',
    ]);
    Log::forgetChannel('single');

    // rota que ESTOURA — o handler de exceção reporta ao log default
    Route::get('/api/_boom_query', fn () => throw new RuntimeException('falha proposital de teste'));

    // ACT — request com nome de menor na busca
    $this->getJson('/api/_boom_query?busca=CRIANCA_SECRETA_XYZ')->assertStatus(500);

    // ASSERT
    $conteudo = file_exists($arquivo) ? file_get_contents($arquivo) : '';
    // liveness: o erro FOI logado (sem isto o teste passaria à toa)
    expect($conteudo)->toContain('falha proposital de teste');
    // a query string (chave E valor) NÃO aparece
    expect($conteudo)->not->toContain('CRIANCA_SECRETA_XYZ');
    expect($conteudo)->not->toContain('?busca');

    // cleanup
    @unlink($arquivo);
});
