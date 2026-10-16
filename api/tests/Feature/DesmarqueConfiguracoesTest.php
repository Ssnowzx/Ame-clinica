<?php

use App\Models\StatusAgendamento;
use App\Support\Configuracoes\ConfiguracaoService;

/**
 * Os status vêm do conjunto default da clínica (`StatusAgendamentoDefaults`) — nada de
 * factory. E "Desmarcado pelo Profissional" JÁ EXISTE ali, com `desconta_sessao` falso e
 * `ocupa_horario` falso: o domínio (§6) antecipou esta operação, ela só não tinha gesto.
 */
function statusDaClinica(string $nome): StatusAgendamento
{
    return StatusAgendamento::where('nome', $nome)->firstOrFail();
}

it('deve devolver os defaults das três chaves do desmarque quando a clínica nunca gravou', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');

    // ASSERT — o teto e o corte têm default útil; o status nasce NÃO CONFIGURADO (0), e a
    // operação recusa com o caminho em vez de escolher um status por conta própria
    $resposta->assertOk();
    $chaves = collect($resposta->json('configuracoes'))->keyBy('chave');
    expect($chaves['agenda.desmarque_em_lote_maximo']['valor'])->toBe(60)
        ->and($chaves['agenda.corte_manha_tarde']['valor'])->toBe('12:00')
        ->and($chaves['agenda.status_desmarque_id']['valor'])->toBe(0);
});

it('deve recusar status que DESCONTA sessão como status do desmarque', function () {
    // ARRANGE — desmarcar por imprevisto do profissional não pode consumir a sessão da criança
    $adminDaClinica = admin();
    $descontante = statusDaClinica('Finalizado');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.status_desmarque_id',
        'valor' => $descontante->id,
    ]);

    // ASSERT
    $resposta->assertStatus(422);
    expect((int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id'))->toBe(0);
});

it('deve aceitar status que NÃO desconta sessão como status do desmarque', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $naoDescontante = statusDaClinica('Desmarcado pelo Profissional');

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.status_desmarque_id',
        'valor' => $naoDescontante->id,
    ])->assertOk();

    // ASSERT
    expect((int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id'))
        ->toBe($naoDescontante->id);
});

it('deve zerar o status do desmarque quando o status apontado é excluído', function () {
    // ARRANGE — `configuracoes` é chave-valor SEM chave estrangeira: nada no banco impede a
    // referência de ficar pendurada, e a recepção veria "falta configurar" sem entender por quê
    $adminDaClinica = admin();
    $alvo = statusDaClinica('Desmarcado pelo Profissional');
    $configuracoes = app(ConfiguracaoService::class);
    $configuracoes->set('agenda.status_desmarque_id', $alvo->id);

    // ACT
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/status-agendamento/{$alvo->id}")
        ->assertNoContent();

    // ASSERT
    expect((int) $configuracoes->get('agenda.status_desmarque_id'))->toBe(0);
});

it('deve recusar teto do lote fora da faixa do sistema', function () {
    // ARRANGE — teto zero desliga o freio; teto alto demais o esvazia
    $adminDaClinica = admin();

    // ACT / ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.desmarque_em_lote_maximo',
        'valor' => 0,
    ])->assertStatus(422);

    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.desmarque_em_lote_maximo',
        'valor' => 201,
    ])->assertStatus(422);

    expect((int) app(ConfiguracaoService::class)->get('agenda.desmarque_em_lote_maximo'))->toBe(60);
});

it('deve aceitar o corte manhã/tarde em hora válida e recusar o que não é hora', function () {
    // ARRANGE — a fronteira é regra da CLÍNICA (há turno que vira 13:00)
    $adminDaClinica = admin();

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.corte_manha_tarde',
        'valor' => '13:00',
    ])->assertOk();

    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.corte_manha_tarde',
        'valor' => 'meio-dia',
    ])->assertStatus(422);

    // ASSERT
    expect(app(ConfiguracaoService::class)->get('agenda.corte_manha_tarde'))->toBe('13:00');
});
