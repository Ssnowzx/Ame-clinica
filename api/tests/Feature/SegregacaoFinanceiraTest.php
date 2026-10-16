<?php

use App\Models\AprovacaoDeAcesso;
use App\Models\Configuracao;
use App\Models\NivelPermissao;
use App\Models\Usuario;
use App\Support\Configuracoes\CatalogoConfiguracoes;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\MutacoesDeAcesso;
use App\Support\Rbac\PermissaoCatalogo;
use App\Support\Rbac\SegregacaoFinanceira;
use Illuminate\Validation\ValidationException;

/**
 * Segregação de deveres permissões × financeiro (AP-13 · SEC-SD-05/06) — regra é
 * DADO (§13): tudo atrás de `seguranca.segregacao_financeira`, default desligada.
 */

/** As permissões do Administrador SEM a escrita financeira (mantém .ver e o resto). */
function permissoesSemEscritaFinanceira(): array
{
    return array_values(array_filter(
        PermissaoCatalogo::PERMISSOES,
        fn (string $permissao): bool => ! in_array($permissao, SegregacaoFinanceira::violacoes(PermissaoCatalogo::PERMISSOES), true),
    ));
}

it('deve manter a classificação de módulos COMPLETA e sem fantasmas (rede SEC-SD-05)', function () {
    // ARRANGE — os módulos REAIS do catálogo de permissões
    $modulosDoCatalogo = collect(PermissaoCatalogo::PERMISSOES)
        ->map(fn (string $permissao): string => explode('.', $permissao, 2)[0])
        ->unique()
        ->sort()
        ->values()
        ->all();

    // ACT
    $classificados = collect(SegregacaoFinanceira::CLASSIFICACAO)->keys()->sort()->values()->all();

    // ASSERT — módulo novo sem classificação reprova; entrada fantasma (que não existe
    // no catálogo, como 'faturamento'/'subcategorias') também reprova
    expect($classificados)->toBe(
        $modulosDoCatalogo,
        'A CLASSIFICACAO de SegregacaoFinanceira divergiu dos módulos do catálogo de permissões. '
        .'Classifique o módulo novo (financeiro|fora) — ou remova a entrada fantasma.',
    );
});

/**
 * O caminho real até a segregação ligada: reorganiza o Administrador (larga a escrita financeira), liga a
 * aprovação dupla — exigida desde `trava-de-usuarios-e-niveis` (CR-TRV-27), com uma segunda administradora
 * — e só então a segregação. Devolve a segunda administradora, que aprova.
 */
function ligarASegregacaoComADupla(Usuario $administradora, bool $abrirAntes = false): Usuario
{
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $segunda = Usuario::factory()->create();
    $segunda->syncRoles([$administrador]);
    test()->actingAs($administradora);
    test()->putJsonComVersao("/api/niveis-permissao/{$administrador->id}", [
        'nome' => 'Administrador',
        'permissoes' => permissoesSemEscritaFinanceira(),
    ])->assertOk();
    test()->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => true])->assertOk();
    if ($abrirAntes) {
        // o pedido de desligar a dupla, aberto com a segregação AINDA desligada
        test()->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => false])->assertStatus(202);
    }
    test()->putJson('/api/configuracoes', ['chave' => 'seguranca.segregacao_financeira', 'valor' => true])->assertOk();

    return $segunda;
}

it('deve recusar nível que combine controle de acesso com escrita financeira quando a segregação está ligada', function () {
    // ARRANGE — o Administrador sem a escrita financeira, a dupla e a segregação ligadas
    $adminDaClinica = admin();
    $segunda = ligarASegregacaoComADupla($adminDaClinica);

    // ACT + ASSERT — combinação recusada na CRIAÇÃO (âncora `.criar` também conta)
    $this->postJson('/api/niveis-permissao', [
        'nome' => 'Combinado Fictício',
        'permissoes' => ['niveis_permissao.criar', 'lancamentos.pagar'],
    ])->assertUnprocessable();

    // leitura financeira é LIVRE
    $id = $this->postJson('/api/niveis-permissao', [
        'nome' => 'Leitor Financeiro Fictício',
        'permissoes' => ['niveis_permissao.editar', 'lancamentos.ver'],
    ])->assertCreated()->json('id');

    // ...e recusada na EDIÇÃO do nível recém-criado — com a dupla ligada, a edição vira pendência, e a
    // segregação recusa na APROVAÇÃO (a pendência fica)
    $this->putJsonComVersao("/api/niveis-permissao/{$id}", [
        'nome' => 'Leitor Financeiro Fictício',
        'permissoes' => ['niveis_permissao.editar', 'contas.editar'],
    ])->assertStatus(202);
    $pendencia = AprovacaoDeAcesso::where('status', 'pendente')->firstOrFail();
    trocarDeUsuario();
    $aprovacao = $this->actingAs($segunda)->postJson("/api/aprovacoes-de-acesso/{$pendencia->id}/aprovar");
    $aprovacao->assertUnprocessable();
    // pela SEGREGAÇÃO, não por outro 422 qualquer (CR-TRV-31)
    expect(json_encode($aprovacao->json(), JSON_UNESCAPED_UNICODE))->toContain('segregação financeira está ligada')
        ->and($pendencia->fresh()->status)->toBe('pendente');
});

it('deve recusar ligar a segregação sem a aprovação dupla', function () {
    // ARRANGE — CR-TRV-27: com a segregação, quem gere o acesso monta o nível do dinheiro; sem um segundo
    // aval, chegaria a ele sozinho. O Administrador já largou a escrita financeira (sem violadores)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $this->putJsonComVersao("/api/niveis-permissao/{$administrador->id}", [
        'nome' => 'Administrador', 'permissoes' => permissoesSemEscritaFinanceira(),
    ])->assertOk();

    // ACT
    $resposta = $this->putJson('/api/configuracoes', ['chave' => 'seguranca.segregacao_financeira', 'valor' => true]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('valor');
    expect(json_encode($resposta->json(), JSON_UNESCAPED_UNICODE))->toContain('aprovação dupla');
});

it('deve recusar já no pedido desligar a aprovação dupla com a segregação ligada', function () {
    // ARRANGE — CR-TRV-30: um pedido que nunca poderia ser aprovado não é "enviado para aprovação"
    $adminDaClinica = admin();
    ligarASegregacaoComADupla($adminDaClinica);

    // ACT
    $resposta = $this->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => false]);

    // ASSERT
    $resposta->assertUnprocessable();
    expect(json_encode($resposta->json(), JSON_UNESCAPED_UNICODE))->toContain('Desligue a segregação')
        ->and(AprovacaoDeAcesso::where('status', 'pendente')->count())->toBe(0);
});

it('deve recusar aprovar o desligar da dupla pedido antes de a segregação ligar', function () {
    // ARRANGE — o pedido nasce com a segregação desligada; a segregação liga depois; a aprovação esbarra
    $adminDaClinica = admin();
    $segunda = ligarASegregacaoComADupla($adminDaClinica, abrirAntes: true);
    $pendencia = AprovacaoDeAcesso::where('status', 'pendente')->firstOrFail();
    trocarDeUsuario();

    // ACT
    $resposta = $this->actingAs($segunda)->postJson("/api/aprovacoes-de-acesso/{$pendencia->id}/aprovar");

    // ASSERT — a dupla continua ligada, e a pendência fica
    $resposta->assertUnprocessable();
    expect(json_encode($resposta->json(), JSON_UNESCAPED_UNICODE))->toContain('Desligue a segregação')
        ->and($pendencia->fresh()->status)->toBe('pendente');
});

it('deve ler a dupla GRAVADA, não a memória do request, ao ligar a segregação', function () {
    // ARRANGE — CR-TRV-29: o controller lê a dupla antes da âncora; se outra administradora a desliga
    // nesse meio-tempo, a pré-condição não pode decidir pelo valor velho
    $adminDaClinica = admin();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    Usuario::factory()->create()->syncRoles([$administrador]);
    $this->actingAs($adminDaClinica);
    $this->putJsonComVersao("/api/niveis-permissao/{$administrador->id}", [
        'nome' => 'Administrador', 'permissoes' => permissoesSemEscritaFinanceira(),
    ])->assertOk();
    $this->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => true])->assertOk();
    $configuracoes = app(ConfiguracaoService::class);
    expect((bool) $configuracoes->get('seguranca.aprovacao_dupla'))->toBeTrue(); // a memória lembra "ligada"
    Configuracao::where('chave', 'seguranca.aprovacao_dupla')->update(['valor' => CatalogoConfiguracoes::serializar('seguranca.aprovacao_dupla', false)]);

    // ACT + ASSERT — a outra administradora desligou: a segregação não liga
    expect(fn () => app(MutacoesDeAcesso::class)->aplicarConfiguracao('seguranca.segregacao_financeira', true))
        ->toThrow(ValidationException::class);
    expect((bool) $configuracoes->atual('seguranca.segregacao_financeira'))->toBeFalse();
});

it('deve recusar ligar a segregação nomeando os níveis violadores', function () {
    // ARRANGE — clínica recém-nascida: o Administrador de fábrica combina TUDO
    $this->actingAs(admin());

    // ACT
    $resposta = $this->putJson('/api/configuracoes', [
        'chave' => 'seguranca.segregacao_financeira', 'valor' => true,
    ]);

    // ASSERT — 422 NOMEANDO o violador; a flag continua desligada
    $resposta->assertUnprocessable();
    expect(json_encode($resposta->json(), JSON_UNESCAPED_UNICODE))->toContain('Administrador');
    $this->getJson('/api/configuracoes')->assertOk();
    $efetivas = collect($this->getJson('/api/configuracoes')->json('configuracoes'));
    expect($efetivas->firstWhere('chave', 'seguranca.segregacao_financeira')['valor'])->toBeFalse();
});

it('deve manter qualquer combinação aceita com a segregação desligada', function () {
    // ARRANGE — default OFF: postura atual intacta
    $this->actingAs(admin());

    // ACT + ASSERT
    $this->postJson('/api/niveis-permissao', [
        'nome' => 'Tudo Junto Fictício',
        'permissoes' => ['niveis_permissao.editar', 'lancamentos.pagar', 'contas.editar'],
    ])->assertCreated();
});
