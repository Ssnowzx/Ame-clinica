<?php

use App\Models\NivelPermissao;
use Database\Seeders\CatalogoPermissoesSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;
use Symfony\Component\Finder\Finder;

uses(RefreshDatabase::class);

/**
 * A AÇÃO NOVA CHEGA À CLÍNICA QUE JÁ EXISTE (change `cadastro-online-do-paciente`).
 *
 * O `ClinicaObserver` concede o catálogo na CRIAÇÃO da clínica, e o deploy roda `migrate --force`,
 * nunca `db:seed`. Sem a migration que chama o seeder, a clínica que já está no ar não recebe
 * `cadastro_online.conferir` — e o efeito não seria um botão faltando: ela ligaria o link, as
 * famílias mandariam cadastro de MENOR, e a fila responderia 403 para todo mundo até o expurgo
 * apagar tudo em 30 dias.
 *
 * O teste reproduz a clínica antiga do único jeito que a suíte permite: revogando a ação do papel
 * depois de a clínica existir. É a mesma condição — papel de Administrador sem a permissão nova.
 */
it('deve devolver cadastro_online.conferir ao Administrador de uma clínica que já existia', function (): void {
    // ARRANGE — a clínica existe e o Administrador dela PERDE a ação, como se ela tivesse nascido
    // depois dele
    $usuario = admin();

    $registrar = app(PermissionRegistrar::class);

    $papel = NivelPermissao::where('name', 'Administrador')->firstOrFail();
    $papel->syncPermissions(
        Permission::all()->reject(fn (Permission $p): bool => $p->name === 'cadastro_online.conferir')
    );
    $registrar->forgetCachedPermissions();

    expect($usuario->fresh()->can('cadastro_online.conferir'))->toBeFalse();

    // ACT — é exatamente o que a migration de deploy faz
    (new CatalogoPermissoesSeeder)->run();

    // ASSERT
    expect($usuario->fresh()->can('cadastro_online.conferir'))->toBeTrue();
});

it('deve manter a ação FORA dos outros níveis — quem confere é decisão da clínica', function (): void {
    // ARRANGE — o backfill é só do Administrador, de propósito: conferir cadastro de criança que
    // veio de fora é decisão de administração, distribuída pela tela de níveis com o rosto de
    // quem decidiu
    $usuario = admin();
    $registrar = app(PermissionRegistrar::class);

    // a clínica nasce só com o Administrador; a Recepção é o nível que a clínica cria
    $recepcao = NivelPermissao::create(['name' => 'Recepção', 'guard_name' => 'web']);
    $recepcao->givePermissionTo(['pacientes.ver', 'agenda.ver']);
    $antes = $recepcao->permissions->pluck('name')->sort()->values()->all();

    // ACT
    (new CatalogoPermissoesSeeder)->run();

    // ASSERT — nada mudou no nível que não é o de administração
    $registrar->forgetCachedPermissions();
    expect($recepcao->fresh()->permissions->pluck('name')->sort()->values()->all())->toBe($antes);
});

/**
 * A MIGRATION, e não o seeder — a guarda que faltava.
 *
 * Os dois testes acima chamam `(new CatalogoPermissoesSeeder)->run()` direto: eles provam que o
 * SEEDER funciona, nunca que a migration que o chama existe. Comentar o corpo do `up()` deixava a
 * suíte inteira verde (rodada dirigida 3), e a migration podia sumir num rebase sem ninguém ver.
 *
 * Uma primeira versão desta guarda procurava o TEXTO da chamada no arquivo. Era decoração: trocar
 * a linha por comentário mantinha a string lá e a guarda verde. Aqui a prova é o EFEITO — a
 * migration roda, e a ação tem de aparecer.
 */
it('deve entregar a ação pela MIGRATION, não só pelo seeder', function (): void {
    // ARRANGE — a clínica existe e o Administrador dela NÃO tem a ação, como uma clínica anterior
    // à change
    $usuario = admin();

    $registrar = app(PermissionRegistrar::class);
    NivelPermissao::where('name', 'Administrador')->firstOrFail()
        ->syncPermissions(Permission::all()->reject(fn (Permission $p): bool => $p->name === 'cadastro_online.conferir'));
    $registrar->forgetCachedPermissions();
    expect($usuario->fresh()->can('cadastro_online.conferir'))->toBeFalse();

    // ACT — a migration de deploy, pelo caminho de verdade
    $arquivo = collect(iterator_to_array(
        Finder::create()->files()->in(dirname(__DIR__, 2).'/database/migrations')->name('*conceder_cadastro_online*.php')
    ))->first();

    expect($arquivo)->not->toBeNull();

    // o `up()` do próprio arquivo — não o comando: o `RefreshDatabase` já a rodou, e um
    // `migrate` aqui seria no-op. O que se prova é que O CORPO DELA entrega a ação; comentar a
    // chamada ao seeder derruba este teste, que é o buraco que a versão anterior desta guarda
    // deixava passar
    $migration = require $arquivo->getPathname();
    $migration->up();

    // ASSERT
    expect($usuario->fresh()->can('cadastro_online.conferir'))->toBeTrue();
});

it('deve ter migration de deploy para os módulos nascidos DEPOIS da clínica estar no ar', function (): void {
    /*
     * ARRANGE — a lista é mantida À MÃO, e isto é uma limitação declarada, não descuido.
     *
     * Completude de verdade exigiria saber QUANDO cada módulo do catálogo nasceu em relação ao
     * nascimento da clínica, e isso não está no código: o `ClinicaObserver` concede o catálogo
     * inteiro na criação, então módulo anterior à clínica nunca precisou de backfill.
     *
     * Uma versão anterior desta guarda tinha o mesmo corpo com o nome "TODA AÇÃO NOVA DO CATÁLOGO
     * PRECISA DE UMA MIGRATION". O corpo estava certo; o nome mentia — e nome que promete mais do
     * que o corpo entrega é pior que guarda nenhuma, porque o próximo revisor confia nele.
     *
     * Quem acrescentar um módulo aqui está declarando que ele nasceu depois de a clínica estar no
     * ar. O teste de comportamento acima é o que de fato protege esta change.
     */
    // módulo => trecho do nome da migration que o entrega (o nome do arquivo nem sempre repete
    // o prefixo da permissão: `mensagens` mora em `conceder_permissoes_de_mensagens`)
    $nascidosDepois = [
        'fluxo_caixa' => 'conceder_fluxo_caixa',
        'ciclos' => 'conceder_permissoes_de_ciclo',
        'termos_consentimento' => 'conceder_termos_consentimento',
        'mensagens' => 'conceder_permissoes_de_mensagens',
        'cadastro_online' => 'conceder_cadastro_online',
    ];

    $migrations = collect(iterator_to_array(
        Finder::create()->files()->in(dirname(__DIR__, 2).'/database/migrations')->name('*.php')
    ))->map(fn ($a): string => $a->getFilename())->implode("\n");

    // ACT
    $semMigration = collect($nascidosDepois)
        ->reject(fn (string $arquivo): bool => str_contains($migrations, $arquivo))
        ->keys();

    // ASSERT
    expect($semMigration->all())->toBe([]);
});
