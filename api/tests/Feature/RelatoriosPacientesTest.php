<?php

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;

/**
 * O relatório `pacientes` (change `area-de-relatorios`, task 2.5): cada `situacao`; o período
 * só em "cadastrados"; `dias` em 1..365; aniversariantes SEM a data de nascimento como campo;
 * falta COBRADA não conta como atendimento (`CRR-02`); escopo do eixo AGENDA (`SEC-REL-01`) pelo
 * predicado da seleção; sintético por convênio somado no banco.
 *
 * LGPD: dados 100% fictícios (nomes e nascimentos inventados).
 */

/** Uma sessão de atendimento da criança em `$data` com o status pedido (realizada = flag). */
function sessaoDaCrianca(Paciente $crianca, string $data, string $status = 'Finalizado', ?Profissional $profissional = null): Agendamento
{
    return Agendamento::factory()->create([
        'paciente_id' => $crianca->id,
        'status_id' => StatusAgendamento::where('nome', $status)->firstOrFail()->id,
        'inicio' => "{$data} 09:00",
        'fim' => "{$data} 09:40",
        ...($profissional === null ? [] : ['profissional_id' => $profissional->id]),
    ]);
}

/** Um pacote da criança num convênio de nome `$convenio` (criado se não existir). */
function pacoteDaCrianca(Paciente $crianca, string $convenio, ?Profissional $profissional = null): Tratamento
{
    return Tratamento::factory()->create([
        'paciente_id' => $crianca->id,
        'convenio_id' => Convenio::firstOrCreate(['nome' => $convenio])->id,
        ...($profissional === null ? [] : ['profissional_id' => $profissional->id]),
    ]);
}

it('deve listar as ativas por padrão, com o convênio do tratamento mais recente e "Sem convênio"', function () {
    // ARRANGE — Ana com dois pacotes (o mais recente noutra operadora), Bia sem pacote, Carla inativa
    $this->actingAs(admin());
    $ana = Paciente::factory()->create(['nome' => 'Ana Fictícia']);
    pacoteDaCrianca($ana, 'Operadora Fictícia');
    pacoteDaCrianca($ana, 'Outra Operadora Fictícia');
    Paciente::factory()->create(['nome' => 'Bia Fictícia']);
    Paciente::factory()->create(['nome' => 'Carla Fictícia', 'ativo' => false]);

    // ACT
    $resposta = $this->getJson('/api/relatorios/pacientes')->assertOk();

    // ASSERT — o envelope sem período, as colunas da situação default, a ordem por nome
    $resposta->assertJsonPath('slug', 'pacientes')
        ->assertJsonPath('periodo', null)
        ->assertJsonPath('filtros_aplicados', [['rotulo' => 'Situação', 'valor' => 'Ativos']])
        ->assertJsonPath('totais.quantidade', 2)
        ->assertJsonPath('contagem', 2);
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())->toBe(['paciente', 'convenio', 'situacao'])
        ->and($resposta->json('linhas'))->toBe([
            ['paciente' => 'Ana Fictícia', 'convenio' => 'Outra Operadora Fictícia', 'situacao' => 'Ativo'],
            ['paciente' => 'Bia Fictícia', 'convenio' => 'Sem convênio', 'situacao' => 'Ativo'],
        ]);
});

it('deve exigir de/ate em cadastrados_no_periodo, respeitar o teto de 366 dias e trazer a data do cadastro', function () {
    // ARRANGE — duas cadastradas hoje (uma já inativa) e uma de dez dias atrás
    $this->actingAs(admin());
    $hoje = agoraNaClinica()->toDateString();
    Paciente::factory()->create(['nome' => 'Nova Fictícia']);
    Paciente::factory()->create(['nome' => 'Desistente Fictícia', 'ativo' => false]);
    Paciente::factory()->create(['nome' => 'Antiga Fictícia'])
        ->forceFill(['created_at' => now()->subDays(10)])->saveQuietly();

    // ACT + ASSERT — sem período, 422 nos dois campos; acima do teto, 422 em `ate`
    $this->getJson('/api/relatorios/pacientes?situacao=cadastrados_no_periodo')
        ->assertUnprocessable()->assertJsonValidationErrors(['de', 'ate']);
    $deLonge = agoraNaClinica()->subDays(370)->toDateString();
    $this->getJson("/api/relatorios/pacientes?situacao=cadastrados_no_periodo&de={$deLonge}&ate={$hoje}")
        ->assertUnprocessable()->assertJsonValidationErrors(['ate']);

    // ...e o teto PRÓPRIO deste relatório conta como o do controller: inclusivo (`CRR-15`) —
    // 366 dias com as duas pontas passam, 367 recusam. Divergir aqui seria o mesmo relatório
    // com dois tetos
    $noLimite = agoraNaClinica()->subDays(365)->toDateString();
    $umDiaAlem = agoraNaClinica()->subDays(366)->toDateString();
    $this->getJson("/api/relatorios/pacientes?situacao=cadastrados_no_periodo&de={$noLimite}&ate={$hoje}")->assertOk();
    $this->getJson("/api/relatorios/pacientes?situacao=cadastrados_no_periodo&de={$umDiaAlem}&ate={$hoje}")
        ->assertUnprocessable()->assertJsonValidationErrors(['ate']);

    $resposta = $this->getJson("/api/relatorios/pacientes?situacao=cadastrados_no_periodo&de={$hoje}&ate={$hoje}")->assertOk();
    $resposta->assertJsonPath('periodo', ['de' => $hoje, 'ate' => $hoje])->assertJsonPath('totais.quantidade', 2);
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())->toBe(['paciente', 'convenio', 'situacao', 'cadastro'])
        ->and($resposta->json('colunas.3.tipo'))->toBe('data')
        ->and($resposta->json('linhas'))->toBe([
            ['paciente' => 'Desistente Fictícia', 'convenio' => 'Sem convênio', 'situacao' => 'Inativo', 'cadastro' => $hoje],
            ['paciente' => 'Nova Fictícia', 'convenio' => 'Sem convênio', 'situacao' => 'Ativo', 'cadastro' => $hoje],
        ]);
});

it('deve recusar dias fora de 1..365 e listar as ativas sem atendimento realizado há N dias, com o último atendimento', function () {
    // ARRANGE — Ana realizou há 10 dias; Bia só tem sessão em aberto; Carla realizou há 90 dias;
    // Dora é inativa. "Realizado" é a flag desconta_sessao do status, não o nome.
    $this->actingAs(admin());
    $ha10 = agoraNaClinica()->subDays(10)->toDateString();
    $ha5 = agoraNaClinica()->subDays(5)->toDateString();
    $ha90 = agoraNaClinica()->subDays(90)->toDateString();
    sessaoDaCrianca(Paciente::factory()->create(['nome' => 'Ana Fictícia']), $ha10);
    sessaoDaCrianca(Paciente::factory()->create(['nome' => 'Bia Fictícia']), $ha5, 'Em Aberto');
    $carla = Paciente::factory()->create(['nome' => 'Carla Fictícia']);
    sessaoDaCrianca($carla, $ha90);
    sessaoDaCrianca($carla, agoraNaClinica()->subDays(120)->toDateString());
    Paciente::factory()->create(['nome' => 'Dora Fictícia', 'ativo' => false]);

    // ACT + ASSERT — a régua de `dias`
    $this->getJson('/api/relatorios/pacientes?situacao=sem_atendimento&dias=0')
        ->assertUnprocessable()->assertJsonValidationErrors(['dias']);
    $this->getJson('/api/relatorios/pacientes?situacao=sem_atendimento&dias=366')
        ->assertUnprocessable()->assertJsonValidationErrors(['dias']);

    // ...o default de 60 dias
    $padrao = $this->getJson('/api/relatorios/pacientes?situacao=sem_atendimento')->assertOk();
    expect(collect($padrao->json('colunas'))->pluck('chave')->all())->toBe(['paciente', 'convenio', 'situacao', 'ultimo_atendimento'])
        ->and($padrao->json('linhas'))->toBe([
            ['paciente' => 'Bia Fictícia', 'convenio' => 'Sem convênio', 'situacao' => 'Ativo', 'ultimo_atendimento' => '—'],
            ['paciente' => 'Carla Fictícia', 'convenio' => 'Sem convênio', 'situacao' => 'Ativo', 'ultimo_atendimento' => $ha90],
        ])
        ->and($padrao->json('filtros_aplicados'))->toBe([
            ['rotulo' => 'Situação', 'valor' => 'Sem atendimento'],
            ['rotulo' => 'Sem atendimento há', 'valor' => '60 dias'],
        ]);

    // ...e com 100 dias a Carla já atendeu dentro da janela
    $cem = $this->getJson('/api/relatorios/pacientes?situacao=sem_atendimento&dias=100')->assertOk();
    expect(collect($cem->json('linhas'))->pluck('paciente')->all())->toBe(['Bia Fictícia']);
});

it('deve manter em "sem atendimento" a criança cuja única sessão recente é FALTA COBRADA (CRR-02)', function () {
    // ARRANGE — a Ana só tem "Não Compareceu" há 5 dias. O status padrão carrega AS DUAS flags
    // (`desconta_sessao` porque a clínica cobra a sessão perdida, `marca_falta` porque foi falta),
    // e filtrar só por `desconta_sessao` a contava como ATENDIDA: ela sumia da lista que existe
    // para achá-la. A Bia é o contraste — finalizou de verdade no mesmo dia.
    $this->actingAs(admin());
    $ha5 = agoraNaClinica()->subDays(5)->toDateString();
    $ana = Paciente::factory()->create(['nome' => 'Ana Fictícia']);
    sessaoDaCrianca($ana, $ha5, 'Não Compareceu');
    sessaoDaCrianca(Paciente::factory()->create(['nome' => 'Bia Fictícia']), $ha5, 'Finalizado');

    // ACT
    $resposta = $this->getJson('/api/relatorios/pacientes?situacao=sem_atendimento')->assertOk();

    // ASSERT — a Ana está na lista, e o "último atendimento" dela é "—": falta cobrada não é
    // atendimento em lugar nenhum do relatório, nem no filtro nem na coluna
    expect($resposta->json('linhas'))->toBe([
        ['paciente' => 'Ana Fictícia', 'convenio' => 'Sem convênio', 'situacao' => 'Ativo', 'ultimo_atendimento' => '—'],
    ])->and($resposta->json('totais.quantidade'))->toBe(1);
});

it('deve exigir mes em aniversariantes e trazer só o mês pedido, com dia e idade que fará, SEM a data de nascimento', function () {
    // ARRANGE — nascimentos FICTÍCIOS: duas em setembro, uma em outubro, uma inativa em setembro
    $this->actingAs(admin());
    Paciente::factory()->create(['nome' => 'Ana Fictícia', 'nascimento' => '2019-09-25']);
    Paciente::factory()->create(['nome' => 'Bia Fictícia', 'nascimento' => '2020-09-03']);
    Paciente::factory()->create(['nome' => 'Carla Fictícia', 'nascimento' => '2018-10-03']);
    Paciente::factory()->create(['nome' => 'Dora Fictícia', 'nascimento' => '2019-09-10', 'ativo' => false]);

    // ACT + ASSERT — `mes` obrigatório e no formato YYYY-MM
    $this->getJson('/api/relatorios/pacientes?situacao=aniversariantes')
        ->assertUnprocessable()->assertJsonValidationErrors(['mes']);
    $this->getJson('/api/relatorios/pacientes?situacao=aniversariantes&mes=2026-13')
        ->assertUnprocessable()->assertJsonValidationErrors(['mes']);

    $resposta = $this->getJson('/api/relatorios/pacientes?situacao=aniversariantes&mes=2026-09')->assertOk();

    // ...só setembro, em ordem de dia, com "dd/mm" e a idade que fará em 2026
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())->toBe(['paciente', 'convenio', 'situacao', 'dia', 'idade_que_fara'])
        ->and($resposta->json('colunas.4.tipo'))->toBe('numero')
        ->and($resposta->json('linhas'))->toBe([
            ['paciente' => 'Bia Fictícia', 'convenio' => 'Sem convênio', 'situacao' => 'Ativo', 'dia' => '03/09', 'idade_que_fara' => 6],
            ['paciente' => 'Ana Fictícia', 'convenio' => 'Sem convênio', 'situacao' => 'Ativo', 'dia' => '25/09', 'idade_que_fara' => 7],
        ])
        ->and($resposta->json('filtros_aplicados'))->toBe([
            ['rotulo' => 'Situação', 'valor' => 'Aniversariantes do mês'],
            ['rotulo' => 'Mês', 'valor' => '09/2026'],
        ]);

    // ...e a data de nascimento INTEIRA não está em lugar nenhum do payload (chave ou valor)
    $chaves = [];
    $varrer = function (mixed $valor) use (&$chaves, &$varrer): void {
        if (! is_array($valor)) {
            return;
        }
        foreach ($valor as $chave => $filho) {
            if (is_string($chave)) {
                $chaves[] = $chave;
            }
            $varrer($filho);
        }
    };
    $varrer($resposta->json());
    expect(array_values(array_intersect(array_unique($chaves), ['nascimento', 'data_nascimento'])))->toBe([]);
    semVazamento($resposta->json(), '2019-09-25');
    semVazamento($resposta->json(), '2020-09-03');
});

it('deve escopar pelo eixo AGENDA: o vinculado vê só as crianças dele e o sem vínculo vê nada', function () {
    // ARRANGE — papel SEM as flags de alcance; a Ana tem uma criança pela agenda e outra pelo pacote;
    // o colega tem a sua; uma quarta não é de ninguém
    admin();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $colega = Profissional::factory()->create(['nome' => 'Colega Fictício']);
    sessaoDaCrianca(Paciente::factory()->create(['nome' => 'Da Agenda Fictícia']), agoraNaClinica()->toDateString(), 'Em Aberto', $ana);
    pacoteDaCrianca(Paciente::factory()->create(['nome' => 'Do Pacote Fictícia']), 'Operadora Fictícia', $ana);
    pacoteDaCrianca(Paciente::factory()->create(['nome' => 'Do Colega Fictícia']), 'Operadora Fictícia', $colega);
    Paciente::factory()->create(['nome' => 'De Ninguém Fictícia']);
    $escopado = usuarioCom(['pacientes.ver'], 'Escopado na agenda');
    $escopado->update(['profissional_id' => $ana->id]);
    $semVinculo = usuarioCom(['pacientes.ver'], 'Sem vínculo');

    // ACT
    $doEscopado = $this->actingAs($escopado)->getJson('/api/relatorios/pacientes')->assertOk();
    trocarDeUsuario();
    $sintetico = $this->actingAs($escopado)->getJson('/api/relatorios/pacientes?resultado=sintetico&dividir_por=convenio')->assertOk();
    trocarDeUsuario();
    $doSemVinculo = $this->actingAs($semVinculo)->getJson('/api/relatorios/pacientes')->assertOk();

    // ASSERT — agendamento OU tratamento com ela; o sintético na mesma query; sem vínculo, fail-closed
    expect(collect($doEscopado->json('linhas'))->pluck('paciente')->all())->toBe(['Da Agenda Fictícia', 'Do Pacote Fictícia'])
        ->and($sintetico->json('totais.quantidade'))->toBe(2)
        ->and(collect($sintetico->json('grupos'))->pluck('titulo')->all())->toBe(['Operadora Fictícia', 'Sem convênio']);
    $doSemVinculo->assertJsonPath('totais.quantidade', 0)->assertJsonPath('contagem', 0);
});

it('deve somar no sintético por convênio, cada criança num grupo só, com "Sem convênio" por último', function () {
    // ARRANGE — duas na Operadora, uma na Outra, uma sem pacote; e uma inativa que não entra
    $this->actingAs(admin());
    pacoteDaCrianca(Paciente::factory()->create(['nome' => 'Ana Fictícia']), 'Operadora Fictícia');
    pacoteDaCrianca(Paciente::factory()->create(['nome' => 'Bia Fictícia']), 'Operadora Fictícia');
    pacoteDaCrianca(Paciente::factory()->create(['nome' => 'Carla Fictícia']), 'Outra Operadora Fictícia');
    Paciente::factory()->create(['nome' => 'Dora Fictícia']);
    pacoteDaCrianca(Paciente::factory()->create(['nome' => 'Inativa Fictícia', 'ativo' => false]), 'Operadora Fictícia');

    // ACT + ASSERT — sintético sem divisão é 422
    $this->getJson('/api/relatorios/pacientes?resultado=sintetico')
        ->assertUnprocessable()->assertJsonValidationErrors(['dividir_por']);

    $resposta = $this->getJson('/api/relatorios/pacientes?resultado=sintetico&dividir_por=convenio')->assertOk();

    // ...um grupo por convênio, os totais são a soma, e a contagem é o número de grupos
    $grupos = $resposta->json('grupos');
    expect(collect($grupos)->pluck('titulo')->all())->toBe(['Operadora Fictícia', 'Outra Operadora Fictícia', 'Sem convênio'])
        ->and(collect($grupos)->pluck('totais.quantidade')->all())->toBe([2, 1, 1])
        ->and($grupos[0]['linhas'])->toBe([])
        ->and($resposta->json('linhas'))->toBe([])
        ->and($resposta->json('totais'))->toBe(['quantidade' => 4])
        ->and($resposta->json('contagem'))->toBe(3)
        ->and(collect($resposta->json('colunas'))->pluck('chave')->all())->toBe(['grupo', 'quantidade'])
        ->and($resposta->json('filtros_aplicados'))->toBe([
            ['rotulo' => 'Situação', 'valor' => 'Ativos'],
            ['rotulo' => 'Dividido por', 'valor' => 'Convênio'],
        ]);
});
