<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Especialidade;
use App\Models\Evolucao;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * O relatório `evolucoes` (change `area-de-relatorios`, task 2.3): 403 faltando QUALQUER uma
 * das duas permissões; o universo são os REALIZADOS (pelas flags do status); analítico com
 * Preenchida/Pendente (sem registro clínico é pendente); o sintético por profissional com o
 * cenário da spec (8 realizados e 6 evoluções → 8, 6, 2 e 75); `situacao` recorta as linhas;
 * escopo D11 do eixo clínico; e UMA agregação por profissional, não duas
 * (`CRR-14`).
 */

/** Status escolhido pelas FLAGS, nunca pelo nome (§13) — o próprio teste obedece à regra que prova. */
function statusDasEvolucoes(bool $descontaSessao, bool $marcaFalta = false): StatusAgendamento
{
    return StatusAgendamento::query()
        ->where('desconta_sessao', $descontaSessao)
        ->where('marca_falta', $marcaFalta)
        ->orderBy('ordem')
        ->firstOrFail();
}

/** Um agendamento REALIZADO (status pelas flags) em `$data` (hoje da clínica por padrão) às `$hora`, 40 min. */
function realizadoDasEvolucoes(array $atributos = [], ?string $data = null, string $hora = '09:00'): Agendamento
{
    $data ??= agoraNaClinica()->toDateString();

    return Agendamento::factory()->create([
        'status_id' => statusDasEvolucoes(descontaSessao: true)->id,
        'inicio' => "{$data} {$hora}",
        'fim' => Carbon::parse("{$data} {$hora}")->addMinutes(40)->format('Y-m-d H:i'),
        ...$atributos,
    ]);
}

/** Registro clínico + evolução (criação DIRETA, sem factory) sobre o agendamento. */
function evolucaoDasEvolucoes(Agendamento $agendamento): Evolucao
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
function periodoDasEvolucoes(int $dias = 7): string
{
    return 'de='.agoraNaClinica()->subDays($dias)->toDateString().'&ate='.agoraNaClinica()->toDateString();
}

it('deve recusar com 403 faltando QUALQUER uma das duas permissões, mesmo com período inválido (403 antes de 422)', function () {
    // ARRANGE — três usuários: só `evolucoes.ver`, só `atendimentos.ver`, e com as duas
    admin();
    $soEvolucoes = usuarioCom(['evolucoes.ver'], 'Só evoluções');
    $soAtendimentos = usuarioCom(['atendimentos.ver'], 'Só atendimentos');
    $comAsDuas = usuarioCom(['evolucoes.ver', 'atendimentos.ver'], 'Com as duas');

    // ACT + ASSERT — as duas são exigidas (E, não OU); quem tem as duas passa do portão e cai no validador
    $this->actingAs($soEvolucoes)->getJson('/api/relatorios/evolucoes?de=nao-e-data')->assertForbidden();
    trocarDeUsuario();
    $this->actingAs($soAtendimentos)->getJson('/api/relatorios/evolucoes?de=nao-e-data')->assertForbidden();
    trocarDeUsuario();
    $this->actingAs($comAsDuas)->getJson('/api/relatorios/evolucoes?de=nao-e-data')->assertUnprocessable();
});

it('deve recusar situação e divisão desconhecidas', function () {
    // ARRANGE
    $this->actingAs(admin());

    // ACT + ASSERT — o sintético é sempre por profissional: só essa divisão é aceita
    $this->getJson('/api/relatorios/evolucoes?'.periodoDasEvolucoes().'&situacao=qualquer')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['situacao']);
    $this->getJson('/api/relatorios/evolucoes?'.periodoDasEvolucoes().'&resultado=sintetico&dividir_por=convenio')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['dividir_por']);
});

it('deve listar no analítico os realizados com Preenchida/Pendente — sem registro clínico é Pendente — nas colunas e na ordem', function () {
    // ARRANGE — ontem 14h Carla (nem registro clínico), hoje 09h Bia (com evolução), hoje 09h Ana
    // (registro sem evolução); um "Em Aberto" e uma falta cobrada ficam fora
    $this->actingAs(admin());
    $hoje = agoraNaClinica()->toDateString();
    $ontem = agoraNaClinica()->subDay()->toDateString();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    $carla = Profissional::factory()->create(['nome' => 'Carla Fictícia']);
    $especialidade = Especialidade::factory()->create(['nome' => 'Fono Fictícia']);
    $paciente = Paciente::factory()->create(['nome' => 'Criança Fictícia do Analítico']);
    $daBia = realizadoDasEvolucoes(['profissional_id' => $bia->id, 'paciente_id' => $paciente->id, 'especialidade_id' => $especialidade->id], $hoje, '09:00');
    evolucaoDasEvolucoes($daBia);
    $daAna = realizadoDasEvolucoes(['profissional_id' => $ana->id, 'especialidade_id' => $especialidade->id], $hoje, '09:00');
    Atendimento::factory()->create(['agendamento_id' => $daAna->id, 'finalizado_em' => "{$hoje} 09:40"]);
    realizadoDasEvolucoes(['profissional_id' => $carla->id, 'especialidade_id' => $especialidade->id], $ontem, '14:00');
    Agendamento::factory()->create([
        'status_id' => statusDasEvolucoes(descontaSessao: false)->id,
        'profissional_id' => $ana->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => "{$hoje} 08:00",
        'fim' => "{$hoje} 08:40",
    ]);
    realizadoDasEvolucoes(['status_id' => statusDasEvolucoes(descontaSessao: true, marcaFalta: true)->id, 'profissional_id' => $ana->id], $hoje, '11:00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/evolucoes?'.periodoDasEvolucoes())->assertOk();

    // ASSERT — o envelope, com os totais da foto inteira
    $resposta->assertJsonPath('slug', 'evolucoes')
        ->assertJsonPath('titulo', 'Evoluções')
        ->assertJsonPath('periodo.ate', $hoje)
        ->assertJsonPath('filtros_aplicados', [])
        ->assertJsonPath('grupos', null)
        ->assertJsonPath('totais', ['realizados' => 3, 'preenchidas' => 1, 'pendentes' => 2, 'percentual' => 33])
        ->assertJsonPath('contagem', 3)
        ->assertJsonPath('truncado', false);
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())
        ->toBe(['data', 'hora', 'paciente', 'profissional', 'especialidade', 'evolucao'])
        ->and(collect($resposta->json('colunas'))->pluck('tipo')->all())
        ->toBe(['data', 'hora', 'texto', 'texto', 'texto', 'texto']);

    // ...a ordem e as linhas
    $linhas = $resposta->json('linhas');
    expect(collect($linhas)->pluck('profissional')->all())->toBe(['Carla Fictícia', 'Ana Fictícia', 'Bia Fictícia'])
        ->and(collect($linhas)->pluck('evolucao')->all())->toBe(['Pendente', 'Pendente', 'Preenchida'])
        ->and($linhas[0])->toBe([
            'data' => $ontem,
            'hora' => '14:00',
            'paciente' => $linhas[0]['paciente'],
            'profissional' => 'Carla Fictícia',
            'especialidade' => 'Fono Fictícia',
            'evolucao' => 'Pendente',
        ])
        ->and($linhas[2]['paciente'])->toBe('Criança Fictícia do Analítico');
});

it('deve trazer no sintético, por profissional, 8 realizados e 6 evoluções como 8, 6, 2 e 75', function () {
    // ARRANGE — a Ana com 8 realizados e 6 evoluções; a Bia com 2 e 2; a Carla só com um "Em
    // Aberto" (sem realizado → não aparece)
    $this->actingAs(admin());
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    $carla = Profissional::factory()->create(['nome' => 'Carla Fictícia']);
    foreach (range(8, 15) as $indice => $hora) {
        $realizado = realizadoDasEvolucoes(['profissional_id' => $ana->id], null, sprintf('%02d:00', $hora));
        if ($indice < 6) {
            evolucaoDasEvolucoes($realizado);
        }
    }
    evolucaoDasEvolucoes(realizadoDasEvolucoes(['profissional_id' => $bia->id], null, '08:00'));
    evolucaoDasEvolucoes(realizadoDasEvolucoes(['profissional_id' => $bia->id], null, '09:00'));
    Agendamento::factory()->create([
        'status_id' => statusDasEvolucoes(descontaSessao: false)->id,
        'profissional_id' => $carla->id,
        'inicio' => agoraNaClinica()->toDateString().' 10:00',
        'fim' => agoraNaClinica()->toDateString().' 10:40',
    ]);

    // ACT — como o web manda (com a divisão declarada) e sem ela: o mesmo resultado
    $resposta = $this->getJson('/api/relatorios/evolucoes?'.periodoDasEvolucoes().'&resultado=sintetico&dividir_por=profissional')->assertOk();
    $semDivisao = $this->getJson('/api/relatorios/evolucoes?'.periodoDasEvolucoes().'&resultado=sintetico')->assertOk();

    // ASSERT — o cenário da spec, e os totais gerais sobre as somas (10, 8, 2, 80)
    $grupos = $resposta->json('grupos');
    expect(collect($grupos)->pluck('titulo')->all())->toBe(['Ana Fictícia', 'Bia Fictícia'])
        ->and($grupos[0]['totais'])->toBe(['realizados' => 8, 'preenchidas' => 6, 'pendentes' => 2, 'percentual' => 75])
        ->and($grupos[0]['linhas'])->toBe([])
        ->and($grupos[1]['totais'])->toBe(['realizados' => 2, 'preenchidas' => 2, 'pendentes' => 0, 'percentual' => 100])
        ->and($resposta->json('linhas'))->toBe([])
        ->and($resposta->json('totais'))->toBe(['realizados' => 10, 'preenchidas' => 8, 'pendentes' => 2, 'percentual' => 80])
        ->and($resposta->json('contagem'))->toBe(2)
        ->and(collect($resposta->json('colunas'))->pluck('chave')->all())->toBe(['grupo', 'realizados', 'preenchidas', 'pendentes', 'percentual'])
        ->and(collect($resposta->json('colunas'))->pluck('tipo')->all())->toBe(['texto', 'numero', 'numero', 'numero', 'percentual'])
        ->and($resposta->json('filtros_aplicados'))->toBe([['rotulo' => 'Dividido por', 'valor' => 'Profissional']])
        ->and($semDivisao->json('grupos'))->toBe($grupos);
});

it('deve filtrar as linhas por situação, dizer isso no cabeçalho e manter nos totais a foto inteira', function () {
    // ARRANGE — três realizados da Ana: dois com evolução (08h, 09h), um sem (10h)
    $this->actingAs(admin());
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    evolucaoDasEvolucoes(realizadoDasEvolucoes(['profissional_id' => $ana->id], null, '08:00'));
    evolucaoDasEvolucoes(realizadoDasEvolucoes(['profissional_id' => $ana->id], null, '09:00'));
    realizadoDasEvolucoes(['profissional_id' => $ana->id], null, '10:00');

    // ACT
    $pendentes = $this->getJson('/api/relatorios/evolucoes?'.periodoDasEvolucoes().'&situacao=pendente')->assertOk();
    $preenchidas = $this->getJson('/api/relatorios/evolucoes?'.periodoDasEvolucoes().'&situacao=preenchida')->assertOk();
    $todas = $this->getJson('/api/relatorios/evolucoes?'.periodoDasEvolucoes().'&situacao=todas')->assertOk();

    // ASSERT — as linhas são o recorte; os totais dizem "1 de 3 pendente, 67% preenchido"
    expect(collect($pendentes->json('linhas'))->pluck('hora')->all())->toBe(['10:00'])
        ->and($pendentes->json('contagem'))->toBe(1)
        ->and($pendentes->json('filtros_aplicados'))->toBe([['rotulo' => 'Situação', 'valor' => 'Pendentes']])
        ->and($pendentes->json('totais'))->toBe(['realizados' => 3, 'preenchidas' => 2, 'pendentes' => 1, 'percentual' => 67])
        ->and(collect($preenchidas->json('linhas'))->pluck('hora')->all())->toBe(['08:00', '09:00'])
        ->and($preenchidas->json('filtros_aplicados'))->toBe([['rotulo' => 'Situação', 'valor' => 'Preenchidas']])
        ->and($todas->json('contagem'))->toBe(3)
        ->and($todas->json('filtros_aplicados'))->toBe([]);
});

it('deve classificar realizado pelas FLAGS: status renomeado conta, e a falta cobrada não vira evolução pendente', function () {
    // ARRANGE — o status que desconta e não é falta RENOMEADO; o padrão "Não Compareceu" também
    // desconta a sessão, e uma falta nunca terá evolução — contá-la seria pendência eterna
    $this->actingAs(admin());
    statusDasEvolucoes(descontaSessao: true)->update(['nome' => 'Sessão Feita Fictícia']);
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    realizadoDasEvolucoes(['profissional_id' => $ana->id], null, '09:00');
    realizadoDasEvolucoes(['profissional_id' => $ana->id, 'status_id' => statusDasEvolucoes(descontaSessao: true, marcaFalta: true)->id], null, '10:00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/evolucoes?'.periodoDasEvolucoes())->assertOk();

    // ASSERT — um realizado, pendente; a falta não entra em conta nenhuma
    $resposta->assertJsonPath('totais', ['realizados' => 1, 'preenchidas' => 0, 'pendentes' => 1, 'percentual' => 0]);
    expect(collect($resposta->json('linhas'))->pluck('hora')->all())->toBe(['09:00']);
});

it('deve escopar pelo eixo clínico: o vinculado sem clinico.ver_todos vê só os seus e o sem vínculo vê nada', function () {
    // ARRANGE — papel SEM `clinico.ver_todos` (com as duas permissões); um vinculado à Ana, outro sem vínculo
    admin();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $colega = Profissional::factory()->create(['nome' => 'Colega Fictício']);
    evolucaoDasEvolucoes(realizadoDasEvolucoes(['profissional_id' => $ana->id], null, '09:00'));
    realizadoDasEvolucoes(['profissional_id' => $colega->id], null, '10:00');
    $escopado = usuarioEscopadoEm($ana, ['evolucoes.ver', 'atendimentos.ver']);
    $semVinculo = usuarioCom(['evolucoes.ver', 'atendimentos.ver'], 'Sem vínculo');

    // ACT
    $doEscopado = $this->actingAs($escopado)->getJson('/api/relatorios/evolucoes?'.periodoDasEvolucoes());
    trocarDeUsuario();
    $sintetico = $this->actingAs($escopado)->getJson('/api/relatorios/evolucoes?'.periodoDasEvolucoes().'&resultado=sintetico');
    trocarDeUsuario();
    $doSemVinculo = $this->actingAs($semVinculo)->getJson('/api/relatorios/evolucoes?'.periodoDasEvolucoes());

    // ASSERT — analítico E sintético escopados; a pendência do colega não entra nos totais; sem vínculo, fail-closed
    $doEscopado->assertOk()->assertJsonPath('totais', ['realizados' => 1, 'preenchidas' => 1, 'pendentes' => 0, 'percentual' => 100]);
    expect(collect($doEscopado->json('linhas'))->pluck('profissional')->all())->toBe(['Ana Fictícia']);
    $sintetico->assertOk();
    expect(collect($sintetico->json('grupos'))->pluck('titulo')->all())->toBe(['Ana Fictícia']);
    $doSemVinculo->assertOk()
        ->assertJsonPath('totais', ['realizados' => 0, 'preenchidas' => 0, 'pendentes' => 0, 'percentual' => 0])
        ->assertJsonPath('contagem', 0);
});

it('deve agregar UMA vez por profissional no analítico, não duas (CRR-14)', function () {
    // ARRANGE — os totais do analítico saíam de `porProfissional($consulta)` chamado DUAS vezes
    // na mesma expressão (uma para `realizados`, outra para `preenchidas`), e cada chamada é um
    // par de agregações no banco: 4 consultas onde bastam 2. O número é pequeno hoje e cresce
    // com o período: é o analítico de 366 dias que a clínica manda para o convênio.
    $this->actingAs(admin());
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    evolucaoDasEvolucoes(realizadoDasEvolucoes(['profissional_id' => $ana->id], hora: '09:00'));
    realizadoDasEvolucoes(['profissional_id' => $ana->id], hora: '10:00');
    $hoje = agoraNaClinica()->toDateString();

    // ACT — contando só as agregações (as ÚNICAS consultas com `group by` neste caminho)
    $agregacoes = 0;
    DB::listen(function ($consulta) use (&$agregacoes): void {
        if (str_contains(strtolower($consulta->sql), 'group by')) {
            $agregacoes++;
        }
    });
    $resposta = $this->getJson("/api/relatorios/evolucoes?de={$hoje}&ate={$hoje}")->assertOk();

    // ASSERT — o número certo continua saindo, e sai com 2 agregações, não 4
    expect($resposta->json('totais'))->toBe(['realizados' => 2, 'preenchidas' => 1, 'pendentes' => 1, 'percentual' => 50])
        ->and($agregacoes)->toBe(2);
});
