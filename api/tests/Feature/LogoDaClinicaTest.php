<?php

use App\Models\Auditoria;
use App\Models\Clinica;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * GUARDA da identidade da clínica (change identidade-da-clinica): upload/leitura/
 * remoção do logo com o endurecimento herdado dos anexos (MIME do CONTEÚDO, caminho
 * server-set, SVG recusado — vetor executável), `marca` no /me sem exigir
 * `configuracoes.ver`, e chaves novas com domínio de opções. Dados 100% fictícios.
 */
beforeEach(function () {
    Storage::fake('local');
});

it('deve aceitar PNG válido, gravar em caminho server-set e auditar', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->post('/api/clinica/logo', [
        'arquivo' => UploadedFile::fake()->image('minha logo linda.png', 320, 128),
    ]);

    // ASSERT — 201 com versão; caminho fixo SEM nada do nome do cliente; trilha
    $resposta->assertCreated();
    expect($resposta->json('logo_versao'))->not->toBeNull();
    $clinica = Clinica::atual();
    expect($clinica->logo_path)->toBe('clinica/logo.png');
    expect(Storage::disk('local')->exists($clinica->logo_path))->toBeTrue();
    expect(Auditoria::where('acao', 'enviou_logo')->count())->toBe(1);
});

it('deve substituir o logo anterior sem deixar resto no disco', function () {
    // ARRANGE — um PNG já enviado
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica)->post('/api/clinica/logo', [
        'arquivo' => UploadedFile::fake()->image('logo.png', 128, 128),
    ])->assertCreated();

    // ACT — troca por JPG (extensão muda; o PNG antigo precisa sumir)
    $resposta = $this->actingAs($adminDaClinica)->post('/api/clinica/logo', [
        'arquivo' => UploadedFile::fake()->image('logo.jpg', 128, 128),
    ]);

    // ASSERT
    $resposta->assertCreated();
    expect(Clinica::atual()->logo_path)->toBe('clinica/logo.jpg');
    expect(Storage::disk('local')->allFiles())->toBe(['clinica/logo.jpg']);
});

it('deve recusar SVG (vetor executável) sem gravar nada', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->post('/api/clinica/logo', [
        'arquivo' => UploadedFile::fake()->createWithContent('logo.svg', $svg),
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('arquivo');
    expect(Storage::disk('local')->allFiles())->toBe([]);
    expect(Clinica::atual()->logo_path)->toBeNull();
});

it('deve recusar imagem menor que o lado mínimo', function () {
    // ARRANGE — 32×32 < 64
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->post('/api/clinica/logo', [
        'arquivo' => UploadedFile::fake()->image('logo.png', 32, 32),
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('arquivo');
    expect(Storage::disk('local')->allFiles())->toBe([]);
});

it('deve recusar arquivo que se diz PNG mas não decodifica', function () {
    // ARRANGE — assinatura PNG com corpo de lixo (o finfo pode até dizer image/png;
    // o getimagesize é quem prova a imagem)
    $adminDaClinica = admin();
    $falso = "\x89PNG\r\n\x1a\n".str_repeat('lixo', 32);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->post('/api/clinica/logo', [
        'arquivo' => UploadedFile::fake()->createWithContent('logo.png', $falso),
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('arquivo');
    expect(Storage::disk('local')->allFiles())->toBe([]);
});

it('deve negar escrita sem configuracoes.editar', function () {
    // ARRANGE — a clínica + usuário só com leitura
    admin();
    $restrito = usuarioCom(['configuracoes.ver'], 'Somente Leitura');

    // ACT + ASSERT
    $this->actingAs($restrito)->post('/api/clinica/logo', [
        'arquivo' => UploadedFile::fake()->image('logo.png', 128, 128),
    ])->assertForbidden();
    $this->actingAs($restrito)->delete('/api/clinica/logo')->assertForbidden();
});

it('deve servir o logo a autenticado SEM configuracoes.ver, com o Content-Type detectado', function () {
    // ARRANGE — usuários criados ANTES das requests (o guard sanctum de uma request
    // anterior contaminaria o guard default do Role::create do helper)
    $adminDaClinica = admin();
    $recepcao = usuarioCom([], 'Recepção Sem Permissões');
    $this->actingAs($adminDaClinica)->post('/api/clinica/logo', [
        'arquivo' => UploadedFile::fake()->image('logo.png', 128, 128),
    ])->assertCreated();
    $this->flushSession();
    $this->app['auth']->forgetGuards();

    // ACT
    $resposta = $this->actingAs($recepcao)->get('/api/clinica/logo');

    // ASSERT
    $resposta->assertOk();
    expect($resposta->headers->get('Content-Type'))->toBe('image/png');
    expect($resposta->headers->get('X-Content-Type-Options'))->toBe('nosniff');
});

it('deve responder 404 quando a clínica não tem logo', function () {
    // ARRANGE — nenhum logo enviado
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->get('/api/clinica/logo')->assertNotFound();
});

it('deve remover o logo com trilha e voltar a 404', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica)->post('/api/clinica/logo', [
        'arquivo' => UploadedFile::fake()->image('logo.png', 128, 128),
    ])->assertCreated();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->delete('/api/clinica/logo');

    // ASSERT
    $resposta->assertNoContent();
    $clinica = Clinica::atual();
    expect($clinica->logo_path)->toBeNull()
        ->and($clinica->logo_atualizado_em)->toBeNull();
    expect(Storage::disk('local')->allFiles())->toBe([]);
    expect(Auditoria::where('acao', 'removeu_logo')->count())->toBe(1);
    $this->actingAs($adminDaClinica)->get('/api/clinica/logo')->assertNotFound();
});

it('deve entregar a marca no /me a usuário sem configuracoes.ver', function () {
    // ARRANGE — usuários ANTES das requests (guard do helper); identidade + logo do admin
    $adminDaClinica = admin();
    $recepcao = usuarioCom([], 'Recepção Sem Permissões');
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.fonte_do_nome',
        'valor' => 'serifada',
    ])->assertOk();
    $this->actingAs($adminDaClinica)->post('/api/clinica/logo', [
        'arquivo' => UploadedFile::fake()->image('logo.png', 128, 128),
    ])->assertCreated();
    $this->flushSession();
    $this->app['auth']->forgetGuards();

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/me');

    // ASSERT — a marca chega inteira, sem permissão de configurações.
    // `identidade` é `logo` porque ENVIAR a logo passou a aplicá-la (change
    // logo-aplicada-ao-enviar); antes dela, este mesmo arranjo terminava em `nome` — que era
    // justamente o defeito: logo no servidor, nome na barra.
    $resposta->assertOk()
        ->assertJsonPath('marca.identidade', 'logo')
        ->assertJsonPath('marca.fonte', 'serifada');
    expect($resposta->json('marca.logo_versao'))->not->toBeNull();
});

it('deve recusar valor fora das opções nas chaves de identidade', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.identidade',
        'valor' => 'banner',
    ]);

    // ASSERT — 422 e o efetivo permanece o default
    $resposta->assertUnprocessable()->assertJsonValidationErrors('valor');
    $me = $this->actingAs($adminDaClinica)->getJson('/api/me');
    expect($me->json('marca.identidade'))->toBe('nome');
});

/**
 * ENVIAR A LOGO É USAR A LOGO (change logo-aplicada-ao-enviar).
 *
 * A tela pedia dois gestos — enviar o arquivo e marcar "Logo" num botão acima do campo de envio —
 * e quem enviava por último não via mais botão nenhum. A logo ficava no servidor e a barra
 * continuava exibindo o texto.
 */
it('deve aplicar a logo na barra ao enviá-la com a identidade em nome', function () {
    // ARRANGE — o padrão do catálogo é `nome`
    $adminDaClinica = admin();
    expect(app(ConfiguracaoService::class)->get('clinica.identidade'))->toBe('nome');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->post('/api/clinica/logo', [
        'arquivo' => UploadedFile::fake()->image('logo.png', 200, 200),
    ]);

    // ASSERT — a escolha passou a `logo`, a resposta diz que aplicou, e a mudança está na trilha
    $resposta->assertCreated();
    expect($resposta->json('identidade_aplicada'))->toBeTrue();
    expect(app(ConfiguracaoService::class)->get('clinica.identidade'))->toBe('logo');
    expect(Auditoria::where('entidade', 'configuracoes')->count())->toBe(1);
});

it('deve não reescrever a escolha quando a identidade já é logo', function () {
    // ARRANGE — clínica que já exibe a logo e está só trocando o arquivo
    $adminDaClinica = admin();
    app(ConfiguracaoService::class)->set('clinica.identidade', 'logo');
    $trilhaAntes = Auditoria::where('entidade', 'configuracoes')->count();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->post('/api/clinica/logo', [
        'arquivo' => UploadedFile::fake()->image('logo.png', 200, 200),
    ]);

    // ASSERT — nada a aplicar: a resposta diz isso e a trilha não ganha linha de configuração
    $resposta->assertCreated();
    expect($resposta->json('identidade_aplicada'))->toBeFalse();
    expect(app(ConfiguracaoService::class)->get('clinica.identidade'))->toBe('logo');
    expect(Auditoria::where('entidade', 'configuracoes')->count())->toBe($trilhaAntes);
});

it('deve manter a escolha ao REMOVER a logo', function () {
    // ARRANGE — a clínica pode estar trocando de arquivo; reverter apagaria uma decisão dela
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica)->post('/api/clinica/logo', [
        'arquivo' => UploadedFile::fake()->image('logo.png', 200, 200),
    ])->assertCreated();

    // ACT
    $this->actingAs($adminDaClinica)->delete('/api/clinica/logo')->assertNoContent();

    // ASSERT — sem arquivo, mas com a escolha de pé (a tela avisa e a barra cai para o nome)
    expect(app(ConfiguracaoService::class)->get('clinica.identidade'))->toBe('logo');
    expect(Clinica::atual()->logo_path)->toBeNull();
});

// ── Tema de cores (change tema-da-clinica) ───────────────────────────────────────────────────

it('deve nascer no tema Padrão e entregá-lo na marca do /me', function () {
    // ARRANGE — nenhum deploy troca a cor de ninguém
    $adminDaClinica = admin();

    // ACT
    $me = $this->actingAs($adminDaClinica)->getJson('/api/me');

    // ASSERT
    $me->assertOk()->assertJsonPath('marca.tema', 'padrao');
});

it('deve entregar o tema da clínica a usuário sem configuracoes.ver', function () {
    // ARRANGE — a cor é do shell, que é de todo usuário autenticado
    $adminDaClinica = admin();
    $recepcao = usuarioCom([], 'Recepção Fictícia Sem Permissões');
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.tema',
        'valor' => 'menta',
    ])->assertOk();
    $this->flushSession();
    $this->app['auth']->forgetGuards();

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/me');

    // ASSERT
    $resposta->assertOk()->assertJsonPath('marca.tema', 'menta');
});

it('deve recusar o valor antigo do tema menta — nenhum tema leva o nome de uma clínica', function () {
    // ARRANGE — change tema-menta: o tema verde-água e rosa virou `menta`
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.tema',
        'valor' => 'neurokids',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('valor');
});

it('deve recusar tema fora das opções sem mudar o efetivo', function () {
    // ARRANGE — a paleta é curadoria: tema que o design system não conhece não existe
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.tema',
        'valor' => 'rosa-choque',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('valor');
    expect(app(ConfiguracaoService::class)->get('clinica.tema'))->toBe('padrao');
});

it('deve aceitar o tema Xclinicas e entregá-lo na marca do /me', function () {
    // ARRANGE — a marca do produto é opção de TODA clínica (change tema-xclinicas)
    $adminDaClinica = admin();

    // ACT
    $gravacao = $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.tema',
        'valor' => 'xclinicas',
    ]);
    $me = $this->actingAs($adminDaClinica)->getJson('/api/me');

    // ASSERT
    $gravacao->assertOk();
    $me->assertOk()->assertJsonPath('marca.tema', 'xclinicas');
});
