<?php

use App\Models\Convenio;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Servico;
use App\Models\Tratamento;
use Illuminate\Support\Facades\DB;

/**
 * O relatório `tratamentos-sem-lancamento` (change `area-de-relatorios`, task 2.7): as DUAS
 * permissões (falta qualquer uma → 403, antes de validar); só os pacotes sem lançamento; o
 * valor previsto em decimal; a abertura na parede da clínica; escopo D11 do eixo clínico;
 */

/** A query string de `de`/`ate` cobrindo `$dias` para trás a partir de hoje da clínica. */
function periodoDosSemLancamento(int $dias = 7): string
{
    return 'de='.agoraNaClinica()->subDays($dias)->toDateString().'&ate='.agoraNaClinica()->toDateString();
}

/** Um pacote aberto hoje na parede da clínica. */
function pacoteSemLancamento(array $atributos = []): Tratamento
{
    return Tratamento::factory()->create([
        'data_inicio' => agoraNaClinica()->toDateString(),
        ...$atributos,
    ]);
}

/** Um serviço PRECIFICADO do convênio (`convenio_id` fora do fillable, como no formulário). */
function servicoDoSemLancamento(int $convenioId, string $procedimento, string $valor): Servico
{
    $servico = new Servico(['procedimento' => $procedimento, 'valor' => $valor]);
    $servico->convenio_id = $convenioId;
    $servico->save();

    return $servico;
}

it('deve exigir AS DUAS permissões: falta qualquer uma → 403, e antes de validar o período', function () {
    // ARRANGE — três usuários: só tratamentos, só lançamentos, os dois
    admin();
    $soTratamentos = usuarioCom(['tratamentos.ver'], 'Só tratamentos');
    $soLancamentos = usuarioCom(['lancamentos.ver'], 'Só lançamentos');
    $asDuas = usuarioCom(['tratamentos.ver', 'lancamentos.ver'], 'As duas');

    // ACT + ASSERT — 403 com período inválido (autorização antes de validação) e com válido
    $this->actingAs($soTratamentos)
        ->getJson('/api/relatorios/tratamentos-sem-lancamento?de=nao-e-data')
        ->assertForbidden();
    trocarDeUsuario();
    $this->actingAs($soLancamentos)
        ->getJson('/api/relatorios/tratamentos-sem-lancamento?'.periodoDosSemLancamento())
        ->assertForbidden();
    trocarDeUsuario();
    $this->actingAs($asDuas)
        ->getJson('/api/relatorios/tratamentos-sem-lancamento?'.periodoDosSemLancamento())
        ->assertOk();
});

it('deve listar só os pacotes sem lançamento, com valor previsto = preço do serviço × vendidas e "Sem serviço" na soma', function () {
    // ARRANGE — dois abertos hoje sem lançamento (um com serviço a 150 × 10, um sem serviço) e
    // um COM lançamento amarrado pelo `tratamento_id`
    $this->actingAs(admin());
    $hoje = agoraNaClinica()->toDateString();
    $operadora = Convenio::create(['nome' => 'Operadora Fictícia']);
    $servico = servicoDoSemLancamento($operadora->id, 'Sessão Fictícia', '150.00');
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    pacoteSemLancamento([
        'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Sem Caixa'])->id,
        'convenio_id' => $operadora->id,
        'servico_id' => $servico->id,
        'profissional_id' => $ana->id,
        'sessoes_total' => 10,
    ]);
    pacoteSemLancamento([
        'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Sem Serviço'])->id,
        'sessoes_total' => 4,
    ]);
    $cobrado = pacoteSemLancamento([
        'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Cobrada'])->id,
        'convenio_id' => $operadora->id,
        'servico_id' => $servico->id,
    ]);
    lancamentoDoTratamento($cobrado->id, $hoje);

    // ACT
    $resposta = $this->getJson('/api/relatorios/tratamentos-sem-lancamento?'.periodoDosSemLancamento())->assertOk();

    // ASSERT — o envelope e as colunas
    $resposta->assertJsonPath('slug', 'tratamentos-sem-lancamento')
        ->assertJsonPath('titulo', 'Tratamentos sem lançamento')
        ->assertJsonPath('periodo.ate', $hoje)
        ->assertJsonPath('filtros_aplicados', [])
        ->assertJsonPath('grupos', null)
        ->assertJsonPath('totais', ['quantidade' => 2, 'valor_previsto' => '1500.00'])
        ->assertJsonPath('contagem', 2);
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())
        ->toBe(['paciente', 'convenio', 'servico', 'valor_previsto', 'abertura', 'profissional'])
        ->and(collect($resposta->json('colunas'))->pluck('tipo')->all())
        ->toBe(['texto', 'texto', 'texto', 'dinheiro', 'data', 'texto']);

    // ...as linhas (mesma abertura → pelo nome), e a cobrada NÃO está
    $linhas = $resposta->json('linhas');
    expect($linhas[0])->toBe([
        'paciente' => 'Criança Fictícia Sem Caixa',
        'convenio' => 'Operadora Fictícia',
        'servico' => 'Sessão Fictícia',
        'valor_previsto' => '1500.00',
        'abertura' => $hoje,
        'profissional' => 'Ana Fictícia',
    ])
        ->and($linhas[1]['paciente'])->toBe('Criança Fictícia Sem Serviço')
        ->and($linhas[1]['servico'])->toBe('Sem serviço')
        ->and($linhas[1]['valor_previsto'])->toBe('0.00');
    semVazamento($resposta->json(), 'Criança Fictícia Cobrada');
});

it('deve recortar pela abertura na parede da clínica: data_inicio quando há, senão a criação convertida do UTC', function () {
    // ARRANGE — abertura há 3 dias entra; há 30 dias sai; sem `data_inicio` vale a criação — e
    // uma criada às 23:59 de hoje na parede (já amanhã em UTC) ainda é de HOJE
    $this->actingAs(admin());
    pacoteSemLancamento([
        'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Dentro'])->id,
        'data_inicio' => agoraNaClinica()->subDays(3)->toDateString(),
    ]);
    pacoteSemLancamento([
        'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Antiga'])->id,
        'data_inicio' => agoraNaClinica()->subDays(30)->toDateString(),
    ]);
    $semData = Tratamento::factory()->create([
        'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia Sem Data'])->id,
        'data_inicio' => null,
    ]);
    DB::table('tratamentos')->where('id', $semData->id)->update([
        'created_at' => agoraNaClinica()->setTime(23, 59, 0)->utc()->format('Y-m-d H:i:s'),
    ]);

    // ACT — período de hoje até hoje para a última; de 7 dias para as outras
    $hoje = agoraNaClinica()->toDateString();
    $deHoje = $this->getJson("/api/relatorios/tratamentos-sem-lancamento?de={$hoje}&ate={$hoje}")->assertOk();
    $daSemana = $this->getJson('/api/relatorios/tratamentos-sem-lancamento?'.periodoDosSemLancamento())->assertOk();

    // ASSERT — em ordem de abertura
    expect(collect($deHoje->json('linhas'))->pluck('paciente')->all())->toBe(['Criança Fictícia Sem Data'])
        ->and($deHoje->json('linhas.0.abertura'))->toBe($hoje)
        ->and(collect($daSemana->json('linhas'))->pluck('paciente')->all())->toBe(['Criança Fictícia Dentro', 'Criança Fictícia Sem Data']);
});

it('deve escopar pelo eixo clínico: o vinculado vê só os seus e o sem vínculo vê nada', function () {
    // ARRANGE
    admin();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $colega = Profissional::factory()->create(['nome' => 'Colega Fictício']);
    pacoteSemLancamento(['profissional_id' => $ana->id]);
    pacoteSemLancamento(['profissional_id' => $colega->id]);
    $escopado = usuarioEscopadoEm($ana, ['tratamentos.ver', 'lancamentos.ver']);
    $semVinculo = usuarioCom(['tratamentos.ver', 'lancamentos.ver'], 'Sem vínculo');
    $consulta = '/api/relatorios/tratamentos-sem-lancamento?'.periodoDosSemLancamento();

    // ACT
    $doEscopado = $this->actingAs($escopado)->getJson($consulta);
    trocarDeUsuario();
    $doSemVinculo = $this->actingAs($semVinculo)->getJson($consulta);

    // ASSERT
    $doEscopado->assertOk()->assertJsonPath('totais.quantidade', 1);
    expect(collect($doEscopado->json('linhas'))->pluck('profissional')->all())->toBe(['Ana Fictícia']);
    $doSemVinculo->assertOk()->assertJsonPath('totais.quantidade', 0)->assertJsonPath('contagem', 0);
});

it('deve tirar o total previsto de quem não vê o caixa, e deixar o valor de cada pacote', function () {
    // ARRANGE — change `financeiro-sem-faturamento-total`: a recepção cobra pelo valor da linha
    admin();
    $operadora = Convenio::create(['nome' => 'Operadora Fictícia']);
    $servico = servicoDoSemLancamento($operadora->id, 'Sessão Fictícia', '120.00');
    pacoteSemLancamento(['servico_id' => $servico->id, 'convenio_id' => $operadora->id, 'sessoes_total' => 10]);
    $semCaixa = usuarioCom(['tratamentos.ver', 'lancamentos.ver', 'agenda.ver_todos'], 'Sem o caixa');
    $comCaixa = usuarioCom(['tratamentos.ver', 'lancamentos.ver', 'agenda.ver_todos', 'fluxo_caixa.ver'], 'Com o caixa');

    // ACT
    $daRecepcao = $this->actingAs($semCaixa)->getJson('/api/relatorios/tratamentos-sem-lancamento?'.periodoDosSemLancamento());
    trocarDeUsuario();
    $daGestora = $this->actingAs($comCaixa)->getJson('/api/relatorios/tratamentos-sem-lancamento?'.periodoDosSemLancamento());

    // ASSERT
    $daRecepcao->assertOk()
        ->assertJsonPath('linhas.0.valor_previsto', '1200.00')
        ->assertJsonPath('totais', ['quantidade' => 1]);
    $daGestora->assertOk()->assertJsonPath('totais', ['quantidade' => 1, 'valor_previsto' => '1200.00']);
});
