<?php

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Relatorios\Agendamentos;
use Carbon\Carbon;

/**
 * O relatório `agendamentos` e o despacho por slug (change `area-de-relatorios`, onda 1):
 * 404 → 403 ANTES de 422 → 422 → envelope; analítico com as colunas declaradas e a ordem;
 * sintético somado no banco; filtros com nome legível; escopo D11 do eixo agenda;
 * índice sem dado; o corte de linhas com limite injetado.
 */

/** Um agendamento de atendimento em `$data` (hoje da clínica por padrão) às `$hora`, 40 min. */
function agendamentoDoRelatorio(array $atributos = [], ?string $data = null, string $hora = '09:00'): Agendamento
{
    $data ??= agoraNaClinica()->toDateString();

    return Agendamento::factory()->create([
        'inicio' => "{$data} {$hora}",
        'fim' => Carbon::parse("{$data} {$hora}")->addMinutes(40)->format('Y-m-d H:i'),
        ...$atributos,
    ]);
}

/** A query string de `de`/`ate` cobrindo `$dias` para trás a partir de hoje da clínica. */
function periodoDoRelatorio(int $dias = 7): string
{
    return 'de='.agoraNaClinica()->subDays($dias)->toDateString().'&ate='.agoraNaClinica()->toDateString();
}

it('deve responder 404 para slug fora do catálogo', function () {
    // ARRANGE
    $this->actingAs(admin());

    // ACT + ASSERT
    $this->getJson('/api/relatorios/nao-existe?'.periodoDoRelatorio())->assertNotFound();
});

it('deve recusar com 403 quem não tem agenda.ver MESMO com período inválido (403 antes de 422)', function () {
    // ARRANGE — um usuário logado, com outra permissão, e um período que NÃO valida
    admin();
    $semAgenda = usuarioCom(['pacientes.ver'], 'Sem agenda');

    // ACT + ASSERT — a autorização decide antes de o validador olhar o parâmetro
    $this->actingAs($semAgenda)
        ->getJson('/api/relatorios/agendamentos?de=nao-e-data')
        ->assertForbidden();
    $this->actingAs($semAgenda)
        ->getJson('/api/relatorios/agendamentos')
        ->assertForbidden();
});

it('deve exigir de/ate e cortar o período INCLUSIVO em 366 dias, nas duas bordas', function () {
    // ARRANGE — o período é inclusivo nas duas pontas, e é assim que a spec e a tela contam
    // (`diasDoPeriodo` soma 1). O servidor comparava o `diffInDays` cru contra 366 e ACEITAVA
    // 367 dias inclusivos — um dia a mais que a tela deixava pedir (`CRR-15`).
    $this->actingAs(admin());
    $ate = agoraNaClinica()->toDateString();
    $deLonge = agoraNaClinica()->subDays(370)->toDateString();
    $noLimite = agoraNaClinica()->subDays(365)->toDateString();   // 366 dias com as duas pontas
    $umDiaAlem = agoraNaClinica()->subDays(366)->toDateString();  // 367 — recusa

    // ACT + ASSERT
    $this->getJson('/api/relatorios/agendamentos')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['de', 'ate']);
    $this->getJson("/api/relatorios/agendamentos?de={$deLonge}&ate={$ate}")
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['ate']);

    // ...a borda: 366 dias inclusivos passam
    $this->getJson("/api/relatorios/agendamentos?de={$noLimite}&ate={$ate}")->assertOk();
    // ...e 367 recusam, com o erro no mesmo campo
    $this->getJson("/api/relatorios/agendamentos?de={$umDiaAlem}&ate={$ate}")
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['ate']);
});

it('deve exigir dividir_por no sintético e recusar divisão desconhecida', function () {
    // ARRANGE
    $this->actingAs(admin());

    // ACT + ASSERT
    $this->getJson('/api/relatorios/agendamentos?'.periodoDoRelatorio().'&resultado=sintetico')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['dividir_por']);
    $this->getJson('/api/relatorios/agendamentos?'.periodoDoRelatorio().'&resultado=sintetico&dividir_por=sala')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['dividir_por']);
});

it('deve trazer no analítico as colunas declaradas, na ordem data → hora → profissional', function () {
    // ARRANGE — três agendamentos fora de ordem: ontem 14h (Carla), hoje 09h (Bia), hoje 09h (Ana)
    $this->actingAs(admin());
    $hoje = agoraNaClinica()->toDateString();
    $ontem = agoraNaClinica()->subDay()->toDateString();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    $carla = Profissional::factory()->create(['nome' => 'Carla Fictícia']);
    $especialidade = Especialidade::factory()->create(['nome' => 'Fono Fictícia']);
    $paciente = Paciente::factory()->create(['nome' => 'Criança Fictícia do Analítico']);
    agendamentoDoRelatorio(['profissional_id' => $bia->id, 'paciente_id' => $paciente->id, 'especialidade_id' => $especialidade->id], $hoje, '09:00');
    $daAna = agendamentoDoRelatorio(['profissional_id' => $ana->id, 'especialidade_id' => $especialidade->id], $hoje, '09:00');
    agendamentoDoRelatorio(['profissional_id' => $carla->id, 'especialidade_id' => $especialidade->id], $ontem, '14:00');
    // a Ana tem pacote com convênio → a coluna sai com o nome dele; os outros, "Sem convênio"
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $daAna->paciente_id,
        'convenio_id' => Convenio::create(['nome' => 'Operadora Fictícia'])->id,
        'especialidade_id' => $especialidade->id,
        'profissional_id' => $ana->id,
    ]);
    $daAna->forceFill(['tratamento_id' => $tratamento->id])->save();
    // um BLOQUEIO no período não é atendimento e fica fora
    Agendamento::factory()->create([
        'tipo' => 'bloqueio',
        'paciente_id' => null,
        'profissional_id' => $ana->id,
        'especialidade_id' => null,
        'inicio' => "{$hoje} 12:00",
        'fim' => "{$hoje} 13:00",
    ]);

    // ACT
    $resposta = $this->getJson('/api/relatorios/agendamentos?'.periodoDoRelatorio())->assertOk();

    // ASSERT — o envelope
    $resposta->assertJsonPath('slug', 'agendamentos')
        ->assertJsonPath('titulo', 'Agendamentos')
        ->assertJsonPath('periodo.ate', $hoje)
        ->assertJsonPath('filtros_aplicados', [])
        ->assertJsonPath('grupos', null)
        ->assertJsonPath('totais.quantidade', 3)
        ->assertJsonPath('contagem', 3)
        ->assertJsonPath('truncado', false);
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())
        ->toBe(['data', 'hora', 'paciente', 'profissional', 'especialidade', 'convenio', 'status'])
        ->and(collect($resposta->json('colunas'))->pluck('tipo')->all())
        ->toBe(['data', 'hora', 'texto', 'texto', 'texto', 'texto', 'texto']);

    // ...a ordem e as linhas
    $linhas = $resposta->json('linhas');
    expect(collect($linhas)->pluck('profissional')->all())->toBe(['Carla Fictícia', 'Ana Fictícia', 'Bia Fictícia'])
        ->and($linhas[0])->toBe([
            'data' => $ontem,
            'hora' => '14:00',
            'paciente' => $linhas[0]['paciente'],
            'profissional' => 'Carla Fictícia',
            'especialidade' => 'Fono Fictícia',
            'convenio' => 'Sem convênio',
            'status' => 'Em Aberto',
        ])
        ->and($linhas[1]['convenio'])->toBe('Operadora Fictícia')
        ->and($linhas[2]['paciente'])->toBe('Criança Fictícia do Analítico');
});

it('deve somar no sintético por status a quantidade e os minutos de cada grupo', function () {
    // ARRANGE — dois "Em Aberto" e um "Finalizado" (status é DADO: só o nome sai)
    $this->actingAs(admin());
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
    agendamentoDoRelatorio(['status_id' => $emAberto->id], null, '08:00');
    agendamentoDoRelatorio(['status_id' => $emAberto->id], null, '09:00');
    agendamentoDoRelatorio(['status_id' => $finalizado->id], null, '10:00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/agendamentos?'.periodoDoRelatorio().'&resultado=sintetico&dividir_por=status')
        ->assertOk();

    // ASSERT — um grupo por status na ordem do cadastro; totais = soma dos grupos
    $grupos = $resposta->json('grupos');
    expect(collect($grupos)->pluck('titulo')->all())->toBe(['Em Aberto', 'Finalizado'])
        ->and($grupos[0]['totais'])->toBe(['quantidade' => 2, 'minutos' => 80])
        ->and($grupos[0]['linhas'])->toBe([])
        ->and($grupos[1]['totais'])->toBe(['quantidade' => 1, 'minutos' => 40])
        ->and($resposta->json('linhas'))->toBe([])
        ->and($resposta->json('totais'))->toBe(['quantidade' => 3, 'minutos' => 120])
        ->and($resposta->json('contagem'))->toBe(2)
        ->and(collect($resposta->json('colunas'))->pluck('chave')->all())->toBe(['grupo', 'quantidade', 'minutos'])
        ->and($resposta->json('colunas.0.rotulo'))->toBe('Status')
        ->and($resposta->json('filtros_aplicados'))->toBe([['rotulo' => 'Dividido por', 'valor' => 'Status']]);
});

it('deve agrupar por convênio com "Sem convênio" na soma e por dia em ordem cronológica', function () {
    // ARRANGE — um com pacote na Operadora, um sem pacote; em dois dias
    $this->actingAs(admin());
    $hoje = agoraNaClinica()->toDateString();
    $ontem = agoraNaClinica()->subDay()->toDateString();
    $comPacote = agendamentoDoRelatorio([], $hoje, '09:00');
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $comPacote->paciente_id,
        'convenio_id' => Convenio::create(['nome' => 'Operadora Fictícia'])->id,
        'especialidade_id' => $comPacote->especialidade_id,
        'profissional_id' => $comPacote->profissional_id,
    ]);
    $comPacote->forceFill(['tratamento_id' => $tratamento->id])->save();
    agendamentoDoRelatorio([], $ontem, '09:00');

    // ACT
    $porConvenio = $this->getJson('/api/relatorios/agendamentos?'.periodoDoRelatorio().'&resultado=sintetico&dividir_por=convenio')->assertOk();
    $porDia = $this->getJson('/api/relatorios/agendamentos?'.periodoDoRelatorio().'&resultado=sintetico&dividir_por=dia')->assertOk();

    // ASSERT
    expect(collect($porConvenio->json('grupos'))->pluck('titulo')->all())->toBe(['Operadora Fictícia', 'Sem convênio'])
        ->and($porConvenio->json('totais.quantidade'))->toBe(2)
        ->and(collect($porDia->json('grupos'))->pluck('titulo')->all())->toBe([
            Carbon::parse($ontem)->format('d/m/Y'),
            Carbon::parse($hoje)->format('d/m/Y'),
        ]);
});

it('deve filtrar por profissional com o nome legível em filtros_aplicados e recusar id inexistente', function () {
    // ARRANGE
    $this->actingAs(admin());
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    agendamentoDoRelatorio(['profissional_id' => $ana->id], null, '09:00');
    agendamentoDoRelatorio(['profissional_id' => $bia->id], null, '10:00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/agendamentos?'.periodoDoRelatorio()."&profissional_id={$ana->id}")->assertOk();

    // ASSERT — só a Ana, e o cabeçalho impresso sabe disso
    expect(collect($resposta->json('linhas'))->pluck('profissional')->all())->toBe(['Ana Fictícia'])
        ->and($resposta->json('filtros_aplicados'))->toBe([['rotulo' => 'Profissional', 'valor' => 'Ana Fictícia']]);

    // id que não existe → 422 (o `exists` do boundary)
    $this->getJson('/api/relatorios/agendamentos?'.periodoDoRelatorio().'&profissional_id=999999')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['profissional_id']);
});

it('deve escopar pelo eixo agenda: o vinculado vê só os seus e o sem vínculo vê nada', function () {
    // ARRANGE — papel SEM `agenda.ver_todos`; um vinculado à Ana, outro sem vínculo
    admin();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $colega = Profissional::factory()->create(['nome' => 'Colega Fictício']);
    agendamentoDoRelatorio(['profissional_id' => $ana->id], null, '09:00');
    agendamentoDoRelatorio(['profissional_id' => $colega->id], null, '10:00');
    $escopado = usuarioEscopadoEm($ana);
    $semVinculo = usuarioCom(['agenda.ver'], 'Sem vínculo');

    // ACT
    $doEscopado = $this->actingAs($escopado)->getJson('/api/relatorios/agendamentos?'.periodoDoRelatorio());
    trocarDeUsuario();
    $sintetico = $this->actingAs($escopado)->getJson('/api/relatorios/agendamentos?'.periodoDoRelatorio().'&resultado=sintetico&dividir_por=profissional');
    trocarDeUsuario();
    $doSemVinculo = $this->actingAs($semVinculo)->getJson('/api/relatorios/agendamentos?'.periodoDoRelatorio());

    // ASSERT — analítico E sintético escopados na mesma query; sem vínculo, fail-closed
    $doEscopado->assertOk()->assertJsonPath('totais.quantidade', 1);
    expect(collect($doEscopado->json('linhas'))->pluck('profissional')->all())->toBe(['Ana Fictícia']);
    $sintetico->assertOk()->assertJsonPath('totais.quantidade', 1);
    expect(collect($sintetico->json('grupos'))->pluck('titulo')->all())->toBe(['Ana Fictícia']);
    $doSemVinculo->assertOk()->assertJsonPath('totais.quantidade', 0)->assertJsonPath('contagem', 0);
});

it('deve publicar no índice o slug com as permissões, sem dado de negócio, para qualquer logado', function () {
    // ARRANGE — um agendamento de criança fictícia existe; um usuário SEM permissão nenhuma pede o índice
    admin();
    agendamentoDoRelatorio(['paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia do Índice'])->id]);
    $semNada = usuarioCom([], 'Sem permissão nenhuma');

    // ACT
    $resposta = $this->actingAs($semNada)->getJson('/api/relatorios');

    // ASSERT — o catálogo, e só ele
    $resposta->assertOk();
    $agendamentos = collect($resposta->json('relatorios'))->firstWhere('slug', 'agendamentos');
    expect($agendamentos)->toBe([
        'slug' => 'agendamentos',
        'titulo' => 'Agendamentos',
        'permissoes' => ['agenda.ver'],
        'eixo' => 'agenda',
        'expoe_nome' => true,
    ]);
    semVazamento($resposta->json(), 'Criança Fictícia do Índice');
    expect($resposta->json())->not->toHaveKeys(['linhas', 'grupos', 'totais']);
});

it('deve cortar o analítico no limite e avisar em truncado, mantendo o total do recorte', function () {
    // ARRANGE — o limite é injetado (o catálogo resolve pelo container) para não criar 2001
    // registros: com 2 de teto e 3 agendamentos, o corte acontece do mesmo jeito que com 2000
    $this->actingAs(admin());
    app()->bind(Agendamentos::class, fn () => new Agendamentos(limiteDeLinhas: 2));
    agendamentoDoRelatorio([], null, '08:00');
    agendamentoDoRelatorio([], null, '09:00');
    agendamentoDoRelatorio([], null, '10:00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/agendamentos?'.periodoDoRelatorio())->assertOk();

    // ASSERT — duas linhas (as primeiras na ordem), truncado, e o total diz que são três
    expect($resposta->json('linhas'))->toHaveCount(2)
        ->and(collect($resposta->json('linhas'))->pluck('hora')->all())->toBe(['08:00', '09:00'])
        ->and($resposta->json('truncado'))->toBeTrue()
        ->and($resposta->json('contagem'))->toBe(2)
        ->and($resposta->json('totais.quantidade'))->toBe(3);
});
