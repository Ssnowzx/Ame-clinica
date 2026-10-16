<?php

use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Support\Clinica\ResumoDoPaciente;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Facades\DB;

/** As 4 pontas obrigatórias de um tratamento, da clínica. */
/**
 * Um pacote com o SALDO que o cenário quiser.
 *
 * `sessoes_realizadas` fica fora do mass assignment de propósito (o consumo pertence ao
 * serviço de sessão), então passá-lo pelo `create` seria um no-op SILENCIOSO — o cenário
 * montaria saldo 10 achando que montou 2.
 */
function pacoteComRealizadas(Paciente $paciente, int $realizadas, array $extra = []): Tratamento
{
    $tratamento = pacoteDe($paciente, $extra);
    $tratamento->forceFill(['sessoes_realizadas' => $realizadas])->save();

    return $tratamento;
}

function pacoteDe(Paciente $paciente, array $extra = []): Tratamento
{
    return Tratamento::create([
        'paciente_id' => $paciente->id,
        'convenio_id' => Convenio::create(['nome' => 'Convênio '.fake()->unique()->word()])->id,
        'especialidade_id' => Especialidade::factory()->create()->id,
        'profissional_id' => Profissional::factory()->create()->id,
        'sessoes_total' => 10,
        ...$extra,
    ]);
}

it('deve filtrar os vencidos no SERVIDOR, pelo fuso da clínica', function () {
    // ARRANGE: filtrar depois de paginar daria resposta errada (a página é uma amostra),
    // e recalcular `vencido` no navegador usaria o fuso do CLIENTE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $vencido = pacoteDe($paciente, ['data_inicio' => now()->subDays(400)->toDateString(), 'validade_dias' => 30]);
    $noPrazo = pacoteDe($paciente, ['data_inicio' => now()->toDateString(), 'validade_dias' => 180]);
    $semAncora = pacoteDe($paciente); // sem data_inicio: NUNCA vence

    // ACT
    $vencidos = $this->actingAs($adminDaClinica)->getJson('/api/tratamentos?vencido=1');
    $noPrazoOuSemAncora = $this->actingAs($adminDaClinica)->getJson('/api/tratamentos?vencido=0');

    // ASSERT
    $vencidos->assertOk();
    expect(collect($vencidos->json('data'))->pluck('id')->all())->toBe([$vencido->id]);

    // o ramo negativo precisa cobrir os NULL — pacote sem âncora não vence
    $ids = collect($noPrazoOuSemAncora->json('data'))->pluck('id')->all();
    expect($ids)->toContain($noPrazo->id)->toContain($semAncora->id)
        ->and($ids)->not->toContain($vencido->id);
});

it('deve filtrar quem está acabando pelo saldo máximo', function () {
    // ARRANGE: é a pergunta que a clínica faz — quem está prestes a ficar sem sessões
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $acabando = pacoteDe($paciente);
    $acabando->forceFill(['sessoes_realizadas' => 9])->save(); // saldo 1
    $comFolga = pacoteDe($paciente);
    $comFolga->forceFill(['sessoes_realizadas' => 2])->save(); // saldo 8

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/tratamentos?saldo_max=2');

    // ASSERT
    $resposta->assertOk();
    expect(collect($resposta->json('data'))->pluck('id')->all())->toBe([$acabando->id]);
});

it('deve devolver o NOME do paciente e mais nada dele', function () {
    // ARRANGE: a lista precisa dizer de quem é o pacote. Exigir `pacientes.ver` para isso
    // entregaria o cadastro inteiro de um MENOR (nascimento, necessidade — dado de saúde)
    // a quem só precisa do nome. Nada além do nome pode escapar por aqui.
    //
    // Este teste prende o RESULTADO — que é o produto de DUAS camadas (a consulta que
    // limita colunas e o serializador que monta campo a campo). Justamente por ser o
    // produto, ele fica verde com uma delas caída: a outra ainda esconde o cadastro.
    // Defesa em profundidade que ninguém vê erodir vira defesa simples (SEC-TR-18), e é
    // por isso que os DOIS testes abaixo prendem cada camada na SUA fronteira.
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create(['nome' => 'Paciente Fictício da Lista']);
    pacoteDe($paciente);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/tratamentos');

    // ASSERT
    $resposta->assertOk()
        ->assertJsonPath('data.0.paciente.nome', 'Paciente Fictício da Lista')
        ->assertJsonMissingPath('data.0.paciente.nascimento')
        ->assertJsonMissingPath('data.0.paciente.necessidade')
        ->assertJsonMissingPath('data.0.paciente.cpf')
        // matrícula e guia são detail-only (identificadores do menor no convênio)
        ->assertJsonMissingPath('data.0.matricula')
        ->assertJsonMissingPath('data.0.guia');
});

it('deve carregar do banco só o nome do menor — nunca o cadastro inteiro', function () {
    // ARRANGE — camada 1 (BANCO → app), presa na SUA fronteira: o SQL.
    // Com `select *`, nascimento/necessidade/cpf de uma criança entram na memória do
    // processo — e de lá escapam para um log, um dump, o payload de uma exceção. O
    // serializador NÃO defende isto: ele defende a fronteira HTTP, que é a outra.
    $adminDaClinica = admin();
    pacoteDe(Paciente::factory()->create());

    $sqls = [];
    DB::listen(function ($consulta) use (&$sqls) {
        $sqls[] = $consulta->sql;
    }); // escutar DEPOIS do arrange: as inserções não interessam

    // ACT
    $this->actingAs($adminDaClinica)->getJson('/api/tratamentos')->assertOk();

    // ASSERT: a consulta de `pacientes` NOMEIA as três colunas.
    // A asserção que carrega o peso é a POSITIVA: um `not->toContain('cpf')` seria
    // inútil, porque `select *` também não contém a string `cpf`.
    $doPaciente = array_values(array_filter($sqls, fn ($sql) => str_contains($sql, 'from `pacientes`')));
    expect($doPaciente)->not->toBeEmpty();
    foreach ($doPaciente as $sql) {
        expect($sql)->toContain('select `id`, `nome`, `nome_social` from `pacientes`');
    }
});

it('deve emitir só o nome do menor mesmo com o cadastro INTEIRO em memória', function () {
    // ARRANGE — camada 2 (app → HTTP), presa com a camada 1 NEUTRALIZADA de propósito:
    // o paciente vem COMPLETO do banco. Se o serializador for a única defesa que
    // sobrou, ele tem que segurar sozinho — é essa a promessa da defesa em profundidade,
    // e ela nunca tinha sido exercitada (SEC-TR-18).
    admin();
    $completo = Paciente::findOrFail(Paciente::factory()->create()->id); // select *
    expect($completo->getAttributes())->toHaveKey('nascimento'); // a camada 1 está mesmo fora

    // ACT
    $resumo = ResumoDoPaciente::de($completo);

    // ASSERT: exatamente três chaves. Nem nascimento, nem necessidade, nem cpf.
    expect(array_keys($resumo))->toBe(['id', 'nome', 'nome_social']);
});

it('deve ler o tratamento SOB LOCK ao editar — sem isso o piso escapa', function () {
    // ARRANGE: o piso é validado contra `sessoes_realizadas`, que a reconciliação de
    // consumo (que TAMBÉM trava a linha) pode incrementar entre a validação e a gravação.
    // Nada além deste teste impede alguém de "simplificar" o lock e trazer de volta o
    // saldo negativo persistido (gate CR-TR-05).
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $tratamento = pacoteDe($paciente);

    $consultas = [];
    DB::listen(function ($consulta) use (&$consultas) {
        $consultas[] = $consulta->sql;
    });

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$tratamento->id}", [
        'paciente_id' => $tratamento->paciente_id,
        'convenio_id' => $tratamento->convenio_id,
        'especialidade_id' => $tratamento->especialidade_id,
        'profissional_id' => $tratamento->profissional_id,
        'sessoes_total' => 12,
    ])->assertOk();

    // ASSERT
    $comLock = array_filter(
        $consultas,
        fn (string $sql) => str_contains($sql, 'tratamentos') && str_contains($sql, 'for update'),
    );
    expect($comLock)->not->toBeEmpty();
});

it('deve recortar a lista por profissional_id — a fatia da ficha do profissional', function () {
    // ARRANGE — pacotes de A e de B; o recorte pede só os de A
    $this->actingAs(admin());
    $paciente = Paciente::factory()->create();
    $profissionalA = Profissional::factory()->create();
    $profissionalB = Profissional::factory()->create();
    $deA = pacoteDe($paciente, ['profissional_id' => $profissionalA->id]);
    pacoteDe($paciente, ['profissional_id' => $profissionalB->id]);

    // ACT
    $lista = $this->getJson("/api/tratamentos?profissional_id={$profissionalA->id}");

    // ASSERT — só os do profissional pedido; a whitelist do menor não muda
    $lista->assertOk();
    expect(collect($lista->json('data'))->pluck('id')->all())->toBe([$deA->id])
        ->and(collect($lista->json('data'))->pluck('profissional_id')->unique()->all())
        ->toBe([$profissionalA->id]);
});

/**
 * O recorte "Acabando" pelo limiar da CLÍNICA (change alerta-de-fim-de-pacote, §13).
 *
 * A tela mandava `saldo_max=2` com uma constante própria do front — um número que podia
 * divergir do que o selo e o contador usavam. Agora ela só diz o que quer.
 */
it('deve recortar os que estão acabando pelo limiar da clínica, não por um número do cliente', function () {
    // ARRANGE — um pacote no fim e um longe do fim
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $noFim = pacoteComRealizadas($paciente, 8); // saldo 2
    $longe = pacoteComRealizadas($paciente, 3); // saldo 7

    // ACT
    $lista = $this->actingAs($adminDaClinica)->getJson('/api/tratamentos?acabando=1');

    // ASSERT — só o que está dentro do limiar
    $lista->assertOk();
    $ids = collect($lista->json('data'))->pluck('id')->all();
    expect($ids)->toContain($noFim->id)
        ->and($ids)->not->toContain($longe->id);

    // ACT — a clínica alarga o alerta, SEM deploy
    app(ConfiguracaoService::class)
        ->set('tratamentos.saldo_alerta_sessoes', 7);

    // ASSERT — o MESMO pedido, outro recorte
    $depois = $this->actingAs($adminDaClinica)->getJson('/api/tratamentos?acabando=1');
    expect(collect($depois->json('data'))->pluck('id')->all())->toContain($longe->id);
});

it('deve mandar o veredito do realce em cada linha da lista', function () {
    // ARRANGE — o selo da tela parava de refazer a conta; sem este cenário, servir 'nenhum'
    // fixo passaria com a suíte verde e a lista ficaria sem selo nenhum
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $noFim = pacoteComRealizadas($paciente, 9);
    $zerado = pacoteComRealizadas($paciente, 10);

    // ACT
    $lista = $this->actingAs($adminDaClinica)->getJson('/api/tratamentos');

    // ASSERT
    $porId = collect($lista->json('data'))->keyBy('id');
    expect($porId[$noFim->id]['realce'])->toBe('acabando')
        ->and($porId[$zerado->id]['realce'])->toBe('sem-saldo');
});

it('deve escopar a LISTA pelo vínculo do profissional nos três estados do D11', function () {
    /*
     * ARRANGE — achado SEC-FP-03 do gate: o contador "Pacotes acabando" é escopado, e o rodapé
     * dele levava a esta lista, que era PLANA. O escopo sumia no caminho: o profissional via a
     * carteira inteira da clínica — nome de menor + especialidade (vínculo art. 11) de todas
     * as crianças, 50 por página.
     */
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $meu = Profissional::factory()->create();
    $doColega = Profissional::factory()->create();
    $meuPacote = pacoteDe($paciente, ['profissional_id' => $meu->id]);
    $doColegaPacote = pacoteDe($paciente, ['profissional_id' => $doColega->id]);

    // os dois papéis nascem ANTES de qualquer `actingAs`: o Spatie resolve o guard do papel
    // pelo usuário autenticado, e criá-los com sessão de sanctum aberta pede a permissão no
    // guard errado
    $escopado = usuarioCom(['tratamentos.ver'], 'Prof. dos pacotes');
    $escopado->update(['profissional_id' => $meu->id]);
    $semVinculo = usuarioCom(['tratamentos.ver'], 'Sem vínculo');

    // trocar de usuário no mesmo teste exige soltar o guard do sanctum (padrão da casa)
    $listaDe = function (Usuario $usuario): array {
        $this->flushSession();
        $this->app['auth']->forgetGuards();

        return collect(
            $this->actingAs($usuario)->getJson('/api/tratamentos')->json('data')
        )->pluck('id')->all();
    };

    // ACT + ASSERT — o admin é PLANO (tem as flags) e vê os dois
    expect($listaDe($adminDaClinica))->toContain($meuPacote->id)->toContain($doColegaPacote->id);

    // ACT + ASSERT — o VINCULADO vê só os seus
    expect($listaDe($escopado))->toContain($meuPacote->id)->not->toContain($doColegaPacote->id);

    // ACT + ASSERT — e SEM vínculo nenhum: fail-closed, nunca "tudo"
    expect($listaDe($semVinculo))->toBe([]);
});
