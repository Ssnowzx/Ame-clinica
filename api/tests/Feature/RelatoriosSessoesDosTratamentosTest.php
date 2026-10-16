<?php

use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Tratamento;
use App\Support\Clinica\PacotesAcabando;
use App\Support\Clinica\RealceDoPacote;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\Escopo;
use App\Support\Relatorios\PeriodoDoTratamento;
use App\Support\Relatorios\SessoesDosTratamentos;
use Illuminate\Support\Facades\DB;

/**
 * O relatório `sessoes-dos-tratamentos` (change `area-de-relatorios`, task 2.6): 403 antes de
 * 422; as colunas e a ordem por saldo; as três situações — em andamento até `ate`, finalizados
 * no período, próximos do encerramento pelo limiar de `configuracoes` (o corte MUDA com ela) e
 * pelo MESMO predicado da fila do centro (`CRR-08`); filtros com nome legível; escopo D11 do eixo
 * AGENDA (`SEC-REL-01`); o corte de linhas; e o GET antigo servido pela MESMA
 * conta (task 2.10).
 */

/** A query string de `de`/`ate` cobrindo `$dias` para trás a partir de hoje da clínica. */
function periodoDasSessoesDosTratamentos(int $dias = 7): string
{
    return 'de='.agoraNaClinica()->subDays($dias)->toDateString().'&ate='.agoraNaClinica()->toDateString();
}

/** Um pacote aberto hoje na parede da clínica, com `$total` vendidas e `$realizadas` consumidas. */
function pacoteDasSessoes(int $total, int $realizadas, array $atributos = []): Tratamento
{
    $tratamento = Tratamento::factory()->create([
        'sessoes_total' => $total,
        'data_inicio' => agoraNaClinica()->toDateString(),
        ...$atributos,
    ]);
    $tratamento->forceFill(['sessoes_realizadas' => $realizadas])->save();

    return $tratamento->refresh();
}

it('deve recusar com 403 quem não tem tratamentos.ver MESMO com período inválido (403 antes de 422)', function () {
    // ARRANGE — logado, com outra permissão, e um período que NÃO valida
    admin();
    $semTratamentos = usuarioCom(['agenda.ver'], 'Sem tratamentos');

    // ACT + ASSERT — a autorização decide antes de o validador olhar o parâmetro
    $this->actingAs($semTratamentos)
        ->getJson('/api/relatorios/sessoes-dos-tratamentos?de=nao-e-data')
        ->assertForbidden();
});

it('deve listar os em andamento até o fim do período, com as colunas declaradas, em ordem de saldo, e somar os totais', function () {
    // ARRANGE — um pacote folgado (saldo 6) e um apertado (saldo 1); fora: finalizado, parado e
    // um aberto DEPOIS do fim do período
    $this->actingAs(admin());
    $hoje = agoraNaClinica()->toDateString();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $fono = Especialidade::factory()->create(['nome' => 'Fono Fictícia']);
    $operadora = Convenio::create(['nome' => 'Operadora Fictícia']);
    $ponta = ['profissional_id' => $ana->id, 'especialidade_id' => $fono->id, 'convenio_id' => $operadora->id];
    pacoteDasSessoes(10, 4, [...$ponta, 'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Folgada'])->id]);
    pacoteDasSessoes(5, 4, [...$ponta, 'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Apertada'])->id]);
    pacoteDasSessoes(10, 10, ['status' => 'finalizado']);
    pacoteDasSessoes(10, 2, ['status' => 'parado']);
    pacoteDasSessoes(10, 0, ['data_inicio' => agoraNaClinica()->addDay()->toDateString()]);

    // ACT
    $resposta = $this->getJson('/api/relatorios/sessoes-dos-tratamentos?'.periodoDasSessoesDosTratamentos())->assertOk();

    // ASSERT — o envelope, as colunas, a ordem e os totais
    $resposta->assertJsonPath('slug', 'sessoes-dos-tratamentos')
        ->assertJsonPath('titulo', 'Sessões dos tratamentos')
        ->assertJsonPath('periodo.ate', $hoje)
        ->assertJsonPath('filtros_aplicados', [['rotulo' => 'Situação', 'valor' => 'Em andamento']])
        ->assertJsonPath('grupos', null)
        ->assertJsonPath('totais', ['quantidade' => 2, 'vendidas' => 15, 'realizadas' => 8, 'saldo' => 7])
        ->assertJsonPath('contagem', 2)
        ->assertJsonPath('truncado', false);
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())
        ->toBe(['paciente', 'especialidade', 'convenio', 'profissional', 'vendidas', 'realizadas', 'saldo', 'situacao'])
        ->and(collect($resposta->json('colunas'))->pluck('tipo')->all())
        ->toBe(['texto', 'texto', 'texto', 'texto', 'numero', 'numero', 'numero', 'texto']);

    $linhas = $resposta->json('linhas');
    expect($linhas[0])->toBe([
        'paciente' => 'Criança Fictícia Apertada',
        'especialidade' => 'Fono Fictícia',
        'convenio' => 'Operadora Fictícia',
        'profissional' => 'Ana Fictícia',
        'vendidas' => 5,
        'realizadas' => 4,
        'saldo' => 1,
        'situacao' => 'Em andamento',
    ])
        ->and($linhas[1]['paciente'])->toBe('Criança Fictícia Folgada')
        ->and($linhas[1]['saldo'])->toBe(6);
});

it('deve listar os finalizados pela data da finalização dentro do período', function () {
    // ARRANGE — um finalizado agora e um finalizado há 30 dias (gravação antiga pelo query
    // builder, para o Eloquent não carimbar `updated_at` de novo); um em andamento fica fora
    $this->actingAs(admin());
    pacoteDasSessoes(10, 10, ['status' => 'finalizado', 'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Recente'])->id]);
    $antigo = pacoteDasSessoes(10, 10, ['status' => 'finalizado', 'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Antiga'])->id]);
    DB::table('tratamentos')->where('id', $antigo->id)->update(['updated_at' => now()->subDays(30)->format('Y-m-d H:i:s')]);
    pacoteDasSessoes(10, 2, ['paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Em Curso'])->id]);

    // ACT
    $resposta = $this->getJson('/api/relatorios/sessoes-dos-tratamentos?'.periodoDasSessoesDosTratamentos().'&situacao=finalizados')->assertOk();

    // ASSERT
    expect(collect($resposta->json('linhas'))->pluck('paciente')->all())->toBe(['Criança Fictícia Recente'])
        ->and($resposta->json('linhas.0.situacao'))->toBe('Finalizado')
        ->and($resposta->json('totais.quantidade'))->toBe(1)
        ->and($resposta->json('filtros_aplicados'))->toBe([['rotulo' => 'Situação', 'valor' => 'Finalizados no período']]);
});

it('deve recortar os próximos do encerramento pelo limiar de configuracoes — e o corte muda quando ela muda', function () {
    // ARRANGE — o cenário da spec: limiar 3 → saldo 2 entra, saldo 4 não; sessão única (saldo 1)
    // não é pacote e fica fora em qualquer limiar
    $this->actingAs(admin());
    app(ConfiguracaoService::class)->set('tratamentos.saldo_alerta_sessoes', 3);
    pacoteDasSessoes(10, 8, ['paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Saldo Dois'])->id]);
    pacoteDasSessoes(10, 6, ['paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Saldo Quatro'])->id]);
    pacoteDasSessoes(1, 0, ['paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Sessão Única'])->id]);
    $consulta = '/api/relatorios/sessoes-dos-tratamentos?'.periodoDasSessoesDosTratamentos().'&situacao=proximos_do_encerramento';

    // ACT — com limiar 3, depois com limiar 5 (o dado mudou; o código não)
    $comTres = $this->getJson($consulta)->assertOk();
    app(ConfiguracaoService::class)->set('tratamentos.saldo_alerta_sessoes', 5);
    $comCinco = $this->getJson($consulta)->assertOk();

    // ASSERT — o corte acompanha a configuração; ordem por saldo crescente
    expect(collect($comTres->json('linhas'))->pluck('paciente')->all())->toBe(['Criança Fictícia Saldo Dois'])
        ->and($comTres->json('filtros_aplicados'))->toBe([['rotulo' => 'Situação', 'valor' => 'Próximos do encerramento']])
        ->and(collect($comCinco->json('linhas'))->pluck('paciente')->all())->toBe(['Criança Fictícia Saldo Dois', 'Criança Fictícia Saldo Quatro'])
        ->and($comCinco->json('totais'))->toBe(['quantidade' => 2, 'vendidas' => 20, 'realizadas' => 14, 'saldo' => 6]);
});

it('deve recortar os próximos do encerramento com o MESMO predicado da fila do centro (CRR-08)', function () {
    // ARRANGE — o predicado estava COPIADO de `PacotesAcabando::consulta()` para dentro do
    // relatório; agora os dois chamam `RealceDoPacote::escopoDoFimDePacote`. Este teste amarra
    // os dois lados: MESMO conjunto, e mudando o limiar os dois se movem JUNTOS — se um dia só
    // um dos dois for corrigido, o contador do sino dirá 1 e o papel listará 2.
    $this->actingAs(admin());
    app(ConfiguracaoService::class)->set('tratamentos.saldo_alerta_sessoes', 3);
    pacoteDasSessoes(10, 8, ['paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Saldo Dois'])->id]);
    pacoteDasSessoes(10, 6, ['paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Saldo Quatro'])->id]);
    pacoteDasSessoes(1, 0, ['paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Sessão Única'])->id]);
    $consulta = '/api/relatorios/sessoes-dos-tratamentos?'.periodoDasSessoesDosTratamentos().'&situacao=proximos_do_encerramento';
    $daFila = fn (): array => app(PacotesAcabando::class)->consulta(Escopo::plano())
        ->pluck('tratamentos.id')->sort()->values()->all();

    // ACT + ASSERT — com limiar 3
    $comTres = $this->getJson($consulta)->assertOk();
    expect(collect($comTres->json('linhas'))->pluck('paciente')->all())->toBe(['Criança Fictícia Saldo Dois'])
        ->and($daFila())->toHaveCount(1);

    // ...e com limiar 5 os DOIS crescem juntos, para o mesmo conjunto
    app(ConfiguracaoService::class)->set('tratamentos.saldo_alerta_sessoes', 5);
    $comCinco = $this->getJson($consulta)->assertOk();
    expect(collect($comCinco->json('linhas'))->pluck('paciente')->all())
        ->toBe(['Criança Fictícia Saldo Dois', 'Criança Fictícia Saldo Quatro'])
        ->and($daFila())->toHaveCount(2);

    // ...e o conjunto de IDS é o mesmo dos dois lados, não só a contagem
    $doRelatorio = Tratamento::whereIn('paciente_id', Paciente::whereIn('nome', [
        'Criança Fictícia Saldo Dois', 'Criança Fictícia Saldo Quatro',
    ])->pluck('id'))->pluck('id')->sort()->values()->all();
    expect($daFila())->toBe($doRelatorio);
});

it('deve filtrar por convênio com o nome legível e recusar situação desconhecida e id inexistente', function () {
    // ARRANGE
    $this->actingAs(admin());
    $operadora = Convenio::create(['nome' => 'Operadora Fictícia']);
    pacoteDasSessoes(10, 2, ['convenio_id' => $operadora->id, 'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia da Operadora'])->id]);
    pacoteDasSessoes(10, 2, ['paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia de Outro'])->id]);
    $periodo = periodoDasSessoesDosTratamentos();

    // ACT
    $resposta = $this->getJson("/api/relatorios/sessoes-dos-tratamentos?{$periodo}&convenio_id={$operadora->id}")->assertOk();

    // ASSERT — só a da operadora, e o cabeçalho impresso sabe disso
    expect(collect($resposta->json('linhas'))->pluck('paciente')->all())->toBe(['Criança Fictícia da Operadora'])
        ->and($resposta->json('filtros_aplicados'))->toBe([
            ['rotulo' => 'Situação', 'valor' => 'Em andamento'],
            ['rotulo' => 'Convênio', 'valor' => 'Operadora Fictícia'],
        ]);
    $this->getJson("/api/relatorios/sessoes-dos-tratamentos?{$periodo}&situacao=parados")
        ->assertUnprocessable()->assertJsonValidationErrors(['situacao']);
    $this->getJson("/api/relatorios/sessoes-dos-tratamentos?{$periodo}&convenio_id=999999")
        ->assertUnprocessable()->assertJsonValidationErrors(['convenio_id']);
});

it('deve escopar pelo eixo AGENDA: o vinculado vê só os seus, quem tem só a flag clínica vê nada e o plano na agenda vê tudo', function () {
    // ARRANGE — pacotes da Ana, da Bia e do colega; quatro papéis que separam os dois eixos (o
    // vínculo usuário→profissional é 1:1, daí uma profissional para cada)
    admin();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    $colega = Profissional::factory()->create(['nome' => 'Colega Fictício']);
    pacoteDasSessoes(10, 2, ['profissional_id' => $ana->id]);
    pacoteDasSessoes(10, 2, ['profissional_id' => $bia->id]);
    pacoteDasSessoes(10, 2, ['profissional_id' => $colega->id]);
    $escopado = usuarioEscopadoEm($ana, ['tratamentos.ver']);
    // plano na AGENDA (flag), sem a flag clínica, vinculado à Bia: no eixo AGENDA é PLANO — e é
    // este papel que prova o eixo, porque no clínico ele seria `de(Bia)`. É também o papel real
    // da Secretaria/Faturista do AP-10, que com o eixo clínico recebia folha em branco
    $planoNaAgenda = usuarioCom(['tratamentos.ver', 'agenda.ver_todos'], 'Plano na agenda');
    $planoNaAgenda->update(['profissional_id' => $bia->id]);
    // o inverso: só a flag CLÍNICA, sem a da agenda e sem vínculo. No eixo agenda é `nenhum`
    // (fail-closed); com o eixo clínico ele saía PLANO aqui e escopado na porta antiga do mesmo
    // dado (`GET /relatorios/sessoes-vendidas-realizadas`), contornando o `SEC-VP-45`
    $soClinico = usuarioCom(['tratamentos.ver', 'clinico.ver_todos'], 'Só clínico');
    $semVinculo = usuarioCom(['tratamentos.ver'], 'Sem vínculo');
    $consulta = '/api/relatorios/sessoes-dos-tratamentos?'.periodoDasSessoesDosTratamentos();

    // ACT
    $doEscopado = $this->actingAs($escopado)->getJson($consulta);
    trocarDeUsuario();
    $doPlanoNaAgenda = $this->actingAs($planoNaAgenda)->getJson($consulta);
    trocarDeUsuario();
    $doSoClinico = $this->actingAs($soClinico)->getJson($consulta);
    trocarDeUsuario();
    $doSemVinculo = $this->actingAs($semVinculo)->getJson($consulta);

    // ASSERT
    $doEscopado->assertOk()->assertJsonPath('totais.quantidade', 1);
    expect(collect($doEscopado->json('linhas'))->pluck('profissional')->all())->toBe(['Ana Fictícia']);
    $doPlanoNaAgenda->assertOk()->assertJsonPath('totais.quantidade', 3);
    // conjunto, não ordem: os três pacotes têm o MESMO saldo, e o desempate é pelo nome da
    // criança, que a factory sorteia — comparar a lista posicional passaria por acaso
    expect(collect($doPlanoNaAgenda->json('linhas'))->pluck('profissional')->sort()->values()->all())
        ->toBe(['Ana Fictícia', 'Bia Fictícia', 'Colega Fictício']);
    $doSoClinico->assertOk()->assertJsonPath('totais.quantidade', 0)->assertJsonPath('contagem', 0);
    $doSemVinculo->assertOk()->assertJsonPath('totais.quantidade', 0)->assertJsonPath('contagem', 0);
});

it('deve cortar o analítico no limite e avisar em truncado, mantendo os totais do recorte', function () {
    // ARRANGE — limite injetado (o catálogo resolve pelo container): 2 de teto, 3 pacotes
    $this->actingAs(admin());
    app()->bind(SessoesDosTratamentos::class, fn () => new SessoesDosTratamentos(
        app(RealceDoPacote::class),
        app(PeriodoDoTratamento::class),
        limiteDeLinhas: 2,
    ));
    pacoteDasSessoes(10, 9);
    pacoteDasSessoes(10, 5);
    pacoteDasSessoes(10, 0);

    // ACT
    $resposta = $this->getJson('/api/relatorios/sessoes-dos-tratamentos?'.periodoDasSessoesDosTratamentos())->assertOk();

    // ASSERT — duas linhas (os menores saldos), truncado, e os totais falam do recorte inteiro
    expect($resposta->json('linhas'))->toHaveCount(2)
        ->and(collect($resposta->json('linhas'))->pluck('saldo')->all())->toBe([1, 5])
        ->and($resposta->json('truncado'))->toBeTrue()
        ->and($resposta->json('contagem'))->toBe(2)
        ->and($resposta->json('totais'))->toBe(['quantidade' => 3, 'vendidas' => 30, 'realizadas' => 14, 'saldo' => 16]);
});

it('deve servir o GET antigo sessoes-vendidas-realizadas pela MESMA conta do relatório (task 2.10)', function () {
    // ARRANGE — um pacote só; os dois caminhos leem o mesmo número
    $this->actingAs(admin());
    pacoteDasSessoes(10, 4);

    // ACT
    $antigo = $this->getJson('/api/relatorios/sessoes-vendidas-realizadas')->assertOk()->json('data.0');
    $novo = $this->getJson('/api/relatorios/sessoes-dos-tratamentos?'.periodoDasSessoesDosTratamentos())->assertOk()->json('linhas.0');

    // ASSERT — o JSON antigo continua o mesmo, e a conta é uma só
    expect($antigo)->toHaveKeys(['tratamento_id', 'paciente', 'convenio', 'especialidade', 'status', 'vendidas', 'realizadas', 'saldo'])
        ->and([$antigo['vendidas'], $antigo['realizadas'], $antigo['saldo']])->toBe([10, 4, 6])
        ->and([$novo['vendidas'], $novo['realizadas'], $novo['saldo']])->toBe([10, 4, 6]);
});
