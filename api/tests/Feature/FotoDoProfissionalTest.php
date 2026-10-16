<?php

use App\Models\Auditoria;
use App\Models\Profissional;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * A foto do profissional (change foto-do-profissional) — o mesmo contrato da foto de perfil do
 * usuário, sobre o cadastro. Dados 100% fictícios; a imagem é gerada pelo fake do Laravel.
 */
beforeEach(function () {
    Storage::fake('local');
});

it('deve aceitar PNG, gravar em caminho server-set e auditar', function () {
    $admin = admin();
    $profissional = Profissional::factory()->create(['nome' => 'Profissional Fictício da Foto']);

    $resposta = $this->actingAs($admin)->post("/api/profissionais/{$profissional->id}/foto", [
        'arquivo' => UploadedFile::fake()->image('foto.png', 256, 256),
    ]);

    $resposta->assertCreated();
    expect($resposta->json('foto_versao'))->not->toBeNull();
    $profissional->refresh();
    expect($profissional->foto_path)->toBe("profissionais/{$profissional->id}/foto.png");
    expect(Storage::disk('local')->exists($profissional->foto_path))->toBeTrue();
    expect(Auditoria::where('acao', 'enviou_foto')->count())->toBe(1);
});

it('deve servir a foto com o content-type certo e expor só a versão no cadastro e na agenda', function () {
    $admin = admin();
    $profissional = Profissional::factory()->create();
    $this->actingAs($admin)->post("/api/profissionais/{$profissional->id}/foto", [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertCreated();

    $foto = $this->actingAs($admin)->get("/api/profissionais/{$profissional->id}/foto");
    $ficha = $this->actingAs($admin)->getJson("/api/profissionais/{$profissional->id}");
    $selecao = $this->actingAs($admin)->getJson('/api/agenda/selecao');

    $foto->assertOk()->assertHeader('Content-Type', 'image/png')->assertHeader('X-Content-Type-Options', 'nosniff');
    $ficha->assertOk();
    expect($ficha->json('foto_versao'))->toBe($profissional->refresh()->foto_atualizado_em->format('YmdHis'));
    expect($ficha->json())->not->toHaveKey('foto_path');
    $daAgenda = collect($selecao->json('profissionais'))->firstWhere('id', $profissional->id);
    expect($daAgenda['foto_versao'])->toBe($ficha->json('foto_versao'));
    expect($daAgenda)->not->toHaveKey('foto_path');
});

it('deve responder 404 sem foto e para profissional inexistente, e 403 sem profissionais.editar', function () {
    $admin = admin();
    $semFoto = Profissional::factory()->create();
    $leitor = usuarioCom(['agenda.ver'], 'Leitor Fictício');

    $this->actingAs($admin)->get("/api/profissionais/{$semFoto->id}/foto")->assertNotFound();
    $this->actingAs($admin)->get('/api/profissionais/99999999/foto')->assertNotFound();
    $this->actingAs($admin)->post('/api/profissionais/99999999/foto', [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertNotFound();

    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($leitor)->post("/api/profissionais/{$semFoto->id}/foto", [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertForbidden();
    $this->actingAs($leitor)->delete("/api/profissionais/{$semFoto->id}/foto")->assertForbidden();
});

it('deve recusar arquivo que não é imagem aceita', function () {
    $admin = admin();
    $profissional = Profissional::factory()->create();

    $resposta = $this->actingAs($admin)->post("/api/profissionais/{$profissional->id}/foto", [
        'arquivo' => UploadedFile::fake()->create('nota.txt', 10, 'text/plain'),
    ]);

    $resposta->assertUnprocessable()->assertJsonValidationErrors(['arquivo']);
    expect($profissional->refresh()->foto_path)->toBeNull();
});

it('deve remover a foto, apagar o arquivo e auditar', function () {
    $admin = admin();
    $profissional = Profissional::factory()->create();
    $this->actingAs($admin)->post("/api/profissionais/{$profissional->id}/foto", [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertCreated();
    $caminho = $profissional->refresh()->foto_path;

    $this->actingAs($admin)->delete("/api/profissionais/{$profissional->id}/foto")->assertNoContent();

    expect($profissional->refresh()->foto_path)->toBeNull();
    expect($profissional->foto_atualizado_em)->toBeNull();
    expect(Storage::disk('local')->exists($caminho))->toBeFalse();
    expect(Auditoria::where('acao', 'removeu_foto')->count())->toBe(1);
});

it('deve deixar LER a foto quem enxerga o profissional pela agenda — e negar a quem não enxerga nada', function () {
    $admin = admin();
    $profissional = Profissional::factory()->create();
    $leitor = usuarioCom(['agenda.ver'], 'Leitor Fictício da Foto');
    $semNada = usuarioCom(['tarefas.ver'], 'Sem Agenda Fictício');
    $this->actingAs($admin)->post("/api/profissionais/{$profissional->id}/foto", [
        'arquivo' => UploadedFile::fake()->image('foto.webp', 128, 128),
    ])->assertCreated();

    $this->flushSession();
    $this->app['auth']->forgetGuards();
    // a foto acompanha o nome, que a agenda entrega a quem tem agenda.ver; a FICHA não
    $this->actingAs($leitor)->get("/api/profissionais/{$profissional->id}/foto")
        ->assertOk()
        ->assertHeader('Content-Type', 'image/webp');
    $this->actingAs($leitor)->getJson("/api/profissionais/{$profissional->id}")->assertForbidden();

    $this->flushSession();
    $this->app['auth']->forgetGuards();
    // quem não recebe o nome por nenhuma porta não recebe o rosto (SEC-FP-01)
    $this->actingAs($semNada)->get("/api/profissionais/{$profissional->id}/foto")->assertForbidden();
});

it('deve trocar a extensão sem deixar a foto antiga no disco', function () {
    $admin = admin();
    $profissional = Profissional::factory()->create();
    $this->actingAs($admin)->post("/api/profissionais/{$profissional->id}/foto", [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertCreated();
    $anterior = $profissional->refresh()->foto_path;

    $this->actingAs($admin)->post("/api/profissionais/{$profissional->id}/foto", [
        'arquivo' => UploadedFile::fake()->image('foto.jpg', 128, 128),
    ])->assertCreated();

    expect($profissional->refresh()->foto_path)->toEndWith('/foto.jpg');
    expect(Storage::disk('local')->exists($anterior))->toBeFalse();
    expect(Storage::disk('local')->exists($profissional->foto_path))->toBeTrue();
});

it('deve manter a foto atual quando o envio novo é recusado', function () {
    $admin = admin();
    $profissional = Profissional::factory()->create();
    $this->actingAs($admin)->post("/api/profissionais/{$profissional->id}/foto", [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertCreated();
    $atual = $profissional->refresh()->foto_path;

    // MIME forjado: extensão .png, conteúdo de texto — o sniff do conteúdo recusa
    $this->actingAs($admin)->post("/api/profissionais/{$profissional->id}/foto", [
        'arquivo' => UploadedFile::fake()->createWithContent('foto.png', 'isto não é uma imagem'),
    ])->assertUnprocessable();

    expect($profissional->refresh()->foto_path)->toBe($atual);
    expect(Storage::disk('local')->exists($atual))->toBeTrue();
});

it('deve ser idempotente ao remover sem foto e responder 404 para remover de profissional inexistente', function () {
    $admin = admin();
    $semFoto = Profissional::factory()->create();

    $this->actingAs($admin)->delete("/api/profissionais/{$semFoto->id}/foto")->assertNoContent();
    expect(Auditoria::where('acao', 'removeu_foto')->count())->toBe(0);

    $this->actingAs($admin)->delete('/api/profissionais/99999999/foto')->assertNotFound();
});

it('deve apagar o arquivo da foto quando o cadastro do profissional é excluído', function () {
    $admin = admin();
    $profissional = Profissional::factory()->create();
    $this->actingAs($admin)->post("/api/profissionais/{$profissional->id}/foto", [
        'arquivo' => UploadedFile::fake()->image('foto.png', 128, 128),
    ])->assertCreated();
    $caminho = $profissional->refresh()->foto_path;

    $this->actingAs($admin)->deleteJson("/api/profissionais/{$profissional->id}")->assertNoContent();

    // dado pessoal não sobrevive à exclusão do dono (SEC-FP-02)
    expect(Storage::disk('local')->exists($caminho))->toBeFalse();
});
