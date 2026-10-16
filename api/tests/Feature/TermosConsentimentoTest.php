<?php

use App\Models\Auditoria;
use App\Models\Paciente;
use App\Models\TermoConsentimento;
use App\Models\Usuario;

/** Publica uma versão pelo caminho REAL (a API), devolvendo o corpo. */
function publicarTermo(
    Usuario $usuario,
    string $titulo = 'Regulamento dos Atendimentos',
    string $texto = 'Texto fictício da versão.',
): array {
    return test()->actingAs($usuario)
        ->postJson('/api/termos-consentimento', ['titulo' => $titulo, 'texto' => $texto])
        ->assertCreated()
        ->json();
}

/**
 * Um aceite gravado como o servidor grava — para montar a cena de "versão já
 * aceita" sem depender do caminho de escrita do paciente. Dados FICTÍCIOS.
 *
 * @return list<array<string, mixed>>
 */
function aceiteFicticio(int $termoId, int $versao, int $usuarioId): array
{
    return [[
        'termo_id' => $termoId,
        'versao' => $versao,
        'termo' => 'Regulamento dos Atendimentos',
        'responsavel' => 'Responsável Fictício',
        'forma' => 'papel',
        'registrado_por' => $usuarioId,
        'aceito_em' => now()->toIso8601String(),
    ]];
}

it('deve numerar a primeira versão como 1 e nascer vigente', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $publicado = publicarTermo($adminDaClinica);

    // ASSERT
    expect($publicado['versao'])->toBe(1)
        ->and($publicado['vigente'])->toBeTrue()
        ->and($publicado['aceites_total'])->toBe(0);

    // ...e a mutação fica AUDITADA (a spec exige; sem esta asserção, trocar o `save()`
    // por um update de query builder tiraria a troca do contrato terapêutico da trilha
    // e a suíte seguiria verde)
    $trilha = Auditoria::where('entidade', 'termos_consentimento')->where('acao', 'criou')->firstOrFail();
    expect($trilha->usuario_id)->toBe($adminDaClinica->id);
});

it('deve aposentar a versão anterior ao publicar a próxima, sem alterá-la', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $primeira = publicarTermo($adminDaClinica, texto: 'Texto da v1.');

    // ACT
    $segunda = publicarTermo($adminDaClinica, texto: 'Texto da v2.');

    // ASSERT — a v1 continua existindo, com o texto intacto, e só a v2 é vigente
    expect($segunda['versao'])->toBe(2)->and($segunda['vigente'])->toBeTrue();

    $v1 = TermoConsentimento::find($primeira['id']);
    expect($v1->vigente)->toBeFalse()->and($v1->texto)->toBe('Texto da v1.');
});

it('deve recusar versão escolhida pelo cliente', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT — quem numera é o servidor
    $this->actingAs($adminDaClinica)->postJson('/api/termos-consentimento', [
        'titulo' => 'Regulamento', 'texto' => 'Texto.', 'versao' => 99,
    ])->assertUnprocessable()->assertJsonValidationErrors('versao');
});

it('deve recusar vigente escolhido pelo cliente', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/termos-consentimento', [
        'titulo' => 'Regulamento', 'texto' => 'Texto.', 'vigente' => false,
    ])->assertUnprocessable()->assertJsonValidationErrors('vigente');

    // ...e a chave NULA também (gatilho PROHIBITED-NULL): quem manda a chave, manda o campo
    $this->actingAs($adminDaClinica)->postJson('/api/termos-consentimento', [
        'titulo' => 'Regulamento', 'texto' => 'Texto.', 'versao' => null,
    ])->assertUnprocessable()->assertJsonValidationErrors('versao');
});

it('deve recusar edição do texto de versão já aceita e preservar o texto', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $termo = publicarTermo($adminDaClinica, texto: 'Texto original.');
    Paciente::factory()->create([
        'consentimentos_json' => aceiteFicticio($termo['id'], 1, $adminDaClinica->id),
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->withHeader('If-Match', TermoConsentimento::find($termo['id'])->updated_at->toJSON())
        ->putJson("/api/termos-consentimento/{$termo['id']}", [
            'titulo' => 'Regulamento dos Atendimentos', 'texto' => 'Texto reescrito.',
        ]);

    // ASSERT — a recusa é do formulário (422), e a prova continua como estava
    $resposta->assertUnprocessable()->assertJsonValidationErrors('texto');
    expect(TermoConsentimento::find($termo['id'])->texto)->toBe('Texto original.');
});

it('deve permitir editar versão que ninguém aceitou', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $termo = publicarTermo($adminDaClinica, texto: 'Texto com erro de digitacao.');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->withHeader('If-Match', TermoConsentimento::find($termo['id'])->updated_at->toJSON())
        ->putJson("/api/termos-consentimento/{$termo['id']}", [
            'titulo' => 'Regulamento dos Atendimentos', 'texto' => 'Texto corrigido.',
        ]);

    // ASSERT
    $resposta->assertOk();
    expect(TermoConsentimento::find($termo['id'])->texto)->toBe('Texto corrigido.');
    expect(Auditoria::where('entidade', 'termos_consentimento')->where('acao', 'atualizou')->exists())
        ->toBeTrue();
});

it('deve recusar exclusão de versão já aceita', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $termo = publicarTermo($adminDaClinica);
    Paciente::factory()->create([
        'consentimentos_json' => aceiteFicticio($termo['id'], 1, $adminDaClinica->id),
    ]);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/termos-consentimento/{$termo['id']}")
        ->assertUnprocessable();
    expect(TermoConsentimento::find($termo['id']))->not->toBeNull();
});

it('deve excluir versão sem aceite', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $termo = publicarTermo($adminDaClinica);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/termos-consentimento/{$termo['id']}")
        ->assertNoContent();
    expect(TermoConsentimento::find($termo['id']))->toBeNull();
    expect(Auditoria::where('entidade', 'termos_consentimento')->where('acao', 'excluiu')->exists())
        ->toBeTrue();
});

it('deve recusar a exclusão da versão VIGENTE quando existe outra', function () {
    // ARRANGE — excluir a vigente havendo histórico deixaria a clínica SEM RÉGUA, e o
    // estrago é silencioso: o aceite passa a recusar e a fila de pendências ZERA,
    // indistinguível de "todo mundo assinou" (parecer SEC-TR-02/CR-2)
    $adminDaClinica = admin();
    publicarTermo($adminDaClinica, texto: 'Texto da v1.');
    $v2 = publicarTermo($adminDaClinica, texto: 'Texto da v2.');

    // ACT + ASSERT — a v2 é vigente e não tem aceite, mas não sai
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/termos-consentimento/{$v2['id']}")
        ->assertUnprocessable();
    expect(TermoConsentimento::emVigor()?->id)->toBe($v2['id']);
});

it('deve permitir excluir a ÚNICA versão, mesmo vigente', function () {
    // ARRANGE — desfazer honesto de uma publicação errada: volta a "ainda não publicou"
    $adminDaClinica = admin();
    $unica = publicarTermo($adminDaClinica);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/termos-consentimento/{$unica['id']}")
        ->assertNoContent();
    expect(TermoConsentimento::query()->count())->toBe(0);
});

it('deve negar ESCRITA a quem não tem a permissão de cada ação', function () {
    // ARRANGE — o 403 tem de valer por AÇÃO, não só na leitura/criação
    $adminDaClinica = admin();
    $soLeitura = usuarioCom(['termos_consentimento.ver'], 'Só Lê Termo');
    $termo = publicarTermo($adminDaClinica);

    // ACT + ASSERT
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($soLeitura)
        ->putJson("/api/termos-consentimento/{$termo['id']}", ['titulo' => 'X', 'texto' => 'Y'])
        ->assertForbidden();
    $this->actingAs($soLeitura)
        ->deleteJson("/api/termos-consentimento/{$termo['id']}")
        ->assertForbidden();
    expect(TermoConsentimento::find($termo['id'])->titulo)->not->toBe('X');
});

it('deve negar o catálogo a quem não tem a permissão do módulo', function () {
    // ARRANGE
    admin();
    $recepcao = usuarioCom(['pacientes.ver', 'pacientes.editar'], 'Recepção');

    // ACT + ASSERT
    $this->actingAs($recepcao)->getJson('/api/termos-consentimento')->assertForbidden();
    $this->actingAs($recepcao)->postJson('/api/termos-consentimento', [
        'titulo' => 'Regulamento', 'texto' => 'Texto.',
    ])->assertForbidden();
});

it('deve devolver a versão vigente a quem registra aceite, sem o texto', function () {
    // ARRANGE — todos os atores ANTES da 1ª request (guard pegajoso do sanctum)
    $adminDaClinica = admin();
    $recepcao = usuarioCom(['pacientes.ver', 'pacientes.editar'], 'Recepção');
    publicarTermo($adminDaClinica, texto: 'Texto integral que a recepção não precisa receber.');

    // ACT — trocar de usuário no meio do teste exige soltar sessão e guards (idioma da casa)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $resposta = $this->actingAs($recepcao)->getJson('/api/termos-consentimento/vigente');

    // ASSERT — nomeia a régua e nada mais
    $resposta->assertOk()
        ->assertJsonPath('termo.versao', 1)
        ->assertJsonMissingPath('termo.texto');
    semVazamento($resposta->json(), 'Texto integral');
});

it('deve dizer que não há vigente quando a clínica ainda não publicou', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/termos-consentimento/vigente');

    // ASSERT — "ainda não publicaram" é resposta legítima, e explícita
    $resposta->assertOk()->assertJsonPath('termo', null);
});

it('não deve dizer QUEM aceitou — só a contagem', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $termo = publicarTermo($adminDaClinica);
    Paciente::factory()->create([
        'nome' => 'Criança Fictícia da Prova',
        'consentimentos_json' => aceiteFicticio($termo['id'], 1, $adminDaClinica->id),
    ]);

    // ACT
    $lista = $this->actingAs($adminDaClinica)->getJson('/api/termos-consentimento');
    $detalhe = $this->actingAs($adminDaClinica)->getJson("/api/termos-consentimento/{$termo['id']}");

    // ASSERT — a contagem explica o texto travado; o nome do menor nunca aparece
    $lista->assertOk()->assertJsonPath('0.aceites_total', 1);
    $detalhe->assertOk()->assertJsonPath('aceites_total', 1);
    semVazamento($lista->json(), 'Criança Fictícia da Prova');
    semVazamento($detalhe->json(), 'Criança Fictícia da Prova');
});

it('não deve trazer o texto integral na listagem do histórico', function () {
    // ARRANGE
    $adminDaClinica = admin();
    publicarTermo($adminDaClinica, texto: 'Texto integral de cinquenta quilobytes.');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/termos-consentimento');

    // ASSERT — metadados na lista; texto só ao abrir a versão
    $resposta->assertOk()->assertJsonMissingPath('0.texto');
});
