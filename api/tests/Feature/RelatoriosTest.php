<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Evolucao;
use App\Models\Profissional;
use App\Models\TipoPagamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use Illuminate\Support\Carbon;

it('deve consolidar a produção por profissional no período', function () {
    // ARRANGE — 1 atendimento + 1 consumo + 1 evolução do MESMO profissional
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    // a sessão de ONTEM: a produção conta as sessões consumidas pelo dia da sessão (change
    // producao-pelo-dia-da-sessao) — a da factory nasce no futuro, onde nada se consome
    $ontem = agoraNaClinica()->subDay()->setTime(10, 0);
    $agendamento = Agendamento::factory()->create(['inicio' => $ontem, 'fim' => $ontem->copy()->addMinutes(40)]);
    $profissionalId = $agendamento->profissional_id;
    $atendimento = Atendimento::factory()->create(['agendamento_id' => $agendamento->id]);
    $agendamento->forceFill([
        'sessao_consumida_em' => agoraNaClinica()->format('Y-m-d H:i'),
    ])->save();
    $evolucao = new Evolucao([
        'profissional_id' => $profissionalId,
        'conteudo' => 'Evolução fictícia do relatório.',
    ]);
    $evolucao->atendimento_id = $atendimento->id;
    $evolucao->preenchida_em = agoraNaClinica()->format('Y-m-d H:i');
    $evolucao->save();

    $de = agoraNaClinica()->subDays(7)->toDateString();
    $ate = agoraNaClinica()->toDateString();

    // ACT
    $relatorio = $this->getJson("/api/relatorios/producao-por-profissional?de={$de}&ate={$ate}");

    // ASSERT — três contagens na linha; nenhum nome de paciente no payload
    $relatorio->assertOk();
    $linha = collect($relatorio->json('linhas'))
        ->firstWhere('profissional.id', $profissionalId);
    expect($linha['atendimentos'])->toBe(1)
        ->and($linha['sessoes_consumidas'])->toBe(1)
        ->and($linha['evolucoes_preenchidas'])->toBe(1)
        ->and(json_encode($relatorio->json()))->not->toContain('paciente');

    // janela acima do teto → 422; sem permissão do módulo dono → 403
    $deLonge = agoraNaClinica()->subDays(370)->toDateString();
    $this->getJson("/api/relatorios/producao-por-profissional?de={$deLonge}&ate={$ate}")
        ->assertUnprocessable();
    $semPermissao = Usuario::factory()->create();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($semPermissao)
        ->getJson("/api/relatorios/producao-por-profissional?de={$de}&ate={$ate}")
        ->assertForbidden();
});

/** As sessões consumidas da linha do profissional no período. */
function sessoesConsumidasNoPeriodo($teste, int $profissionalId, string $de, string $ate): int
{
    $linha = collect($teste->getJson("/api/relatorios/producao-por-profissional?de={$de}&ate={$ate}")->assertOk()->json('linhas'))
        ->firstWhere('profissional.id', $profissionalId);

    return (int) ($linha['sessoes_consumidas'] ?? 0);
}

it('deve contar a sessão consumida pelo dia da sessão, e não pelo dia da baixa', function () {
    // ARRANGE — change producao-pelo-dia-da-sessao: a sessão de 29/09 levou baixa em 1º/10. A clínica
    // perguntou por que outubro tinha 15 sessões consumidas em dois dias, e escolheu "pelo dia da sessão"
    $this->actingAs(admin());
    $sessao = Agendamento::factory()->create(['inicio' => '2026-09-29 14:00:00', 'fim' => '2026-09-29 14:40:00']);
    $sessao->forceFill(['sessao_consumida_em' => '2026-10-01 09:00'])->save();

    // ACT
    $setembro = sessoesConsumidasNoPeriodo($this, $sessao->profissional_id, '2026-09-01', '2026-09-30');
    $outubro = sessoesConsumidasNoPeriodo($this, $sessao->profissional_id, '2026-10-01', '2026-10-31');

    // ASSERT
    expect($setembro)->toBe(1)
        ->and($outubro)->toBe(0);
});

it('não deve contar a sessão do mês que ainda não foi consumida', function () {
    // ARRANGE — sessão de outubro "Em Aberto": aconteceu no mês, mas não descontou do pacote
    $this->actingAs(admin());
    $sessao = Agendamento::factory()->create(['inicio' => '2026-10-01 14:00:00', 'fim' => '2026-10-01 14:40:00']);

    // ACT
    $outubro = sessoesConsumidasNoPeriodo($this, $sessao->profissional_id, '2026-10-01', '2026-10-31');

    // ASSERT
    expect($sessao->fresh()->sessao_consumida_em)->toBeNull()
        ->and($outubro)->toBe(0);
});

it('deve contar as sessões das duas pontas do período, e só elas', function () {
    // ARRANGE — gate CR-PROD-02: a primeira hora do dia 1º, a última do dia 30 e a primeira do mês
    // seguinte. Pega o teto esquecido, o último dia de fora e o período deslocado por fuso
    $this->actingAs(admin());
    $profissional = Profissional::factory()->create();
    foreach ([['2026-09-01 00:30', '2026-09-01 09:00'], ['2026-09-30 23:30', '2026-10-01 09:00'], ['2026-10-01 00:10', '2026-10-01 09:00']] as [$inicio, $consumida]) {
        Agendamento::factory()->create(['profissional_id' => $profissional->id, 'inicio' => $inicio, 'fim' => Carbon::parse($inicio)->addMinutes(20)])
            ->forceFill(['sessao_consumida_em' => $consumida])->save();
    }

    // ACT
    $setembro = sessoesConsumidasNoPeriodo($this, $profissional->id, '2026-09-01', '2026-09-30');
    $outubro = sessoesConsumidasNoPeriodo($this, $profissional->id, '2026-10-01', '2026-10-31');

    // ASSERT
    expect($setembro)->toBe(2)
        ->and($outubro)->toBe(1);
});

it('deve consolidar o financeiro por período em regime de caixa', function () {
    // ARRANGE — receita paga 200, despesa paga 80, receita ABERTA 999
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $conta = Conta::create(['nome' => 'Caixa Relatório Fictício']);
    $receita = Categoria::create(['nome' => 'Sessões Fictícias', 'tipo' => 'receita']);
    $despesa = Categoria::create(['nome' => 'Aluguel Fictício', 'tipo' => 'despesa']);
    $tipoPagamento = TipoPagamento::create(['nome' => 'PIX Relatório Fictício']);
    $lancar = function (Categoria $categoria, string $valor, bool $pagar) use ($conta, $tipoPagamento): void {
        $id = $this->postJson('/api/lancamentos', [
            'tipo' => $categoria->tipo,
            'competencia' => agoraNaClinica()->toDateString(),
            'vencimento' => agoraNaClinica()->toDateString(),
            'categoria_id' => $categoria->id,
            'valor' => $valor,
            'tipo_pagamento_id' => $tipoPagamento->id,
            'conta_id' => $conta->id,
        ])->assertCreated()->json('id');
        if ($pagar) {
            $this->postJson("/api/lancamentos/{$id}/pagamento")->assertOk();
        }
    };
    $lancar($receita, '200.00', true);
    $lancar($despesa, '80.00', true);
    $lancar($receita, '999.00', false);

    $hoje = agoraNaClinica()->toDateString();

    // ACT
    $relatorio = $this->getJson("/api/relatorios/financeiro-por-periodo?de={$hoje}&ate={$hoje}");

    // ASSERT — coerente com o extrato; em aberto fora (T-not-15)
    $relatorio->assertOk()
        ->assertJsonPath('totais.receitas', '200.00')
        ->assertJsonPath('totais.despesas', '80.00')
        ->assertJsonPath('totais.saldo_do_periodo', '120.00');
    $porCategoria = collect($relatorio->json('linhas'))->keyBy('categoria.id');
    expect($porCategoria[$receita->id]['total'])->toBe('200.00')
        ->and($porCategoria[$despesa->id]['total'])->toBe('80.00');

    // 403 sem a permissão dos agregados (fluxo_caixa.ver — totais-do-caixa)
    $semPermissao = Usuario::factory()->create();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($semPermissao)
        ->getJson("/api/relatorios/financeiro-por-periodo?de={$hoje}&ate={$hoje}")
        ->assertForbidden();
});

it('deve consolidar sessões vendidas x realizadas por tratamento', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $tratamento = Tratamento::factory()->create(['sessoes_total' => 10]);
    $tratamento->forceFill(['sessoes_realizadas' => 4])->save();
    Tratamento::factory()->create(['sessoes_total' => 5, 'status' => 'finalizado']);

    // ACT
    $relatorio = $this->getJson('/api/relatorios/sessoes-vendidas-realizadas?status=andamento');

    // ASSERT — vendido/realizado/saldo da fonte canônica; filtro por status
    $relatorio->assertOk()->assertJsonPath('total', 1);
    $linha = $relatorio->json('data.0');
    expect($linha['vendidas'])->toBe(10)
        ->and($linha['realizadas'])->toBe(4)
        ->and($linha['saldo'])->toBe(6)
        ->and($linha['paciente'])->toHaveKeys(['id', 'nome']);

    // 403 sem tratamentos.ver
    $semPermissao = Usuario::factory()->create();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($semPermissao)
        ->getJson('/api/relatorios/sessoes-vendidas-realizadas')
        ->assertForbidden();
});

it('deve escopar o relatório de sessões vendidas × realizadas pelo eixo agenda (SEC-VP-45)', function () {
    // ARRANGE — a lista é POR CRIANÇA (nome, convênio, modalidade, saldo) sob `tratamentos.ver`, e
    // era plana: o Profissional da matriz AP-10 lia, de toda criança da clínica, o que o `index`
    // de tratamentos lhe esconde. Sem vínculo e sem flag, relatório vazio (fail-closed).
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $meu = Tratamento::factory()->create(['profissional_id' => $prof->id]);
    $doColega = Tratamento::factory()->create(['profissional_id' => $colega->id]);
    $escopado = usuarioEscopadoEm($prof, ['tratamentos.ver']);
    $semVinculo = usuarioCom(['tratamentos.ver'], 'Sem vínculo');

    // ACT
    $doEscopado = $this->actingAs($escopado)->getJson('/api/relatorios/sessoes-vendidas-realizadas');
    trocarDeUsuario();
    $doSemVinculo = $this->actingAs($semVinculo)->getJson('/api/relatorios/sessoes-vendidas-realizadas');

    // ASSERT
    $doEscopado->assertOk()->assertJsonPath('total', 1);
    expect(collect($doEscopado->json('data'))->pluck('tratamento_id'))->toContain($meu->id)->not->toContain($doColega->id);
    $doSemVinculo->assertOk()->assertJsonPath('total', 0);
});
