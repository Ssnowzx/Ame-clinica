<?php

use App\Models\NivelPermissao;
use App\Models\Profissional;
use App\Models\Usuario;
use App\Support\Rbac\PermissaoCatalogo;
use App\Support\Rbac\SegregacaoFinanceira;
use Database\Seeders\CatalogoPermissoesSeeder;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;
use Symfony\Component\Finder\Finder;

/**
 * A permissão `repasse.ver_proprio` (change painel-do-profissional, spec rbac): o profissional VINCULADO
 * vê o que recebeu pelos próprios atendimentos, e mais nada. Ela chega por deploy só ao Administrador; é
 * LEITURA para a segregação financeira; e quem gere níveis não a concede sem tê-la. Dados fictícios.
 */
const PERMISSAO_PROPRIA = 'repasse.ver_proprio';

/** Tira a permissão do Administrador, como numa clínica anterior à change. */
function administradorSemAPropria(): void
{
    $registrar = app(PermissionRegistrar::class);
    NivelPermissao::where('name', 'Administrador')->firstOrFail()
        ->syncPermissions(Permission::all()->reject(fn (Permission $p): bool => $p->name === PERMISSAO_PROPRIA));
    $registrar->forgetCachedPermissions();
}

/** A migration de deploy desta permissão, pelo `up()` do próprio arquivo. */
function migrationDaPropria(): object
{
    $arquivo = collect(iterator_to_array(
        Finder::create()->files()->in(dirname(__DIR__, 2).'/database/migrations')->name('*conceder_repasse_ver_proprio*.php')
    ))->first();
    expect($arquivo)->not->toBeNull();

    return require $arquivo->getPathname();
}

/** Um nível da clínica com as permissões dadas, e um usuário nele. */
function usuarioNoNivelDaPropria(string $nome, array $permissoes): Usuario
{
    $nivel = NivelPermissao::create(['name' => $nome, 'guard_name' => 'web']);
    $nivel->givePermissionTo($permissoes);
    $usuario = Usuario::factory()->create();
    $usuario->syncRoles([$nivel]);
    trocarDeUsuario();

    return $usuario;
}

it('deve entregar repasse.ver_proprio ao Administrador da clínica que já existia, pela MIGRATION', function () {
    // ARRANGE
    $administradora = admin();
    administradorSemAPropria();
    expect($administradora->fresh()->can(PERMISSAO_PROPRIA))->toBeFalse();

    // ACT — o corpo da migration de deploy (o `RefreshDatabase` já a rodou: `migrate` seria no-op)
    migrationDaPropria()->up();

    // ASSERT
    app(PermissionRegistrar::class)->forgetCachedPermissions();
    expect($administradora->fresh()->can(PERMISSAO_PROPRIA))->toBeTrue();
});

it('não deve dar repasse.ver_proprio por deploy a nenhum nível além do Administrador', function () {
    // ARRANGE — o nível dos profissionais, que a clínica criou, e o da recepção
    $administradora = admin();
    $profissionais = NivelPermissao::create(['name' => 'Profissionais Fictícios', 'guard_name' => 'web']);
    $profissionais->givePermissionTo(['agenda.ver', 'atendimentos.ver', 'evolucoes.ver', 'evolucoes.criar']);
    $recepcao = NivelPermissao::create(['name' => 'Recepção Fictícia', 'guard_name' => 'web']);
    $recepcao->givePermissionTo(['agenda.ver', 'pacientes.ver', 'repasse.ver']);
    $antes = [$profissionais->permissions->pluck('name')->sort()->values()->all(), $recepcao->permissions->pluck('name')->sort()->values()->all()];

    // ACT
    migrationDaPropria()->up();

    // ASSERT
    $registrar = app(PermissionRegistrar::class);
    $registrar->forgetCachedPermissions();
    expect([
        $profissionais->fresh()->permissions->pluck('name')->sort()->values()->all(),
        $recepcao->fresh()->permissions->pluck('name')->sort()->values()->all(),
    ])->toBe($antes);
});

it('deve estar no catálogo e no banco, e ser LEITURA para a segregação financeira', function () {
    // ARRANGE
    admin();
    (new CatalogoPermissoesSeeder)->run();

    // ACT
    $ehEscrita = SegregacaoFinanceira::ehEscritaFinanceira(PERMISSAO_PROPRIA);
    $violacoes = SegregacaoFinanceira::violacoes(['niveis_permissao.editar', PERMISSAO_PROPRIA, 'repasse.ver']);

    // ASSERT — ação nova de módulo financeiro continua nascendo escrita (fail-closed)
    expect(PermissaoCatalogo::PERMISSOES)->toContain(PERMISSAO_PROPRIA)
        ->and(Permission::where('name', PERMISSAO_PROPRIA)->exists())->toBeTrue()
        ->and($ehEscrita)->toBeFalse()
        ->and($violacoes)->toBe([])
        ->and(SegregacaoFinanceira::ehEscritaFinanceira('repasse.ver_tudo'))->toBeTrue();
});

/** O caminho real até a segregação ligada (Administrador sem escrita financeira, dupla, segregação). */
function ligarASegregacaoDaPropria(Usuario $administradora): void
{
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $segunda = Usuario::factory()->create();
    $segunda->syncRoles([$administrador]);
    $semEscrita = array_values(array_filter(PermissaoCatalogo::PERMISSOES, fn (string $p): bool => ! SegregacaoFinanceira::ehEscritaFinanceira($p)));
    test()->actingAs($administradora);
    test()->putJsonComVersao("/api/niveis-permissao/{$administrador->id}", ['nome' => 'Administrador', 'permissoes' => $semEscrita])->assertOk();
    test()->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => true])->assertOk();
    test()->putJson('/api/configuracoes', ['chave' => 'seguranca.segregacao_financeira', 'valor' => true])->assertOk();
    trocarDeUsuario();
}

it('deve deixar quem gere níveis, com a segregação ligada, montar um nível que lê o próprio recebido', function () {
    // ARRANGE — é leitura: o Administrador reorganizado a mantém, e ela não conflita com a âncora
    $administradora = admin();
    ligarASegregacaoDaPropria($administradora);

    // ACT
    $resposta = $this->actingAs($administradora)->postJson('/api/niveis-permissao', [
        'nome' => 'Profissionais com o Próprio Recebido', 'permissoes' => ['agenda.ver', PERMISSAO_PROPRIA, 'niveis_permissao.ver'],
    ]);

    // ASSERT
    $resposta->assertCreated();
    expect($administradora->fresh()->can(PERMISSAO_PROPRIA))->toBeTrue();
});

it('não deve deixar quem gere níveis conceder repasse.ver_proprio sem tê-la', function (bool $segregacaoLigada) {
    // ARRANGE — "ninguém concede o que não tem" vale para ela nos dois mundos: tratada como escrita
    // financeira, a segregação a tiraria do acesso em jogo e a gestora a daria sem tê-la
    $administradora = admin();
    $gestora = usuarioNoNivelDaPropria('Gestora de Acesso Fictícia', [
        'usuarios.ver', 'usuarios.editar', 'niveis_permissao.ver', 'niveis_permissao.criar', 'niveis_permissao.editar', 'agenda.ver',
    ]);
    if ($segregacaoLigada) {
        ligarASegregacaoDaPropria($administradora);
    }

    // ACT
    $resposta = $this->actingAs($gestora)->postJson('/api/niveis-permissao', [
        'nome' => 'Nível Fictício do Recebido', 'permissoes' => ['agenda.ver', PERMISSAO_PROPRIA],
    ]);

    // ASSERT
    $resposta->assertForbidden();
    expect(NivelPermissao::query()->where('name', 'Nível Fictício do Recebido')->exists())->toBeFalse();
})->with(['segregação desligada' => false, 'segregação ligada' => true]);

it('não deve abrir o relatório Recebido por profissional nem a lista de lançamentos', function () {
    // ARRANGE — vinculada, com a permissão própria: ela abre a FICHA, e só
    admin();
    $profissional = Profissional::factory()->create(['nome' => 'Profissional Fictícia do Recebido']);
    $propria = usuarioEscopadoEm($profissional, [PERMISSAO_PROPRIA]);

    // ACT
    $this->actingAs($propria);
    $relatorio = $this->getJson("/api/relatorios/recebido-por-profissional?de=2026-09-01&ate=2026-09-30&profissional_id={$profissional->id}");
    $lancamentos = $this->getJson('/api/lancamentos');

    // ASSERT
    $relatorio->assertForbidden();
    $lancamentos->assertForbidden();
});

// ─── SEC-PP-01 (gate r1): o vínculo escolhe de quem é o dinheiro ───────────────────────────────

/** Gere usuários e níveis, vê a clínica inteira e lê o PRÓPRIO recebido — sem a régua do relatório. */
const GESTAO_SEM_A_REGUA = [
    'usuarios.ver', 'usuarios.editar', 'niveis_permissao.ver', 'niveis_permissao.editar',
    'agenda.ver', 'agenda.ver_todos', 'clinico.ver_todos', 'profissionais.ver', PERMISSAO_PROPRIA,
];

/** As permissões do relatório "Recebido por profissional". */
const REGUA_DO_RECEBIDO = ['repasse.ver', 'lancamentos.ver', 'tratamentos.ver'];

it('não deve deixar quem lê o próprio recebido trocar o próprio vínculo pelo de uma colega — 403 antes de 422', function () {
    // ARRANGE — o repro do auditor: vinculada à Ana, com usuarios.editar e as flags de ver todos
    admin();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia do Vínculo']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia do Vínculo']);
    $gestora = usuarioNoNivelDaPropria('Gestora Vinculada Fictícia', GESTAO_SEM_A_REGUA);
    $gestora->update(['profissional_id' => $ana->id]);

    // ACT — com um e-mail inválido junto: a recusa de acesso vem antes da validação
    $resposta = $this->actingAs($gestora)->putJsonComVersao("/api/usuarios/{$gestora->id}", [
        'profissional_id' => $bia->id, 'email' => 'nao-e-email',
    ]);

    // ASSERT
    $resposta->assertForbidden();
    expect($gestora->fresh()->profissional_id)->toBe($ana->id)
        ->and($this->getJson("/api/profissionais/{$bia->id}/painel")->assertOk()->json())->not->toHaveKey('financeiro');
});

it('não deve deixar pôr ou trocar o vínculo de outro usuário que lê o próprio recebido', function (bool $jaVinculado) {
    // ARRANGE
    admin();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia do Vínculo']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia do Vínculo']);
    $gestora = usuarioNoNivelDaPropria('Gestora Fictícia', GESTAO_SEM_A_REGUA);
    $alvo = usuarioNoNivelDaPropria('Profissionais Fictícios', ['agenda.ver', PERMISSAO_PROPRIA]);
    $alvo->update(['profissional_id' => $jaVinculado ? $ana->id : null]);

    // ACT
    $resposta = $this->actingAs($gestora)->putJsonComVersao("/api/usuarios/{$alvo->id}", ['profissional_id' => $bia->id]);

    // ASSERT
    $resposta->assertForbidden();
    expect($alvo->fresh()->profissional_id)->toBe($jaVinculado ? $ana->id : null);
})->with(['trocar' => true, 'pôr' => false]);

it('deve deixar quem tem a régua do relatório trocar o vínculo de quem lê o próprio recebido', function () {
    // ARRANGE — quem já lê o recebido de todo profissional não ganha nada vinculando
    admin();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia do Vínculo']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia do Vínculo']);
    $gestora = usuarioNoNivelDaPropria('Gestora com a Régua', [...GESTAO_SEM_A_REGUA, ...REGUA_DO_RECEBIDO]);
    $alvo = usuarioNoNivelDaPropria('Profissionais Fictícios', ['agenda.ver', PERMISSAO_PROPRIA]);
    $alvo->update(['profissional_id' => $ana->id]);

    // ACT
    $resposta = $this->actingAs($gestora)->putJsonComVersao("/api/usuarios/{$alvo->id}", ['profissional_id' => $bia->id]);

    // ASSERT
    $resposta->assertOk();
    expect($alvo->fresh()->profissional_id)->toBe($bia->id);
});

it('não deve deixar trocar o vínculo de quem uma pendência vai dar o próprio recebido', function () {
    // ARRANGE — hoje o alvo só vê a agenda; a atribuição PENDENTE lhe dá o recebido próprio
    $administradora = admin();
    $outraAdministradora = Usuario::factory()->create();
    $outraAdministradora->syncRoles([NivelPermissao::query()->where('name', 'Administrador')->firstOrFail()]);
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia do Vínculo']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia do Vínculo']);
    $gestora = usuarioNoNivelDaPropria('Gestora Fictícia', GESTAO_SEM_A_REGUA);
    $alvo = usuarioNoNivelDaPropria('Só a Agenda Fictícia', ['agenda.ver']);
    $alvo->update(['profissional_id' => $ana->id]);
    $comORecebido = NivelPermissao::create(['name' => 'Profissionais Fictícios', 'guard_name' => 'web']);
    $comORecebido->givePermissionTo(['agenda.ver', PERMISSAO_PROPRIA]);
    $this->actingAs($administradora);
    $this->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => true])->assertOk();
    $this->putJson("/api/usuarios/{$alvo->id}/nivel-permissao", ['nivel_permissao_id' => $comORecebido->id])->assertStatus(202);
    trocarDeUsuario();

    // ACT
    $resposta = $this->actingAs($gestora)->putJsonComVersao("/api/usuarios/{$alvo->id}", ['profissional_id' => $bia->id]);

    // ASSERT
    $resposta->assertForbidden();
    expect($alvo->fresh()->profissional_id)->toBe($ana->id);
});

it('não deve deixar dar o próprio recebido, pela atribuição de nível, a quem está vinculado a uma colega', function (array $regua, int $esperado) {
    // ARRANGE — o desvio em dois passos: vincular uma conta SEM nível (a régua do vínculo não vê o
    // recebido) e atribuir-lhe depois o nível que o tem
    admin();
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia do Vínculo']);
    $gestora = usuarioNoNivelDaPropria('Gestora Fictícia '.count($regua), [...GESTAO_SEM_A_REGUA, ...$regua]);
    $alvo = Usuario::factory()->create(['profissional_id' => $bia->id]);
    $comORecebido = NivelPermissao::create(['name' => 'Profissionais Fictícios', 'guard_name' => 'web']);
    $comORecebido->givePermissionTo(['agenda.ver', PERMISSAO_PROPRIA]);

    // ACT
    $resposta = $this->actingAs($gestora)->putJson("/api/usuarios/{$alvo->id}/nivel-permissao", ['nivel_permissao_id' => $comORecebido->id]);

    // ASSERT
    $resposta->assertStatus($esperado);
    expect($alvo->fresh()->can(PERMISSAO_PROPRIA))->toBe($esperado === 200);
})->with([
    'sem a régua do relatório' => [[], 403],
    'com a régua do relatório' => [REGUA_DO_RECEBIDO, 200],
]);

it('não deve deixar pôr o próprio recebido num nível que tem gente vinculada a uma colega', function (bool $temVinculado, int $esperado) {
    // ARRANGE — o mesmo desvio pela edição do nível: a conta vinculada já está nele
    admin();
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia do Vínculo']);
    $gestora = usuarioNoNivelDaPropria('Gestora Fictícia', GESTAO_SEM_A_REGUA);
    $nivel = NivelPermissao::create(['name' => 'Equipe Fictícia', 'guard_name' => 'web']);
    $nivel->givePermissionTo(['agenda.ver']);
    $membro = Usuario::factory()->create(['profissional_id' => $temVinculado ? $bia->id : null]);
    $membro->syncRoles([$nivel]);

    // ACT
    $resposta = $this->actingAs($gestora)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Equipe Fictícia', 'permissoes' => ['agenda.ver', PERMISSAO_PROPRIA],
    ]);

    // ASSERT
    $resposta->assertStatus($esperado);
    expect($nivel->fresh()->hasPermissionTo(PERMISSAO_PROPRIA))->toBe($esperado === 200);
})->with([
    'com alguém vinculado' => [true, 403],
    'sem ninguém vinculado' => [false, 200],
]);

// ─── SEC-PP-04 (gate r2): tomar a conta da colega dava o recebido dela ─────────────────────────
// Trava até o "esqueci minha senha" por e-mail (change própria, decisão do dono).

/** A conta da Bia: vinculada a ela, no nível dado (por padrão, com o próprio recebido). */
function contaDaColegaDoRecebido(Profissional $bia, array $permissoes = ['agenda.ver', PERMISSAO_PROPRIA]): Usuario
{
    $conta = usuarioNoNivelDaPropria('Nível da Colega '.md5(implode(',', $permissoes)), $permissoes);
    $conta->update(['profissional_id' => $bia->id]);

    return $conta;
}

it('não deve deixar a gestora sem a régua trocar a senha ou o e-mail da colega que lê o próprio recebido', function (array $corpo) {
    // ARRANGE — o repro do auditor: usuarios.editar + as flags de ver todos + o próprio recebido
    admin();
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia da Conta']);
    $gestora = usuarioNoNivelDaPropria('Gestora Fictícia', GESTAO_SEM_A_REGUA);
    $contaDaBia = contaDaColegaDoRecebido($bia);
    $antes = $contaDaBia->fresh()->only(['email', 'senha_hash']);

    // ACT
    $resposta = $this->actingAs($gestora)->putJsonComVersao("/api/usuarios/{$contaDaBia->id}", $corpo);

    // ASSERT — a conta da Bia continua dela
    $resposta->assertForbidden();
    expect($contaDaBia->fresh()->only(['email', 'senha_hash']))->toBe($antes);
})->with([
    'senha' => [['senha' => 'SenhaNovaFicticia123']],
    'e-mail' => [['email' => 'outra.conta@exemplo-ficticio.com.br']],
    'senha curta (403 antes de 422)' => [['senha' => 'curta']],
]);

it('não deve deixar trocar a senha da colega a quem uma pendência vai dar o próprio recebido', function () {
    // ARRANGE — hoje a conta da Bia só vê a agenda; a atribuição PENDENTE (aprovação dupla) lhe dá o
    // recebido próprio: tomar a conta agora seria tomá-la já com o dinheiro (code-reviewer r3)
    $administradora = admin();
    $outraAdministradora = Usuario::factory()->create();
    $outraAdministradora->syncRoles([NivelPermissao::query()->where('name', 'Administrador')->firstOrFail()]);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia da Conta']);
    $gestora = usuarioNoNivelDaPropria('Gestora Fictícia', GESTAO_SEM_A_REGUA);
    $contaDaBia = contaDaColegaDoRecebido($bia, ['agenda.ver']);
    $comORecebido = NivelPermissao::create(['name' => 'Profissionais Fictícios', 'guard_name' => 'web']);
    $comORecebido->givePermissionTo(['agenda.ver', PERMISSAO_PROPRIA]);
    $this->actingAs($administradora);
    $this->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => true])->assertOk();
    $this->putJson("/api/usuarios/{$contaDaBia->id}/nivel-permissao", ['nivel_permissao_id' => $comORecebido->id])->assertStatus(202);
    trocarDeUsuario();
    $antes = $contaDaBia->fresh()->senha_hash;

    // ACT
    $resposta = $this->actingAs($gestora)->putJsonComVersao("/api/usuarios/{$contaDaBia->id}", ['senha' => 'SenhaNovaFicticia123']);

    // ASSERT
    $resposta->assertForbidden();
    expect($contaDaBia->fresh()->senha_hash)->toBe($antes);
});

it('deve deixar quem tem a régua do relatório trocar a senha da colega que lê o próprio recebido', function () {
    // ARRANGE
    admin();
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia da Conta']);
    $gestora = usuarioNoNivelDaPropria('Gestora com a Régua', [...GESTAO_SEM_A_REGUA, ...REGUA_DO_RECEBIDO]);
    $contaDaBia = contaDaColegaDoRecebido($bia);
    $antes = $contaDaBia->fresh()->senha_hash;

    // ACT
    $resposta = $this->actingAs($gestora)->putJsonComVersao("/api/usuarios/{$contaDaBia->id}", ['senha' => 'SenhaNovaFicticia123']);

    // ASSERT
    $resposta->assertOk();
    expect($contaDaBia->fresh()->senha_hash)->not->toBe($antes);
});

it('deve deixar quem lê o próprio recebido trocar a própria senha', function () {
    // ARRANGE — a própria passa sempre (CR-TRV-16)
    admin();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia da Conta']);
    $gestora = usuarioNoNivelDaPropria('Gestora Fictícia', GESTAO_SEM_A_REGUA);
    $gestora->update(['profissional_id' => $ana->id]);

    // ACT
    $resposta = $this->actingAs($gestora)->putJsonComVersao("/api/usuarios/{$gestora->id}", ['senha' => 'SenhaNovaFicticia123']);

    // ASSERT
    $resposta->assertOk();
});

it('deve deixar trocar a senha da colega que não lê o próprio recebido', function () {
    // ARRANGE — sem o recebido, a conta da Bia não abre dinheiro nenhum
    admin();
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia da Conta']);
    $gestora = usuarioNoNivelDaPropria('Gestora Fictícia', GESTAO_SEM_A_REGUA);
    $contaDaBia = contaDaColegaDoRecebido($bia, ['agenda.ver']);

    // ACT
    $resposta = $this->actingAs($gestora)->putJsonComVersao("/api/usuarios/{$contaDaBia->id}", ['senha' => 'SenhaNovaFicticia123']);

    // ASSERT
    $resposta->assertOk();
});

it('deve deixar renomear a colega que lê o próprio recebido reenviando o mesmo e-mail', function () {
    // ARRANGE — a tela manda o e-mail em toda edição: só a TROCA do e-mail entrega a conta
    admin();
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia da Conta']);
    $gestora = usuarioNoNivelDaPropria('Gestora Fictícia', GESTAO_SEM_A_REGUA);
    $contaDaBia = contaDaColegaDoRecebido($bia);

    // ACT
    $resposta = $this->actingAs($gestora)->putJsonComVersao("/api/usuarios/{$contaDaBia->id}", [
        'nome' => 'Bia Fictícia Renomeada', 'email' => mb_strtoupper($contaDaBia->email),
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($contaDaBia->fresh()->nome)->toBe('Bia Fictícia Renomeada');
});
