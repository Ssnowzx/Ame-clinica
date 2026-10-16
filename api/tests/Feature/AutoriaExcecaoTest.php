<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Auditoria;
use App\Models\Profissional;
use App\Models\Usuario;
use Database\Seeders\CatalogoPermissoesSeeder;
use Illuminate\Database\Eloquent\Builder;
use Spatie\Permission\Models\Role;

/**
 * Exceção de autoria (FA-04 · SEC-AE): assinar evolução EM NOME DE OUTRO
 * profissional exige a permissão dedicada, um motivo, e o evento
 * `assinou_por_outro` na trilha — atômico com a própria evolução.
 */

/** Atendimento pronto para evoluir + profissional ativo para assinar. */
function cenarioDeAutoriaExcecao(): array
{
    return [
        Atendimento::factory()->create(),
        Profissional::factory()->create(),
    ];
}

/** Usuária SEM vínculo, com visão clínica PLANA e criação de evolução — SEM/COM a exceção. */
function secretariaClinica(array $permissoesExtras = [], string $nivel = 'Secretária Clínica'): Usuario
{
    return usuarioCom(array_merge(
        ['evolucoes.ver', 'evolucoes.criar', 'evolucoes.editar', 'clinico.ver_todos'],
        $permissoesExtras,
    ), $nivel);
}

/** Usuário VINCULADO a $prof com o leque clínico de assinar em nome próprio. */
function profissionalComLoginProprio(Profissional $prof): Usuario
{
    $usuario = usuarioCom(
        ['evolucoes.ver', 'evolucoes.criar', 'evolucoes.editar'],
        'Prof. Assina Próprio',
    );
    $usuario->update(['profissional_id' => $prof->id]);

    return $usuario;
}

/** Atendimento finalizado de um agendamento DO profissional $prof. */
function atendimentoDoProprioProfissional(Profissional $prof): Atendimento
{
    $agendamento = Agendamento::factory()->create(['profissional_id' => $prof->id]);

    return Atendimento::factory()->create(['agendamento_id' => $agendamento->id]);
}

function eventosDeExcecao(): Builder
{
    return Auditoria::where('entidade', 'evolucoes')->where('acao', 'assinou_por_outro');
}

it('deve recusar com 403 assinar por outro sem a permissão dedicada — e nada vai à trilha', function () {
    // ARRANGE — sem vínculo + visão plana + evolucoes.criar, SEM a exceção
    admin();
    [$atendimento, $autor] = cenarioDeAutoriaExcecao();
    $secretaria = secretariaClinica();

    // ACT + ASSERT — com motivo (403: autorização vence forma)...
    $this->actingAs($secretaria)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $autor->id,
            'conteudo' => 'Evolução fictícia por outro.',
            'motivo_assinatura' => 'Tentativa sem liberação.',
        ])->assertForbidden();

    // ...e SEM motivo: 403 vence o 422 (SEC-AE-01) — o mecanismo não vaza no erro
    $this->actingAs($secretaria)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $autor->id,
            'conteudo' => 'Evolução fictícia por outro.',
        ])->assertForbidden();

    // AU-03: tentativa negada NÃO é auditada; nada foi criado
    expect(Auditoria::where('entidade', 'evolucoes')->count())->toBe(0)
        ->and(Atendimento::find($atendimento->id)->evolucao()->exists())->toBeFalse();
});

it('deve exigir motivo no ramo de exceção, com 422 estático que não ecoa o valor', function () {
    // ARRANGE — o admin (sem vínculo) TEM a permissão pelo catálogo
    $adminDaClinica = admin();
    [$atendimento, $autor] = cenarioDeAutoriaExcecao();
    $base = ['profissional_id' => $autor->id, 'conteudo' => 'Evolução fictícia.'];

    // ACT + ASSERT — ausente, vazio e só-espaços: todos 422 em motivo_assinatura
    foreach ([[], ['motivo_assinatura' => ''], ['motivo_assinatura' => '   ']] as $variacao) {
        $this->actingAs($adminDaClinica)
            ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", array_merge($base, $variacao))
            ->assertUnprocessable()->assertJsonValidationErrors('motivo_assinatura');
    }

    // acima do teto (500) → 422, e a resposta NÃO ecoa o texto enviado (SEC-AE-03)
    $motivoLongo = str_repeat('m', 501);
    $resposta = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", array_merge($base, [
            'motivo_assinatura' => $motivoLongo,
        ]));
    $resposta->assertUnprocessable()->assertJsonValidationErrors('motivo_assinatura');
    expect($resposta->getContent())->not->toContain($motivoLongo);
});

it('deve registrar a exceção autorizada na trilha: em-nome-de + motivo, atribuída a quem digitou', function () {
    // ARRANGE
    $adminDaClinica = admin();
    [$atendimento, $autor] = cenarioDeAutoriaExcecao();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $autor->id,
            'conteudo' => 'Evolução clínica fictícia registrada pela administração.',
            'motivo_assinatura' => 'Profissional sem acesso ao sistema no dia.',
        ]);

    // ASSERT — 201 sem o motivo no corpo (whitelist CAMPOS)
    $resposta->assertCreated();
    expect($resposta->json())->not->toHaveKey('motivo_assinatura');

    // o evento existe, aninhado na convenção da casa, com autor real e IP
    $evento = eventosDeExcecao()->firstOrFail();
    expect($evento->diff_json['depois']['profissional_id'])->toBe($autor->id)
        ->and($evento->diff_json['depois']['motivo'])->toBe('Profissional sem acesso ao sistema no dia.')
        ->and($evento->usuario_id)->toBe($adminDaClinica->id)
        ->and($evento->ip)->not->toBeNull();

    // o `criou` do observer também está lá, e o conteúdo clínico NÃO está no
    // evento (whitelist literal, SEC-AE-04) — guarda blindada contra o escape
    // de acento do json_encode (helper da casa)
    expect(Auditoria::where('entidade', 'evolucoes')->where('acao', 'criou')->count())->toBe(1);
    semVazamento($evento->diff_json, 'registrada pela administração');
});

it('deve comitar evolução e evento na MESMA transação — a prova por epoch', function () {
    // ARRANGE — sem esta prova, apagar o `DB::transaction` do store deixava a
    // suíte inteira verde (achado I-3 do gate; padrão TEST-LOCK-EPOCH): a
    // duplicata sequencial morre no pré-check e nunca exercita a atomicidade
    $adminDaClinica = admin();
    [$atendimento, $autor] = cenarioDeAutoriaExcecao();
    $capturadas = capturarConsultasComEpoch();

    // ACT
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $autor->id,
            'conteudo' => 'Evolução fictícia para a prova de atomicidade.',
            'motivo_assinatura' => 'Registro administrativo.',
        ])->assertCreated();

    // ASSERT — o insert da evolução e TODOS os inserts na tabela `auditoria` (o
    // `criou` do observer E o `assinou_por_outro`) compartilham o MESMO epoch de
    // transação: comitam juntos, rolam juntos
    $consultas = $capturadas();
    $epochDaEvolucao = epochDaConsulta($consultas, ['insert', 'evolucoes']);
    $insercoesDeAuditoria = array_values(array_filter(
        $consultas,
        fn (array $consulta): bool => str_contains($consulta['sql'], 'insert')
            && str_contains($consulta['sql'], 'auditoria'),
    ));
    expect(count($insercoesDeAuditoria))->toBe(2);
    foreach ($insercoesDeAuditoria as $insercao) {
        expect($insercao['epoch'])->toBe($epochDaEvolucao);
    }
});

it('deve manter o vinculado fora da exceção: sem motivo, sem evento — e motivo presente é recusado', function () {
    // ARRANGE — vinculado assinando em nome próprio no PRÓPRIO atendimento
    admin();
    $prof = Profissional::factory()->create();
    $usuario = profissionalComLoginProprio($prof);
    $atendimento = atendimentoDoProprioProfissional($prof);

    // ACT + ASSERT — motivo presente (com valor e com null) → 422 `missing`
    foreach (['Motivo indevido.', null] as $motivo) {
        $this->actingAs($usuario)
            ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
                'profissional_id' => $prof->id,
                'conteudo' => 'Evolução fictícia.',
                'motivo_assinatura' => $motivo,
            ])->assertUnprocessable()->assertJsonValidationErrors('motivo_assinatura');
    }

    // sem motivo → 201, e NENHUM evento de exceção (só o `criou`)
    $this->actingAs($usuario)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $prof->id,
            'conteudo' => 'Evolução fictícia em nome próprio.',
        ])->assertCreated();
    expect(eventosDeExcecao()->count())->toBe(0)
        ->and(Auditoria::where('entidade', 'evolucoes')->where('acao', 'criou')->count())->toBe(1);
});

it('deve manter o PUT fora da exceção: edita sem a permissão, e motivo no PUT é recusado', function () {
    // ARRANGE — atores ANTES de qualquer request: o auth:sanctum troca o guard
    // padrão do processo (`shouldUse`), e o Spatie passaria a resolver
    // role/permissão pelo guard errado num ator criado depois
    $adminDaClinica = admin();
    $secretaria = secretariaClinica(nivel: 'Secretária Sem Exceção');
    [$atendimento, $autor] = cenarioDeAutoriaExcecao();
    $id = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $autor->id,
            'conteudo' => 'Evolução fictícia original.',
            'motivo_assinatura' => 'Registro administrativo.',
        ])->assertCreated()->json('id');

    // ACT + ASSERT — sem `evolucoes.assinar_por_outro`, a EDIÇÃO segue livre
    // (permissão própria). Troca de ator após request derruba os guards memoizados.
    test()->flushSession();
    app('auth')->forgetGuards();
    $this->actingAs($secretaria)
        ->putJsonComVersao("/api/evolucoes/{$id}", ['conteudo' => 'Conteúdo corrigido pela secretária.'])
        ->assertOk();

    // motivo_assinatura no PUT → 422 `missing` (a exceção é só de CRIAÇÃO)
    $this->actingAs($secretaria)
        ->putJsonComVersao("/api/evolucoes/{$id}", [
            'conteudo' => 'Outra correção.',
            'motivo_assinatura' => 'Não se aplica.',
        ])->assertUnprocessable()->assertJsonValidationErrors('motivo_assinatura');
});

it('deve exigir o escopo D11 além da permissão: a exceção é AND com clinico.ver_todos, nunca OR', function () {
    // ARRANGE — sem vínculo, COM a permissão de exceção, SEM visão clínica plana
    admin();
    [$atendimento, $autor] = cenarioDeAutoriaExcecao();
    $semEscopo = usuarioCom(
        ['evolucoes.ver', 'evolucoes.criar', 'evolucoes.assinar_por_outro'],
        'Exceção Sem Escopo',
    );

    // ACT + ASSERT — o 403 já nasce no authorize() (a autoria é decidida ali pelo eixo clínico desde a rodada 4 — SEC-VP-48); o escopo fail-closed do controller é a rede (403)
    $this->actingAs($semEscopo)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $autor->id,
            'conteudo' => 'Evolução fictícia.',
            'motivo_assinatura' => 'Permissão sem escopo não basta.',
        ])->assertForbidden();
    expect(eventosDeExcecao()->count())->toBe(0);
});

it('deve continuar recusando o desligado que não atendeu, mesmo na exceção autorizada', function () {
    // ARRANGE — a exceção NÃO revoga a regra do desligado
    $adminDaClinica = admin();
    [$atendimento] = cenarioDeAutoriaExcecao();
    $desligadaAlheia = Profissional::factory()->create(['ativo' => false]);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $desligadaAlheia->id,
            'conteudo' => 'Evolução fictícia de quem não atendeu.',
            'motivo_assinatura' => 'Tentativa sobre desligada alheia.',
        ])->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
    expect(eventosDeExcecao()->count())->toBe(0);
});

it('deve manter 1:1 evolução↔evento na duplicidade: o segundo POST não deixa evento órfão', function () {
    // ARRANGE — este teste prova a via SEQUENCIAL (o pré-check recusa antes de
    // gravar). A atomicidade em si é provada pelo teste de epoch acima; o ramo
    // 1062 de corrida REAL fica para o pacote de corrida da change
    // `concorrencia-otimista` (OBS-1 do parecer final)
    $adminDaClinica = admin();
    [$atendimento, $autor] = cenarioDeAutoriaExcecao();
    $payload = [
        'profissional_id' => $autor->id,
        'conteudo' => 'Evolução fictícia.',
        'motivo_assinatura' => 'Registro administrativo.',
    ];
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", $payload)->assertCreated();

    // ACT — segunda tentativa no MESMO atendimento
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", $payload)
        ->assertUnprocessable()->assertJsonValidationErrors('atendimento_id');

    // ASSERT — segue 1 evolução, 1 criou, 1 evento de exceção
    expect(Atendimento::find($atendimento->id)->evolucao()->count())->toBe(1)
        ->and(Auditoria::where('entidade', 'evolucoes')->where('acao', 'criou')->count())->toBe(1)
        ->and(eventosDeExcecao()->count())->toBe(1);
});

it('deve conceder evolucoes.assinar_por_outro apenas ao Administrador no seeder', function () {
    // ARRANGE — um segundo nível preexistente NÃO pode ganhar a permissão no re-seed
    $adminDaClinica = admin();
    $recepcao = Role::create(['name' => 'Recepção Sem Exceção']);
    $recepcao->givePermissionTo(['evolucoes.ver']);

    // ACT — o deploy re-sincroniza o catálogo (SEC-AE-08)
    $this->seed(CatalogoPermissoesSeeder::class);

    // ASSERT
    $administrador = Role::findByName('Administrador');
    expect($administrador->hasPermissionTo('evolucoes.assinar_por_outro'))->toBeTrue()
        ->and($recepcao->fresh()->hasPermissionTo('evolucoes.assinar_por_outro'))->toBeFalse()
        ->and($adminDaClinica->can('evolucoes.assinar_por_outro'))->toBeTrue();
});
