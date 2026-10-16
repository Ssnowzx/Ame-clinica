<?php

/**
 * Gatilho TISS-BLOB (parecer SEC-CA-04/14): `flags_tiss_json` é armazenamento
 * DORMENTE (§14). Sem shape, `convenios.editar` gravaria um blob arbitrário que o
 * `Auditavel` copia para a trilha append-only, sem exclusão — por onde PII de um
 * menor entraria de vez. O boundary passa a exigir mapa RASO e bounded.
 */
it('deve aceitar um mapa raso e pequeno de flags TISS', function () {
    // ARRANGE + ACT
    $resposta = $this->actingAs(admin())->postJson('/api/convenios', [
        'nome' => 'Unimed',
        'flags_tiss_json' => ['lote_automatico' => true, 'token' => 'abc123'],
    ]);

    // ASSERT
    $resposta->assertCreated();
});

it('deve RECUSAR um valor ANINHADO nas flags TISS (o vetor do blob) sem ecoar o valor', function () {
    // ARRANGE — o aninhamento é onde um blob/PII se esconde
    $segredo = 'PII_DO_MENOR_QUE_NAO_DEVE_ECOAR';

    // ACT
    $resposta = $this->actingAs(admin())->postJson('/api/convenios', [
        'nome' => 'Unimed',
        'flags_tiss_json' => ['blob' => ['aninhado' => $segredo]],
    ]);

    // ASSERT — 422 EM flags_tiss_json e a mensagem NÃO ecoa o valor recebido (dado sensível)
    $resposta->assertStatus(422)->assertJsonValidationErrors('flags_tiss_json');
    expect($resposta->getContent())->not->toContain($segredo);
});

it('deve RECUSAR flags TISS além do teto de chaves', function () {
    // ARRANGE — 40 chaves > MAX_FLAGS_TISS (30)
    $muitas = [];
    for ($i = 0; $i < 40; $i++) {
        $muitas["k{$i}"] = 'v';
    }

    // ACT + ASSERT
    $this->actingAs(admin())->postJson('/api/convenios', [
        'nome' => 'Unimed',
        'flags_tiss_json' => $muitas,
    ])->assertStatus(422)->assertJsonValidationErrors('flags_tiss_json');
});

it('deve RECUSAR um valor de flag TISS longo demais', function () {
    // ARRANGE — string > MAX_VALOR_TISS (255)
    $longo = str_repeat('x', 300);

    // ACT + ASSERT
    $this->actingAs(admin())->postJson('/api/convenios', [
        'nome' => 'Unimed',
        'flags_tiss_json' => ['token' => $longo],
    ])->assertStatus(422)->assertJsonValidationErrors('flags_tiss_json');
});

it('deve RECUSAR uma CHAVE de flag TISS longa demais (chave também é vetor de blob)', function () {
    // ARRANGE — chave > MAX_VALOR_TISS (255)
    $chaveLonga = str_repeat('k', 300);

    // ACT + ASSERT
    $this->actingAs(admin())->postJson('/api/convenios', [
        'nome' => 'Unimed',
        'flags_tiss_json' => [$chaveLonga => 'v'],
    ])->assertStatus(422)->assertJsonValidationErrors('flags_tiss_json');
});

it('deve aceitar a AUSÊNCIA de flags TISS (campo dormente §14)', function () {
    // ARRANGE + ACT + ASSERT
    $this->actingAs(admin())->postJson('/api/convenios', ['nome' => 'SUS'])->assertCreated();
});
