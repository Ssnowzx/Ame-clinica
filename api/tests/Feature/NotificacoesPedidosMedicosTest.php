<?php

use App\Models\Configuracao;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Tratamento;
use Carbon\Carbon;

// Relógio ANCORADO num dia seguro (dia 10): aritmética de meses em dia 29–31 não
// tem roundtrip exato (31/03 − 6M = 30/09; +6M = 30/03), e as asserções de data
// literal ficariam intermitentes conforme o dia real da suíte.
beforeEach(fn () => Carbon::setTestNow(Carbon::parse('2026-06-10 12:00:00', 'America/Sao_Paulo')));
afterEach(fn () => Carbon::setTestNow());

/**
 * Tratamento EM ANDAMENTO de um convênio com validade, com pedido emitido de
 * modo que o vencimento caia a `$diasParaVencer` de hoje (negativo = vencido).
 * Validade fixa de 6 meses; a emissão anda para trás a partir do vencimento.
 */
function tratamentoComPedidoVencendoEm(int $diasParaVencer, array $extras = []): Tratamento
{
    $convenio = Convenio::create([
        'nome' => 'Operadora Fictícia '.fake()->unique()->word(),
        'pedido_validade_meses' => 6,
    ]);
    $emissao = agoraNaClinica()->addDays($diasParaVencer)->subMonthsNoOverflow(6);

    return Tratamento::factory()->create([
        'convenio_id' => $convenio->id,
        'pedido_emitido_em' => $emissao->format('Y-m-d'),
        'status' => 'andamento',
        ...$extras,
    ]);
}

it('deve listar no bloco só a janela: vencidos e a vencer dentro da antecedência', function () {
    // ARRANGE — antecedência default 60 (§13): 30d entra, 100d fica fora, vencido entra
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $entra = tratamentoComPedidoVencendoEm(30, [
        'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia A'])->id,
    ]);
    tratamentoComPedidoVencendoEm(100); // fora da antecedência
    $vencido = tratamentoComPedidoVencendoEm(-5, [
        'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia B'])->id,
    ]);

    // ACT
    $bloco = $this->getJson('/api/notificacoes')->json('pedidos_medicos');

    // ASSERT — 2 itens: o vencido (mais urgente) primeiro, com dias nulos; o a
    // vencer com a contagem de dias
    expect($bloco['total'])->toBe(2)->and($bloco['itens'])->toHaveCount(2);
    [$itemVencido, $itemAVencer] = $bloco['itens'];
    expect($itemVencido['tratamento_id'])->toBe($vencido->id)
        ->and($itemVencido['vencido'])->toBeTrue()
        ->and($itemVencido['vence_em_dias'])->toBeNull()
        ->and($itemVencido['vence_em'])->toBe(agoraNaClinica()->subDays(5)->format('Y-m-d'));
    expect($itemAVencer['tratamento_id'])->toBe($entra->id)
        ->and($itemAVencer['vencido'])->toBeFalse()
        ->and($itemAVencer['vence_em_dias'])->toBe(30)
        ->and($itemAVencer['paciente']['nome'])->toBe('Criança Fictícia A');
});

it('deve expor no item EXATAMENTE a whitelist do bloco — nada do cadastro nem do pedido', function () {
    // ARRANGE — SEC-LP-02: chaves presentes E ausentes
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    tratamentoComPedidoVencendoEm(30, [
        'matricula' => 'MATRICULA-FICTICIA-XYZ',
        'guia' => 'GUIA-FICTICIA-XYZ',
        'pedido_sessoes_por_semana' => 3,
    ]);

    // ACT
    $bloco = $this->getJson('/api/notificacoes')->json('pedidos_medicos');

    // ASSERT — a whitelist exata…
    $item = $bloco['itens'][0];
    expect(array_keys($item))->toBe([
        'tratamento_id', 'paciente', 'convenio', 'especialidade',
        'vencido', 'vence_em', 'vence_em_dias',
    ])
        ->and(array_keys($item['paciente']))->toBe(['id', 'nome', 'nome_social'])
        ->and(array_keys($item['convenio']))->toBe(['id', 'nome'])
        ->and(array_keys($item['especialidade']))->toBe(['id', 'nome']);

    // …e nenhum identificador/dado sensível atravessa (matrícula, guia, override)
    semVazamento($bloco, 'MATRICULA-FICTICIA-XYZ');
    semVazamento($bloco, 'GUIA-FICTICIA-XYZ');
});

it('deve manter o bloco AUSENTE sem tratamentos.ver', function () {
    // ARRANGE — cenário da spec: sem a permissão o bloco não existe (nem contador)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    tratamentoComPedidoVencendoEm(30);
    $semTratamentos = usuarioCom(['agenda.ver'], 'Sem Tratamentos');

    // ACT
    $centro = $this->actingAs($semTratamentos)->getJson('/api/notificacoes');

    // ASSERT
    $centro->assertOk();
    expect($centro->json())->not->toHaveKey('pedidos_medicos');
});

it('deve deixar fora tratamento sem pedido, convênio sem validade e status fora de andamento', function () {
    // ARRANGE — cenários da spec tratamentos/convenios (nenhum alarme falso)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    // sem pedido registrado
    Tratamento::factory()->create(['status' => 'andamento']);
    // com pedido, mas convênio SEM validade
    $semValidade = Convenio::create(['nome' => 'Sem Validade Fictício']);
    Tratamento::factory()->create([
        'convenio_id' => $semValidade->id,
        'pedido_emitido_em' => agoraNaClinica()->subMonths(8)->format('Y-m-d'),
        'status' => 'andamento',
    ]);
    // vencido, porém tratamento FINALIZADO
    tratamentoComPedidoVencendoEm(-10, ['status' => 'finalizado']);

    // ACT + ASSERT
    expect($this->getJson('/api/notificacoes')->json('pedidos_medicos.total'))->toBe(0);
});

it('deve respeitar o teto de itens do bloco mantendo o contador total', function () {
    // ARRANGE — 51 tratamentos na janela (teto do centro = 50)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $convenio = Convenio::create(['nome' => 'Operadora Fictícia', 'pedido_validade_meses' => 6]);
    $paciente = Paciente::factory()->create();
    $especialidade = Especialidade::factory()->create();
    $emissao = agoraNaClinica()->addDays(30)->subMonthsNoOverflow(6)->format('Y-m-d');
    Tratamento::factory()->count(51)->create([
        'paciente_id' => $paciente->id,
        'convenio_id' => $convenio->id,
        'especialidade_id' => $especialidade->id,
        'pedido_emitido_em' => $emissao,
        'status' => 'andamento',
    ]);

    // ACT
    $bloco = $this->getJson('/api/notificacoes')->json('pedidos_medicos');

    // ASSERT
    expect($bloco['total'])->toBe(51)->and($bloco['itens'])->toHaveCount(50);
});

it('deve validar a faixa 7..180 da antecedência na escrita da configuração', function () {
    // ARRANGE — SEC-LP-16, lado da ESCRITA
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);

    // ACT + ASSERT
    foreach ([6, 181] as $foraDaFaixa) {
        $this->putJsonComVersao('/api/configuracoes', [
            'chave' => 'tratamentos.pedido_aviso_antecedencia_dias', 'valor' => $foraDaFaixa,
        ])->assertUnprocessable()->assertJsonValidationErrors('valor');
    }
    $this->putJsonComVersao('/api/configuracoes', [
        'chave' => 'tratamentos.pedido_aviso_antecedencia_dias', 'valor' => 90,
    ])->assertOk();

    // com antecedência 90, um pedido a 80 dias entra na janela
    tratamentoComPedidoVencendoEm(80);
    expect($this->getJson('/api/notificacoes')->json('pedidos_medicos.total'))->toBe(1);
});

it('deve clampar a antecedência na LEITURA: valor adulterado no banco nunca alarga além de 180', function () {
    // ARRANGE — SEC-LP-16, lado da LEITURA: escrita crua fora do boundary
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    Configuracao::create(['chave' => 'tratamentos.pedido_aviso_antecedencia_dias', 'valor' => '400']);
    tratamentoComPedidoVencendoEm(200); // só entraria com a janela adulterada (400)
    $dentroDoTeto = tratamentoComPedidoVencendoEm(170);

    // ACT + ASSERT — a janela efetiva é 180: o de 200 dias fica fora
    $bloco = $this->getJson('/api/notificacoes')->json('pedidos_medicos');
    expect($bloco['total'])->toBe(1)
        ->and($bloco['itens'][0]['tratamento_id'])->toBe($dentroDoTeto->id);

    // e o piso: adulterado para 1, a janela efetiva é 7 (nunca estreita além dela)
    Configuracao::where('chave', 'tratamentos.pedido_aviso_antecedencia_dias')
        ->update(['valor' => '1']);
    tratamentoComPedidoVencendoEm(5);
    expect($this->getJson('/api/notificacoes')->json('pedidos_medicos.total'))->toBe(2);
});

it('deve escopar o bloco de pedidos médicos pelo eixo agenda (SEC-VP-45)', function () {
    // ARRANGE — "plano por construção" (SEC-LP-06) era anterior ao perfil escopado da AP-10: o
    // profissional lia o pedido médico (criança, convênio, modalidade, validade) de toda criança
    // da clínica. A fonte única aplica o escopo por dentro, como `PacotesAcabando`.
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $meu = tratamentoComPedidoVencendoEm(30, ['profissional_id' => $prof->id]);
    tratamentoComPedidoVencendoEm(20, ['profissional_id' => $colega->id]);
    $escopado = usuarioEscopadoEm($prof, ['tratamentos.ver']);
    $semVinculo = usuarioCom(['tratamentos.ver'], 'Sem vínculo');

    // ACT
    $doEscopado = $this->actingAs($escopado)->getJson('/api/notificacoes')->json('pedidos_medicos');
    trocarDeUsuario();
    $doSemVinculo = $this->actingAs($semVinculo)->getJson('/api/notificacoes')->json('pedidos_medicos');

    // ASSERT
    expect($doEscopado['total'])->toBe(1)
        ->and($doEscopado['itens'][0]['tratamento_id'])->toBe($meu->id);
    expect($doSemVinculo['total'])->toBe(0)->and($doSemVinculo['itens'])->toBe([]);
});
