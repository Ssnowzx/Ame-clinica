<?php

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Fornecedor;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Servico;
use App\Models\StatusAgendamento;
use App\Models\TipoPagamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * O FINANCEIRO do painel do profissional (change painel-do-profissional, D4): duas portas estreitas —
 * a própria (`repasse.ver_proprio` + vínculo igual ao id) e a de gestão (a régua do relatório
 * "Recebido por profissional") — e nenhum caminho para o dinheiro da clínica.
 *
 * A cena: a Ana atende sessões do pacote particular dela, uma sessão do pacote da Bia (quem ATENDEU
 * recebe) e uma de convênio de PLANO (que só chega ao caixa com a flag da clínica, e fica fora da
 * ficha). Em volta, o que nunca pode aparecer: a Bia, o pagamento sem profissional e a despesa da
 * clínica. Relógio fixo em 15/10/2026, 10h. Dados 100% fictícios (LGPD).
 */
function relogioDoFinanceiroDoPainel(): void
{
    test()->travelTo(CarbonImmutable::parse('2026-10-15 10:00:00', 'America/Sao_Paulo'));
}

function profissionalDoFinanceiroDoPainel(string $nome): Profissional
{
    $especialidade = Especialidade::query()->where('nome', 'Psicologia Fictícia')->first()
        ?? Especialidade::factory()->create(['nome' => 'Psicologia Fictícia', 'tempo_sessao' => 40]);
    $profissional = Profissional::factory()->create(['nome' => $nome]);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);

    return $profissional;
}

function pacoteDoFinanceiroDoPainel(Profissional $dono, Paciente $crianca, Convenio $convenio): Tratamento
{
    // o serviço é único por convênio × procedimento: um por dono do pacote
    $servico = new Servico(['procedimento' => "Sessão Fictícia {$dono->nome}", 'valor' => '150.00']);
    $servico->convenio_id = $convenio->id;
    $servico->save();

    return Tratamento::factory()->create([
        'paciente_id' => $crianca->id,
        'convenio_id' => $convenio->id,
        'servico_id' => $servico->id,
        'profissional_id' => $dono->id,
        'especialidade_id' => DB::table('profissional_especialidade')->where('profissional_id', $dono->id)->value('especialidade_id'),
    ]);
}

/** Uma sessão do pacote, atendida por `$quem`, no papel dado (pelas flags). */
function sessaoDoFinanceiroDoPainel(Profissional $quem, Tratamento $pacote, string $inicio, string $papel = 'realizada'): Agendamento
{
    $status = $papel === 'falta'
        ? StatusAgendamento::query()->where('marca_falta', true)->orderBy('ordem')->firstOrFail()
        : StatusAgendamento::query()->where(['desconta_sessao' => true, 'marca_falta' => false, 'marca_reserva' => false])->orderBy('ordem')->firstOrFail();
    $sessao = Agendamento::factory()->create([
        'paciente_id' => $pacote->paciente_id,
        'profissional_id' => $quem->id,
        'especialidade_id' => $pacote->especialidade_id,
        'status_id' => $status->id,
        'inicio' => $inicio,
        'fim' => CarbonImmutable::parse($inicio)->addMinutes(40)->format('Y-m-d H:i:s'),
    ]);
    $sessao->forceFill(['tratamento_id' => $pacote->id])->save();

    return $sessao;
}

/** O lançamento da sessão faturada, como o faturamento o deixa (vínculos do servidor). */
function faturadaDoFinanceiroDoPainel(Agendamento $sessao, string $valor, ?string $pagoEm, string $forma = 'PIX Fictício'): LancamentoCaixa
{
    return lancamentoNoCaixa($valor, [
        'competencia' => $sessao->inicio->toDateString(),
        'vencimento' => $sessao->inicio->toDateString(),
        'interessado_tipo' => 'paciente',
        'interessado_id' => $sessao->paciente_id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => $forma])->id,
    ], ['agendamento_id' => $sessao->id, 'tratamento_id' => $sessao->tratamento_id, 'pago_em' => $pagoEm]);
}

/**
 * @return array{ana: Profissional, bia: Profissional, emAberto: Agendamento, plano: Convenio}
 */
function cenaDoFinanceiroDoPainel(): array
{
    $particular = Convenio::create(['nome' => 'Particular Fictício do Painel', 'particular' => true]);
    $plano = Convenio::create(['nome' => 'Plano Fictício do Painel', 'particular' => false]);
    $ana = profissionalDoFinanceiroDoPainel('Ana Fictícia do Caixa');
    $bia = profissionalDoFinanceiroDoPainel('Bia Fictícia do Caixa');
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia do Caixa']);
    $outra = Paciente::factory()->create(['nome' => 'Outra Criança Fictícia do Caixa']);
    $pacoteDaAna = pacoteDoFinanceiroDoPainel($ana, $crianca, $particular);
    $planoDaAna = pacoteDoFinanceiroDoPainel($ana, $crianca, $plano);
    $pacoteDaBia = pacoteDoFinanceiroDoPainel($bia, $outra, $particular);

    // o início da clínica: uma sessão de agosto, sem lançamento — antes de 01/09, para "outubro ×
    // setembro" comparar o mesmo período inteiro
    sessaoDoFinanceiroDoPainel($ana, $pacoteDaAna, '2026-08-03 08:00:00');

    // o que é da Ana em outubro (até hoje): 150 + 600 + 120 − 50 = 820
    faturadaDoFinanceiroDoPainel(sessaoDoFinanceiroDoPainel($ana, $pacoteDaAna, '2026-10-05 08:00:00'), '150.00', '2026-10-06 09:00');
    lancamentoNoCaixa('600.00', ['interessado_tipo' => 'paciente', 'interessado_id' => $crianca->id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => 'Dinheiro Fictício'])->id,
    ], ['tratamento_id' => $pacoteDaAna->id, 'pago_em' => '2026-10-02 10:00']);
    // a Ana ATENDEU a sessão do pacote da Bia: quem atendeu recebe
    faturadaDoFinanceiroDoPainel(sessaoDoFinanceiroDoPainel($ana, $pacoteDaBia, '2026-10-07 08:00:00'), '120.00', '2026-10-08 09:00');
    // devolução à família: subtrai, como no relatório
    lancamentoNoCaixa('50.00', ['tipo' => 'despesa', 'interessado_tipo' => 'paciente', 'interessado_id' => $crianca->id],
        ['tratamento_id' => $pacoteDaAna->id, 'pago_em' => '2026-10-10 10:00']);
    // setembro, no mesmo período (1–15/09)
    faturadaDoFinanceiroDoPainel(sessaoDoFinanceiroDoPainel($ana, $pacoteDaAna, '2026-09-08 08:00:00'), '100.00', '2026-09-10 09:00');

    // em aberto: a realizada (entra), a falta e a de plano (não entram)
    $emAberto = sessaoDoFinanceiroDoPainel($ana, $pacoteDaAna, '2026-10-12 08:00:00');
    faturadaDoFinanceiroDoPainel($emAberto, '150.00', null);
    faturadaDoFinanceiroDoPainel(sessaoDoFinanceiroDoPainel($ana, $pacoteDaAna, '2026-10-13 08:00:00', 'falta'), '150.00', null);
    faturadaDoFinanceiroDoPainel(sessaoDoFinanceiroDoPainel($ana, $planoDaAna, '2026-10-13 09:00:00'), '90.00', null);

    // o que NUNCA aparece na ficha da Ana
    faturadaDoFinanceiroDoPainel(sessaoDoFinanceiroDoPainel($ana, $planoDaAna, '2026-10-09 08:00:00'), '300.00', '2026-10-09 12:00');
    faturadaDoFinanceiroDoPainel(sessaoDoFinanceiroDoPainel($bia, $pacoteDaBia, '2026-10-06 08:00:00'), '200.00', '2026-10-07 09:00');
    lancamentoNoCaixa('999.00', ['interessado_tipo' => 'paciente', 'interessado_id' => $outra->id], ['pago_em' => '2026-10-03 10:00']);
    $fornecedor = Fornecedor::create(['razao_social' => 'Fornecedor Fictício do Caixa']);
    lancamentoNoCaixa('5000.00', ['tipo' => 'despesa', 'interessado_tipo' => 'fornecedor', 'interessado_id' => $fornecedor->id], ['pago_em' => '2026-10-04 10:00']);

    return compact('ana', 'bia', 'emAberto', 'plano');
}

/** A profissional vinculada a `$profissional`, escopada, com as permissões dadas. */
function propriaDoFinanceiroDoPainel(Profissional $profissional, array $extras): Usuario
{
    return usuarioEscopadoEm($profissional, $extras);
}

it('deve mostrar à profissional com repasse.ver_proprio só o que entrou pelos atendimentos dela', function () {
    // ARRANGE
    relogioDoFinanceiroDoPainel();
    admin();
    ['ana' => $ana, 'emAberto' => $emAberto] = cenaDoFinanceiroDoPainel();
    $aAna = propriaDoFinanceiroDoPainel($ana, ['repasse.ver_proprio']);

    // ACT
    $resposta = $this->actingAs($aAna)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('financeiro'))->toBe([
        'base' => 'caixa',
        'recebido' => ['atual' => '820.00', 'anterior' => '100.00'],
        'por_forma' => [
            ['forma' => 'Dinheiro Fictício', 'valor' => '600.00'],
            ['forma' => 'PIX Fictício', 'valor' => '220.00'],
        ],
        'por_convenio' => [['convenio' => 'Particular Fictício do Painel', 'valor' => '820.00']],
        'sem_pagamento' => [
            'quantidade' => 1,
            'itens' => [[
                'atendimento_id' => $emAberto->id,
                'data' => '2026-10-12',
                'paciente' => 'Criança Fictícia do Caixa',
                'valor' => '150.00',
            ]],
        ],
    ]);
});

it('deve trazer o recebido mês a mês na série, só com o financeiro', function () {
    // ARRANGE — a clínica começa em agosto: maio a julho sem dados, agosto sem pagamento
    relogioDoFinanceiroDoPainel();
    admin();
    ['ana' => $ana] = cenaDoFinanceiroDoPainel();
    $aAna = propriaDoFinanceiroDoPainel($ana, ['repasse.ver_proprio']);

    // ACT
    $resposta = $this->actingAs($aAna)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT — sem `atendimentos.ver`, a série vem pelo financeiro e sem os realizados
    $resposta->assertOk();
    expect(collect($resposta->json('serie'))->map(fn (array $mes): array => [$mes['mes'], $mes['recebido']])->all())->toBe([
        ['2026-05', null], ['2026-06', null], ['2026-07', null], ['2026-08', '0.00'],
        ['2026-09', '100.00'], ['2026-10', '820.00'],
    ])->and($resposta->json('serie.5'))->not->toHaveKey('realizados');
});

it('não deve trazer o financeiro a quem não tem a permissão própria nem a régua do relatório', function () {
    // ARRANGE
    relogioDoFinanceiroDoPainel();
    admin();
    ['ana' => $ana] = cenaDoFinanceiroDoPainel();
    $aAna = propriaDoFinanceiroDoPainel($ana, ['atendimentos.ver']);

    // ACT
    $resposta = $this->actingAs($aAna)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json())->toHaveKey('agenda')->not->toHaveKey('financeiro')
        ->and(collect($resposta->json('serie'))->every(fn (array $mes): bool => ! array_key_exists('recebido', $mes)))->toBeTrue();
});

it('não deve abrir financeiro de ninguém com repasse.ver_proprio e sem vínculo', function () {
    // ARRANGE — a permissão própria sem profissional vinculado não é nada (spec rbac)
    relogioDoFinanceiroDoPainel();
    admin();
    ['ana' => $ana] = cenaDoFinanceiroDoPainel();
    $semVinculo = usuarioCom(['profissionais.ver', 'agenda.ver', 'agenda.ver_todos', 'repasse.ver_proprio'], 'Própria Sem Vínculo');

    // ACT
    $resposta = $this->actingAs($semVinculo)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json())->toHaveKey('agenda')->not->toHaveKey('financeiro');
});

it('não deve abrir o financeiro do colega com repasse.ver_proprio, nem com agenda.ver_todos', function () {
    // ARRANGE — vinculada à Ana, vê a agenda da clínica inteira: a porta própria é IGUALDADE, não escopo
    relogioDoFinanceiroDoPainel();
    admin();
    ['ana' => $ana, 'bia' => $bia] = cenaDoFinanceiroDoPainel();
    $aAna = usuarioCom(['profissionais.ver', 'agenda.ver', 'agenda.ver_todos', 'repasse.ver_proprio'], 'Ana Que Vê Toda a Agenda');
    $aAna->update(['profissional_id' => $ana->id]);

    // ACT
    $daBia = $this->actingAs($aAna)->getJson("/api/profissionais/{$bia->id}/painel?mes=2026-10");
    $daAna = $this->actingAs($aAna)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT
    $daBia->assertOk();
    expect($daBia->json())->toHaveKey('agenda')->not->toHaveKey('financeiro')
        ->and($daAna->json('financeiro.recebido.atual'))->toBe('820.00');
});

it('deve abrir o financeiro pela régua do relatório, um profissional por vez', function () {
    // ARRANGE — a faturista: as três permissões do relatório e o alcance da agenda, sem a agenda em si
    relogioDoFinanceiroDoPainel();
    admin();
    ['ana' => $ana] = cenaDoFinanceiroDoPainel();
    $faturista = usuarioCom(['profissionais.ver', 'repasse.ver', 'lancamentos.ver', 'tratamentos.ver', 'agenda.ver_todos'], 'Faturista do Painel');

    // ACT
    $resposta = $this->actingAs($faturista)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT
    $resposta->assertOk();
    expect(array_keys($resposta->json()))->toBe(['profissional', 'periodo', 'inicio_historico', 'inicio_historico_dia', 'serie', 'financeiro'])
        ->and($resposta->json('financeiro.recebido.atual'))->toBe('820.00');
});

it('não deve abrir o financeiro pela régua do relatório faltando uma das três permissões', function (array $permissoes) {
    // ARRANGE — com a agenda, para sobrar um bloco (sem bloco nenhum seria 403)
    relogioDoFinanceiroDoPainel();
    admin();
    ['ana' => $ana] = cenaDoFinanceiroDoPainel();
    $quase = usuarioCom(['profissionais.ver', 'agenda.ver', 'agenda.ver_todos', ...$permissoes], 'Quase Faturista '.md5(implode(',', $permissoes)));

    // ACT
    $resposta = $this->actingAs($quase)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json())->toHaveKey('agenda')->not->toHaveKey('financeiro');
})->with([
    'sem repasse.ver' => [['lancamentos.ver', 'tratamentos.ver']],
    'sem lancamentos.ver' => [['repasse.ver', 'tratamentos.ver']],
    'sem tratamentos.ver' => [['repasse.ver', 'lancamentos.ver']],
]);

it('não deve abrir o financeiro pela régua do relatório a quem não alcança a agenda do profissional', function () {
    // ARRANGE — as três permissões, sem `agenda.ver_todos` e sem vínculo: o eixo do relatório é
    // `nenhum`, como lá (onde a mesma pessoa receberia a folha vazia)
    relogioDoFinanceiroDoPainel();
    admin();
    ['ana' => $ana] = cenaDoFinanceiroDoPainel();
    $semAlcance = usuarioCom(['profissionais.ver', 'agenda.ver', 'repasse.ver', 'lancamentos.ver', 'tratamentos.ver'], 'Faturista Sem Alcance');

    // ACT
    $resposta = $this->actingAs($semAlcance)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT — sem alcance, nenhum bloco sobra
    $resposta->assertForbidden();
});

it('não deve trazer total da clínica, Sem profissional, despesa da clínica nem convênio de plano', function () {
    // ARRANGE
    relogioDoFinanceiroDoPainel();
    $administradora = admin();
    ['ana' => $ana] = cenaDoFinanceiroDoPainel();

    // ACT — mesmo o Administrador, que vê o fluxo de caixa, recebe só a Ana
    $resposta = $this->actingAs($administradora)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT
    $resposta->assertOk();
    $financeiro = $resposta->json('financeiro');
    $valores = collect([...$financeiro['por_forma'], ...$financeiro['por_convenio']])->pluck('valor');
    expect(array_keys($financeiro))->toBe(['base', 'recebido', 'por_forma', 'por_convenio', 'sem_pagamento'])
        ->and($valores->map(fn (string $v): string => bcadd($v, '0', 2))->reduce(fn (string $s, string $v): string => bcadd($s, $v, 2), '0'))
        ->toBe(bcmul($financeiro['recebido']['atual'], '2', 2))
        ->and(collect($financeiro['por_convenio'])->pluck('convenio')->all())->toBe(['Particular Fictício do Painel']);
    foreach (['Sem profissional', 'Plano Fictício', 'Bia Fictícia', 'Fornecedor', '999.00', '5000.00', '300.00', '200.00', '90.00', 'total'] as $texto) {
        semVazamento($financeiro, $texto);
    }
});

it('deve somar o mesmo que o relatório Recebido por profissional, menos o convênio de plano', function () {
    // ARRANGE — a mesma consulta base: a única diferença é o plano, que a ficha deixa de fora (§14)
    relogioDoFinanceiroDoPainel();
    $administradora = admin();
    ['ana' => $ana] = cenaDoFinanceiroDoPainel();

    // ACT
    $this->actingAs($administradora);
    $painel = $this->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10")->assertOk();
    $relatorio = $this->getJson("/api/relatorios/recebido-por-profissional?de=2026-10-01&ate=2026-10-15&profissional_id={$ana->id}")->assertOk();

    // ASSERT
    expect($relatorio->json('totais.recebido'))->toBe('1120.00')
        ->and(bcadd($painel->json('financeiro.recebido.atual'), '300.00', 2))->toBe('1120.00');
});

it('não deve escrever no financeiro ao montar o painel', function () {
    // ARRANGE
    relogioDoFinanceiroDoPainel();
    $administradora = admin();
    ['ana' => $ana] = cenaDoFinanceiroDoPainel();
    $retrato = fn (): array => LancamentoCaixa::query()->orderBy('id')
        ->get(['id', 'valor', 'pago_em', 'tratamento_id', 'agendamento_id', 'updated_at'])
        ->map(fn (LancamentoCaixa $l): array => $l->only(['id', 'valor', 'tratamento_id', 'agendamento_id']) + [
            'pago_em' => $l->pago_em?->format('Y-m-d H:i:s'),
            'updated_at' => $l->updated_at?->format('Y-m-d H:i:s.u'),
        ])->all();
    $antes = $retrato();
    $quantosAntes = count($antes);

    // ACT
    $this->actingAs($administradora)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10")->assertOk();

    // ASSERT
    expect(LancamentoCaixa::query()->count())->toBe($quantosAntes)
        ->and($retrato())->toBe($antes);
});

it('não deve listar o nome das crianças sem pagamento a quem não vê a agenda do profissional', function () {
    // ARRANGE — SEC-PP-02: a régua do relatório não exige agenda; a faturista lê o recebido, mas os
    // nomes das crianças da agenda da Ana só vêm a quem vê essa agenda
    relogioDoFinanceiroDoPainel();
    admin();
    ['ana' => $ana] = cenaDoFinanceiroDoPainel();
    $faturista = usuarioCom(['profissionais.ver', 'repasse.ver', 'lancamentos.ver', 'tratamentos.ver', 'agenda.ver_todos'], 'Faturista Sem Agenda');
    $comAgenda = usuarioCom(['profissionais.ver', 'repasse.ver', 'lancamentos.ver', 'tratamentos.ver', 'agenda.ver_todos', 'agenda.ver'], 'Faturista Com Agenda');

    // ACT
    $semNomes = $this->actingAs($faturista)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");
    trocarDeUsuario();
    $comNomes = $this->actingAs($comAgenda)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT — sem a agenda, só a contagem (a chave `itens` nem existe)
    $semNomes->assertOk();
    $comNomes->assertOk();
    expect($semNomes->json('financeiro.sem_pagamento'))->toBe(['quantidade' => 1])
        ->and($comNomes->json('financeiro.sem_pagamento.itens.0.paciente'))->toBe('Criança Fictícia do Caixa');
    semVazamento($semNomes->json(), 'Criança Fictícia');
});
