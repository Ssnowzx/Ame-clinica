<?php

use App\Models\Auditoria;
use App\Models\Convenio;
use App\Models\Servico;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Support\Configuracoes\ConfiguracaoService;

it('deve criar, listar, atualizar e excluir tratamento', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();

    // ACT + ASSERT — criar
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', $payload);
    $criar->assertCreated()
        ->assertJsonPath('status', 'andamento')
        ->assertJsonPath('sessoes_realizadas', 0)
        ->assertJsonPath('sessoes_saldo', 10)
        ->assertJsonPath('vencido', false);
    $id = $criar->json('id');

    // atualizar (parar o pacote)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$id}", [
        ...$payload, 'status' => 'parado',
    ])->assertOk()->assertJsonPath('status', 'parado');

    // excluir sem consumo → 204 + auditoria
    $this->actingAs($adminDaClinica)->deleteJson("/api/tratamentos/{$id}")->assertNoContent();
    expect(Tratamento::count())->toBe(0)
        ->and(Auditoria::where('entidade', 'tratamentos')->where('acao', 'excluiu')->exists())->toBeTrue();
});

it('deve ignorar sessoes_realizadas no payload', function () {
    // ARRANGE — abuse case 2 (T-trat-02: integridade do saldo)
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();

    // ACT — create com o campo proibido
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...$payload, 'sessoes_realizadas' => 5,
    ]);
    $criar->assertCreated()->assertJsonPath('sessoes_realizadas', 0);

    // update também não altera
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$criar->json('id')}", [
        ...$payload, 'sessoes_realizadas' => 7,
    ])->assertOk()->assertJsonPath('sessoes_realizadas', 0);
});

it('deve ignorar tipo no payload e nunca devolvê-lo', function () {
    // ARRANGE — SEC-TR-17. `tipo` é uma coluna de UM valor ('pacote', o default do
    // banco) e ZERO consumidores: nada no produto a lê. Enquanto ela era gravável
    // (`sometimes|string|max:30`, sem enum), qualquer um com `tratamentos.editar`
    // deixava um valor arbitrário guardado numa coluna que ninguém confere — pronto
    // para virar bypass no dia em que alguém pendurasse comportamento nela.
    // Fechar a porta é inútil se ninguém tentar a maçaneta: este teste tenta.
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();

    // ACT — create tentando plantar um tipo arbitrário
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...$payload, 'tipo' => 'invadido',
    ]);

    // ASSERT — nasce 'pacote' (default do banco) e o campo não sai na resposta
    $criar->assertCreated()->assertJsonMissingPath('tipo');
    $id = $criar->json('id');
    expect(Tratamento::findOrFail($id)->tipo)->toBe('pacote');

    // ACT — update tentando sobrescrever
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$id}", [
        ...$payload, 'tipo' => 'invadido',
    ])->assertOk()->assertJsonMissingPath('tipo');

    // ASSERT — a coluna continua intacta no banco
    expect(Tratamento::findOrFail($id)->tipo)->toBe('pacote');
});

it('deve rejeitar total abaixo do já consumido', function () {
    // ARRANGE — abuse case 6 (piso lido do banco)
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', $payload);
    Tratamento::findOrFail($criar->json('id'))->forceFill(['sessoes_realizadas' => 3])->save();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$criar->json('id')}", [
        ...$payload, 'sessoes_total' => 2,
    ])->assertUnprocessable()->assertJsonValidationErrors('sessoes_total');
});

it('deve calcular vencido por dias corridos e nunca vencer sem validade', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();

    // ACT + ASSERT — vencido: início há 40 dias, validade 30
    $vencido = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...$payload,
        'data_inicio' => now()->subDays(40)->toDateString(),
        'validade_dias' => 30,
    ]);
    $vencido->assertCreated()->assertJsonPath('vencido', true);

    // sem validade nunca vence
    $semValidade = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...payloadDeTratamento(),
        'data_inicio' => now()->subYears(2)->toDateString(),
    ]);
    $semValidade->assertCreated()->assertJsonPath('vencido', false);
});

it('deve considerar o dia-limite ainda válido', function () {
    // ARRANGE — contrato D2: vencido só quando o limite é ANTERIOR a hoje (gate r1)
    $adminDaClinica = admin();
    $fuso = app(ConfiguracaoService::class)->get('clinica.timezone');

    // ACT + ASSERT — início há 30 dias, validade 30 → limite é HOJE → válido
    $noLimite = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...payloadDeTratamento(),
        'data_inicio' => now($fuso)->subDays(30)->toDateString(),
        'validade_dias' => 30,
    ]);
    $noLimite->assertCreated()->assertJsonPath('vencido', false);

    // início há 31 dias, validade 30 → limite foi ontem → vencido
    $vencido = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...payloadDeTratamento(),
        'data_inicio' => now($fuso)->subDays(31)->toDateString(),
        'validade_dias' => 30,
    ]);
    $vencido->assertCreated()->assertJsonPath('vencido', true);
});

it('deve rejeitar serviço incoerente com o convênio inclusive em update parcial', function () {
    // ARRANGE — abuse case 3 (T-trat-03: estado final)
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();
    $outroConvenio = Convenio::create(['nome' => 'Outro Convênio']);

    // create com serviço de outro convênio → 422
    $servicoAlheio = new Servico(['procedimento' => 'Alheio', 'valor' => 1]);
    $servicoAlheio->convenio_id = $outroConvenio->id;
    $servicoAlheio->save();
    $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...$payload, 'servico_id' => $servicoAlheio->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('servico_id');

    // ACT — update trocando SÓ o convênio (serviço antigo fica incoerente)
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', $payload);
    $update = [...$payload, 'convenio_id' => $outroConvenio->id];
    unset($update['servico_id']);
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/tratamentos/{$criar->json('id')}", $update);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('servico_id');
});

it('deve aplicar a regra de duplicidade só quando a configuração está ativa', function () {
    // ARRANGE — abuse case 4 (T-trat-04) + spec (regra é DADO, §13)
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();
    $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', $payload)->assertCreated();

    // default off: duplicado permitido
    $duplicado = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', $payload);
    $duplicado->assertCreated();

    // liga a configuração (dado, não código)
    app(ConfiguracaoService::class)->set('tratamentos.bloquear_duplicado_mesmo_servico', true);

    // ACT + ASSERT — terceiro duplicado agora é bloqueado
    $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', $payload)
        ->assertUnprocessable()->assertJsonValidationErrors('servico_id');

    // burla via status: criar parado passa, mas mover para andamento → 422
    $parado = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...$payload, 'status' => 'parado',
    ]);
    $parado->assertCreated();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$parado->json('id')}", [
        ...$payload, 'status' => 'andamento',
    ])->assertUnprocessable()->assertJsonValidationErrors('servico_id');
});

it('deve rejeitar status fora do ciclo de vida', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...payloadDeTratamento(), 'status' => 'cancelado',
    ])->assertUnprocessable()->assertJsonValidationErrors('status');
});

it('deve bloquear exclusão de tratamento com sessões realizadas', function () {
    // ARRANGE — abuse case 7
    $adminDaClinica = admin();
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', payloadDeTratamento());
    Tratamento::findOrFail($criar->json('id'))->forceFill(['sessoes_realizadas' => 1])->save();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->deleteJson("/api/tratamentos/{$criar->json('id')}")
        ->assertUnprocessable()->assertJsonValidationErrors('tratamento');
    expect(Tratamento::count())->toBe(1);
});

it('deve manter matricula e guia fora da listagem e mascarados no diff', function () {
    // ARRANGE — abuse case 5 (T-trat-06)
    $adminDaClinica = admin();
    $payload = [...payloadDeTratamento(), 'matricula' => 'MAT-SIGILOSA-1', 'guia' => 'GUIA-SIGILOSA-1'];
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', $payload);
    $criar->assertCreated()->assertJsonPath('matricula', 'MAT-SIGILOSA-1');
    $id = $criar->json('id');

    // ACT — listagem, detalhe, update e delete
    $lista = $this->actingAs($adminDaClinica)->getJson('/api/tratamentos');
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$id}", [
        ...$payload, 'matricula' => 'MAT-SIGILOSA-2',
    ])->assertOk();
    $this->actingAs($adminDaClinica)->deleteJson("/api/tratamentos/{$id}")->assertNoContent();

    // ASSERT — lista sem os campos; trilha completa (criou/atualizou/excluiu) e
    // nenhum diff contém os valores (asserção não-vácua — gate r1)
    $lista->assertOk();
    expect($lista->json('data.0'))->not->toHaveKey('matricula')->not->toHaveKey('guia');
    $registros = Auditoria::where('entidade', 'tratamentos')->get();
    expect($registros->pluck('acao')->sort()->values()->all())
        ->toBe(['atualizou', 'criou', 'excluiu']);
    foreach ($registros as $registro) {
        expect(json_encode($registro->diff_json))->not->toContain('SIGILOSA');
    }
});

it('deve responder 403 sem permissão', function () {
    // ARRANGE
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)->getJson('/api/tratamentos')->assertForbidden();
});
