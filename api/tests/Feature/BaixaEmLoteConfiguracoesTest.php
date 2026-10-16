<?php

use App\Support\Configuracoes\CatalogoConfiguracoes;
use App\Support\Configuracoes\ConfiguracaoService;

/**
 * O teto da baixa em lote por status é DADO (§13, change baixa-em-lote-por-status, D12) —
 * próprio, separado do teto do desmarque: o desmarque avisa famílias e por isso é baixo; a
 * baixa não envia mensagem e alcança uma semana inteira de um profissional.
 *
 * Molde de `DesmarqueConfiguracoesTest`.
 */
it('deve devolver o teto da baixa em lote como inteiro 100, faixa 1..200, na seção agenda', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');

    // ASSERT — default útil, tipado, com a faixa e o rótulo em português ao lado
    $resposta->assertOk();
    $teto = collect($resposta->json('configuracoes'))->keyBy('chave')['agenda.baixa_em_lote_maximo'];
    expect($teto['valor'])->toBe(100)
        ->and($teto['tipo'])->toBe('int')
        ->and($teto['min'])->toBe(1)
        ->and($teto['max'])->toBe(200)
        ->and($teto['secao'])->toBe('agenda')
        ->and($teto['rotulo'])->toBe('Máximo de agendamentos por baixa em lote');
});

it('deve aceitar as bordas 1 e 200 do teto da baixa em lote', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    foreach ([1, 200] as $naBorda) {
        $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
            'chave' => 'agenda.baixa_em_lote_maximo',
            'valor' => $naBorda,
        ])->assertOk();
        expect((int) app(ConfiguracaoService::class)->get('agenda.baixa_em_lote_maximo'))->toBe($naBorda);
    }
});

it('deve recusar teto da baixa em lote fora da faixa ou fora do tipo, mantendo o valor anterior', function () {
    // ARRANGE — teto zero desliga o freio; teto alto demais o esvazia
    $adminDaClinica = admin();

    // ACT + ASSERT
    foreach ([0, 201, -1, 'cem', 2.5] as $invalido) {
        $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
            'chave' => 'agenda.baixa_em_lote_maximo',
            'valor' => $invalido,
        ])->assertUnprocessable()->assertJsonValidationErrors('valor');
    }

    expect((int) app(ConfiguracaoService::class)->get('agenda.baixa_em_lote_maximo'))->toBe(100);
});

it('deve manter o teto da baixa em lote fora da leitura de exibição da agenda', function () {
    // ARRANGE — a grade não precisa dele para desenhar; quem passa do teto é avisado pelo 422
    admin();
    $soDaAgenda = usuarioCom(['agenda.ver'], 'Só agenda');

    // ACT
    $exibicao = $this->actingAs($soDaAgenda)->getJson('/api/agenda/configuracoes')->assertOk();

    // ASSERT — fora da allowlist, fora da resposta, e o catálogo inteiro continua exigindo configuracoes.ver
    expect(CatalogoConfiguracoes::CHAVES_EXIBICAO_AGENDA)->not->toContain('agenda.baixa_em_lote_maximo')
        ->and(collect($exibicao->json('configuracoes'))->pluck('chave')->all())
        ->not->toContain('agenda.baixa_em_lote_maximo');
    $this->actingAs($soDaAgenda)->getJson('/api/configuracoes')->assertForbidden();
});
