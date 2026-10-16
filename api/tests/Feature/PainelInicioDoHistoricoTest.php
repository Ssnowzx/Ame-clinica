<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Especialidade;
use App\Models\Evolucao;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * O INÍCIO DO HISTÓRICO por dia (change indicadores-profissionais, rodada 1 do gate: DQ-10,
 * CR-IND-09). O cabeçalho de todo painel diz o dia do primeiro ATENDIMENTO agendado
 * (`inicio_historico_dia`), e a comparação só existe quando o período comparado está inteiro
 * dentro do histórico: `comparado_de >= inicio_historico_dia`. Fora disso, TODO `anterior` dos
 * quatro painéis é nulo.
 *
 * A clínica fictícia começa em 21 de agosto. Relógio FIXO: segunda, 5 de outubro de 2026, 10h na
 * parede da clínica. Dados 100% fictícios (LGPD).
 */
const FRENTES_DO_INICIO_DO_HISTORICO = ['dinheiro', 'agenda', 'pacientes', 'equipe'];

function relogioDoInicioDoHistorico(): void
{
    test()->travelTo(CarbonImmutable::parse('2026-10-05 10:00:00', 'America/Sao_Paulo'));
}

function profissionalDoInicioDoHistorico(): Profissional
{
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->comHorarios([1 => [['inicio' => '08:00', 'fim' => '12:00']]])
        ->create(['nome' => 'Profissional Fictícia do Histórico']);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);

    return $profissional;
}

/**
 * Uma sessão REALIZADA, com atendimento e evolução, e a criança cadastrada no mesmo dia: cada
 * painel tem o que comparar em qualquer período que a receba.
 */
function sessaoDoInicioDoHistorico(Profissional $profissional, string $inicio): void
{
    $comeco = Carbon::createFromFormat('Y-m-d H:i', $inicio);
    $realizada = StatusAgendamento::query()
        ->where(['desconta_sessao' => true, 'marca_falta' => false, 'ocupa_horario' => true, 'marca_reserva' => false])
        ->orderBy('ordem')->orderBy('id')->firstOrFail();
    $crianca = Paciente::factory()->create(['created_at' => $comeco->copy()->addHours(5), 'updated_at' => $comeco->copy()->addHours(5)]);
    $sessao = Agendamento::factory()->create([
        'profissional_id' => $profissional->id,
        'especialidade_id' => DB::table('profissional_especialidade')->where('profissional_id', $profissional->id)->value('especialidade_id'),
        'paciente_id' => $crianca->id,
        'status_id' => $realizada->id,
        'inicio' => $comeco->format('Y-m-d H:i'),
        'fim' => $comeco->copy()->addMinutes(40)->format('Y-m-d H:i'),
    ]);
    $atendimento = Atendimento::factory()->create([
        'agendamento_id' => $sessao->id,
        'finalizado_em' => $comeco->copy()->addMinutes(40)->format('Y-m-d H:i'),
    ]);
    $evolucao = new Evolucao(['profissional_id' => $profissional->id, 'conteudo' => 'Evolução clínica fictícia.']);
    $evolucao->atendimento_id = $atendimento->id;
    $evolucao->preenchida_em = $atendimento->finalizado_em->format('Y-m-d H:i');
    $evolucao->save();
    lancamentoNoCaixa('100.00', ['competencia' => $comeco->toDateString()], ['pago_em' => $comeco->format('Y-m-d H:i:s'), 'agendamento_id' => $sessao->id]);
}

/** A clínica fictícia: um bloqueio em julho, o primeiro atendimento em 21/08 e movimento depois. */
function clinicaDoInicioDoHistorico(string $primeiroDia = '2026-08-21'): Profissional
{
    $profissional = profissionalDoInicioDoHistorico();
    // a grade da profissional, ANTES do primeiro atendimento: não é a clínica operando (CR-IND-09)
    Agendamento::factory()->create([
        'tipo' => 'bloqueio', 'paciente_id' => null, 'status_id' => null, 'profissional_id' => $profissional->id,
        'inicio' => '2026-07-13 08:00', 'fim' => '2026-07-13 12:00',
    ]);
    sessaoDoInicioDoHistorico($profissional, "{$primeiroDia} 09:00");
    sessaoDoInicioDoHistorico($profissional, '2026-08-28 09:00');
    sessaoDoInicioDoHistorico($profissional, '2026-09-02 09:00');
    sessaoDoInicioDoHistorico($profissional, '2026-09-15 09:00');
    sessaoDoInicioDoHistorico($profissional, '2026-10-01 09:00');

    return $profissional;
}

/**
 * Todos os `anterior` de uma resposta, em qualquer profundidade, pelo caminho.
 *
 * @return array<string, mixed>
 */
function anterioresDoInicioDoHistorico(array $json, string $caminho = ''): array
{
    $achados = [];
    foreach ($json as $chave => $valor) {
        $aqui = ltrim("{$caminho}.{$chave}", '.');
        if ($chave === 'anterior') {
            $achados[$aqui] = $valor;
        } elseif (is_array($valor)) {
            $achados += anterioresDoInicioDoHistorico($valor, $aqui);
        }
    }

    return $achados;
}

it('deve devolver o DIA do primeiro atendimento como início do histórico, sem contar o bloqueio de antes', function () {
    // ARRANGE — bloqueio em 13/07, primeiro atendimento em 21/08
    relogioDoInicioDoHistorico();
    $this->actingAs(admin());
    clinicaDoInicioDoHistorico();

    foreach (FRENTES_DO_INICIO_DO_HISTORICO as $frente) {
        // ACT
        $painel = $this->getJson("/api/indicadores/painel/{$frente}?mes=2026-10")->assertOk();

        // ASSERT — o mês e o dia do atendimento; julho (o bloqueio) não é o começo de nada
        expect($painel->json('inicio_historico'))->toBe('2026-08', $frente)
            ->and($painel->json('inicio_historico_dia'))->toBe('2026-08-21', $frente);
    }
});

it('deve devolver o início do histórico nulo, nas duas formas, para a clínica só com bloqueio', function () {
    // ARRANGE — nenhum atendimento: só a grade de julho
    relogioDoInicioDoHistorico();
    $this->actingAs(admin());
    Agendamento::factory()->create([
        'tipo' => 'bloqueio', 'paciente_id' => null, 'status_id' => null,
        'profissional_id' => profissionalDoInicioDoHistorico()->id,
        'inicio' => '2026-07-13 08:00', 'fim' => '2026-07-13 12:00',
    ]);

    // ACT
    $painel = $this->getJson('/api/indicadores/painel/agenda?mes=2026-10')->assertOk();

    // ASSERT
    expect($painel->json('inicio_historico'))->toBeNull()
        ->and($painel->json('inicio_historico_dia'))->toBeNull();
});

it('deve anular TODO anterior dos quatro painéis quando o comparado começa antes do primeiro dia', function () {
    // ARRANGE — setembro fechado contra agosto, com o sistema começando em 21/08: agosto tem
    // movimento (dez dias), mas não está inteiro no histórico
    relogioDoInicioDoHistorico();
    $this->actingAs(admin());
    clinicaDoInicioDoHistorico();

    foreach (FRENTES_DO_INICIO_DO_HISTORICO as $frente) {
        // ACT
        $painel = $this->getJson("/api/indicadores/painel/{$frente}?mes=2026-09")->assertOk();
        $anteriores = anterioresDoInicioDoHistorico($painel->json());

        // ASSERT — havia pares para comparar, e nenhum compara
        expect($painel->json('periodo.comparado_de'))->toBe('2026-08-01')
            ->and($anteriores)->not->toBeEmpty()
            ->and(array_filter($anteriores, fn (mixed $valor): bool => $valor !== null))->toBe([], $frente);
    }
});

it('deve comparar outubro com setembro quando o comparado já está inteiro dentro do histórico', function () {
    // ARRANGE — 1–5/10 contra 1–5/09, com o sistema começando em 21/08
    relogioDoInicioDoHistorico();
    $this->actingAs(admin());
    clinicaDoInicioDoHistorico();

    // ACT
    $paineis = collect(FRENTES_DO_INICIO_DO_HISTORICO)
        ->mapWithKeys(fn (string $frente): array => [$frente => $this->getJson("/api/indicadores/painel/{$frente}?mes=2026-10")->assertOk()]);

    // ASSERT — a sessão de 2/9 está no comparado: cada painel compara com ela
    expect($paineis['dinheiro']->json('recebido'))->toBe(['atual' => '100.00', 'anterior' => '100.00'])
        ->and($paineis['agenda']->json('realizadas'))->toBe(['atual' => 1, 'anterior' => 1])
        ->and($paineis['pacientes']->json('novos'))->toBe(['atual' => 1, 'anterior' => 1])
        ->and($paineis['equipe']->json('evolucoes.em_dia'))->toBe(['atual' => 1.0, 'anterior' => 1.0]);
});

it('deve comparar quando o comparado começa EXATAMENTE no primeiro dia do histórico', function () {
    // ARRANGE — o primeiro atendimento é de 1/09, o mesmo dia em que o comparado de outubro começa
    relogioDoInicioDoHistorico();
    $this->actingAs(admin());
    sessaoDoInicioDoHistorico(profissionalDoInicioDoHistorico(), '2026-09-01 09:00');

    // ACT
    $painel = $this->getJson('/api/indicadores/painel/agenda?mes=2026-10')->assertOk();

    // ASSERT — o dia do início conta como dentro: o corte é inclusivo
    expect($painel->json('inicio_historico_dia'))->toBe('2026-09-01')
        ->and($painel->json('realizadas'))->toBe(['atual' => 0, 'anterior' => 1]);
});

// ── A data configurada (change inicio-dos-indicadores, D1/D2) ────────────────────────────────────
// O início é o MAIS TARDE entre o primeiro atendimento e `indicadores.comparar_a_partir_de`, com teto
// em hoje. A produção mostrou o porquê: um agendamento solto de 12/08 fazia 1–6/10 comparar contra
// uma primeira semana de setembro quase vazia.

it('deve adiar o início para a data configurada, anulando todo anterior e cortando as séries', function () {
    // ARRANGE — primeiro atendimento em 21/08, data configurada em 1º/10, hoje é 5/10
    relogioDoInicioDoHistorico();
    $this->actingAs(admin());
    clinicaDoInicioDoHistorico();
    app(ConfiguracaoService::class)->set('indicadores.comparar_a_partir_de', '2026-10-01');

    foreach (FRENTES_DO_INICIO_DO_HISTORICO as $frente) {
        // ACT
        $painel = $this->getJson("/api/indicadores/painel/{$frente}?mes=2026-10")->assertOk();
        $anteriores = anterioresDoInicioDoHistorico($painel->json());

        // ASSERT — 1–5/09 tinha movimento, e mesmo assim nada compara
        expect($painel->json('inicio_historico'))->toBe('2026-10', $frente)
            ->and($painel->json('inicio_historico_dia'))->toBe('2026-10-01', $frente)
            ->and($anteriores)->not->toBeEmpty()
            ->and(array_filter($anteriores, fn (mixed $valor): bool => $valor !== null))->toBe([], $frente);
    }
    $serie = $this->getJson('/api/indicadores/painel/dinheiro?mes=2026-10')->json('serie_recebido');
    expect(array_column($serie, 'valor'))->toBe([null, null, null, null, null, '100.00']);
});

it('deve manter o primeiro atendimento quando a data configurada é anterior a ele', function () {
    // ARRANGE — a data configurada não antecipa nada: antes de 21/08 não há o que medir
    relogioDoInicioDoHistorico();
    $this->actingAs(admin());
    clinicaDoInicioDoHistorico();
    app(ConfiguracaoService::class)->set('indicadores.comparar_a_partir_de', '2026-01-01');

    // ACT
    $painel = $this->getJson('/api/indicadores/painel/dinheiro?mes=2026-10')->assertOk();

    // ASSERT — se a configuração mandasse, maio a julho viriam "0.00" em vez de nulos
    expect($painel->json('inicio_historico_dia'))->toBe('2026-08-21')
        ->and(array_column($painel->json('serie_recebido'), 'valor'))->toBe([null, null, null, '200.00', '200.00', '100.00']);
});

it('deve comparar o período que começa no dia configurado', function () {
    // ARRANGE — data configurada em 1º/09: 1–5/10 contra 1–5/09 está inteiro dentro do histórico
    relogioDoInicioDoHistorico();
    $this->actingAs(admin());
    clinicaDoInicioDoHistorico();
    app(ConfiguracaoService::class)->set('indicadores.comparar_a_partir_de', '2026-09-01');

    // ACT
    $painel = $this->getJson('/api/indicadores/painel/dinheiro?mes=2026-10')->assertOk();

    // ASSERT — a sessão de 2/9 compara; agosto, antes do início, sai da série
    expect($painel->json('inicio_historico_dia'))->toBe('2026-09-01')
        ->and($painel->json('recebido'))->toBe(['atual' => '100.00', 'anterior' => '100.00'])
        ->and(array_column($painel->json('serie_recebido'), 'valor'))->toBe([null, null, null, null, '200.00', '100.00']);
});

it('deve repetir na leitura as regras da escrita para o valor gravado direto no banco', function () {
    // ARRANGE — valores que a escrita barra, mas que podem existir (gravados antes das regras)
    relogioDoInicioDoHistorico();
    $this->actingAs(admin());
    clinicaDoInicioDoHistorico();
    $configuracoes = app(ConfiguracaoService::class);
    $inicio = function (string $valor): ?string {
        app(ConfiguracaoService::class)->set('indicadores.comparar_a_partir_de', $valor);

        return $this->getJson('/api/indicadores/painel/agenda?mes=2026-10')->assertOk()->json('inicio_historico_dia');
    };

    // ACT + ASSERT
    // data futura: o início para no mês de hoje, nunca num mês que ainda não existe
    expect($inicio('2026-12-01'))->toBe('2026-10-01')
        // dia no meio do mês: o dia 1º dele — a frase e as séries dizem o mesmo mês
        ->and($inicio('2026-09-10'))->toBe('2026-09-01')
        // texto que não é data, e data que não existe no calendário: vale o primeiro atendimento
        ->and($inicio('outubro'))->toBe('2026-08-21')
        ->and($inicio('2026-09-31'))->toBe('2026-08-21')
        ->and($inicio("2026-09-01\n"))->toBe('2026-08-21');
});

it('deve limitar a data configurada pelo relógio da clínica, e não pelo do servidor', function () {
    // ARRANGE — 31/10 às 23h30 em Brasília (já é 1º/11 em UTC), com 1º/11 gravado direto no banco
    test()->travelTo(CarbonImmutable::parse('2026-10-31 23:30:00', 'America/Sao_Paulo'));
    $this->actingAs(admin());
    clinicaDoInicioDoHistorico();
    app(ConfiguracaoService::class)->set('indicadores.comparar_a_partir_de', '2026-11-01');

    // ACT
    $painel = $this->getJson('/api/indicadores/painel/agenda?mes=2026-10')->assertOk();

    // ASSERT — pelo relógio do servidor, outubro viraria "anterior ao início dos indicadores"
    expect($painel->json('inicio_historico_dia'))->toBe('2026-10-01');
});

it('deve devolver o início nulo, mesmo com a data configurada, para a clínica sem atendimento', function () {
    // ARRANGE — sem agendamento não há histórico de nada, qualquer que seja a configuração
    relogioDoInicioDoHistorico();
    $this->actingAs(admin());
    app(ConfiguracaoService::class)->set('indicadores.comparar_a_partir_de', '2026-10-01');

    // ACT
    $painel = $this->getJson('/api/indicadores/painel/pacientes?mes=2026-10')->assertOk();

    // ASSERT
    expect($painel->json('inicio_historico'))->toBeNull()
        ->and($painel->json('inicio_historico_dia'))->toBeNull();
});
