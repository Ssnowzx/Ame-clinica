<?php

use App\Models\Auditoria;
use App\Support\Rede\ProxiesConfiaveis;
use Illuminate\Http\Middleware\TrustProxies;

/**
 * TRUSTPROXY (SEC-ER-04) — o IP da auditoria é requisito da trilha de troca de criança.
 * Atrás do proxy, `request()->ip()` só é o IP REAL se o proxy conhecido for confiado —
 * e SÓ ele. `*` FALHA a boot (confiar em todos = forjar o IP na auditoria).
 */
it('deve devolver lista vazia quando TRUSTED_PROXIES é vazio', function () {
    // ASSERT — vazio/nulo/espaços → [] (nunca [''], que Symfony trataria como IP)
    expect(ProxiesConfiaveis::parse(null))->toBe([]);
    expect(ProxiesConfiaveis::parse(''))->toBe([]);
    expect(ProxiesConfiaveis::parse('   '))->toBe([]);
});

it('deve fazer parse defensivo — trim e sem itens vazios', function () {
    // ASSERT — vírgula sobrando não vira ['']
    expect(ProxiesConfiaveis::parse('10.0.0.1, 172.18.0.0/16 ,'))
        ->toBe(['10.0.0.1', '172.18.0.0/16']);
});

it('deve FALHAR o parse quando a lista contém o coringa *', function () {
    // ASSERT — o mecanismo que o boot chama: parse('*') lança → app não sobe
    expect(fn () => ProxiesConfiaveis::parse('*'))->toThrow(InvalidArgumentException::class);
    expect(fn () => ProxiesConfiaveis::parse('**'))->toThrow(InvalidArgumentException::class);
    expect(fn () => ProxiesConfiaveis::parse('10.0.0.1, *'))->toThrow(InvalidArgumentException::class);
});

it('deve cravar parse(env(TRUSTED_PROXIES)) no boot — o mecanismo que FALHA com *', function () {
    // Re-bootar a app em processo trocaria o app das facades (Facade::$app estático) e
    // corromperia o suíte de DB compartilhado (TEST-DB). A falha de boot fica provada por
    // DUAS peças que não podem divergir: (1) `parse('*')` LANÇA [teste acima]; (2) o boot
    // chama EXATAMENTE `parse(env('TRUSTED_PROXIES'))` dentro do `trustProxies`. Logo,
    // TRUSTED_PROXIES=* derruba o boot.
    $bootstrap = file_get_contents(base_path('bootstrap/app.php'));

    expect($bootstrap)
        ->toContain('->trustProxies(')
        ->toContain("ProxiesConfiaveis::parse(env('TRUSTED_PROXIES'))");
});

it('deve preservar o IP do cliente na AUDITORIA quando o XFF vem do proxy confiado', function () {
    // ARRANGE — confia no IP da conexão de teste (127.0.0.1) como se fosse o reverse proxy
    TrustProxies::at(['127.0.0.1']);
    $admin = admin();

    // ACT — mutação auditada; XFF carrega o IP REAL do cliente atrás do proxy
    $this->actingAs($admin)->postJson('/api/niveis-permissao', [
        'nome' => 'Recepção', 'permissoes' => [],
    ], ['X-Forwarded-For' => '203.0.113.7'])->assertCreated();

    // ASSERT — a trilha grava o IP do CLIENTE, não o do proxy
    $registro = Auditoria::where('entidade', 'roles')->where('acao', 'criou')
        ->orderByDesc('id')->firstOrFail();
    expect($registro->ip)->toBe('203.0.113.7');
});

it('não deve deixar XFF de origem não confiada falsificar o IP da auditoria', function () {
    // ARRANGE — nenhum proxy confiado (default local-first)
    TrustProxies::at([]);
    $admin = admin();

    // ACT — XFF forjado de origem NÃO listada
    $this->actingAs($admin)->postJson('/api/niveis-permissao', [
        'nome' => 'Recepção', 'permissoes' => [],
    ], ['X-Forwarded-For' => '203.0.113.7'])->assertCreated();

    // ASSERT — grava o IP REAL da conexão, não o cabeçalho forjado
    $registro = Auditoria::where('entidade', 'roles')->where('acao', 'criou')
        ->orderByDesc('id')->firstOrFail();
    expect($registro->ip)->toBe('127.0.0.1')
        ->and($registro->ip)->not->toBe('203.0.113.7');
});
