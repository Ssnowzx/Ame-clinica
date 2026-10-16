<?php

it('deve responder ok no health', function () {
    // ACT
    $resposta = $this->getJson('/api/health');

    // ASSERT
    $resposta->assertOk()->assertJson(['status' => 'ok']);
});
