<?php

use App\Models\Auditoria;
use App\Models\Convenio;
use Carbon\Carbon;

it('deve aceitar o pedido e derivar o vencimento pela validade do convênio', function () {
    // ARRANGE — cenário da spec convenios: validade 6 meses, emissão 10/01 → vence 10/07
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();
    Convenio::findOrFail($payload['convenio_id'])->update(['pedido_validade_meses' => 6]);

    // ACT
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...$payload,
        'pedido_emitido_em' => '2026-01-10',
        'pedido_sessoes_por_semana' => 3,
    ]);

    // ASSERT — derivado no serializer, nunca coluna
    $criar->assertCreated()
        ->assertJsonPath('pedido_emitido_em', '2026-01-10')
        ->assertJsonPath('pedido_sessoes_por_semana', 3)
        ->assertJsonPath('pedido_vence_em', '2026-07-10');

    // e o show devolve o mesmo derivado
    $this->actingAs($adminDaClinica)->getJson('/api/tratamentos/'.$criar->json('id'))
        ->assertOk()->assertJsonPath('pedido_vence_em', '2026-07-10');
});

it('deve derivar 01/09 para validade de 3 meses e reagir à troca da validade do convênio', function () {
    // ARRANGE — cenário da spec tratamentos (SC Saúde: 3 meses; 01/06 → 01/09)
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();
    $convenio = Convenio::findOrFail($payload['convenio_id']);
    $convenio->update(['pedido_validade_meses' => 3]);

    $criar = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...$payload, 'pedido_emitido_em' => '2026-06-01',
    ]);
    $criar->assertCreated()->assertJsonPath('pedido_vence_em', '2026-09-01');

    // ACT — a clínica corrige a validade da operadora: o vencimento acompanha
    // (é exatamente por isso que vencimento NUNCA é coluna — design D4)
    $convenio->refresh();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/convenios/{$convenio->id}", [
        'nome' => $convenio->nome, 'pedido_validade_meses' => 6,
    ])->assertOk();

    // ASSERT
    $this->actingAs($adminDaClinica)->getJson('/api/tratamentos/'.$criar->json('id'))
        ->assertOk()->assertJsonPath('pedido_vence_em', '2026-12-01');
});

it('deve responder vencimento nulo quando o convênio não tem validade de pedido', function () {
    // ARRANGE — cenário da spec: sem validade não há alarme falso
    $adminDaClinica = admin();
    $payload = payloadDeTratamento(); // convênio sem pedido_validade_meses

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...$payload, 'pedido_emitido_em' => '2026-01-10',
    ])->assertCreated()->assertJsonPath('pedido_vence_em', null);
});

it('deve recusar emissão futura NO FUSO DA CLÍNICA — amanhã na parede não é o amanhã UTC', function () {
    // ARRANGE — 22h30 na parede da clínica (SP): o relógio UTC já virou o dia
    // seguinte. A data que é HOJE em UTC ainda é AMANHÃ na parede → 422 (SEC-LP-05).
    Carbon::setTestNow(Carbon::parse('2026-03-10 01:30:00', 'UTC'));
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();

    // ACT + ASSERT — "2026-03-10" é hoje em UTC, mas amanhã na clínica
    $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...$payload, 'pedido_emitido_em' => '2026-03-10',
    ])->assertUnprocessable()->assertJsonValidationErrors('pedido_emitido_em');

    // o hoje da PAREDE (2026-03-09) passa
    $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...$payload, 'pedido_emitido_em' => '2026-03-09',
    ])->assertCreated();

    Carbon::setTestNow();
});

it('deve recusar as faixas inválidas do pedido e da validade', function () {
    // ARRANGE — sessões 1..40 (tratamento) e validade 1..36 (convênio)
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();

    // ACT + ASSERT — override semanal fora da faixa
    foreach ([0, 41] as $invalido) {
        $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
            ...$payload, 'pedido_sessoes_por_semana' => $invalido,
        ])->assertUnprocessable()->assertJsonValidationErrors('pedido_sessoes_por_semana');
    }

    // validade do convênio fora da faixa
    $convenio = Convenio::findOrFail($payload['convenio_id']);
    foreach ([0, 37] as $invalido) {
        $this->actingAs($adminDaClinica)->putJsonComVersao("/api/convenios/{$convenio->id}", [
            'nome' => $convenio->nome, 'pedido_validade_meses' => $invalido,
        ])->assertUnprocessable()->assertJsonValidationErrors('pedido_validade_meses');
    }
});

it('deve expor a validade do pedido no payload do convênio', function () {
    // ARRANGE + ACT
    $adminDaClinica = admin();
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/convenios', [
        'nome' => 'Convênio Fictício', 'pedido_validade_meses' => 6,
    ]);

    // ASSERT — grava e devolve (a tela precisa preservar o campo a cada edição)
    $criar->assertCreated()->assertJsonPath('pedido_validade_meses', 6);
    $this->actingAs($adminDaClinica)->getJson('/api/convenios/'.$criar->json('id'))
        ->assertOk()->assertJsonPath('pedido_validade_meses', 6);
});

it('deve auditar os campos do pedido EM CLARO mantendo matricula e guia mascaradas', function () {
    // ARRANGE — SEC-LP-04: trilha em claro para os 3 campos novos; $auditExclude
    // permanece ['matricula', 'guia'] (retrodatação visível = o controle do R1)
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...$payload,
        'matricula' => 'MATRICULA-FICTICIA-1',
        'pedido_emitido_em' => '2026-01-10',
        'pedido_sessoes_por_semana' => 2,
    ]);
    $criar->assertCreated();

    // ASSERT — o criou: pedido em claro, matricula mascarada
    $criou = Auditoria::where('entidade', 'tratamentos')->where('acao', 'criou')->firstOrFail();
    expect($criou->diff_json['depois']['pedido_emitido_em'])->toBe('2026-01-10')
        ->and($criou->diff_json['depois']['pedido_sessoes_por_semana'])->toBe(2)
        ->and($criou->diff_json['depois']['matricula'])->toBe('***');

    // ACT — retrodatar a emissão: o antes/depois fica visível na trilha
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/tratamentos/'.$criar->json('id'), [
        ...$payload, 'pedido_emitido_em' => '2025-11-01',
    ])->assertOk();

    // ASSERT
    $atualizou = Auditoria::where('entidade', 'tratamentos')->where('acao', 'atualizou')
        ->latest('id')->firstOrFail();
    expect($atualizou->diff_json['antes']['pedido_emitido_em'])->toContain('2026-01-10')
        ->and($atualizou->diff_json['depois']['pedido_emitido_em'])->toBe('2025-11-01');
});

it('deve trazer os DERIVADOS do pedido na listagem e manter as COLUNAS fora (minimização)', function () {
    // ARRANGE — a linha do pedido vive no bloco de tratamentos, que consome a listagem
    // paginada: sem os derivados a superfície fica morta. O que NÃO sai em lista são as
    // colunas — a emissão e, sobretudo, o override semanal (SEC-LP-02/03).
    // Emissão de 8 meses atrás com validade de 6 → vencido HOJE na parede da clínica.
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();
    Convenio::findOrFail($payload['convenio_id'])->update(['pedido_validade_meses' => 6]);
    $emitidoEm = agoraNaClinica()->subMonthsNoOverflow(8);
    $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...$payload,
        'pedido_emitido_em' => $emitidoEm->format('Y-m-d'),
        'pedido_sessoes_por_semana' => 3,
    ])->assertCreated();

    // ACT
    $listagem = $this->actingAs($adminDaClinica)->getJson('/api/tratamentos');

    // ASSERT — os dois derivados presentes, com a MESMA derivação do detalhe...
    $listagem->assertOk();
    $naLista = $listagem->json('data.0');
    expect($naLista['pedido_vence_em'])
        ->toBe($emitidoEm->copy()->addMonthsNoOverflow(6)->format('Y-m-d'))
        // o veredito vem DECIDIDO do servidor (fuso da clínica, §13): o navegador
        // não tem esse fuso e compararia a data no do CLIENTE
        ->and($naLista['pedido_vencido'])->toBeTrue();

    // ...e as colunas do pedido ausentes: o override nunca sai em lista
    expect($naLista)
        ->not->toHaveKey('pedido_emitido_em')
        ->not->toHaveKey('pedido_sessoes_por_semana');
});

it('deve responder pedido_vencido false na listagem enquanto a data-limite não passou', function () {
    // ARRANGE — o outro lado do veredito, no DIA-LIMITE exato (`vencido` só quando o
    // limite é ANTERIOR a hoje), e o caso sem pedido, que não pode virar alarme falso.
    // Relógio fixo: a fronteira só é fronteira numa data conhecida
    Carbon::setTestNow(Carbon::parse('2026-05-20 12:00:00', 'UTC')); // 09h na parede (SP)
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();
    Convenio::findOrFail($payload['convenio_id'])->update(['pedido_validade_meses' => 6]);
    $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', [
        ...$payload, 'pedido_emitido_em' => '2025-11-20', // vence HOJE: ainda vale
    ])->assertCreated();
    $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', $payload)->assertCreated();

    // ACT — ordem é `id` DESC: o sem pedido primeiro, o do dia-limite depois
    $listagem = $this->actingAs($adminDaClinica)->getJson('/api/tratamentos');

    // ASSERT
    $listagem->assertOk();
    expect($listagem->json('data.0.pedido_vence_em'))->toBeNull()
        ->and($listagem->json('data.0.pedido_vencido'))->toBeFalse()
        ->and($listagem->json('data.1.pedido_vence_em'))->toBe('2026-05-20')
        ->and($listagem->json('data.1.pedido_vencido'))->toBeFalse();
});
