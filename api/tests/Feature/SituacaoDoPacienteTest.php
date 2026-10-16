<?php

use App\Models\Auditoria;
use App\Models\Paciente;
use App\Models\Usuario;

/**
 * GUARDA do endpoint de SITUAÇÃO (change faxina-de-gatilhos).
 *
 * Ele existe por um buraco de LGPD, não por conveniência: desativar um PRÉ-CADASTRO errado pelo
 * `PUT` exigia `nascimento` e `necessidade` (o boundary completo), e um pré-cadastrado não tem
 * nenhum dos dois — a recepção teria de FABRICAR data de nascimento e dado de saúde de um MENOR
 * para desfazer um erro de digitação.
 *
 * O que estas guardas prendem: desativar sem exigir nem preencher esses campos · payload de UMA
 * chave (o endpoint não vira um PUT paralelo) · a versão do registro (If-Match) · a trilha de
 * auditoria (que depende de a gravação passar pelo model) · portão e 404 do inexistente.
 *
 * LGPD: dados 100% fictícios.
 */

/** Um pré-cadastrado de verdade: sem nascimento e sem necessidade, como o balcão cria. */
function preCadastradoFicticio(): Paciente
{
    $paciente = Paciente::factory()->create(['nome' => 'Paciente Fictício do Balcão']);
    $paciente->forceFill(['nascimento' => null, 'necessidade' => null])->saveQuietly();

    return $paciente->fresh();
}

/**
 * O token da concorrência otimista, como a LEITURA o entrega — a string verbatim.
 *
 * Vive aqui porque os sete testes precisam dele; em Pest, função de arquivo de teste é GLOBAL, e
 * uma declarada-e-não-usada é armadilha (o próximo arquivo que declarar o mesmo nome derruba a
 * suíte quando ela roda junta, não isolada).
 */
function versaoDe(Usuario $comoQuem, Paciente $paciente): string
{
    return (string) test()->actingAs($comoQuem)->getJson("/api/pacientes/{$paciente->id}")->json('updated_at');
}

it('deve desativar um PRÉ-CADASTRADO sem exigir nascimento nem necessidade', function () {
    // ARRANGE — é o caso que o endpoint existe para resolver
    $adminDaClinica = admin();
    $paciente = preCadastradoFicticio();
    $versao = versaoDe($adminDaClinica, $paciente);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->patchJson(
        "/api/pacientes/{$paciente->id}/situacao",
        ['ativo' => false],
        ['If-Match' => $versao],
    );

    // ASSERT — inativo, e os campos do boundary completo seguem VAZIOS (nada foi inventado)
    $resposta->assertOk()->assertJsonPath('ativo', false);
    // e a RESPOSTA é mínima: escrever uma flag não ecoa o cadastro do menor (SEC-FX-01)
    expect(array_keys($resposta->json()))->toBe(['id', 'ativo', 'updated_at']);
    $recarregado = $paciente->fresh();
    expect($recarregado->ativo)->toBeFalse()
        ->and($recarregado->nascimento)->toBeNull()
        ->and($recarregado->necessidade)->toBeNull();
});

it('deve reativar pelo mesmo caminho', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create(['ativo' => false]);
    $versao = versaoDe($adminDaClinica, $paciente);

    // ACT
    $this->actingAs($adminDaClinica)->patchJson(
        "/api/pacientes/{$paciente->id}/situacao",
        ['ativo' => true],
        ['If-Match' => $versao],
    )->assertOk();

    // ASSERT
    expect($paciente->fresh()->ativo)->toBeTrue();
});

it('deve registrar a mudança de situação na trilha, com autor e valores', function () {
    // ARRANGE — a trilha depende de a gravação passar pelo MODEL: um update de query builder
    // pularia os eventos do Auditavel e a mudança sumiria do histórico
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create(['ativo' => true]);
    $versao = versaoDe($adminDaClinica, $paciente);

    // ACT
    $this->actingAs($adminDaClinica)->patchJson(
        "/api/pacientes/{$paciente->id}/situacao",
        ['ativo' => false],
        ['If-Match' => $versao],
    )->assertOk();

    // ASSERT
    $trilha = Auditoria::where('entidade', 'pacientes')
        ->where('entidade_id', $paciente->id)
        ->where('acao', 'atualizou')
        ->latest('id')
        ->firstOrFail();
    expect($trilha->usuario_id)->toBe($adminDaClinica->id);
    // o ANTES e o DEPOIS do campo, não só a menção dele: é isso que responde "quem desativou esta
    // criança, e quando" depois do fato
    expect($trilha->diff_json['antes'])->toMatchArray(['ativo' => true]);
    expect($trilha->diff_json['depois'])->toMatchArray(['ativo' => false]);
});

it('deve recusar campo fora do contrato da situação', function () {
    // ARRANGE — `validate()` IGNORA o que não está nas regras, e ignorar não é recusar: sem a
    // checagem, isto responderia 200 e o chamador acharia que gravou o nascimento
    $adminDaClinica = admin();
    $paciente = preCadastradoFicticio();
    $versao = versaoDe($adminDaClinica, $paciente);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->patchJson(
        "/api/pacientes/{$paciente->id}/situacao",
        ['ativo' => false, 'nascimento' => '2020-01-01'],
        ['If-Match' => $versao],
    );

    // ...e também pela QUERY STRING: a guarda olha a entrada inteira, não só o corpo — trocar
    // `except()` por `json()->except()` num refactor abriria essa porta com o teste verde
    $porQueryString = $this->actingAs($adminDaClinica)->patchJson(
        "/api/pacientes/{$paciente->id}/situacao?nascimento=2020-01-01",
        ['ativo' => false],
        ['If-Match' => $versao],
    );

    // ASSERT — 422 e NADA alterado (nem a situação, nem o nascimento)
    $resposta->assertStatus(422);
    $porQueryString->assertStatus(422);
    $recarregado = $paciente->fresh();
    expect($recarregado->ativo)->toBeTrue()->and($recarregado->nascimento)->toBeNull();
});

it('deve exigir a versão do registro para trocar a situação', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create(['ativo' => true]);

    // ACT + ASSERT — sem If-Match: 428 (fail-closed); divergente: 409
    $this->actingAs($adminDaClinica)
        ->patchJson("/api/pacientes/{$paciente->id}/situacao", ['ativo' => false])
        ->assertStatus(428);

    $this->actingAs($adminDaClinica)->patchJson(
        "/api/pacientes/{$paciente->id}/situacao",
        ['ativo' => false],
        ['If-Match' => '2020-01-01T00:00:00.000000Z'],
    )->assertStatus(409);

    expect($paciente->fresh()->ativo)->toBeTrue();
});

it('deve negar a troca de situação a quem não tem pacientes.editar', function () {
    // ARRANGE
    // um usuário SEM NADA seria recusado por qualquer middleware — o teste ficaria verde mesmo se a
    // rota pedisse `agenda.ver`. O vetor que prova `pacientes.editar` é a permissão VIZINHA
    // presente e a testada ausente (achado CR-FX-04 do gate).
    // TODOS os atores ANTES da 1ª request (guard pegajoso do sanctum — idioma da casa)
    $adminDaClinica = admin();
    $soLeitura = usuarioCom(['pacientes.ver'], 'Só Leitura de Paciente');
    $paciente = Paciente::factory()->create();
    $versao = versaoDe($adminDaClinica, $paciente);

    // ACT + ASSERT
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($soLeitura)->patchJson(
        "/api/pacientes/{$paciente->id}/situacao",
        ['ativo' => false],
        ['If-Match' => $versao],
    )->assertForbidden();
});

it('deve responder 404 para paciente inexistente', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $inexistente = 999999;

    // ACT + ASSERT — 404 vence a versão (o token não é oráculo de existência)
    $this->actingAs($adminDaClinica)->patchJson(
        "/api/pacientes/{$inexistente}/situacao",
        ['ativo' => false],
        ['If-Match' => '2020-01-01T00:00:00.000000Z'],
    )->assertNotFound();
});
