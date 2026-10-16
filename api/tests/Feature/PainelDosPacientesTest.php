<?php

use App\Models\Agendamento;
use App\Models\Especialidade;
use App\Models\ListaEspera;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Tratamento;
use App\Models\Usuario;
use Carbon\CarbonImmutable;
use Illuminate\Testing\TestResponse;

/**
 * O painel dos PACIENTES (change indicadores-profissionais, D4/D9): `GET /api/indicadores/painel/pacientes`
 * sob `pacientes.ver`. Só contagens — nenhum nome sai (LGPD, menores). Dados 100% fictícios.
 *
 * Relógio FIXO: segunda, 5 de outubro de 2026, 10h em Brasília (13h UTC). Período 1–5/10,
 * comparado 1–5/9. `created_at` e a trilha gravam em UTC.
 */
const MES_DO_PAINEL_PACIENTES = '2026-10';

function relogioDoPainelPacientes(string $quando = '2026-10-05 10:00:00'): void
{
    test()->travelTo(CarbonImmutable::parse($quando, 'America/Sao_Paulo'));
}

/**
 * O histórico da clínica começa no mês do primeiro atendimento agendado. A criança da sessão é
 * cadastrada no mesmo dia — sem isso, a da factory nasceria "hoje" e contaria como nova.
 */
function historicoDoPainelPacientes(string $dia = '2026-08-10'): void
{
    Agendamento::factory()->create([
        'paciente_id' => cadastradaDoPainelPacientes("{$dia} 12:00:00")->id,
        'inicio' => "{$dia} 09:00",
        'fim' => "{$dia} 09:40",
    ]);
}

/** Criança fictícia cadastrada no instante UTC dado. */
function cadastradaDoPainelPacientes(string $criadoEmUtc, array $extra = []): Paciente
{
    return Paciente::factory()->create(['created_at' => $criadoEmUtc, 'updated_at' => $criadoEmUtc, ...$extra]);
}

/**
 * Muda a situação pela ROTA de produção (`PATCH /pacientes/{id}/situacao`), no instante dado na parede
 * da clínica — a trilha nasce exatamente como nasce na clínica. Volta o relógio ao dia 5 depois.
 */
function situacaoDoPainelPacientes(Usuario $quem, Paciente $paciente, bool $ativo, string $quando): void
{
    relogioDoPainelPacientes($quando);
    $versao = (string) test()->actingAs($quem)->getJson("/api/pacientes/{$paciente->id}")->json('updated_at');
    test()->actingAs($quem)
        ->patchJson("/api/pacientes/{$paciente->id}/situacao", ['ativo' => $ativo], ['If-Match' => $versao])
        ->assertOk();
    relogioDoPainelPacientes();
}

/** Um pacote fictício em andamento, com o saldo que o teste quiser. */
function pacoteDoPainelPacientes(int $total, int $realizadas, ?Profissional $profissional = null): Tratamento
{
    return Tratamento::factory()->create([
        'paciente_id' => Paciente::factory()->create()->id,
        'profissional_id' => ($profissional ?? Profissional::factory()->create())->id,
        'especialidade_id' => Especialidade::factory()->create()->id,
        'sessoes_total' => $total,
        'sessoes_realizadas' => $realizadas,
        'status' => 'andamento',
    ]);
}

function painelDosPacientes(string $mes = MES_DO_PAINEL_PACIENTES): TestResponse
{
    return test()->getJson("/api/indicadores/painel/pacientes?mes={$mes}");
}

it('deve responder 403 a quem não tem pacientes.ver — antes de validar o mês', function () {
    // ARRANGE
    admin();
    $semPacientes = usuarioCom(['agenda.ver', 'fluxo_caixa.ver', 'tratamentos.ver'], 'Sem Pacientes do Painel');

    // ACT + ASSERT
    $this->actingAs($semPacientes);
    painelDosPacientes()->assertForbidden();
    painelDosPacientes('2026-13')->assertForbidden();
});

it('deve contar os ativos de hoje', function () {
    // ARRANGE
    relogioDoPainelPacientes();
    $this->actingAs(admin());
    Paciente::factory()->count(3)->create();
    Paciente::factory()->create(['ativo' => false]);

    // ACT + ASSERT
    expect(painelDosPacientes()->assertOk()->json('ativos'))->toBe(3);
});

it('deve contar os novos pelo dia da clínica, comparando com o mesmo período do mês anterior', function () {
    // ARRANGE — histórico desde agosto
    relogioDoPainelPacientes();
    $this->actingAs(admin());
    historicoDoPainelPacientes();
    cadastradaDoPainelPacientes('2026-10-02 15:00:00');
    cadastradaDoPainelPacientes('2026-10-05 12:00:00');
    // 1/10 01:00 UTC ainda é 30/09 22:00 em Brasília: é de setembro, não de outubro
    cadastradaDoPainelPacientes('2026-10-01 01:00:00');
    cadastradaDoPainelPacientes('2026-09-03 15:00:00');
    cadastradaDoPainelPacientes('2026-09-20 15:00:00');

    // ACT
    $painel = painelDosPacientes()->assertOk();

    // ASSERT
    expect($painel->json('novos'))->toBe(['atual' => 2, 'anterior' => 1]);
});

it('não deve contar como novo o paciente que veio da importação da virada', function () {
    // ARRANGE — validação local de 05/10: a importação de setembro virava uma "queda" de 85% em outubro
    relogioDoPainelPacientes();
    $this->actingAs(admin());
    historicoDoPainelPacientes();
    cadastradaDoPainelPacientes('2026-10-02 15:00:00');
    cadastradaDoPainelPacientes('2026-09-02 13:00:00', ['importado_clinicaagil_em' => '2026-09-02 13:00:00']);
    cadastradaDoPainelPacientes('2026-09-02 13:00:00', ['importado_clinicaagil_em' => '2026-09-02 13:00:00']);
    cadastradaDoPainelPacientes('2026-09-03 15:00:00');

    // ACT
    $painel = painelDosPacientes()->assertOk();

    // ASSERT — nos novos do período e na série
    $serie = collect($painel->json('serie_novos'))->keyBy('mes');
    expect($painel->json('novos'))->toBe(['atual' => 1, 'anterior' => 1])
        ->and($serie['2026-09']['quantidade'])->toBe(1);
});

it('deve contar em "saíram" quem passou de ativo a inativo no período, pela trilha', function () {
    // ARRANGE — inativada em 3/10 pela rota de produção; outra em 2/9 (o comparado)
    relogioDoPainelPacientes();
    $adminDaClinica = admin();
    historicoDoPainelPacientes();
    $outubro = Paciente::factory()->create();
    $setembro = Paciente::factory()->create();
    situacaoDoPainelPacientes($adminDaClinica, $outubro, false, '2026-10-03 14:00:00');
    situacaoDoPainelPacientes($adminDaClinica, $setembro, false, '2026-09-02 14:00:00');

    // ACT
    $this->actingAs($adminDaClinica);
    $outubroPainel = painelDosPacientes()->assertOk();
    $setembroPainel = painelDosPacientes('2026-09')->assertOk();

    // ASSERT — a de 3/10 conta em outubro e NÃO em setembro
    expect($outubroPainel->json('sairam'))->toBe(['atual' => 1, 'anterior' => 1])
        ->and($setembroPainel->json('sairam.atual'))->toBe(1);
});

it('deve contar UMA vez a criança reativada e inativada de novo no mesmo período', function () {
    // ARRANGE
    relogioDoPainelPacientes();
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    situacaoDoPainelPacientes($adminDaClinica, $paciente, false, '2026-10-01 09:00:00');
    situacaoDoPainelPacientes($adminDaClinica, $paciente, true, '2026-10-02 09:00:00');
    situacaoDoPainelPacientes($adminDaClinica, $paciente, false, '2026-10-03 09:00:00');

    // ACT + ASSERT
    $this->actingAs($adminDaClinica);
    expect(painelDosPacientes()->assertOk()->json('sairam.atual'))->toBe(1);
});

it('não deve contar em "saíram" quem já nasceu inativo nem quem foi reativado', function () {
    // ARRANGE — cadastrada inativa (a trilha diz "criou"); inativa reativada em outubro
    relogioDoPainelPacientes();
    $adminDaClinica = admin();
    Paciente::factory()->create(['ativo' => false]);
    $reativada = Paciente::factory()->create(['ativo' => false]);
    situacaoDoPainelPacientes($adminDaClinica, $reativada, true, '2026-10-02 09:00:00');

    // ACT + ASSERT
    $this->actingAs($adminDaClinica);
    expect(painelDosPacientes()->assertOk()->json('sairam.atual'))->toBe(0);
});

it('deve pôr no mês da clínica a inativação das 22h do último dia, que no UTC já é o mês seguinte', function () {
    // ARRANGE — 30/09 22:00 em Brasília é 1/10 01:00 UTC; a escrita direta no model também é trilha
    relogioDoPainelPacientes('2026-09-30 22:00:00');
    $adminDaClinica = admin();
    Paciente::factory()->create()->update(['ativo' => false]);
    relogioDoPainelPacientes();

    // ACT
    $this->actingAs($adminDaClinica);
    $outubro = painelDosPacientes()->assertOk();
    $setembro = painelDosPacientes('2026-09')->assertOk();

    // ASSERT
    expect($outubro->json('sairam.atual'))->toBe(0)
        ->and($setembro->json('sairam.atual'))->toBe(1);
});

it('deve contar os pacotes no fim pela regra do sino, com o mesmo escopo da agenda', function () {
    // ARRANGE — limiar padrão 2: dois pacotes no fim (um da escopada), um longe do fim
    relogioDoPainelPacientes();
    $adminDaClinica = admin();
    $propria = Profissional::factory()->create();
    pacoteDoPainelPacientes(10, 9, $propria);
    pacoteDoPainelPacientes(10, 8);
    pacoteDoPainelPacientes(10, 2);
    $escopada = usuarioEscopadoEm($propria, ['pacientes.ver', 'tratamentos.ver']);

    // ACT
    $plano = $this->actingAs($adminDaClinica)->getJson('/api/indicadores/painel/pacientes?mes='.MES_DO_PAINEL_PACIENTES)->assertOk();
    $sinoPlano = $this->actingAs($adminDaClinica)->getJson('/api/notificacoes')->assertOk();
    trocarDeUsuario();
    $daEscopada = $this->actingAs($escopada)->getJson('/api/indicadores/painel/pacientes?mes='.MES_DO_PAINEL_PACIENTES)->assertOk();
    $sinoDaEscopada = $this->actingAs($escopada)->getJson('/api/notificacoes')->assertOk();

    // ASSERT — o número do painel é o do sino, para a clínica e para a escopada
    expect($plano->json('pacotes_no_fim'))->toBe(2)
        ->and($sinoPlano->json('pacotes_acabando.total'))->toBe(2)
        ->and($daEscopada->json('pacotes_no_fim'))->toBe(1)
        ->and($sinoDaEscopada->json('pacotes_acabando.total'))->toBe(1);
});

it('deve contar as entradas da fila de espera', function () {
    // ARRANGE
    relogioDoPainelPacientes();
    $this->actingAs(admin());
    $especialidade = Especialidade::factory()->create();
    ListaEspera::create(['paciente_id' => Paciente::factory()->create()->id, 'especialidade_id' => $especialidade->id, 'prioridade' => 1]);
    ListaEspera::create(['paciente_id' => Paciente::factory()->create()->id, 'especialidade_id' => $especialidade->id, 'prioridade' => 0]);

    // ACT + ASSERT
    expect(painelDosPacientes()->assertOk()->json('fila_de_espera'))->toBe(2);
});

it('deve deixar AUSENTES os pacotes no fim e a fila para quem não tem tratamentos.ver nem lista_espera.ver', function () {
    // ARRANGE — um pacote no fim e uma criança na fila; quem pede só vê pacientes (com a flag de ver a
    // agenda inteira, para o escopo não ser a causa do vazio)
    relogioDoPainelPacientes();
    admin();
    pacoteDoPainelPacientes(10, 9);
    ListaEspera::create(['paciente_id' => Paciente::factory()->create()->id, 'especialidade_id' => Especialidade::factory()->create()->id, 'prioridade' => 1]);
    $soPacientes = usuarioCom(['pacientes.ver', 'agenda.ver_todos'], 'Só Pacientes do Painel');

    // ACT
    $painel = $this->actingAs($soPacientes)->getJson('/api/indicadores/painel/pacientes?mes='.MES_DO_PAINEL_PACIENTES)->assertOk();

    // ASSERT — ausente não é zero (SEC-IND-01): a tela some com o cartão em vez de dizer "nenhum"
    $painel->assertJsonMissingPath('pacotes_no_fim')->assertJsonMissingPath('fila_de_espera');
    expect($painel->json('ativos'))->toBeInt();
});

it('deve entregar cada número de outro módulo só com a permissão DELE', function () {
    // ARRANGE — um com Tratamentos › Ver, outro com Lista de espera › Ver
    relogioDoPainelPacientes();
    admin();
    pacoteDoPainelPacientes(10, 9);
    ListaEspera::create(['paciente_id' => Paciente::factory()->create()->id, 'especialidade_id' => Especialidade::factory()->create()->id, 'prioridade' => 1]);
    $comPacotes = usuarioCom(['pacientes.ver', 'tratamentos.ver', 'agenda.ver_todos'], 'Pacientes e Pacotes do Painel');
    $comFila = usuarioCom(['pacientes.ver', 'lista_espera.ver'], 'Pacientes e Fila do Painel');

    // ACT
    $doPacote = $this->actingAs($comPacotes)->getJson('/api/indicadores/painel/pacientes?mes='.MES_DO_PAINEL_PACIENTES)->assertOk();
    trocarDeUsuario();
    $daFila = $this->actingAs($comFila)->getJson('/api/indicadores/painel/pacientes?mes='.MES_DO_PAINEL_PACIENTES)->assertOk();

    // ASSERT
    expect($doPacote->json('pacotes_no_fim'))->toBe(1)
        ->and($daFila->json('fila_de_espera'))->toBe(1);
    $doPacote->assertJsonMissingPath('fila_de_espera');
    $daFila->assertJsonMissingPath('pacotes_no_fim');
});

it('deve trazer seis meses de novos com NULO antes do histórico, cada mês no dia da clínica', function () {
    // ARRANGE — histórico desde agosto; a importação de julho fica fora da série (antes do sistema)
    relogioDoPainelPacientes();
    $this->actingAs(admin());
    historicoDoPainelPacientes();
    cadastradaDoPainelPacientes('2026-07-15 15:00:00');
    cadastradaDoPainelPacientes('2026-09-10 15:00:00');
    // 1/10 01:00 UTC é setembro na clínica
    cadastradaDoPainelPacientes('2026-10-01 01:00:00');
    cadastradaDoPainelPacientes('2026-10-02 15:00:00');

    // ACT
    $painel = painelDosPacientes()->assertOk();

    // ASSERT
    expect($painel->json('serie_novos'))->toBe([
        ['mes' => '2026-05', 'quantidade' => null],
        ['mes' => '2026-06', 'quantidade' => null],
        ['mes' => '2026-07', 'quantidade' => null],
        // agosto: a criança do primeiro atendimento, cadastrada nele
        ['mes' => '2026-08', 'quantidade' => 1],
        ['mes' => '2026-09', 'quantidade' => 2],
        ['mes' => '2026-10', 'quantidade' => 1],
    ]);
});

it('não deve carregar nome de criança nenhuma na resposta', function () {
    // ARRANGE — uma criança nova, uma que saiu e uma na fila, todas com nome marcado
    relogioDoPainelPacientes();
    $adminDaClinica = admin();
    historicoDoPainelPacientes();
    Paciente::factory()->create(['nome' => 'Criança Fictícia Marcada Um']);
    $saiu = Paciente::factory()->create(['nome' => 'Criança Fictícia Marcada Dois']);
    situacaoDoPainelPacientes($adminDaClinica, $saiu, false, '2026-10-02 09:00:00');

    // ACT
    $this->actingAs($adminDaClinica);
    $painel = painelDosPacientes()->assertOk();

    // ASSERT
    semVazamento($painel->json(), 'Criança Fictícia Marcada');
    semVazamento($painel->json(), 'Paciente Fictício');
});

it('deve devolver o formato EXATO do contrato D9, com contagens inteiras', function () {
    // ARRANGE — histórico desde agosto
    relogioDoPainelPacientes();
    $this->actingAs(admin());
    historicoDoPainelPacientes();
    cadastradaDoPainelPacientes('2026-10-02 15:00:00');

    // ACT
    $painel = painelDosPacientes()->assertOk();

    // ASSERT
    $painel->assertExactJsonStructure([
        'periodo' => ['mes', 'de', 'ate', 'parcial', 'comparado_de', 'comparado_ate'],
        'inicio_historico',
        'inicio_historico_dia',
        'ativos',
        'novos' => ['atual', 'anterior'],
        'sairam' => ['atual', 'anterior'],
        'pacotes_no_fim',
        'fila_de_espera',
        'serie_novos' => ['*' => ['mes', 'quantidade']],
    ]);
    expect($painel->json('ativos'))->toBeInt()
        ->and($painel->json('novos.atual'))->toBeInt()
        ->and($painel->json('novos.anterior'))->toBeInt()
        ->and($painel->json('sairam.anterior'))->toBeInt()
        ->and($painel->json('pacotes_no_fim'))->toBeInt()
        ->and($painel->json('fila_de_espera'))->toBeInt()
        ->and($painel->json('inicio_historico'))->toBe('2026-08')
        ->and($painel->json('inicio_historico_dia'))->toBe('2026-08-10');
});
