<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Evolucao;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use Carbon\Carbon;

/**
 * O relatório `atendimentos` (change `area-de-relatorios`, task 2.1): 403 antes de 422; só os
 * REALIZADOS (pelas flags do status, nunca pelo nome); analítico com as colunas declaradas, a
 * ordem e a evolução; sintético somado no banco com crianças distintas; divisão por mês em
 * ordem cronológica; filtros com nome legível; escopo D11 do eixo clínico.
 */

/** Status escolhido pelas FLAGS, nunca pelo nome (§13) — o próprio teste obedece à regra que prova. */
function statusDosAtendimentos(bool $descontaSessao, bool $marcaFalta = false): StatusAgendamento
{
    return StatusAgendamento::query()
        ->where('desconta_sessao', $descontaSessao)
        ->where('marca_falta', $marcaFalta)
        ->orderBy('ordem')
        ->firstOrFail();
}

/** Um agendamento REALIZADO (status pelas flags) em `$data` (hoje da clínica por padrão) às `$hora`, 40 min. */
function realizadoDosAtendimentos(array $atributos = [], ?string $data = null, string $hora = '09:00'): Agendamento
{
    $data ??= agoraNaClinica()->toDateString();

    return Agendamento::factory()->create([
        'status_id' => statusDosAtendimentos(descontaSessao: true)->id,
        'inicio' => "{$data} {$hora}",
        'fim' => Carbon::parse("{$data} {$hora}")->addMinutes(40)->format('Y-m-d H:i'),
        ...$atributos,
    ]);
}

/** Registro clínico + evolução (criação DIRETA, sem factory) sobre o agendamento. */
function evolucaoDosAtendimentos(Agendamento $agendamento): Evolucao
{
    $atendimento = Atendimento::factory()->create([
        'agendamento_id' => $agendamento->id,
        'finalizado_em' => $agendamento->fim->format('Y-m-d H:i'),
    ]);
    $evolucao = new Evolucao(['profissional_id' => $agendamento->profissional_id, 'conteudo' => 'Evolução clínica fictícia da sessão.']);
    $evolucao->atendimento_id = $atendimento->id;
    $evolucao->preenchida_em = agoraNaClinica()->format('Y-m-d H:i');
    $evolucao->save();

    return $evolucao;
}

/** A query string de `de`/`ate` cobrindo `$dias` para trás a partir de hoje da clínica. */
function periodoDosAtendimentos(int $dias = 7): string
{
    return 'de='.agoraNaClinica()->subDays($dias)->toDateString().'&ate='.agoraNaClinica()->toDateString();
}

it('deve recusar com 403 quem não tem atendimentos.ver MESMO com período inválido (403 antes de 422)', function () {
    // ARRANGE — um usuário logado, com outra permissão, e um período que NÃO valida
    admin();
    $semAtendimentos = usuarioCom(['agenda.ver'], 'Sem atendimentos');

    // ACT + ASSERT — a autorização decide antes de o validador olhar o parâmetro
    $this->actingAs($semAtendimentos)
        ->getJson('/api/relatorios/atendimentos?de=nao-e-data')
        ->assertForbidden();
});

it('deve exigir dividir_por no sintético e recusar divisão que não é deste relatório', function () {
    // ARRANGE
    $this->actingAs(admin());

    // ACT + ASSERT — `status` e `dia` são do relatório `agendamentos`, não deste
    $this->getJson('/api/relatorios/atendimentos?'.periodoDosAtendimentos().'&resultado=sintetico')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['dividir_por']);
    $this->getJson('/api/relatorios/atendimentos?'.periodoDosAtendimentos().'&resultado=sintetico&dividir_por=status')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['dividir_por']);
    $this->getJson('/api/relatorios/atendimentos?'.periodoDosAtendimentos().'&resultado=sintetico&dividir_por=dia')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['dividir_por']);
});

it('deve listar no analítico só os realizados, nas colunas declaradas e na ordem data → hora → profissional, com a evolução', function () {
    // ARRANGE — três realizados fora de ordem: ontem 14h (Carla, registro sem evolução), hoje 09h
    // (Bia, com evolução), hoje 09h (Ana, com pacote e sem registro clínico)
    $this->actingAs(admin());
    $hoje = agoraNaClinica()->toDateString();
    $ontem = agoraNaClinica()->subDay()->toDateString();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    $carla = Profissional::factory()->create(['nome' => 'Carla Fictícia']);
    $especialidade = Especialidade::factory()->create(['nome' => 'Fono Fictícia']);
    $paciente = Paciente::factory()->create(['nome' => 'Criança Fictícia do Analítico']);
    $daBia = realizadoDosAtendimentos(['profissional_id' => $bia->id, 'paciente_id' => $paciente->id, 'especialidade_id' => $especialidade->id], $hoje, '09:00');
    evolucaoDosAtendimentos($daBia);
    $daAna = realizadoDosAtendimentos(['profissional_id' => $ana->id, 'especialidade_id' => $especialidade->id], $hoje, '09:00');
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $daAna->paciente_id,
        'convenio_id' => Convenio::create(['nome' => 'Operadora Fictícia'])->id,
        'especialidade_id' => $especialidade->id,
        'profissional_id' => $ana->id,
    ]);
    $daAna->forceFill(['tratamento_id' => $tratamento->id])->save();
    $daCarla = realizadoDosAtendimentos(['profissional_id' => $carla->id, 'especialidade_id' => $especialidade->id], $ontem, '14:00');
    Atendimento::factory()->create(['agendamento_id' => $daCarla->id, 'finalizado_em' => "{$ontem} 14:40"]);
    // um "Em Aberto" (não desconta a sessão) hoje às 08h NÃO é realizado e fica fora
    Agendamento::factory()->create([
        'status_id' => statusDosAtendimentos(descontaSessao: false)->id,
        'profissional_id' => $ana->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => "{$hoje} 08:00",
        'fim' => "{$hoje} 08:40",
    ]);

    // ACT
    $resposta = $this->getJson('/api/relatorios/atendimentos?'.periodoDosAtendimentos())->assertOk();

    // ASSERT — o envelope
    $resposta->assertJsonPath('slug', 'atendimentos')
        ->assertJsonPath('titulo', 'Atendimentos')
        ->assertJsonPath('periodo.ate', $hoje)
        ->assertJsonPath('filtros_aplicados', [])
        ->assertJsonPath('grupos', null)
        ->assertJsonPath('totais', ['quantidade' => 3, 'criancas_distintas' => 3])
        ->assertJsonPath('contagem', 3)
        ->assertJsonPath('truncado', false);
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())
        ->toBe(['data', 'hora', 'paciente', 'profissional', 'especialidade', 'convenio', 'evolucao'])
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
            'evolucao' => 'Pendente',
        ])
        ->and($linhas[1]['convenio'])->toBe('Operadora Fictícia')
        ->and($linhas[1]['evolucao'])->toBe('Pendente')
        ->and($linhas[2]['paciente'])->toBe('Criança Fictícia do Analítico')
        ->and($linhas[2]['evolucao'])->toBe('Preenchida');
});

it('deve contar crianças distintas — a mesma criança em duas sessões conta uma — no analítico e no sintético por profissional', function () {
    // ARRANGE — a mesma criança com a Ana duas vezes e com a Bia uma; outra criança com a Bia
    $this->actingAs(admin());
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia Repetida']);
    realizadoDosAtendimentos(['profissional_id' => $ana->id, 'paciente_id' => $crianca->id], null, '08:00');
    realizadoDosAtendimentos(['profissional_id' => $ana->id, 'paciente_id' => $crianca->id], null, '09:00');
    realizadoDosAtendimentos(['profissional_id' => $bia->id, 'paciente_id' => $crianca->id], null, '10:00');
    realizadoDosAtendimentos(['profissional_id' => $bia->id], null, '11:00');

    // ACT
    $analitico = $this->getJson('/api/relatorios/atendimentos?'.periodoDosAtendimentos())->assertOk();
    $sintetico = $this->getJson('/api/relatorios/atendimentos?'.periodoDosAtendimentos().'&resultado=sintetico&dividir_por=profissional')->assertOk();

    // ASSERT — 4 sessões, 2 crianças; por grupo, a criança repetida conta uma; o geral NÃO é a
    // soma dos grupos (a mesma criança está nos dois)
    $analitico->assertJsonPath('totais', ['quantidade' => 4, 'criancas_distintas' => 2]);
    $grupos = $sintetico->json('grupos');
    expect(collect($grupos)->pluck('titulo')->all())->toBe(['Ana Fictícia', 'Bia Fictícia'])
        ->and($grupos[0]['totais'])->toBe(['quantidade' => 2, 'criancas_distintas' => 1])
        ->and($grupos[0]['linhas'])->toBe([])
        ->and($grupos[1]['totais'])->toBe(['quantidade' => 2, 'criancas_distintas' => 2])
        ->and($sintetico->json('linhas'))->toBe([])
        ->and($sintetico->json('totais'))->toBe(['quantidade' => 4, 'criancas_distintas' => 2])
        ->and($sintetico->json('contagem'))->toBe(2)
        ->and(collect($sintetico->json('colunas'))->pluck('chave')->all())->toBe(['grupo', 'quantidade', 'criancas_distintas'])
        ->and($sintetico->json('colunas.0.rotulo'))->toBe('Profissional')
        ->and($sintetico->json('filtros_aplicados'))->toBe([['rotulo' => 'Dividido por', 'valor' => 'Profissional']]);
});

it('deve dividir por mês em ordem cronológica com o título "mês de ano", e por convênio com "Sem convênio" na soma', function () {
    // ARRANGE — dois realizados no mês passado (um com pacote na Operadora), um hoje
    $this->actingAs(admin());
    $mesPassado = agoraNaClinica()->subMonthNoOverflow()->startOfMonth();
    $hoje = agoraNaClinica()->toDateString();
    $comPacote = realizadoDosAtendimentos([], $mesPassado->toDateString(), '09:00');
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $comPacote->paciente_id,
        'convenio_id' => Convenio::create(['nome' => 'Operadora Fictícia'])->id,
        'especialidade_id' => $comPacote->especialidade_id,
        'profissional_id' => $comPacote->profissional_id,
    ]);
    $comPacote->forceFill(['tratamento_id' => $tratamento->id])->save();
    realizadoDosAtendimentos([], $mesPassado->toDateString(), '10:00');
    realizadoDosAtendimentos([], $hoje, '10:00');
    $periodo = "de={$mesPassado->toDateString()}&ate={$hoje}";

    // ACT
    $porMes = $this->getJson("/api/relatorios/atendimentos?{$periodo}&resultado=sintetico&dividir_por=mes")->assertOk();
    $porConvenio = $this->getJson("/api/relatorios/atendimentos?{$periodo}&resultado=sintetico&dividir_por=convenio")->assertOk();

    // ASSERT — o mês passado antes deste, em pt-BR ("setembro de 2026"), e as contagens
    $titulos = collect($porMes->json('grupos'))->pluck('titulo')->all();
    expect($titulos)->toBe([
        $mesPassado->locale('pt_BR')->isoFormat('MMMM [de] YYYY'),
        agoraNaClinica()->locale('pt_BR')->isoFormat('MMMM [de] YYYY'),
    ])
        ->and($titulos[0])->toMatch('/^[a-zç]+ de \d{4}$/u')
        ->and($porMes->json('grupos.0.totais.quantidade'))->toBe(2)
        ->and($porMes->json('grupos.1.totais.quantidade'))->toBe(1)
        ->and($porMes->json('totais.quantidade'))->toBe(3)
        ->and($porMes->json('colunas.0.rotulo'))->toBe('Mês')
        ->and(collect($porConvenio->json('grupos'))->pluck('titulo')->all())->toBe(['Operadora Fictícia', 'Sem convênio'])
        ->and($porConvenio->json('grupos.1.totais.quantidade'))->toBe(2)
        ->and($porConvenio->json('totais.quantidade'))->toBe(3);
});

it('deve classificar realizado pelas FLAGS: status renomeado ainda conta, e a falta cobrada (desconta + marca falta) não', function () {
    // ARRANGE — o status que desconta e não é falta RENOMEADO; o padrão "Não Compareceu" também
    // desconta a sessão (a clínica cobra a falta), e ainda assim não é atendimento
    $this->actingAs(admin());
    statusDosAtendimentos(descontaSessao: true)->update(['nome' => 'Sessão Feita Fictícia']);
    $faltaCobrada = statusDosAtendimentos(descontaSessao: true, marcaFalta: true);
    realizadoDosAtendimentos([], null, '09:00');
    realizadoDosAtendimentos(['status_id' => $faltaCobrada->id], null, '10:00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/atendimentos?'.periodoDosAtendimentos())->assertOk();

    // ASSERT — só a sessão feita, com o nome que a clínica deu
    $resposta->assertJsonPath('totais.quantidade', 1);
    expect(collect($resposta->json('linhas'))->pluck('hora')->all())->toBe(['09:00']);
});

it('deve filtrar por convênio e por especialidade com o nome legível em filtros_aplicados e recusar id inexistente', function () {
    // ARRANGE — um com pacote na Operadora (Fono), um sem pacote (TO)
    $this->actingAs(admin());
    $fono = Especialidade::factory()->create(['nome' => 'Fono Fictícia']);
    $to = Especialidade::factory()->create(['nome' => 'TO Fictícia']);
    $operadora = Convenio::create(['nome' => 'Operadora Fictícia']);
    $comPacote = realizadoDosAtendimentos(['especialidade_id' => $fono->id], null, '09:00');
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $comPacote->paciente_id,
        'convenio_id' => $operadora->id,
        'especialidade_id' => $fono->id,
        'profissional_id' => $comPacote->profissional_id,
    ]);
    $comPacote->forceFill(['tratamento_id' => $tratamento->id])->save();
    realizadoDosAtendimentos(['especialidade_id' => $to->id], null, '10:00');

    // ACT
    $porConvenio = $this->getJson('/api/relatorios/atendimentos?'.periodoDosAtendimentos()."&convenio_id={$operadora->id}")->assertOk();
    $porEspecialidade = $this->getJson('/api/relatorios/atendimentos?'.periodoDosAtendimentos()."&especialidade_id={$to->id}")->assertOk();

    // ASSERT — cada filtro recorta e o cabeçalho impresso sabe disso
    expect(collect($porConvenio->json('linhas'))->pluck('hora')->all())->toBe(['09:00'])
        ->and($porConvenio->json('filtros_aplicados'))->toBe([['rotulo' => 'Convênio', 'valor' => 'Operadora Fictícia']])
        ->and(collect($porEspecialidade->json('linhas'))->pluck('hora')->all())->toBe(['10:00'])
        ->and($porEspecialidade->json('filtros_aplicados'))->toBe([['rotulo' => 'Especialidade', 'valor' => 'TO Fictícia']]);

    // id que não existe → 422 (o `exists` do boundary)
    $this->getJson('/api/relatorios/atendimentos?'.periodoDosAtendimentos().'&convenio_id=999999')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['convenio_id']);
});

it('deve escopar pelo eixo clínico: o vinculado sem clinico.ver_todos vê só os seus e o sem vínculo vê nada', function () {
    // ARRANGE — papel SEM `clinico.ver_todos`; um vinculado à Ana, outro sem vínculo
    admin();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $colega = Profissional::factory()->create(['nome' => 'Colega Fictício']);
    realizadoDosAtendimentos(['profissional_id' => $ana->id], null, '09:00');
    realizadoDosAtendimentos(['profissional_id' => $colega->id], null, '10:00');
    $escopado = usuarioEscopadoEm($ana, ['atendimentos.ver']);
    $semVinculo = usuarioCom(['atendimentos.ver'], 'Sem vínculo');

    // ACT
    $doEscopado = $this->actingAs($escopado)->getJson('/api/relatorios/atendimentos?'.periodoDosAtendimentos());
    trocarDeUsuario();
    $sintetico = $this->actingAs($escopado)->getJson('/api/relatorios/atendimentos?'.periodoDosAtendimentos().'&resultado=sintetico&dividir_por=profissional');
    trocarDeUsuario();
    $doSemVinculo = $this->actingAs($semVinculo)->getJson('/api/relatorios/atendimentos?'.periodoDosAtendimentos());

    // ASSERT — analítico E sintético escopados na mesma query; sem vínculo, fail-closed
    $doEscopado->assertOk()->assertJsonPath('totais', ['quantidade' => 1, 'criancas_distintas' => 1]);
    expect(collect($doEscopado->json('linhas'))->pluck('profissional')->all())->toBe(['Ana Fictícia']);
    $sintetico->assertOk()->assertJsonPath('totais.quantidade', 1);
    expect(collect($sintetico->json('grupos'))->pluck('titulo')->all())->toBe(['Ana Fictícia']);
    $doSemVinculo->assertOk()
        ->assertJsonPath('totais', ['quantidade' => 0, 'criancas_distintas' => 0])
        ->assertJsonPath('contagem', 0);
});
