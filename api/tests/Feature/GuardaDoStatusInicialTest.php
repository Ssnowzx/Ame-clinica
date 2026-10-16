<?php

use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Servico;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Facades\DB;

/**
 * O status INICIAL (o de menor `ordem`) é com que todo agendamento nasce.
 * Sem estas guardas, a tela de status entrega à clínica o botão de brickar a
 * própria agenda com um campo numérico (parecer SEC-CA-01/05).
 */
function statusDaGuarda(string $nome): StatusAgendamento
{
    return StatusAgendamento::where('nome', $nome)->firstOrFail();
}

/** O payload do PUT é completo (o Request exige nome e cor sempre). */
function payloadDaGuarda(StatusAgendamento $status, array $extra = []): array
{
    return [
        'nome' => $status->nome,
        'cor' => $status->cor,
        'desconta_sessao' => $status->desconta_sessao,
        'ocupa_horario' => $status->ocupa_horario,
        'ordem' => $status->ordem,
        ...$extra,
    ];
}

it('deve recusar promover um status que desconta sessão à primeira posição', function () {
    // ARRANGE: "Finalizado" desconta sessão; "Em Aberto" (ordem 1) é o inicial hoje
    $adminDaClinica = admin();
    $finalizado = statusDaGuarda('Finalizado');
    expect($finalizado->desconta_sessao)->toBeTrue();

    // ACT: reordenar por estética — e a agenda inteira pararia de aceitar
    // agendamento futuro (o consumo de sessão recusa status descontante em data futura)
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/status-agendamento/{$finalizado->id}", payloadDaGuarda($finalizado, ['ordem' => 0]));

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors('status_agendamento');
    expect(StatusAgendamento::inicialId())->toBe(statusDaGuarda('Em Aberto')->id)
        ->and($finalizado->fresh()->ordem)->toBe(3);
});

it('deve recusar ligar desconta_sessao no status inicial', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $inicial = statusDaGuarda('Em Aberto');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/status-agendamento/{$inicial->id}", payloadDaGuarda($inicial, ['desconta_sessao' => true]));

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors('status_agendamento');
    expect($inicial->fresh()->desconta_sessao)->toBeFalse();
});

it('deve recusar desligar ocupa_horario no status inicial', function () {
    // ARRANGE: sem ocupar horário, o verificador de conflito deixa de enxergar os
    // cards — o mesmo horário passaria a aceitar dois agendamentos
    $adminDaClinica = admin();
    $inicial = statusDaGuarda('Em Aberto');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/status-agendamento/{$inicial->id}", payloadDaGuarda($inicial, ['ocupa_horario' => false]));

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors('status_agendamento');
    expect($inicial->fresh()->ocupa_horario)->toBeTrue();
});

it('deve recusar criar um status inicial que quebre a agenda', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT: nasce em primeiro lugar (ordem 0) já descontando sessão
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/status-agendamento', [
        'nome' => 'Chegou e Pagou',
        'cor' => '#123456',
        'desconta_sessao' => true,
        'ordem' => 0,
    ]);

    // ASSERT: a transação desfaz a criação
    $resposta->assertStatus(422)->assertJsonValidationErrors('status_agendamento');
    expect(StatusAgendamento::where('nome', 'Chegou e Pagou')->exists())->toBeFalse();
});

it('deve continuar permitindo reordenar dentro do que é seguro', function () {
    // ARRANGE: a guarda protege o invariante, não engessa a clínica
    $adminDaClinica = admin();
    $consulta = statusDaGuarda('Consulta');
    expect($consulta->desconta_sessao)->toBeFalse();

    // ACT: "Consulta" não desconta e ocupa horário — pode ser o inicial, desde que entre no
    // em aberto junto (baixa-em-lote-por-status, D2: o inicial é a origem do lote)
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/status-agendamento/{$consulta->id}", payloadDaGuarda($consulta, ['ordem' => 0, 'em_aberto' => true]));

    // ASSERT
    $resposta->assertOk();
    expect(StatusAgendamento::inicialId())->toBe($consulta->id);
});

it('deve recusar excluir o último status da clínica', function () {
    // ARRANGE: sem status não há inicial — nenhum agendamento poderia ser criado
    $adminDaClinica = admin();
    $sobrevivente = statusDaGuarda('Em Aberto');
    StatusAgendamento::whereKeyNot($sobrevivente->id)->delete();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->deleteJson("/api/status-agendamento/{$sobrevivente->id}");

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors('status_agendamento');
    expect(StatusAgendamento::count())->toBe(1);
});

it('deve recusar exclusão que promova um status descontante a inicial', function () {
    // ARRANGE: excluir os dois primeiros deixaria "Finalizado" (descontante) no topo
    $adminDaClinica = admin();
    $emAberto = statusDaGuarda('Em Aberto');
    $aguardando = statusDaGuarda('Aguardando Atendimento');
    $this->actingAs($adminDaClinica)->deleteJson("/api/status-agendamento/{$emAberto->id}")->assertNoContent();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->deleteJson("/api/status-agendamento/{$aguardando->id}");

    // ASSERT: a transação desfaz a exclusão
    $resposta->assertStatus(422);
    expect(StatusAgendamento::whereKey($aguardando->id)->exists())->toBeTrue()
        ->and(StatusAgendamento::inicialId())->toBe($aguardando->id);
});

it('deve recusar com 422 — nunca 500 — a exclusão de serviço vinculado a tratamento', function () {
    // ARRANGE: era o ÚNICO destroy de catálogo sem proteção de FK (parecer SEC-CA-02)
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);
    // o serviço é agregado do convênio: nasce pela relação (convenio_id não é fillable)
    $servico = $convenio->servicos()->create([
        'procedimento' => 'Sessão de Fonoaudiologia',
        'valor' => 120.00,
    ]);
    Tratamento::create([
        'paciente_id' => Paciente::factory()->create()->id,
        'convenio_id' => $convenio->id,
        'especialidade_id' => Especialidade::factory()->create()->id,
        'profissional_id' => Profissional::factory()->create()->id,
        'servico_id' => $servico->id,
        'sessoes_total' => 10,
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->deleteJson("/api/convenios/{$convenio->id}/servicos/{$servico->id}");

    // ASSERT: recusa traduzível, não erro de servidor
    $resposta->assertStatus(422)->assertJsonValidationErrors('servico');
    expect(Servico::whereKey($servico->id)->exists())->toBeTrue();
});

it('deve não promover a inicial um status criado sem ordem explícita', function () {
    // ARRANGE: `ordem` é `sometimes` e a coluna tem default 0 — um status novo sem
    // ordem nasceria em PRIMEIRO lugar e viraria o inicial da clínica em silêncio
    $adminDaClinica = admin();
    $inicialAntes = StatusAgendamento::inicialId();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/status-agendamento', [
        'nome' => 'Em Teleatendimento',
        'cor' => '#123456',
    ]);

    // ASSERT: nasce no FIM da fila, não no começo
    $resposta->assertCreated();
    expect(StatusAgendamento::inicialId())->toBe($inicialAntes)
        ->and($resposta->json('ordem'))->toBeGreaterThan(10);
});

it('deve desligar o encadeamento ao excluir o status que era o alvo', function () {
    // ARRANGE: a configuração aponta para um status numa tabela chave-valor SEM FK —
    // nada no banco impede a referência de ficar pendurada, e a automação morreria
    // em silêncio (o serviço relê o alvo e desiste)
    $adminDaClinica = admin();
    $alvo = statusDaGuarda('Reserva de Agenda');
    $configuracoes = app(ConfiguracaoService::class);
    $configuracoes->set('agenda.encadeamento_status_id', $alvo->id);
    $configuracoes->set('agenda.encadeamento_ativo', true);

    // ACT
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/status-agendamento/{$alvo->id}")
        ->assertNoContent();

    // ASSERT: a automação é desligada EXPLICITAMENTE, não deixada apontando para o vazio
    expect((int) $configuracoes->get('agenda.encadeamento_status_id'))->toBe(0)
        ->and($configuracoes->get('agenda.encadeamento_ativo'))->toBeFalse();
});

it('deve ler o status inicial SOB LOCK — sem ele, o write-skew volta em silêncio', function () {
    // ARRANGE: sem `for update`, duas transações concorrentes leem cada uma o seu
    // snapshot (REPEATABLE READ), aprovam estados que nunca coexistiram e, juntas,
    // deixam um status descontante como inicial — a agenda trava. O lock é o que
    // impede isso, e nada além deste teste impede alguém de "simplificar" e removê-lo.
    $adminDaClinica = admin();
    $consultas = [];
    DB::listen(function ($consulta) use (&$consultas) {
        $consultas[] = $consulta->sql;
    });

    // ACT
    $inicial = statusDaGuarda('Em Aberto');
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/status-agendamento/{$inicial->id}", payloadDaGuarda($inicial, ['ordem' => 2]))
        ->assertOk();

    // ASSERT
    $comLock = array_filter(
        $consultas,
        fn (string $sql) => str_contains($sql, 'status_agendamento') && str_contains($sql, 'for update'),
    );
    expect($comLock)->not->toBeEmpty();
});
