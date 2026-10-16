<?php

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Relatorios\ListaDePresenca;
use Carbon\Carbon;

/**
 * O relatório `lista-de-presenca` (change `area-de-relatorios`, task 2.2): 403 antes de 422;
 * um grupo por profissional × dia, linhas em ordem de hora, coluna de assinatura VAZIA; só o
 * marcado (pelas flags do status); filtro com nome legível; escopo D11 do eixo agenda;
 * o corte de linhas com limite injetado.
 */

/** Um agendamento de atendimento (status inicial, que ocupa horário) em `$data` às `$hora`, 40 min. */
function marcadoDaPresenca(array $atributos = [], ?string $data = null, string $hora = '09:00'): Agendamento
{
    $data ??= agoraNaClinica()->toDateString();

    return Agendamento::factory()->create([
        'inicio' => "{$data} {$hora}",
        'fim' => Carbon::parse("{$data} {$hora}")->addMinutes(40)->format('Y-m-d H:i'),
        ...$atributos,
    ]);
}

/** A query string de `de`/`ate` cobrindo `$dias` para trás a partir de hoje da clínica. */
function periodoDaPresenca(int $dias = 7): string
{
    return 'de='.agoraNaClinica()->subDays($dias)->toDateString().'&ate='.agoraNaClinica()->toDateString();
}

it('deve recusar com 403 quem não tem agenda.ver MESMO com período inválido (403 antes de 422)', function () {
    // ARRANGE
    admin();
    $semAgenda = usuarioCom(['pacientes.ver'], 'Sem agenda');

    // ACT + ASSERT
    $this->actingAs($semAgenda)
        ->getJson('/api/relatorios/lista-de-presenca?de=nao-e-data')
        ->assertForbidden();
});

it('deve agrupar por profissional e dia, em ordem de hora, com a coluna de assinatura vazia', function () {
    // ARRANGE — Bia hoje 08h; Ana hoje 10h e 09h (fora de ordem; a de 09h com pacote na Operadora)
    // e ontem 14h. Grupos por NOME do profissional e dia; linhas por hora.
    $this->actingAs(admin());
    $hoje = agoraNaClinica()->toDateString();
    $ontem = agoraNaClinica()->subDay()->toDateString();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia da Presença']);
    marcadoDaPresenca(['profissional_id' => $bia->id], $hoje, '08:00');
    marcadoDaPresenca(['profissional_id' => $ana->id, 'paciente_id' => $crianca->id], $hoje, '10:00');
    $comPacote = marcadoDaPresenca(['profissional_id' => $ana->id], $hoje, '09:00');
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $comPacote->paciente_id,
        'convenio_id' => Convenio::create(['nome' => 'Operadora Fictícia'])->id,
        'especialidade_id' => $comPacote->especialidade_id,
        'profissional_id' => $ana->id,
    ]);
    $comPacote->forceFill(['tratamento_id' => $tratamento->id])->save();
    marcadoDaPresenca(['profissional_id' => $ana->id], $ontem, '14:00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/lista-de-presenca?'.periodoDaPresenca())->assertOk();

    // ASSERT — o envelope: sempre em grupos, linhas vazias, contagem = soma das linhas dos grupos
    $resposta->assertJsonPath('slug', 'lista-de-presenca')
        ->assertJsonPath('titulo', 'Lista de presença')
        ->assertJsonPath('periodo.ate', $hoje)
        ->assertJsonPath('filtros_aplicados', [])
        ->assertJsonPath('linhas', [])
        ->assertJsonPath('totais', ['quantidade' => 4])
        ->assertJsonPath('contagem', 4)
        ->assertJsonPath('truncado', false);
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())
        ->toBe(['hora', 'paciente', 'convenio', 'situacao', 'assinatura'])
        ->and(collect($resposta->json('colunas'))->pluck('tipo')->all())
        ->toBe(['hora', 'texto', 'texto', 'texto', 'texto']);

    // ...os grupos na ordem profissional → dia, e as linhas por hora
    $grupos = $resposta->json('grupos');
    $ontemLegivel = Carbon::parse($ontem)->format('d/m/Y');
    $hojeLegivel = Carbon::parse($hoje)->format('d/m/Y');
    expect(collect($grupos)->pluck('titulo')->all())->toBe([
        "Ana Fictícia — {$ontemLegivel}",
        "Ana Fictícia — {$hojeLegivel}",
        "Bia Fictícia — {$hojeLegivel}",
    ])
        ->and(collect($grupos[1]['linhas'])->pluck('hora')->all())->toBe(['09:00', '10:00'])
        ->and($grupos[1]['linhas'][0])->toBe([
            'hora' => '09:00',
            'paciente' => $grupos[1]['linhas'][0]['paciente'],
            'convenio' => 'Operadora Fictícia',
            'situacao' => 'Em Aberto',
            'assinatura' => '',
        ])
        ->and($grupos[1]['linhas'][1]['paciente'])->toBe('Criança Fictícia da Presença')
        ->and($grupos[1]['linhas'][1]['convenio'])->toBe('Sem convênio')
        ->and($grupos[1]['totais'])->toBe(['quantidade' => 2])
        ->and($grupos[0]['totais'])->toBe(['quantidade' => 1])
        ->and(collect($grupos)->flatMap(fn (array $g) => collect($g['linhas'])->pluck('assinatura'))->unique()->all())->toBe(['']);
});

it('deve listar só o marcado pelas FLAGS: o desmarcado fica fora, o realizado que liberou o horário entra, e o bloqueio nunca', function () {
    // ARRANGE — um só profissional; o status "desmarcado" (não ocupa, não desconta) e o realizado
    // RENOMEADO e sem ocupar horário (desconta a sessão — ainda é presença)
    $this->actingAs(admin());
    $profissional = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $desmarcado = StatusAgendamento::where('ocupa_horario', false)->where('desconta_sessao', false)->orderBy('ordem')->firstOrFail();
    $realizado = StatusAgendamento::where('desconta_sessao', true)->where('marca_falta', false)->orderBy('ordem')->firstOrFail();
    $realizado->update(['nome' => 'Feito Fictício', 'ocupa_horario' => false]);
    marcadoDaPresenca(['profissional_id' => $profissional->id, 'status_id' => $desmarcado->id], null, '08:00');
    marcadoDaPresenca(['profissional_id' => $profissional->id, 'status_id' => $realizado->id], null, '09:00');
    marcadoDaPresenca(['profissional_id' => $profissional->id], null, '10:00');
    $hoje = agoraNaClinica()->toDateString();
    Agendamento::factory()->create([
        'tipo' => 'bloqueio',
        'paciente_id' => null,
        'profissional_id' => $profissional->id,
        'especialidade_id' => null,
        'inicio' => "{$hoje} 12:00",
        'fim' => "{$hoje} 13:00",
    ]);

    // ACT
    $resposta = $this->getJson('/api/relatorios/lista-de-presenca?'.periodoDaPresenca())->assertOk();

    // ASSERT
    $resposta->assertJsonPath('totais.quantidade', 2)->assertJsonPath('contagem', 2);
    expect($resposta->json('grupos'))->toHaveCount(1)
        ->and(collect($resposta->json('grupos.0.linhas'))->pluck('hora')->all())->toBe(['09:00', '10:00'])
        ->and(collect($resposta->json('grupos.0.linhas'))->pluck('situacao')->all())->toBe(['Feito Fictício', 'Em Aberto']);
});

it('deve filtrar por profissional com o nome legível em filtros_aplicados e recusar id inexistente', function () {
    // ARRANGE
    $this->actingAs(admin());
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    marcadoDaPresenca(['profissional_id' => $ana->id], null, '09:00');
    marcadoDaPresenca(['profissional_id' => $bia->id], null, '10:00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/lista-de-presenca?'.periodoDaPresenca()."&profissional_id={$ana->id}")->assertOk();

    // ASSERT — só a Ana, e o cabeçalho impresso sabe disso
    expect(collect($resposta->json('grupos'))->pluck('titulo')->all())->toBe(['Ana Fictícia — '.agoraNaClinica()->format('d/m/Y')])
        ->and($resposta->json('totais.quantidade'))->toBe(1)
        ->and($resposta->json('filtros_aplicados'))->toBe([['rotulo' => 'Profissional', 'valor' => 'Ana Fictícia']]);

    // id que não existe → 422 (o `exists` do boundary)
    $this->getJson('/api/relatorios/lista-de-presenca?'.periodoDaPresenca().'&profissional_id=999999')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['profissional_id']);
});

it('deve escopar pelo eixo agenda: o vinculado vê só os seus e o sem vínculo vê nada', function () {
    // ARRANGE — papel SEM `agenda.ver_todos`; um vinculado à Ana, outro sem vínculo
    admin();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $colega = Profissional::factory()->create(['nome' => 'Colega Fictício']);
    marcadoDaPresenca(['profissional_id' => $ana->id], null, '09:00');
    marcadoDaPresenca(['profissional_id' => $colega->id], null, '10:00');
    $escopado = usuarioEscopadoEm($ana);
    $semVinculo = usuarioCom(['agenda.ver'], 'Sem vínculo');

    // ACT
    $doEscopado = $this->actingAs($escopado)->getJson('/api/relatorios/lista-de-presenca?'.periodoDaPresenca());
    trocarDeUsuario();
    $doSemVinculo = $this->actingAs($semVinculo)->getJson('/api/relatorios/lista-de-presenca?'.periodoDaPresenca());

    // ASSERT — só a agenda da Ana; sem vínculo, fail-closed
    $doEscopado->assertOk()->assertJsonPath('totais.quantidade', 1);
    expect(collect($doEscopado->json('grupos'))->pluck('titulo')->all())->toBe(['Ana Fictícia — '.agoraNaClinica()->format('d/m/Y')]);
    $doSemVinculo->assertOk()->assertJsonPath('totais.quantidade', 0)->assertJsonPath('contagem', 0)->assertJsonPath('grupos', []);
});

it('deve cortar as linhas no limite e avisar em truncado, mantendo o total do recorte', function () {
    // ARRANGE — o limite é injetado (o catálogo resolve pelo container): com 2 de teto e 3
    // marcados, o corte acontece do mesmo jeito que com 2000
    $this->actingAs(admin());
    app()->bind(ListaDePresenca::class, fn () => new ListaDePresenca(limiteDeLinhas: 2));
    $profissional = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    marcadoDaPresenca(['profissional_id' => $profissional->id], null, '08:00');
    marcadoDaPresenca(['profissional_id' => $profissional->id], null, '09:00');
    marcadoDaPresenca(['profissional_id' => $profissional->id], null, '10:00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/lista-de-presenca?'.periodoDaPresenca())->assertOk();

    // ASSERT — duas linhas (as primeiras na ordem), truncado, e o total diz que são três
    expect(collect($resposta->json('grupos.0.linhas'))->pluck('hora')->all())->toBe(['08:00', '09:00'])
        ->and($resposta->json('truncado'))->toBeTrue()
        ->and($resposta->json('contagem'))->toBe(2)
        ->and($resposta->json('totais.quantidade'))->toBe(3);
});
