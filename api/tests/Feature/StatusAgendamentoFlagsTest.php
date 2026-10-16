<?php

use App\Models\Auditoria;
use App\Models\StatusAgendamento;
use App\Support\Agenda\GuardaDasFlagsDeDesfecho;
use App\Support\Agenda\GuardaDoStatusInicial;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Finder\Finder;

/**
 * "Em aberto" e "aplicável em lote" são DADO do status (change baixa-em-lote-por-status, D2),
 * com os invariantes que impedem a clínica de se machucar: sem eles, "Reserva de Agenda"
 * marcada como em aberto faria um Finalizar em massa consumir sessão de quem nem veio.
 *
 * Os status vêm do conjunto default da clínica (`StatusAgendamentoDefaults`) — nada de
 * factory. "Consulta" é o status LIMPO da cena (não desconta, não marca nada, ocupa horário,
 * não é origem nem alvo do lote): é nele que cada defeito é ligado, um por vez.
 */
function statusDasFlags(string $nome): StatusAgendamento
{
    return StatusAgendamento::where('nome', $nome)->firstOrFail();
}

/** O PUT exige nome e cor sempre; as flags são `sometimes` — só o que o teste liga viaja. */
function payloadDasFlags(StatusAgendamento $status, array $extra = []): array
{
    return ['nome' => $status->nome, 'cor' => $status->cor, ...$extra];
}

/** A clínica como era ANTES da migration: os defaults existem, mas sem nenhuma das duas flags. */
function clinicaSemAsFlags(): void
{
    StatusAgendamento::query()->update(['em_aberto' => false, 'aplicavel_em_lote' => false]);
}

/**
 * O CORPO da migration, pelo caminho de verdade (molde do teste de `conceder_cadastro_online`):
 * o `RefreshDatabase` já a rodou, e um `migrate` aqui seria no-op. O que se prova é que o
 * `up()` semeia e varre — comentar a semente ou a varredura derruba os testes abaixo.
 */
function rodarAMigrationDasFlags(): void
{
    $arquivo = collect(iterator_to_array(
        Finder::create()->files()
            ->in(dirname(__DIR__, 2).'/database/migrations')
            ->name('*add_em_aberto_e_aplicavel_em_lote_to_status_agendamento*.php')
    ))->first();

    expect($arquivo)->not->toBeNull();

    $migration = require $arquivo->getPathname();
    $migration->up();
}

/** @return array<string, array{em_aberto: bool, aplicavel_em_lote: bool}> */
function flagsDoLotePorNome(): array
{
    return StatusAgendamento::query()
        ->get(['nome', 'em_aberto', 'aplicavel_em_lote'])
        ->mapWithKeys(fn (StatusAgendamento $s) => [$s->nome => [
            'em_aberto' => $s->em_aberto,
            'aplicavel_em_lote' => $s->aplicavel_em_lote,
        ]])
        ->all();
}

it('deve nascer com em_aberto na origem, aplicavel_em_lote no alvo e marca_reserva na reserva', function () {
    // ARRANGE / ACT — clínica NOVA (criada pelo TestCase): as flags vêm dos DEFAULTS, sem backfill

    // ASSERT — exatamente estes, e nenhum outro
    $emAberto = StatusAgendamento::where('em_aberto', true)->pluck('nome')->sort()->values()->all();
    $alvos = StatusAgendamento::where('aplicavel_em_lote', true)->pluck('nome')->sort()->values()->all();
    $reservas = StatusAgendamento::where('marca_reserva', true)->pluck('nome')->all();

    expect($emAberto)->toBe(['Aguardando Atendimento', 'Em Aberto'])
        ->and($alvos)->toBe(['Falta Justificada', 'Finalizado'])
        ->and($reservas)->toBe(['Reserva de Agenda']);
});

it('deve recusar em_aberto num status cujo desfecho é {0}', function (string $flag, bool $valorEmConflito) {
    // ARRANGE — um defeito por vez, em cima do status limpo
    $adminDaClinica = admin();
    $consulta = statusDasFlags('Consulta');
    $valorAntes = $consulta->{$flag};
    expect($valorAntes)->not->toBe($valorEmConflito);

    // ACT — liga em_aberto E o desfecho no mesmo save
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/status-agendamento/{$consulta->id}",
        payloadDasFlags($consulta, ['em_aberto' => true, $flag => $valorEmConflito]),
    );

    // ASSERT — 422 pousado na flag que a gravação ligou, com a mensagem do delta; nada persiste
    $resposta->assertStatus(422)
        ->assertJsonValidationErrors(['em_aberto' => GuardaDasFlagsDeDesfecho::MENSAGEM_DESFECHO]);
    $consulta->refresh();
    expect($consulta->em_aberto)->toBeFalse()
        ->and($consulta->{$flag})->toBe($valorAntes);
})->with([
    ['desconta_sessao', true],
    ['marca_falta', true],
    ['marca_reserva', true],
    ['ocupa_horario', false],
]);

it('deve recusar ligar desconta_sessao num status que já está em aberto — a guarda vale na direção contrária', function () {
    // ARRANGE — "Aguardando Atendimento" nasce em aberto e NÃO é o inicial (a razão do
    // inicial tem mensagem própria; aqui se prova a das flags)
    $adminDaClinica = admin();
    $aguardando = statusDasFlags('Aguardando Atendimento');
    expect($aguardando->em_aberto)->toBeTrue();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/status-agendamento/{$aguardando->id}",
        payloadDasFlags($aguardando, ['desconta_sessao' => true]),
    );

    // ASSERT — a recusa pousa na flag ligada (desconta_sessao), com a MESMA mensagem
    $resposta->assertStatus(422)
        ->assertJsonValidationErrors(['desconta_sessao' => GuardaDasFlagsDeDesfecho::MENSAGEM_DESFECHO]);
    expect($aguardando->fresh()->desconta_sessao)->toBeFalse();
});

it('deve recusar criar um status em aberto que também é opção de baixa', function () {
    // ARRANGE — o alvo nunca é a origem
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/status-agendamento', [
        'nome' => 'Chegou e Já Baixou',
        'cor' => '#123456',
        'em_aberto' => true,
        'aplicavel_em_lote' => true,
    ]);

    // ASSERT — a transação desfaz a criação
    $resposta->assertStatus(422)
        ->assertJsonValidationErrors(['em_aberto' => GuardaDasFlagsDeDesfecho::MENSAGEM_ALVO]);
    expect(StatusAgendamento::where('nome', 'Chegou e Já Baixou')->exists())->toBeFalse();
});

it('deve recusar juntar origem e alvo ao editar "{0}", pousando em {1}', function (string $nome, string $flagLigada) {
    // ARRANGE — nas duas direções: ligar em_aberto num alvo, ou ligar aplicavel_em_lote numa origem
    $adminDaClinica = admin();
    $status = statusDasFlags($nome);
    expect($status->{$flagLigada})->toBeFalse();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/status-agendamento/{$status->id}",
        payloadDasFlags($status, [$flagLigada => true]),
    );

    // ASSERT
    $resposta->assertStatus(422)
        ->assertJsonValidationErrors([$flagLigada => GuardaDasFlagsDeDesfecho::MENSAGEM_ALVO]);
    expect($status->fresh()->{$flagLigada})->toBeFalse();
})->with([
    ['Falta Justificada', 'em_aberto'],
    ['Aguardando Atendimento', 'aplicavel_em_lote'],
]);

it('deve recusar reordenar quando o novo inicial não está em aberto', function () {
    // ARRANGE — "Consulta" não desconta e ocupa horário (passaria na guarda antiga), mas
    // está fora do em aberto: todo agendamento nasceria fora do alcance da baixa
    $adminDaClinica = admin();
    $consulta = statusDasFlags('Consulta');
    $inicialAntes = StatusAgendamento::inicialId();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/status-agendamento/{$consulta->id}",
        payloadDasFlags($consulta, ['ordem' => 0]),
    );

    // ASSERT — a ordem anterior permanece
    $resposta->assertStatus(422)
        ->assertJsonValidationErrors(['status_agendamento' => GuardaDoStatusInicial::MENSAGEM_INICIAL_FORA_DO_EM_ABERTO]);
    expect(StatusAgendamento::inicialId())->toBe($inicialAntes)
        ->and($consulta->fresh()->ordem)->toBe(9);
});

it('deve recusar desligar em_aberto do status inicial', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $inicial = statusDasFlags('Em Aberto');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/status-agendamento/{$inicial->id}",
        payloadDasFlags($inicial, ['em_aberto' => false]),
    );

    // ASSERT — a flag permanece ligada
    $resposta->assertStatus(422)
        ->assertJsonValidationErrors(['status_agendamento' => GuardaDoStatusInicial::MENSAGEM_INICIAL_FORA_DO_EM_ABERTO]);
    expect($inicial->fresh()->em_aberto)->toBeTrue();
});

it('deve recusar excluir o inicial quando o próximo na ordem não está em aberto', function () {
    // ARRANGE — "Aguardando" perde a flag por fora da API (a cena é o ESTADO, não o caminho);
    // excluir "Em Aberto" o promoveria a inicial fora do em aberto
    $adminDaClinica = admin();
    $emAberto = statusDasFlags('Em Aberto');
    $aguardando = statusDasFlags('Aguardando Atendimento');
    StatusAgendamento::whereKey($aguardando->id)->update(['em_aberto' => false]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->deleteJson("/api/status-agendamento/{$emAberto->id}");

    // ASSERT — a transação desfaz a exclusão
    $resposta->assertStatus(422)
        ->assertJsonValidationErrors(['status_agendamento' => GuardaDoStatusInicial::MENSAGEM_INICIAL_FORA_DO_EM_ABERTO]);
    expect(StatusAgendamento::whereKey($emAberto->id)->exists())->toBeTrue()
        ->and(StatusAgendamento::inicialId())->toBe($emAberto->id);
});

it('deve expor e gravar marca_reserva, em_aberto e aplicavel_em_lote pelo cadastro', function () {
    // ARRANGE — o anti-exemplo: `marca_reserva` era decisão da clínica na spec e não entrava
    // nem saía pela API
    $adminDaClinica = admin();
    $consulta = statusDasFlags('Consulta');

    // ACT — a leitura traz as três; a gravação persiste as três
    $lista = $this->actingAs($adminDaClinica)->getJson('/api/status-agendamento')->assertOk()->json();
    $gravacao = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/status-agendamento/{$consulta->id}",
        payloadDasFlags($consulta, ['marca_reserva' => true, 'em_aberto' => false, 'aplicavel_em_lote' => true]),
    );

    // ASSERT
    foreach ($lista as $status) {
        expect($status)->toHaveKeys(['marca_reserva', 'em_aberto', 'aplicavel_em_lote']);
    }
    $gravacao->assertOk()
        ->assertJsonPath('marca_reserva', true)
        ->assertJsonPath('em_aberto', false)
        ->assertJsonPath('aplicavel_em_lote', true);
    $this->actingAs($adminDaClinica)->getJson("/api/status-agendamento/{$consulta->id}")
        ->assertOk()
        ->assertJsonPath('marca_reserva', true)
        ->assertJsonPath('aplicavel_em_lote', true);
    $consulta->refresh();
    expect($consulta->marca_reserva)->toBeTrue()
        ->and($consulta->aplicavel_em_lote)->toBeTrue();
});

it('deve auditar o flip de em_aberto como diff, sem recálculo retroativo', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $consulta = statusDasFlags('Consulta');

    // ACT — a clínica decide que "Consulta" entra na baixa em lote
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/status-agendamento/{$consulta->id}",
        payloadDasFlags($consulta, ['em_aberto' => true]),
    )->assertOk()->assertJsonPath('em_aberto', true);

    // ASSERT — flag persiste e o diff está na trilha
    expect($consulta->fresh()->em_aberto)->toBeTrue();
    $registro = Auditoria::where('entidade', 'status_agendamento')
        ->where('entidade_id', $consulta->id)
        ->where('acao', 'atualizou')
        ->firstOrFail();
    expect((bool) $registro->diff_json['antes']['em_aberto'])->toBeFalse()
        ->and((bool) $registro->diff_json['depois']['em_aberto'])->toBeTrue();
});

it('deve manter o alcance da baixa ao renomear — a decisão é da flag, não do nome', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $aguardando = statusDasFlags('Aguardando Atendimento');

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/status-agendamento/{$aguardando->id}",
        payloadDasFlags($aguardando, ['nome' => 'Na sala de espera']),
    )->assertOk();

    // ASSERT
    $aguardando->refresh();
    expect($aguardando->nome)->toBe('Na sala de espera')
        ->and($aguardando->em_aberto)->toBeTrue();
});

it('deve entregar aplicavel_em_lote na lista de status que a agenda recebe', function () {
    // ARRANGE — o gesto "Dar baixa" oferece exatamente os status que a clínica marcou
    $adminDaClinica = admin();

    // ACT
    $status = collect($this->actingAs($adminDaClinica)->getJson('/api/agenda/selecao')->assertOk()->json('status'))
        ->keyBy('nome');

    // ASSERT
    expect($status->every(fn (array $s) => array_key_exists('aplicavel_em_lote', $s)))->toBeTrue()
        ->and($status['Finalizado']['aplicavel_em_lote'])->toBeTrue()
        ->and($status['Falta Justificada']['aplicavel_em_lote'])->toBeTrue()
        ->and($status['Em Aberto']['aplicavel_em_lote'])->toBeFalse();
});

/*
|--------------------------------------------------------------------------
| Migration: semente por nome UMA vez + varredura do inicial da clínica
|--------------------------------------------------------------------------
*/

it('deve semear por nome e marcar pela varredura o inicial que a clínica renomeou', function () {
    // ARRANGE — clínica anterior à change que renomeou "Em Aberto" para "Marcado": nenhum
    // status casa com a semente do inicial, mas "Aguardando" ainda casa
    clinicaSemAsFlags();
    StatusAgendamento::query()->where('nome', 'Em Aberto')
        ->update(['nome' => 'Marcado']);

    // ACT
    rodarAMigrationDasFlags();

    // ASSERT — "Marcado" (inicial, sem desfecho) ganha em_aberto pela varredura; o resto, por nome
    $flags = flagsDoLotePorNome();
    expect($flags['Marcado']['em_aberto'])->toBeTrue()
        ->and($flags['Aguardando Atendimento']['em_aberto'])->toBeTrue()
        ->and($flags['Finalizado']['aplicavel_em_lote'])->toBeTrue()
        ->and($flags['Falta Justificada']['aplicavel_em_lote'])->toBeTrue()
        ->and($flags['Consulta'])->toBe(['em_aberto' => false, 'aplicavel_em_lote' => false])
        ->and($flags['Reserva de Agenda']['em_aberto'])->toBeFalse()
        ->and($flags['Marcado']['aplicavel_em_lote'])->toBeFalse();
});

it('deve deixar sem em_aberto o inicial que {0}, sem erro — e a tela acusa no primeiro salvamento', function (string $caso, array $desfecho, string $mensagem) {
    // ARRANGE — clínica anterior à change cujos nomes não casam com a semente e cujo inicial
    // carrega um desfecho: a migration semeia, não corrige cadastro
    clinicaSemAsFlags();
    StatusAgendamento::query()
        ->update(['nome' => DB::raw("CONCAT('Antigo ', nome)")]);
    StatusAgendamento::query()->where('nome', 'Antigo Em Aberto')
        ->update($desfecho);

    // ACT
    rodarAMigrationDasFlags();

    // ASSERT — nada marcado, nenhuma exceção
    $flags = flagsDoLotePorNome();
    expect(collect($flags)->pluck('em_aberto')->filter()->all())->toBe([])
        ->and(collect($flags)->pluck('aplicavel_em_lote')->filter()->all())->toBe([]);

    // ...e o primeiro save que não corrige o inicial é recusado pela guarda
    $adminDaClinica = admin();
    $consulta = statusDasFlags('Antigo Consulta');
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/status-agendamento/{$consulta->id}",
        payloadDasFlags($consulta, ['cor' => '#ABCDEF']),
    )->assertStatus(422)->assertJsonValidationErrors(['status_agendamento' => $mensagem]);
})->with([
    ['desconta sessão', ['desconta_sessao' => true], 'Um status que desconta sessão não pode ser o inicial'],
    ['marca falta', ['marca_falta' => true], GuardaDoStatusInicial::MENSAGEM_INICIAL_FORA_DO_EM_ABERTO],
]);

it('deve não desfazer a edição da clínica nem mudar nada ao rodar de novo', function () {
    // ARRANGE — clínica virgem que a primeira rodada semeia; depois a clínica desliga
    // "Aguardando" do em aberto
    clinicaSemAsFlags();
    rodarAMigrationDasFlags();
    expect(flagsDoLotePorNome()['Em Aberto']['em_aberto'])->toBeTrue()
        ->and(flagsDoLotePorNome()['Aguardando Atendimento']['em_aberto'])->toBeTrue();
    StatusAgendamento::query()->where('nome', 'Aguardando Atendimento')->update(['em_aberto' => false]);
    $editado = flagsDoLotePorNome();

    // ACT — a segunda rodada
    rodarAMigrationDasFlags();

    // ASSERT — a edição fica; a semente não se repete
    expect(flagsDoLotePorNome())->toBe($editado)
        ->and($editado['Aguardando Atendimento']['em_aberto'])->toBeFalse();
});
