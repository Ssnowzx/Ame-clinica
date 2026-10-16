<?php

use App\Models\Convenio;

/**
 * `particular` decide o DESTINO DO DINHEIRO (`FaturamentoService`): tratamento de
 * convênio particular cai no caixa; de convênio, não (§14/T-fin-17).
 *
 * A tela de convênios apagava essa flag a cada edição, porque o `GET` não a
 * devolvia — a tela não conseguia preservar o que não enxergava (gate CR-CA-01).
 */
it('deve devolver a flag particular na leitura do convênio', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Particular', 'particular' => true]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/convenios');

    // ASSERT: sem isto, a tela não tem como preservar a flag
    $resposta->assertOk()->assertJsonPath('0.particular', true);
    $this->actingAs($adminDaClinica)
        ->getJson("/api/convenios/{$convenio->id}")
        ->assertJsonPath('particular', true);
});

it('deve preservar a flag particular quando o payload não a envia', function () {
    // ARRANGE: a regra é `sometimes` — campo ausente é campo INTOCADO
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Particular', 'particular' => true]);

    // ACT: a edição mais banal que existe — trocar o nome
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/convenios/{$convenio->id}", ['nome' => 'Particular (à vista)'])
        ->assertOk();

    // ASSERT
    expect($convenio->fresh()->particular)->toBeTrue();
});
