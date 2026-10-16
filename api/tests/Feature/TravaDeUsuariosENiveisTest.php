<?php

use App\Models\AprovacaoDeAcesso;
use App\Models\NivelPermissao;
use App\Models\Profissional;
use App\Models\Usuario;
use App\Support\Rbac\PermissaoCatalogo;
use App\Support\Rbac\SegregacaoFinanceira;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Change `trava-de-usuarios-e-niveis` (fecha o `SEC-USR-EDITA-ADMIN`): ninguém concede, tira ou usa
 * acesso que não tem — medido pelas permissões, não pelo nome do nível. Dados 100% fictícios.
 *
 * Todo nível e todo usuário nascem ANTES do 1º request: depois dele o `auth:sanctum` troca o guard
 * default, e um papel criado por nome nasceria no guard errado.
 */

/** Um nível da clínica com as permissões dadas. */
function nivelDaTrava(string $nome, array $permissoes): NivelPermissao
{
    $nivel = NivelPermissao::create(['name' => $nome, 'guard_name' => 'web']);
    $nivel->givePermissionTo($permissoes);

    return $nivel;
}

/** Um usuário da clínica no nível dado. */
function usuarioDaTrava(NivelPermissao $nivel, string $nome = 'Pessoa Fictícia'): Usuario
{
    $usuario = Usuario::factory()->create(['nome' => $nome]);
    $usuario->syncRoles([$nivel]);
    trocarDeUsuario();

    return $usuario;
}

/** Mais um usuário no nível Administrador de fábrica. */
function outroAdministradorDaTrava(): Usuario
{
    return usuarioDaTrava(NivelPermissao::query()->where('name', 'Administrador')->firstOrFail(), 'Outra Administradora Fictícia');
}

/** A recepção: gere usuários e níveis, mas não tem o caixa nem o resto do Administrador. */
function recepcaoDaTrava(string $nome = 'Recepção da Trava'): Usuario
{
    return usuarioDaTrava(nivelDaTrava($nome, [
        'usuarios.ver', 'usuarios.editar', 'niveis_permissao.ver', 'niveis_permissao.criar', 'niveis_permissao.editar',
        'configuracoes.ver', 'configuracoes.editar', 'agenda.ver',
    ]), $nome);
}

// ─── Usuários ─────────────────────────────────────────────────────────────────────────

it('deve recusar à recepção trocar a senha ou o e-mail de uma administradora', function (array $corpo) {
    // ARRANGE — o vetor do SEC-USR-EDITA-ADMIN: trocar a senha e entrar como ela
    $administradora = admin();
    $emailOriginal = $administradora->email;
    $recepcao = recepcaoDaTrava();

    // ACT
    $resposta = $this->actingAs($recepcao)->putJsonComVersao("/api/usuarios/{$administradora->id}", $corpo);

    // ASSERT
    $resposta->assertForbidden();
    $depois = $administradora->fresh();
    expect($depois->email)->toBe($emailOriginal)
        ->and(Hash::check('senha-da-recepcao-1', $depois->senha_hash))->toBeFalse();
})->with([
    'senha' => [['senha' => 'senha-da-recepcao-1']],
    'e-mail' => [['email' => 'recepcao-ficticia@exemplo.com.br']],
    'corpo inválido (o 403 vem antes do 422)' => [['email' => 'não é e-mail']],
]);

it('deve recusar à recepção desativar uma administradora, mesmo havendo outra', function () {
    // ARRANGE — com duas administradoras, a guarda do último admin não seguraria
    $administradora = admin();
    outroAdministradorDaTrava();
    $recepcao = recepcaoDaTrava();

    // ACT
    $resposta = $this->actingAs($recepcao)->putJsonComVersao("/api/usuarios/{$administradora->id}", ['ativo' => false]);

    // ASSERT
    $resposta->assertForbidden();
    expect($administradora->fresh()->ativo)->toBeTrue();
});

it('deve deixar a recepção editar quem está dentro do acesso dela, e a si mesma', function () {
    // ARRANGE — uma terapeuta que só vê a agenda
    admin();
    $terapeuta = usuarioDaTrava(nivelDaTrava('Só agenda', ['agenda.ver']), 'Terapeuta Fictícia');
    $recepcao = recepcaoDaTrava();

    // ACT
    $daTerapeuta = $this->actingAs($recepcao)->putJsonComVersao("/api/usuarios/{$terapeuta->id}", ['senha' => 'senha-nova-forte-1']);
    $daPropria = $this->actingAs($recepcao)->putJsonComVersao("/api/usuarios/{$recepcao->id}", ['senha' => 'senha-propria-forte-1']);

    // ASSERT
    $daTerapeuta->assertOk();
    $daPropria->assertOk();
    expect(Hash::check('senha-nova-forte-1', $terapeuta->fresh()->senha_hash))->toBeTrue()
        ->and(Hash::check('senha-propria-forte-1', $recepcao->fresh()->senha_hash))->toBeTrue();
});

// ─── Níveis ───────────────────────────────────────────────────────────────────────────

it('deve recusar à recepção dar ao próprio nível uma permissão que ela não tem', function () {
    // ARRANGE
    admin();
    $recepcao = recepcaoDaTrava();
    $nivel = $recepcao->roles->first();
    $antes = $nivel->permissions()->pluck('name')->sort()->values()->all();

    // ACT
    $resposta = $this->actingAs($recepcao)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => $nivel->name, 'permissoes' => [...$antes, 'fluxo_caixa.ver'],
    ]);

    // ASSERT
    $resposta->assertForbidden();
    expect($nivel->permissions()->pluck('name')->sort()->values()->all())->toBe($antes);
});

it('deve recusar à recepção mexer no nível Administrador, até para tirar', function () {
    // ARRANGE — tirar do Administrador também é mexer em acesso que ela não tem
    admin();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $recepcao = recepcaoDaTrava();

    // ACT
    $resposta = $this->actingAs($recepcao)->putJsonComVersao("/api/niveis-permissao/{$administrador->id}", [
        'nome' => 'Administrador', 'permissoes' => ['agenda.ver'],
    ]);

    // ASSERT
    $resposta->assertForbidden();
    expect($administrador->permissions()->count())->toBe(count(PermissaoCatalogo::PERMISSOES));
});

it('deve recusar à recepção criar um nível com permissão que ela não tem', function () {
    // ARRANGE
    admin();
    $recepcao = recepcaoDaTrava();

    // ACT
    $resposta = $this->actingAs($recepcao)->postJson('/api/niveis-permissao', [
        'nome' => 'Nível Fictício', 'permissoes' => ['agenda.ver', 'fluxo_caixa.ver'],
    ]);

    // ASSERT
    $resposta->assertForbidden();
    expect(NivelPermissao::query()->where('name', 'Nível Fictício')->exists())->toBeFalse();
});

it('deve manter o 422 para um nome de permissão que não existe', function () {
    // ARRANGE — a régua só olha o catálogo: o nome inventado é erro de validação, não de acesso
    admin();
    $recepcao = recepcaoDaTrava();

    // ACT
    $resposta = $this->actingAs($recepcao)->postJson('/api/niveis-permissao', [
        'nome' => 'Nível Fictício', 'permissoes' => ['agenda.ver', 'permissao.inventada'],
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('permissoes.1');
});

// ─── Atribuição ───────────────────────────────────────────────────────────────────────

it('deve recusar à recepção promover alguém, ou a si mesma, a Administrador', function (bool $aSiMesma) {
    // ARRANGE
    admin();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $terapeuta = usuarioDaTrava(nivelDaTrava('Só agenda', ['agenda.ver']), 'Terapeuta Fictícia');
    $recepcao = recepcaoDaTrava();
    $alvo = $aSiMesma ? $recepcao : $terapeuta;
    $nivelAntes = $alvo->roles->first()->id;

    // ACT
    $resposta = $this->actingAs($recepcao)->putJson("/api/usuarios/{$alvo->id}/nivel-permissao", ['nivel_permissao_id' => $administrador->id]);

    // ASSERT
    $resposta->assertForbidden();
    expect($alvo->fresh()->roles->first()->id)->toBe($nivelAntes);
})->with(['a outra pessoa' => false, 'a si mesma' => true]);

it('deve recusar à recepção rebaixar uma administradora', function () {
    // ARRANGE — o nível de destino está dentro do acesso dela; quem está acima é o alvo
    $administradora = admin();
    outroAdministradorDaTrava();
    $soAgenda = nivelDaTrava('Só agenda', ['agenda.ver']);
    $recepcao = recepcaoDaTrava();

    // ACT
    $resposta = $this->actingAs($recepcao)->putJson("/api/usuarios/{$administradora->id}/nivel-permissao", ['nivel_permissao_id' => $soAgenda->id]);

    // ASSERT
    $resposta->assertForbidden();
    expect($administradora->fresh()->roles->first()->name)->toBe('Administrador');
});

it('deve deixar a administradora criar, editar e atribuir níveis como antes', function () {
    // ARRANGE
    $administradora = admin();
    $terapeuta = usuarioDaTrava(nivelDaTrava('Só agenda', ['agenda.ver']), 'Terapeuta Fictícia');

    // ACT
    $this->actingAs($administradora);
    $criado = $this->postJson('/api/niveis-permissao', ['nome' => 'Caixa Fictício', 'permissoes' => ['fluxo_caixa.ver']]);
    $editado = $this->putJsonComVersao('/api/niveis-permissao/'.$criado->json('id'), ['nome' => 'Caixa Fictício', 'permissoes' => ['fluxo_caixa.ver', 'lancamentos.ver']]);
    $atribuido = $this->putJson("/api/usuarios/{$terapeuta->id}/nivel-permissao", ['nivel_permissao_id' => $criado->json('id')]);

    // ASSERT
    $criado->assertCreated();
    $editado->assertOk();
    $atribuido->assertOk();
    expect($terapeuta->fresh()->getAllPermissions()->pluck('name')->sort()->values()->all())->toBe(['fluxo_caixa.ver', 'lancamentos.ver']);
});

it('deve manter as permissões do banco iguais ao catálogo do código', function () {
    // ARRANGE + ACT — o Administrador de fábrica recebe todas as do banco; isto prova banco ==
    // catálogo, não a migration `conceder_*` de uma permissão nova (CR-TRV-09, gatilho SEC-TRV-06)
    $administradora = admin();

    // ASSERT
    expect($administradora->getAllPermissions()->pluck('name')->sort()->values()->all())
        ->toBe(collect(PermissaoCatalogo::PERMISSOES)->sort()->values()->all());
});

// ─── Aprovação dupla ──────────────────────────────────────────────────────────────────

/** Liga a aprovação dupla pelo caminho real (a administradora tem quórum com a outra). */
function ligarADuplaDaTrava(Usuario $administradora): void
{
    test()->actingAs($administradora)
        ->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => true])
        ->assertOk();
    trocarDeUsuario();
}

it('deve recusar a uma recepcionista abrir o pedido de pôr a outra no Administrador', function () {
    // ARRANGE — duas recepcionistas com o módulo de níveis aprovariam uma à outra
    $administradora = admin();
    outroAdministradorDaTrava();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $primeira = recepcaoDaTrava('Recepção Um');
    $segunda = recepcaoDaTrava('Recepção Dois');
    ligarADuplaDaTrava($administradora);

    // ACT
    $resposta = $this->actingAs($primeira)->putJson("/api/usuarios/{$segunda->id}/nivel-permissao", ['nivel_permissao_id' => $administrador->id]);

    // ASSERT
    $resposta->assertForbidden();
    expect(AprovacaoDeAcesso::count())->toBe(0);
});

it('deve recusar a aprovação de quem não tem o acesso em jogo, e deixar a outra administradora aprovar', function () {
    // ARRANGE — a administradora pede fluxo_caixa.ver para um nível; a recepção não o tem
    $administradora = admin();
    $outra = outroAdministradorDaTrava();
    $alvo = nivelDaTrava('Alvo Fictício', ['agenda.ver']);
    $recepcao = recepcaoDaTrava();
    ligarADuplaDaTrava($administradora);
    $this->actingAs($administradora)->putJsonComVersao("/api/niveis-permissao/{$alvo->id}", [
        'nome' => 'Alvo Fictício', 'permissoes' => ['agenda.ver', 'fluxo_caixa.ver'],
    ])->assertStatus(202);
    $pendencia = AprovacaoDeAcesso::firstOrFail()->id;
    trocarDeUsuario();

    // ACT
    $daRecepcao = $this->actingAs($recepcao)->postJson("/api/aprovacoes-de-acesso/{$pendencia}/aprovar");
    trocarDeUsuario();
    $daOutra = $this->actingAs($outra)->postJson("/api/aprovacoes-de-acesso/{$pendencia}/aprovar");

    // ASSERT — a recusa deixou a pendência pendente; a administradora aplicou
    $daRecepcao->assertForbidden();
    $daOutra->assertOk();
    expect(AprovacaoDeAcesso::find($pendencia)->status)->toBe('aprovada')
        ->and(AprovacaoDeAcesso::find($pendencia)->decidido_por_id)->toBe($outra->id)
        ->and($alvo->permissions()->pluck('name')->sort()->values()->all())->toBe(['agenda.ver', 'fluxo_caixa.ver']);
});

it('deve recusar à recepção aprovar a promoção de alguém a Administrador', function () {
    // ARRANGE — a administradora pede; a recepção, com o módulo de níveis, não tem o que aprova
    $administradora = admin();
    outroAdministradorDaTrava();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $terapeuta = usuarioDaTrava(nivelDaTrava('Só agenda', ['agenda.ver']), 'Terapeuta Fictícia');
    $recepcao = recepcaoDaTrava();
    ligarADuplaDaTrava($administradora);
    $this->actingAs($administradora)->putJson("/api/usuarios/{$terapeuta->id}/nivel-permissao", ['nivel_permissao_id' => $administrador->id])
        ->assertStatus(202);
    $pendencia = AprovacaoDeAcesso::firstOrFail()->id;
    trocarDeUsuario();

    // ACT
    $resposta = $this->actingAs($recepcao)->postJson("/api/aprovacoes-de-acesso/{$pendencia}/aprovar");

    // ASSERT
    $resposta->assertForbidden();
    expect(AprovacaoDeAcesso::find($pendencia)->status)->toBe('pendente')
        ->and($terapeuta->fresh()->roles->first()->name)->toBe('Só agenda');
});

// ─── Configurações de segurança ───────────────────────────────────────────────────────

it('deve recusar a quem só edita configurações mexer na segurança, sem abrir pedido', function (string $chave) {
    // ARRANGE — com a dupla ligada, desligar viraria pendência; sem administrar acesso, nem isso
    $administradora = admin();
    outroAdministradorDaTrava();
    $configura = usuarioDaTrava(nivelDaTrava('Configura', ['configuracoes.ver', 'configuracoes.editar']), 'Configuradora Fictícia');
    ligarADuplaDaTrava($administradora);

    // ACT
    $seguranca = $this->actingAs($configura)->putJson('/api/configuracoes', ['chave' => $chave, 'valor' => false]);
    $nome = $this->actingAs($configura)->putJson('/api/configuracoes', ['chave' => 'clinica.nome', 'valor' => 'Clínica Fictícia']);

    // ASSERT
    $seguranca->assertForbidden();
    $nome->assertOk();
    expect(AprovacaoDeAcesso::count())->toBe(0);
})->with(['aprovação dupla' => 'seguranca.aprovacao_dupla', 'segregação financeira' => 'seguranca.segregacao_financeira']);

// ─── Rodada 1 do gate (SEC-TRV-01/02/04, CR-TRV-01/02/06) ──────────────────────────────

it('deve responder 404 ao id da rota com sufixo, sem passar pela régua por fora', function (string $porta) {
    // ARRANGE — SEC-TRV-01: a régua não achava `1abc` e passava; o controller editava o 1
    $administradora = admin();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $recepcao = recepcaoDaTrava();
    [$caminho, $corpo] = $porta === 'usuário'
        ? ["/api/usuarios/{$administradora->id}abc", ['senha' => 'senha-da-recepcao-1']]
        : ["/api/niveis-permissao/{$administrador->id}abc", ['nome' => 'Administrador', 'permissoes' => ['agenda.ver']]];

    // ACT
    $resposta = $this->actingAs($recepcao)->putJsonComVersao($caminho, $corpo);

    // ASSERT
    $resposta->assertNotFound();
    expect(Hash::check('senha-da-recepcao-1', $administradora->fresh()->senha_hash))->toBeFalse()
        ->and($administrador->permissions()->count())->toBe(count(PermissaoCatalogo::PERMISSOES));
})->with(['usuário', 'nível']);

it('deve recusar a quem não vê a clínica inteira pôr ou trocar um vínculo com profissional', function (string $caso) {
    // ARRANGE — SEC-TRV-02: o vínculo é escopo; sem `clinico.ver_todos`, vincular-se a outro
    // profissional abria o prontuário das crianças dele
    admin();
    $outro = Profissional::factory()->create();
    $gestor = usuarioDaTrava(nivelDaTrava('Gestão sem prontuário', [
        'usuarios.ver', 'usuarios.criar', 'usuarios.editar', 'agenda.ver', 'agenda.ver_todos',
    ]), 'Gestora Fictícia');

    // ACT
    $resposta = $caso === 'o próprio'
        ? $this->actingAs($gestor)->putJsonComVersao("/api/usuarios/{$gestor->id}", ['profissional_id' => $outro->id])
        : $this->actingAs($gestor)->postJson('/api/usuarios', [
            'nome' => 'Nova Fictícia', 'email' => 'nova-ficticia@exemplo.com.br', 'senha' => 'senha-nova-forte-1',
            'profissional_id' => $outro->id,
        ]);

    // ASSERT
    $resposta->assertForbidden();
    expect($gestor->fresh()->profissional_id)->toBeNull()
        ->and(Usuario::where('email', 'nova-ficticia@exemplo.com.br')->exists())->toBeFalse();
})->with(['o próprio', 'um usuário novo']);

it('deve deixar desvincular, e deixar a administradora vincular', function () {
    // ARRANGE — tirar escopo não pede nada; dar escopo pede a clínica inteira, que a administradora tem
    $administradora = admin();
    $profissional = Profissional::factory()->create();
    $vinculada = usuarioDaTrava(nivelDaTrava('Só agenda', ['agenda.ver']), 'Terapeuta Fictícia');
    $vinculada->update(['profissional_id' => Profissional::factory()->create()->id]);
    $gestor = usuarioDaTrava(nivelDaTrava('Gestão', ['usuarios.ver', 'usuarios.editar', 'agenda.ver', 'agenda.ver_todos', 'clinico.ver_todos']), 'Gestora Fictícia');
    $semVinculo = usuarioDaTrava(nivelDaTrava('Só agenda dois', ['agenda.ver']), 'Outra Terapeuta');

    // ACT
    $desvinculo = $this->actingAs($gestor)->putJsonComVersao("/api/usuarios/{$vinculada->id}", ['profissional_id' => null]);
    trocarDeUsuario();
    $vinculo = $this->actingAs($administradora)->putJsonComVersao("/api/usuarios/{$semVinculo->id}", ['profissional_id' => $profissional->id]);

    // ASSERT
    $desvinculo->assertOk();
    $vinculo->assertOk();
    expect($vinculada->fresh()->profissional_id)->toBeNull()
        ->and($semVinculo->fresh()->profissional_id)->toBe($profissional->id);
});

it('deve recusar a quem só alcança o próprio profissional editar o colega de outro profissional', function () {
    // ARRANGE — SEC-TRV-02: sem `*.ver_todos`, a gestora vinculada à A trocava a senha da colega da B.
    // Um profissional tem um usuário só: o colega "do mesmo" não existe, e o sem vínculo não alcança nada
    admin();
    [$daA, $daB] = [Profissional::factory()->create(), Profissional::factory()->create()];
    $soAgenda = nivelDaTrava('Só agenda', ['agenda.ver']);
    $colegaDaB = usuarioDaTrava($soAgenda, 'Colega da B');
    $colegaDaB->update(['profissional_id' => $daB->id]);
    $semVinculo = usuarioDaTrava($soAgenda, 'Colega sem vínculo');
    $gestora = usuarioDaTrava(nivelDaTrava('Gestão escopada', ['usuarios.ver', 'usuarios.editar', 'agenda.ver']), 'Gestora Escopada');
    $gestora->update(['profissional_id' => $daA->id]);

    // ACT
    $daOutra = $this->actingAs($gestora)->putJsonComVersao("/api/usuarios/{$colegaDaB->id}", ['senha' => 'senha-da-gestora-1']);
    $doSemVinculo = $this->actingAs($gestora)->putJsonComVersao("/api/usuarios/{$semVinculo->id}", ['senha' => 'senha-da-gestora-1']);

    // ASSERT
    $daOutra->assertForbidden();
    $doSemVinculo->assertOk();
    expect(Hash::check('senha-da-gestora-1', $colegaDaB->fresh()->senha_hash))->toBeFalse();
});

it('deve recusar à recepção editar quem uma pendência está para promover', function (string $pendencia) {
    // ARRANGE — CR-TRV-01: a recepção trocava a senha da Nova enquanto a promoção esperava, e a
    // aprovação entregava a conta promovida a ela
    $administradora = admin();
    outroAdministradorDaTrava();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $soAgenda = nivelDaTrava('Só agenda', ['agenda.ver']);
    $nova = usuarioDaTrava($soAgenda, 'Nova Fictícia');
    $recepcao = recepcaoDaTrava();
    ligarADuplaDaTrava($administradora);
    $this->actingAs($administradora);
    $pendencia === 'atribuir_nivel'
        ? $this->putJson("/api/usuarios/{$nova->id}/nivel-permissao", ['nivel_permissao_id' => $administrador->id])->assertStatus(202)
        : $this->putJsonComVersao("/api/niveis-permissao/{$soAgenda->id}", ['nome' => 'Só agenda', 'permissoes' => ['agenda.ver', 'fluxo_caixa.ver']])->assertStatus(202);
    trocarDeUsuario();

    // ACT
    $resposta = $this->actingAs($recepcao)->putJsonComVersao("/api/usuarios/{$nova->id}", ['senha' => 'senha-da-recepcao-1']);

    // ASSERT
    $resposta->assertForbidden();
    expect(Hash::check('senha-da-recepcao-1', $nova->fresh()->senha_hash))->toBeFalse();
})->with(['atribuir_nivel', 'editar_nivel']);

it('deve recusar à recepção aprovar o que tira acesso que ela não tem', function (string $pendencia) {
    // ARRANGE — CR-TRV-02: o "estado ATUAL" do decisor — o nível de hoje e o usuário de hoje
    $administradora = admin();
    $outra = outroAdministradorDaTrava();
    $soAgenda = nivelDaTrava('Só agenda', ['agenda.ver']);
    $caixa = nivelDaTrava('Caixa', ['agenda.ver', 'fluxo_caixa.ver']);
    $recepcao = recepcaoDaTrava();
    ligarADuplaDaTrava($administradora);
    $this->actingAs($administradora);
    $pendencia === 'rebaixar uma administradora'
        ? $this->putJson("/api/usuarios/{$outra->id}/nivel-permissao", ['nivel_permissao_id' => $soAgenda->id])->assertStatus(202)
        : $this->putJsonComVersao("/api/niveis-permissao/{$caixa->id}", ['nome' => 'Caixa', 'permissoes' => ['agenda.ver']])->assertStatus(202);
    $id = AprovacaoDeAcesso::firstOrFail()->id;
    trocarDeUsuario();

    // ACT
    $resposta = $this->actingAs($recepcao)->postJson("/api/aprovacoes-de-acesso/{$id}/aprovar");

    // ASSERT
    $resposta->assertForbidden();
    expect(AprovacaoDeAcesso::find($id)->status)->toBe('pendente')
        ->and($outra->fresh()->roles->first()->name)->toBe('Administrador')
        ->and($caixa->permissions()->pluck('name')->sort()->values()->all())->toBe(['agenda.ver', 'fluxo_caixa.ver']);
})->with(['rebaixar uma administradora', 'tirar o caixa de um nível']);

it('deve recusar à recepção trocar o nível de quem uma pendência está para promover', function () {
    // ARRANGE — a atribuição também mede o que a pendência está para dar (CR-TRV-01)
    $administradora = admin();
    outroAdministradorDaTrava();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $nova = usuarioDaTrava(nivelDaTrava('Só agenda', ['agenda.ver']), 'Nova Fictícia');
    $outroNivel = nivelDaTrava('Só agenda dois', ['agenda.ver']);
    $recepcao = recepcaoDaTrava();
    ligarADuplaDaTrava($administradora);
    $this->actingAs($administradora)->putJson("/api/usuarios/{$nova->id}/nivel-permissao", ['nivel_permissao_id' => $administrador->id])
        ->assertStatus(202);
    trocarDeUsuario();

    // ACT
    $resposta = $this->actingAs($recepcao)->putJson("/api/usuarios/{$nova->id}/nivel-permissao", ['nivel_permissao_id' => $outroNivel->id]);

    // ASSERT — nem pedido novo: só a pendência da administradora
    $resposta->assertForbidden();
    expect(AprovacaoDeAcesso::count())->toBe(1);
});

it('deve recusar a quem só alcança o próprio profissional trocar o nível do colega de outro', function () {
    // ARRANGE — SEC-TRV-02 na atribuição: o nível novo cabe no dela, mas o colega está fora do alcance
    admin();
    [$daA, $daB] = [Profissional::factory()->create(), Profissional::factory()->create()];
    $soAgenda = nivelDaTrava('Só agenda', ['agenda.ver']);
    $outroNivel = nivelDaTrava('Só agenda dois', ['agenda.ver']);
    $colegaDaB = usuarioDaTrava($soAgenda, 'Colega da B');
    $colegaDaB->update(['profissional_id' => $daB->id]);
    $gestora = usuarioDaTrava(nivelDaTrava('Gestão escopada', ['niveis_permissao.ver', 'niveis_permissao.editar', 'agenda.ver']), 'Gestora Escopada');
    $gestora->update(['profissional_id' => $daA->id]);

    // ACT
    $resposta = $this->actingAs($gestora)->putJson("/api/usuarios/{$colegaDaB->id}/nivel-permissao", ['nivel_permissao_id' => $outroNivel->id]);

    // ASSERT
    $resposta->assertForbidden();
    expect($colegaDaB->fresh()->roles->first()->name)->toBe('Só agenda');
});

it('deve dizer na lista de pendências quem pode aprovar cada uma', function () {
    // ARRANGE — CR-TRV-06: a tela só oferece "Aprovar" a quem passaria na régua
    $administradora = admin();
    $outra = outroAdministradorDaTrava();
    $caixa = nivelDaTrava('Caixa', ['agenda.ver']);
    $recepcao = recepcaoDaTrava();
    ligarADuplaDaTrava($administradora);
    $this->actingAs($administradora)
        ->putJsonComVersao("/api/niveis-permissao/{$caixa->id}", ['nome' => 'Caixa', 'permissoes' => ['agenda.ver', 'fluxo_caixa.ver']])
        ->assertStatus(202);
    trocarDeUsuario();

    // ACT
    $daRecepcao = $this->actingAs($recepcao)->getJson('/api/aprovacoes-de-acesso')->json('0.voce_pode_aprovar');
    trocarDeUsuario();
    $daOutra = $this->actingAs($outra)->getJson('/api/aprovacoes-de-acesso')->json('0.voce_pode_aprovar');

    // ASSERT
    expect($daRecepcao)->toBeFalse()->and($daOutra)->toBeTrue();
});

it('deve recusar com 422 uma permissão com a caixa trocada, sem estourar', function () {
    // ARRANGE — SEC-TRV-04: o `exists` do banco não diferencia maiúsculas, e o Spatie estourava 500
    $administradora = admin();

    // ACT
    $resposta = $this->actingAs($administradora)->postJson('/api/niveis-permissao', [
        'nome' => 'Nível Fictício', 'permissoes' => ['FLUXO_CAIXA.VER'],
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('permissoes.0');
});

// ─── Rodada 2 do gate (CR-TRV-15/16/17/18/19/21) ──────────────────────────────────────

it('deve recusar à recepção editar quem vai ganhar o caixa por duas pendências encadeadas', function () {
    // ARRANGE — CR-TRV-15: a Nova vai para o nível L, e outra pendência dá o caixa a L
    $administradora = admin();
    outroAdministradorDaTrava();
    $nova = usuarioDaTrava(nivelDaTrava('Nada', []), 'Nova Fictícia');
    $nivelL = nivelDaTrava('Nível L', ['agenda.ver']);
    $recepcao = recepcaoDaTrava();
    ligarADuplaDaTrava($administradora);
    $this->actingAs($administradora);
    $this->putJson("/api/usuarios/{$nova->id}/nivel-permissao", ['nivel_permissao_id' => $nivelL->id])->assertStatus(202);
    $this->putJsonComVersao("/api/niveis-permissao/{$nivelL->id}", ['nome' => 'Nível L', 'permissoes' => ['agenda.ver', 'fluxo_caixa.ver']])->assertStatus(202);
    trocarDeUsuario();

    // ACT
    $resposta = $this->actingAs($recepcao)->putJsonComVersao("/api/usuarios/{$nova->id}", ['senha' => 'senha-da-recepcao-1']);

    // ASSERT
    $resposta->assertForbidden();
    expect(Hash::check('senha-da-recepcao-1', $nova->fresh()->senha_hash))->toBeFalse();
});

it('deve deixar a pessoa trocar a própria senha mesmo com uma pendência que a promove', function () {
    // ARRANGE — CR-TRV-16: o próprio usuário passa sempre
    $administradora = admin();
    outroAdministradorDaTrava();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $recepcao = recepcaoDaTrava();
    ligarADuplaDaTrava($administradora);
    $this->actingAs($administradora)->putJson("/api/usuarios/{$recepcao->id}/nivel-permissao", ['nivel_permissao_id' => $administrador->id])
        ->assertStatus(202);
    trocarDeUsuario();

    // ACT
    $resposta = $this->actingAs($recepcao)->putJsonComVersao("/api/usuarios/{$recepcao->id}", ['senha' => 'senha-propria-forte-1']);

    // ASSERT
    $resposta->assertOk();
    expect(Hash::check('senha-propria-forte-1', $recepcao->fresh()->senha_hash))->toBeTrue();
});

it('deve responder 422, não 500, a um vínculo que não é um id', function (string $porta) {
    // ARRANGE — CR-TRV-17: `(string) [1]` estourava antes da validação
    $administradora = admin();
    $alvo = usuarioDaTrava(nivelDaTrava('Só agenda', ['agenda.ver']), 'Terapeuta Fictícia');

    // ACT
    $this->actingAs($administradora);
    $resposta = $porta === 'edição'
        ? $this->putJsonComVersao("/api/usuarios/{$alvo->id}", ['profissional_id' => [1]])
        : $this->postJson('/api/usuarios', [
            'nome' => 'Nova Fictícia', 'email' => 'nova-ficticia@exemplo.com.br', 'senha' => 'senha-nova-forte-1',
            'profissional_id' => ['a' => 1],
        ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
})->with(['edição', 'criação']);

it('deve deixar quem só alcança o próprio profissional se editar, reenviando o mesmo vínculo', function () {
    // ARRANGE — CR-TRV-19: a tela reenvia o vínculo em todo salvamento; o de hoje não pede nada
    admin();
    $daA = Profissional::factory()->create();
    $terapeuta = usuarioDaTrava(nivelDaTrava('Terapeuta que se edita', ['usuarios.ver', 'usuarios.editar', 'agenda.ver']), 'Terapeuta Fictícia');
    $terapeuta->update(['profissional_id' => $daA->id]);

    // ACT
    $resposta = $this->actingAs($terapeuta)->putJsonComVersao("/api/usuarios/{$terapeuta->id}", [
        'nome' => 'Terapeuta Renomeada', 'profissional_id' => $daA->id,
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($terapeuta->fresh()->nome)->toBe('Terapeuta Renomeada');
});

it('deve deixar quem gere o acesso, sem o dinheiro, montar o nível do financeiro com a segregação ligada', function () {
    // ARRANGE — CR-TRV-21: com a segregação, o Administrador larga a escrita financeira (AP-13); sem
    // esta exceção, ninguém mais a concederia
    $administradora = admin();
    outroAdministradorDaTrava();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $semDinheiro = array_values(array_filter(PermissaoCatalogo::PERMISSOES, fn (string $p): bool => ! SegregacaoFinanceira::ehEscritaFinanceira($p)));
    $this->actingAs($administradora);
    $this->putJsonComVersao("/api/niveis-permissao/{$administrador->id}", ['nome' => 'Administrador', 'permissoes' => $semDinheiro])->assertOk();
    // a segregação só liga com a dupla ligada (CR-TRV-27)
    $this->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => true])->assertOk();
    $this->putJson('/api/configuracoes', ['chave' => 'seguranca.segregacao_financeira', 'valor' => true])->assertOk();

    // ACT
    $resposta = $this->postJson('/api/niveis-permissao', ['nome' => 'Financeiro Fictício', 'permissoes' => ['lancamentos.ver', 'lancamentos.pagar']]);

    // ASSERT
    $resposta->assertCreated();
});

it('deve continuar recusando a escrita financeira a quem não a tem, com a segregação desligada', function () {
    // ARRANGE — a exceção do CR-TRV-21 vale SÓ com a segregação ligada
    admin();
    $recepcao = recepcaoDaTrava();

    // ACT
    $resposta = $this->actingAs($recepcao)->postJson('/api/niveis-permissao', ['nome' => 'Financeiro Fictício', 'permissoes' => ['agenda.ver', 'lancamentos.pagar']]);

    // ASSERT
    $resposta->assertForbidden();
});

it('deve listar as pendências sem reler as permissões a cada linha', function () {
    // ARRANGE — CR-TRV-18: eram ~13 consultas por pendência
    $administradora = admin();
    $outra = outroAdministradorDaTrava();
    $niveis = collect(range(1, 6))->map(fn (int $n): NivelPermissao => nivelDaTrava("Nível {$n}", ['agenda.ver']));
    ligarADuplaDaTrava($administradora);
    $this->actingAs($administradora);
    $pedir = fn (NivelPermissao $nivel) => $this->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", ['nome' => $nivel->name, 'permissoes' => ['agenda.ver', 'pacientes.ver']])->assertStatus(202);
    $pedir($niveis[0]);
    trocarDeUsuario();
    $consultasDaLista = function () use ($outra): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->actingAs($outra)->getJson('/api/aprovacoes-de-acesso')->assertOk();
        DB::disableQueryLog();

        return count(DB::getQueryLog());
    };

    // ACT — com 1 pendência e com 6
    $comUma = $consultasDaLista();
    trocarDeUsuario();
    $this->actingAs($administradora);
    $niveis->slice(1)->each($pedir);
    trocarDeUsuario();
    $comSeis = $consultasDaLista();

    // ASSERT — cada pendência a mais custa poucas consultas, não a régua inteira de novo
    expect(($comSeis - $comUma) / 5)->toBeLessThanOrEqual(3);
});

it('deve conferir o vínculo mandado como decimal ou booleano', function (mixed $vinculo) {
    // ARRANGE — CR-TRV-22: a validação `integer` aceita `5.0` e `true`; a régua que só olhava int e
    // string os deixava passar, e a gestora se vinculava ao profissional e via as crianças dele
    admin();
    $profissional = Profissional::factory()->create();
    $gestora = usuarioDaTrava(nivelDaTrava('Gestão sem prontuário', ['usuarios.ver', 'usuarios.editar', 'agenda.ver', 'agenda.ver_todos']), 'Gestora Fictícia');

    // ACT — o corpo CRU: `putJson` passa por `json_encode`, que manda `1.0` como `1` (gate r4, CR-TRV-26)
    $corpo = $vinculo === 'o id em decimal'
        ? json_encode(['profissional_id' => (float) $profissional->id], JSON_PRESERVE_ZERO_FRACTION)
        : json_encode(['profissional_id' => true]);
    $resposta = $this->actingAs($gestora)->call('PUT', "/api/usuarios/{$gestora->id}", [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_ACCEPT' => 'application/json',
        'HTTP_IF_MATCH' => $gestora->fresh()->updated_at->toISOString(),
    ], $corpo);

    // ASSERT
    $resposta->assertForbidden();
    expect($gestora->fresh()->profissional_id)->toBeNull();
})->with(['o id em decimal', 'verdadeiro']);

it('deve recusar à gestora de acesso, com a segregação ligada, trocar a senha de quem mexe no dinheiro', function () {
    // ARRANGE — CR-TRV-28: a exceção da segregação é para MONTAR níveis; a credencial não passa pela
    // dupla, e trocar a senha da funcionária do financeiro levaria a gestora ao dinheiro
    $administradora = admin();
    outroAdministradorDaTrava();
    $financeiro = usuarioDaTrava(nivelDaTrava('Financeiro', ['lancamentos.ver', 'lancamentos.pagar']), 'Funcionária do Financeiro');
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $semDinheiro = array_values(array_filter(PermissaoCatalogo::PERMISSOES, fn (string $p): bool => ! SegregacaoFinanceira::ehEscritaFinanceira($p)));
    $this->actingAs($administradora);
    $this->putJsonComVersao("/api/niveis-permissao/{$administrador->id}", ['nome' => 'Administrador', 'permissoes' => $semDinheiro])->assertOk();
    $this->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => true])->assertOk();
    $this->putJson('/api/configuracoes', ['chave' => 'seguranca.segregacao_financeira', 'valor' => true])->assertOk();

    // ACT
    $resposta = $this->putJsonComVersao("/api/usuarios/{$financeiro->id}", ['senha' => 'senha-da-gestora-1']);

    // ASSERT
    $resposta->assertForbidden();
    expect(Hash::check('senha-da-gestora-1', $financeiro->fresh()->senha_hash))->toBeFalse();
});
