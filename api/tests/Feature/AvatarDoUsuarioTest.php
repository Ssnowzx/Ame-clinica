<?php

use App\Models\Auditoria;
use App\Models\Usuario;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * GUARDA da foto de perfil do usuário (change foto-de-perfil-do-usuario): upload/
 * leitura/remoção via `/me/avatar` — SEMPRE o próprio autenticado — com o mesmo
 * endurecimento do logo (MIME do CONTEÚDO, caminho server-set, SVG recusado — vetor
 * executável), `avatar_versao` no /me, e sem vazar a foto de um usuário para outro.
 * Dados 100% fictícios.
 */
beforeEach(function () {
    Storage::fake('local');
});

it('deve aceitar PNG válido, gravar em caminho server-set por usuário e auditar', function () {
    // ARRANGE
    $usuario = admin();

    // ACT
    $resposta = $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->image('minha foto.png', 256, 256),
    ]);

    // ASSERT — 201 com versão; caminho por USUÁRIO sem nada do nome do cliente; trilha
    $resposta->assertCreated();
    expect($resposta->json('avatar_versao'))->not->toBeNull();
    $usuario->refresh();
    expect($usuario->avatar_path)->toBe("usuarios/{$usuario->id}/avatar.png");
    expect(Storage::disk('local')->exists($usuario->avatar_path))->toBeTrue();
    expect(Auditoria::where('acao', 'enviou_avatar')->count())->toBe(1);
});

it('deve substituir a foto anterior sem deixar resto no disco', function () {
    // ARRANGE — um PNG já enviado
    $usuario = admin();
    $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertCreated();

    // ACT — troca por JPG (a extensão muda; o PNG antigo precisa sumir)
    $resposta = $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->image('foto.jpg', 128, 128),
    ]);

    // ASSERT
    $resposta->assertCreated();
    $usuario->refresh();
    expect($usuario->avatar_path)->toBe("usuarios/{$usuario->id}/avatar.jpg");
    expect(Storage::disk('local')->allFiles())->toBe(["usuarios/{$usuario->id}/avatar.jpg"]);
});

it('deve recusar SVG (vetor executável) sem gravar nada', function () {
    // ARRANGE
    $usuario = admin();
    $svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

    // ACT
    $resposta = $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->createWithContent('foto.svg', $svg),
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('arquivo');
    expect(Storage::disk('local')->allFiles())->toBe([]);
    expect(Usuario::findOrFail($usuario->id)->avatar_path)->toBeNull();
});

it('deve recusar arquivo que se diz PNG mas não decodifica (MIME forjado)', function () {
    // ARRANGE — assinatura PNG com corpo de lixo: o getimagesize é quem prova a imagem
    $usuario = admin();
    $falso = "\x89PNG\r\n\x1a\n".str_repeat('lixo', 32);

    // ACT
    $resposta = $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->createWithContent('foto.png', $falso),
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('arquivo');
    expect(Storage::disk('local')->allFiles())->toBe([]);
});

it('deve recusar imagem menor que o lado mínimo sem tocar a foto atual', function () {
    // ARRANGE — 32×32 < 64, com uma foto válida já no lugar
    $usuario = admin();
    $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertCreated();

    // ACT
    $resposta = $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->image('mini.png', 32, 32),
    ]);

    // ASSERT — 422 e a foto de 128×128 continua sendo servida
    $resposta->assertUnprocessable()->assertJsonValidationErrors('arquivo');
    $usuario->refresh();
    expect($usuario->avatar_path)->toBe("usuarios/{$usuario->id}/avatar.png");
    expect(Storage::disk('local')->allFiles())->toBe(["usuarios/{$usuario->id}/avatar.png"]);
});

it('deve servir a foto do próprio usuário com o Content-Type detectado, nosniff e no-cache', function () {
    // ARRANGE
    $usuario = admin();
    $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertCreated();

    // ACT
    $resposta = $this->actingAs($usuario)->get('/api/me/avatar');

    // ASSERT
    $resposta->assertOk();
    expect($resposta->headers->get('Content-Type'))->toBe('image/png');
    expect($resposta->headers->get('X-Content-Type-Options'))->toBe('nosniff');
    // SEC-01: recurso por-usuário em URL sem id — revalida, nunca cacheia por muito tempo
    expect($resposta->headers->get('Cache-Control'))->toContain('private');
    expect($resposta->headers->get('Cache-Control'))->toContain('no-cache');
});

it('deve aceitar WebP válido (a whitelist inteira, não só PNG/JPG)', function () {
    // ARRANGE — WebP real via GD (getimagesize/mime_content_type provam o formato)
    $usuario = admin();
    $caminho = tempnam(sys_get_temp_dir(), 'avatar').'.webp';
    $imagem = imagecreatetruecolor(128, 128);
    imagewebp($imagem, $caminho);
    imagedestroy($imagem);
    $arquivo = new UploadedFile($caminho, 'foto.webp', 'image/webp', null, true);

    // ACT
    $resposta = $this->actingAs($usuario)->post('/api/me/avatar', ['arquivo' => $arquivo]);

    // ASSERT — gravado com a extensão do formato detectado
    $resposta->assertCreated();
    $usuario->refresh();
    expect($usuario->avatar_path)->toBe("usuarios/{$usuario->id}/avatar.webp");
    expect(Storage::disk('local')->exists($usuario->avatar_path))->toBeTrue();
});

it('deve recusar arquivo acima de 1 MB sem tocar a foto atual', function () {
    // ARRANGE — o teto (1024 KB) é o controle de abuso do design; um arquivo de 1500 KB o excede
    $usuario = admin();
    $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertCreated();

    // ACT
    $resposta = $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->create('grande.png', 1500, 'image/png'),
    ]);

    // ASSERT — 422 e a foto de 128×128 continua sendo servida
    $resposta->assertUnprocessable()->assertJsonValidationErrors('arquivo');
    $usuario->refresh();
    expect($usuario->avatar_path)->toBe("usuarios/{$usuario->id}/avatar.png");
    expect(Storage::disk('local')->allFiles())->toBe(["usuarios/{$usuario->id}/avatar.png"]);
});

it('deve recusar imagem maior que o lado máximo sem tocar a foto atual', function () {
    // ARRANGE — 5000 px de largura > 4096 (tira fina p/ ficar < 1 MB e chegar ao check de lado)
    $usuario = admin();
    $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertCreated();

    // ACT
    $resposta = $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->image('larga.png', 5000, 100),
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('arquivo');
    $usuario->refresh();
    expect($usuario->avatar_path)->toBe("usuarios/{$usuario->id}/avatar.png");
    expect(Storage::disk('local')->allFiles())->toBe(["usuarios/{$usuario->id}/avatar.png"]);
});

it('deve responder 404 sem foto e nunca servir a foto de outro usuário (own-only)', function () {
    // ARRANGE — os DOIS usuários nascem ANTES das requests: o guard sanctum de uma
    // request contaminaria o guard default do Role::create do helper (como no logo)
    $usuarioA = admin();
    $usuarioB = usuarioCom([], 'Colega Sem Foto');
    $this->actingAs($usuarioA)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertCreated();
    $this->flushSession();
    $this->app['auth']->forgetGuards();

    // ACT + ASSERT — /me/avatar de B enxerga só B (sem foto → 404); a foto de A não vaza
    $this->actingAs($usuarioB)->get('/api/me/avatar')->assertNotFound();
});

it('deve remover a foto com trilha e voltar a 404', function () {
    // ARRANGE
    $usuario = admin();
    $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertCreated();

    // ACT
    $resposta = $this->actingAs($usuario)->delete('/api/me/avatar');

    // ASSERT
    $resposta->assertNoContent();
    $usuario->refresh();
    expect($usuario->avatar_path)->toBeNull();
    expect($usuario->avatar_atualizado_em)->toBeNull();
    expect(Storage::disk('local')->allFiles())->toBe([]);
    expect(Auditoria::where('acao', 'removeu_avatar')->count())->toBe(1);
    $this->actingAs($usuario)->get('/api/me/avatar')->assertNotFound();
});

it('deve ser idempotente ao remover sem foto', function () {
    // ARRANGE — usuário sem foto
    $usuario = admin();

    // ACT
    $resposta = $this->actingAs($usuario)->delete('/api/me/avatar');

    // ASSERT — não erra, segue sem foto e sem trilha de remoção
    $resposta->assertNoContent();
    expect(Auditoria::where('acao', 'removeu_avatar')->count())->toBe(0);
});

it('deve refletir a avatar_versao no /me (presente com foto, nula sem)', function () {
    // ARRANGE
    $usuario = admin();

    // ACT + ASSERT — sem foto, nula
    $this->actingAs($usuario)->get('/api/me')->assertOk()->assertJsonPath('avatar_versao', null);

    // ACT + ASSERT — com foto, a versão bate com o avatar_atualizado_em
    $this->actingAs($usuario)->post('/api/me/avatar', [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertCreated();
    $usuario->refresh();
    $this->actingAs($usuario)->get('/api/me')
        ->assertOk()
        ->assertJsonPath('avatar_versao', $usuario->avatar_atualizado_em->format('YmdHis'));
});
