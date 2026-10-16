<?php

use App\Models\Agendamento;
use App\Models\Configuracao;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Support\Agenda\CatalogoIconesStatus;
use Spatie\Permission\Models\Role;

/**
 * Configurações de EXIBIÇÃO da grade, ícone do status e teto da consulta —
 * a fundação de dados da change de telas (parecer T-sag-02/03/06/13).
 */

// ── Configurações de exibição (T-sag-02 e T-sag-06) ─────────────────────────

it('deve entregar as configurações de exibição da grade a quem tem agenda.ver', function () {
    // ARRANGE — nível com SOMENTE agenda.ver: a recepção NÃO tem configuracoes.ver
    $adminDaClinica = admin();
    $recepcao = Role::create(['name' => 'Recepção Fictícia']);
    $recepcao->givePermissionTo('agenda.ver');
    $usuarioRecepcao = Usuario::factory()->create();
    $usuarioRecepcao->syncRoles([$recepcao]);

    // ACT
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $resposta = $this->actingAs($usuarioRecepcao)->getJson('/api/agenda/configuracoes');

    // ASSERT — a grade desenha sem exigir a permissão do catálogo inteiro
    $resposta->assertOk();
    $chaves = collect($resposta->json('configuracoes'))->pluck('chave');
    expect($chaves)->toContain('agenda.granularidade_min', 'agenda.fim_de_semana', 'agenda.visao_padrao');
});

it('deve esconder o catálogo geral no endpoint de exibição da agenda', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/agenda/configuracoes');

    /*
     * ASSERT — o conjunto EXATO, não dois nomes proibidos (T-sag-02).
     *
     * Nomear o que não pode vazar é lista de NEGAÇÃO: libera por omissão a chave seguinte, e
     * é o mesmo defeito que esta change corrigiu dois andares acima. `CatalogoConfiguracoesTest`
     * fixa a constante; aqui fixamos o que a recepção de fato RECEBE — mutar o controller para
     * empurrar chaves fora da allowlist deixava 1186 verdes (achado SEC-SDC-R4-02).
     */
    $chaves = collect($resposta->json('configuracoes'))->pluck('chave');
    expect($chaves->all())->toBe([
        'agenda.granularidade_min',
        'agenda.fim_de_semana',
        'agenda.visao_padrao',
        'agenda.janela_padrao_inicio',
        'agenda.janela_padrao_fim',
        'agenda.arrastar_para_remarcar',
        'clinica.timezone',
        'evolucoes.responsavel_tecnico_obrigatorio',
        // evolucao-finaliza-a-sessao: o id do status que salvar a evolução aplica — o painel avisa
        // que a sessão vai ser finalizada ANTES do clique. Os status já chegam à agenda pela seleção
        'evolucoes.status_ao_salvar',
    ]);
});

it('deve continuar exigindo configuracoes.ver no catálogo completo', function () {
    // ARRANGE — o mesmo nível de recepção
    $adminDaClinica = admin();
    $recepcao = Role::create(['name' => 'Recepção Fictícia']);
    $recepcao->givePermissionTo('agenda.ver');
    $usuarioRecepcao = Usuario::factory()->create();
    $usuarioRecepcao->syncRoles([$recepcao]);

    // ACT + ASSERT
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($usuarioRecepcao)->getJson('/api/configuracoes')->assertForbidden();
});

it('deve retornar os defaults de exibição quando a clínica nunca configurou', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/agenda/configuracoes');

    // ASSERT
    $configuracoes = collect($resposta->json('configuracoes'))->keyBy('chave');
    expect($configuracoes['agenda.granularidade_min']['valor'])->toBe(40);
    expect($configuracoes['agenda.fim_de_semana']['valor'])->toBe('nenhum');
    expect($configuracoes['agenda.visao_padrao']['valor'])->toBe('dia');
    expect($configuracoes['agenda.janela_padrao_inicio']['valor'])->toBe('08:00');
});

it('deve rejeitar granularidade fora do intervalo', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.granularidade_min',
        'valor' => 3,
    ])->assertStatus(422);
});

it('deve rejeitar valor fora do domínio das chaves de opções', function () {
    // ARRANGE — antes do T-sag-06, string sem formato aceitava QUALQUER valor
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.fim_de_semana',
        'valor' => 'quinta',
    ])->assertStatus(422);

    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.visao_padrao',
        'valor' => 'mes',
    ])->assertStatus(422);
});

it('deve rejeitar hora malformada na janela padrão', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT — 24:00 e 08:60 não são horas de relógio
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.janela_padrao_inicio',
        'valor' => '24:00',
    ])->assertStatus(422);

    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.janela_padrao_fim',
        'valor' => '08:60',
    ])->assertStatus(422);
});

it('deve rejeitar janela padrão que termina antes de começar', function () {
    // ARRANGE — a invariante é do PAR, validada contra o ESTADO FINAL
    $adminDaClinica = admin();

    // ACT + ASSERT — fim 07:00 contra o início efetivo (08:00)
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.janela_padrao_fim',
        'valor' => '07:00',
    ])->assertStatus(422);

    // e o simétrico: início depois do fim efetivo (19:00)
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.janela_padrao_inicio',
        'valor' => '20:00',
    ])->assertStatus(422);
});

it('deve aceitar janela padrão coerente', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.janela_padrao_inicio',
        'valor' => '07:30',
    ])->assertOk();
});

it('deve rejeitar fuso horário inexistente', function () {
    // ARRANGE — o cliente entrega este valor ao Intl, que LANÇA: fuso inválido
    // deixaria a agenda em branco para a clínica inteira (SEC-R2)
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.timezone',
        'valor' => 'America/Sao Paulo', // espaço no lugar do sublinhado
    ])->assertStatus(422);
});

it('deve aceitar fuso horário IANA válido', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.timezone',
        'valor' => 'America/Manaus',
    ])->assertOk();
});

// ── Arrastar para remarcar (change arrastar-para-remarcar, D4) ──────────────

it('deve retornar o arrastar para remarcar desligado e booleano por padrão', function () {
    // ARRANGE — clínica que nunca configurou a agenda (D4: opt-in conservador)
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/agenda/configuracoes');

    // ASSERT — false de verdade (booleano tipado), não string nem int
    $resposta->assertOk();
    $configuracoes = collect($resposta->json('configuracoes'))->keyBy('chave');
    expect($configuracoes['agenda.arrastar_para_remarcar']['valor'])->toBeFalse();
});

it('deve rejeitar valor não booleano no arrastar para remarcar sem persistir', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.arrastar_para_remarcar',
        'valor' => 'sim',
    ]);

    // ASSERT — 422 do catálogo tipado e nenhum override gravado
    $resposta->assertStatus(422)->assertJsonValidationErrors('valor');
    expect(Configuracao::count())->toBe(0);
});

it('deve entregar o arrastar para remarcar efetivo a quem só tem agenda.ver', function () {
    // ARRANGE — a recepção NÃO tem configuracoes.ver (Role ANTES de qualquer
    // request: uma request via sanctum mudaria o guard default do Spatie)
    $adminDaClinica = admin();
    $recepcao = Role::create(['name' => 'Recepção Fictícia']);
    $recepcao->givePermissionTo('agenda.ver');
    $usuarioRecepcao = Usuario::factory()->create();
    $usuarioRecepcao->syncRoles([$recepcao]);

    // e o admin liga o gesto na clínica
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.arrastar_para_remarcar',
        'valor' => true,
    ])->assertOk();

    // ACT
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $resposta = $this->actingAs($usuarioRecepcao)->getJson('/api/agenda/configuracoes');

    // ASSERT — o valor EFETIVO da clínica (override ligado), lido sob agenda.ver
    $resposta->assertOk();
    $configuracoes = collect($resposta->json('configuracoes'))->keyBy('chave');
    expect($configuracoes['agenda.arrastar_para_remarcar']['valor'])->toBeTrue();
});

// ── Ícone do status (T-sag-04/13) ───────────────────────────────────────────

it('deve nascer com o ícone em cada status default da clínica', function () {
    // ARRANGE + ACT — o ClinicaObserver semeia os defaults
    admin();

    // ASSERT — sem ícone, a tela derivaria do NOME (string-match proibido §13)
    $status = StatusAgendamento::query()->pluck('tipo', 'nome');
    expect($status['Finalizado'])->toBe('check');
    expect($status['Não Compareceu'])->toBe('user-x');
    expect($status->filter(fn (?string $tipo) => $tipo === null))->toBeEmpty();
});

it('deve rejeitar ícone fora do catálogo de ícones', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT — slug livre viraria lookup dinâmico no cliente
    $this->actingAs($adminDaClinica)->postJson('/api/status-agendamento', [
        'nome' => 'Status Fictício',
        'cor' => '#123456',
        'tipo' => 'constructor',
    ])->assertStatus(422);
});

it('deve aceitar status sem ícone', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT — ícone é opcional; a interface cai no neutro
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/status-agendamento', [
        'nome' => 'Status Sem Ícone',
        'cor' => '#123456',
    ]);

    // ASSERT
    $resposta->assertCreated();
    expect(CatalogoIconesStatus::existe('circle-dot'))->toBeTrue();
});

// ── Card da agenda: ícone + convênio + teto (T-sag-03, D11) ─────────────────

function agendamentoDeTeste(bool $comTratamento = true, bool $particular = false): Agendamento
{
    $especialidade = Especialidade::factory()->create();
    $profissional = Profissional::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);
    $paciente = Paciente::factory()->create();
    $status = StatusAgendamento::query()->where('nome', 'Em Aberto')->firstOrFail();

    $tratamento = null;
    if ($comTratamento) {
        $convenio = Convenio::create([
            'nome' => $particular ? 'Particular' : 'Convênio Fictício '.fake()->unique()->word(),
            'particular' => $particular,
        ]);
        $tratamento = Tratamento::factory()->create([
            'paciente_id' => $paciente->id,
            'profissional_id' => $profissional->id,
            'especialidade_id' => $especialidade->id,
            'convenio_id' => $convenio->id,
            'sessoes_total' => 12,
        ]);
    }

    return Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'tratamento_id' => $tratamento?->id,
        'status_id' => $status->id,
        'inicio' => agoraNaClinica()->copy()->addDay()->setTime(8, 0),
        'fim' => agoraNaClinica()->copy()->addDay()->setTime(8, 40),
    ]);
}

it('deve entregar o ícone do status e o convênio no card da grade', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $agendamento = agendamentoDeTeste();
    $dia = $agendamento->inicio->format('Y-m-d');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson("/api/agenda?de={$dia}&ate={$dia}");

    // ASSERT — o chip renderiza ícone+nome e a recepção distingue o convênio
    $resposta->assertOk();
    $card = $resposta->json('0');
    expect($card['status']['tipo'])->toBe('circle-dashed');
    expect($card['convenio']['nome'])->toStartWith('Convênio Fictício');
    expect($card['convenio']['particular'])->toBeFalse();
    expect($card['tratamento_total'])->toBe(12);
});

it('deve dizer no cartão da grade se a situação ocupa o horário', function () {
    // ARRANGE — a MESMA flag que o VerificadorDeConflitos usa para decidir conflito. Sem ela no
    // cartão, a grade chama de ocupada a célula que o servidor já aceita marcar de novo.
    $adminDaClinica = admin();
    $agendamento = agendamentoDeTeste(comTratamento: false);
    $dia = $agendamento->inicio->format('Y-m-d');

    // ACT — primeiro na situação que ocupa
    $comOcupacao = $this->actingAs($adminDaClinica)->getJson("/api/agenda?de={$dia}&ate={$dia}");

    // ARRANGE — depois numa situação que LIBERA o horário
    $libera = StatusAgendamento::query()->where('nome', 'Desmarcado pelo Profissional')->firstOrFail();
    $agendamento->forceFill(['status_id' => $libera->id])->save();

    // ACT
    $semOcupacao = $this->actingAs($adminDaClinica)->getJson("/api/agenda?de={$dia}&ate={$dia}");

    // ASSERT — os dois valores, porque um booleano fixo passaria por metade do teste
    $comOcupacao->assertOk();
    $semOcupacao->assertOk();
    expect($comOcupacao->json('0.status.ocupa_horario'))->toBeTrue();
    expect($semOcupacao->json('0.status.ocupa_horario'))->toBeFalse();
});

it('deve marcar o atendimento particular pela flag do cadastro', function () {
    // ARRANGE — "Particular" é um convênio como outro (fronteira §14 como DADO)
    $adminDaClinica = admin();
    $agendamento = agendamentoDeTeste(particular: true);
    $dia = $agendamento->inicio->format('Y-m-d');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson("/api/agenda?de={$dia}&ate={$dia}");

    // ASSERT
    expect($resposta->json('0.convenio.particular'))->toBeTrue();
});

it('deve não inventar convênio para agendamento sem tratamento', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $agendamento = agendamentoDeTeste(comTratamento: false);
    $dia = $agendamento->inicio->format('Y-m-d');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson("/api/agenda?de={$dia}&ate={$dia}");

    // ASSERT
    $card = $resposta->json('0');
    expect($card['convenio'])->toBeNull();
    expect($card['tratamento_total'])->toBeNull();
});

it('deve não gerar N+1 ao montar a grade cheia', function () {
    // ARRANGE — vários cards de tratamentos/convênios distintos
    $adminDaClinica = admin();
    for ($i = 0; $i < 5; $i++) {
        agendamentoDeTeste();
    }
    $dia = agoraNaClinica()->copy()->addDay()->format('Y-m-d');

    // ACT — conta as queries do request
    $consultas = 0;
    DB::listen(function () use (&$consultas) {
        $consultas++;
    });
    $this->actingAs($adminDaClinica)->getJson("/api/agenda?de={$dia}&ate={$dia}")->assertOk();

    // ASSERT — eager-load fixo (o convênio aninhado NÃO vira query por card)
    expect($consultas)->toBeLessThan(20);
});

it('deve rejeitar consulta que excede o teto de itens', function () {
    // ARRANGE — colheita em massa da rotina física de menores (T-sag-03)
    $adminDaClinica = admin();
    $especialidade = Especialidade::factory()->create();
    $profissional = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    $status = StatusAgendamento::query()->where('nome', 'Em Aberto')->firstOrFail();
    $base = agoraNaClinica()->copy()->addDay()->setTime(0, 0);

    $linhas = [];
    for ($i = 0; $i < 2001; $i++) {
        $inicio = $base->copy()->addMinutes($i);
        $linhas[] = [
            'tipo' => 'atendimento',
            'paciente_id' => $paciente->id,
            'profissional_id' => $profissional->id,
            'especialidade_id' => $especialidade->id,
            'status_id' => $status->id,
            'origem' => 'recepcao',
            'inicio' => $inicio->format('Y-m-d H:i:s'),
            'fim' => $inicio->copy()->addMinute()->format('Y-m-d H:i:s'),
            'created_at' => now(),
            'updated_at' => now(),
        ];
    }
    foreach (array_chunk($linhas, 500) as $lote) {
        DB::table('agendamentos')->insert($lote);
    }
    $de = $base->format('Y-m-d');
    $ate = $base->copy()->addDays(3)->format('Y-m-d');

    // ACT + ASSERT — 422 pedindo período menor, em vez de despejar tudo
    $this->actingAs($adminDaClinica)->getJson("/api/agenda?de={$de}&ate={$ate}")
        ->assertStatus(422);
});
