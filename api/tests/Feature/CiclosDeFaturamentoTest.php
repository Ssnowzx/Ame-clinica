<?php

use App\Models\Atendimento;
use App\Models\Auditoria;
use App\Models\Convenio;
use App\Models\FechamentoCiclo;
use App\Models\LancamentoCaixa;
use App\Support\Ciclos\CalendarioDoCiclo;
use App\Support\Rbac\PermissaoCatalogo;

/**
 * Fechar e reabrir o ciclo de faturamento (tasks 2.1 e 2.2 · spec ciclos-de-faturamento).
 *
 * Três testes carregam peso desproporcional aqui:
 * - **SEC-FC-03** — fecha → reabre → fecha o MESMO período, sem colisão de unique. Com o
 *   índice simples que o desenho original previa, o segundo fechamento morria em 1062: a
 *   unique matava exatamente o fluxo que o D2 promete.
 * - **SEC-FC-01** — quem tem só `ciclos.fechar` recebe 403 ao reabrir MESMO com id
 *   inexistente. Se o 404 viesse antes, o 403 já teria virado oráculo de existência.
 * - **SEC-FC-02/04** — a reabertura MARCA (nunca apaga) e comita o evento `reabriu_ciclo`
 *   junto: destravar produção sem a prova de quem destravou é destravar impunemente.
 */
function convenioUnimedFicticio(): Convenio
{
    return Convenio::create([
        'nome' => 'Operadora Fictícia '.fake()->unique()->word(),
        'ciclo_tipo_corte' => 'dia_fixo',
        'ciclo_dia_corte' => 15,
    ]);
}

it('deve fechar um período e listá-lo com quem fechou e quando', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $convenio = convenioUnimedFicticio();

    // ACT
    $fechar = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/ciclos", [
        'periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-15',
    ]);

    // ASSERT — o shape do contrato
    $fechar->assertCreated()
        ->assertJsonPath('periodo_inicio', '2026-06-16')
        ->assertJsonPath('periodo_fim', '2026-07-15')
        ->assertJsonPath('fechado_por.id', $adminDaClinica->id)
        ->assertJsonPath('fechado_por.nome', $adminDaClinica->nome)
        ->assertJsonPath('reaberto_por', null)
        ->assertJsonPath('reaberto_em', null)
        ->assertJsonPath('aberto', true);
    expect($fechar->json('fechado_em'))->not->toBeNull();

    $listar = $this->actingAs($adminDaClinica)->getJson("/api/convenios/{$convenio->id}/ciclos");
    $listar->assertOk()->assertJsonPath('0.id', $fechar->json('id'))->assertJsonPath('0.aberto', true);
});

it('deve recusar fechamento de convênio sem calendário configurado', function () {
    // ARRANGE — fail-safe do D1: sem calendário não há período a derivar
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Operadora Fictícia Sem Ciclo']);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/ciclos", [
        'periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-15',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('convenio_id');
    expect(FechamentoCiclo::count())->toBe(0);
});

it('deve recusar período que não corresponde a uma janela do calendário', function () {
    // ARRANGE — fechar um intervalo arbitrário congelaria produção fora de qualquer
    // ciclo que a operadora reconhece
    $adminDaClinica = admin();
    $convenio = convenioUnimedFicticio(); // dia_fixo 15 ⇒ 16→15

    // ACT — o mês calendário NÃO é janela deste convênio
    $mes = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/ciclos", [
        'periodo_inicio' => '2026-07-01', 'periodo_fim' => '2026-07-31',
    ]);
    // ...nem um fim deslocado em um dia
    $deslocado = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/ciclos", [
        'periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-16',
    ]);

    // ASSERT
    $mes->assertUnprocessable()->assertJsonValidationErrors('periodo_inicio');
    $deslocado->assertUnprocessable()->assertJsonValidationErrors('periodo_inicio');
    expect(FechamentoCiclo::count())->toBe(0);
});

it('deve recusar período que se sobrepõe a outro ciclo aberto', function () {
    // ARRANGE — a interseção PARCIAL nenhum índice pega: é guarda de boundary
    $adminDaClinica = admin();
    $convenio = Convenio::create([
        'nome' => 'Operadora Fictícia Mensal', 'ciclo_tipo_corte' => 'ultimo_dia',
    ]);
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/ciclos", [
        'periodo_inicio' => '2026-07-01', 'periodo_fim' => '2026-07-31',
    ])->assertCreated();

    // ACT — o MESMO período (que o índice pegaria)...
    $mesmo = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/ciclos", [
        'periodo_inicio' => '2026-07-01', 'periodo_fim' => '2026-07-31',
    ]);

    // ASSERT
    $mesmo->assertUnprocessable()->assertJsonValidationErrors('periodo_inicio');
    expect(FechamentoCiclo::count())->toBe(1);

    // ...e um período ADJACENTE, que não intersecta, segue livre
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/ciclos", [
        'periodo_inicio' => '2026-08-01', 'periodo_fim' => '2026-08-31',
    ])->assertCreated();
    expect(FechamentoCiclo::count())->toBe(2);
});

it('deve isolar os ciclos por convênio', function () {
    // ARRANGE — o mesmo período em convênios diferentes não se sobrepõe
    $adminDaClinica = admin();
    $unimed = convenioUnimedFicticio();
    $outra = convenioUnimedFicticio();

    // ACT
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$unimed->id}/ciclos", [
        'periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-15',
    ])->assertCreated();
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$outra->id}/ciclos", [
        'periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-15',
    ])->assertCreated();

    // ASSERT
    expect(FechamentoCiclo::count())->toBe(2);
});

it('deve derivar o próximo período fechável do calendário', function () {
    // ARRANGE — a afordância da tela: uma janela, nunca a lista de fechamentos
    $adminDaClinica = admin();
    $convenio = convenioUnimedFicticio();
    $esperado = CalendarioDoCiclo::janelaAnterior('dia_fixo', 15, agoraNaClinica());

    // ACT
    $proximo = $this->actingAs($adminDaClinica)->getJson("/api/convenios/{$convenio->id}/ciclos/proximo");

    // ASSERT — a última janela INTEIRAMENTE decorrida (a que contém hoje ainda corre).
    // `motivo` NULO é parte do contrato: é ele que diz "há período", sem a tela precisar
    // adivinhar pelo formato do corpo.
    $proximo->assertOk()
        ->assertJsonPath('periodo.periodo_inicio', $esperado['periodo_inicio'])
        ->assertJsonPath('periodo.periodo_fim', $esperado['periodo_fim'])
        ->assertJsonPath('motivo', null);
});

it('deve devolver o motivo `sem_calendario` quando o convênio não tem dia de corte', function () {
    // ARRANGE — o estado que PEDE ação: alguém precisa configurar o calendário do convênio
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Operadora Fictícia Sem Ciclo']);

    // ACT
    $proximo = $this->actingAs($adminDaClinica)->getJson("/api/convenios/{$convenio->id}/ciclos/proximo");

    // ASSERT
    $proximo->assertOk()
        ->assertJsonPath('periodo', null)
        ->assertJsonPath('motivo', 'sem_calendario');
});

it('deve devolver o motivo `ja_fechado` quando a janela sugerida já foi fechada', function () {
    // ARRANGE — o estado que NÃO pede ação nenhuma, e que a versão anterior deste endpoint
    // confundia com o de cima: os dois viravam `null`, e a tela dizia "configure o corte"
    // para um convênio configurado, com a linha recém-fechada visível logo abaixo. É a
    // contradição que este par de testes existe para impedir de voltar.
    $adminDaClinica = admin();
    $convenio = convenioUnimedFicticio();
    $janela = CalendarioDoCiclo::janelaAnterior('dia_fixo', 15, agoraNaClinica());
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/ciclos", $janela)
        ->assertCreated();

    // ACT
    $proximo = $this->actingAs($adminDaClinica)->getJson("/api/convenios/{$convenio->id}/ciclos/proximo");

    // ASSERT — sem período a sugerir, mas o convênio está configurado
    $proximo->assertOk()
        ->assertJsonPath('periodo', null)
        ->assertJsonPath('motivo', 'ja_fechado');
});

it('deve reabrir marcando a linha e registrando o evento na trilha', function () {
    // ARRANGE — SEC-FC-02 (append-only) + SEC-FC-04 (evento na MESMA transação)
    $adminDaClinica = admin();
    $convenio = convenioUnimedFicticio();
    $fechamento = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/ciclos", [
        'periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-15',
    ])->json();

    // ACT
    $reabrir = $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/ciclos/{$fechamento['id']}/reabertura", [
            'motivo' => 'Guia fictícia devolvida pela operadora para correção.',
        ]);

    // ASSERT — a linha foi MARCADA, não apagada
    $reabrir->assertOk()
        ->assertJsonPath('id', $fechamento['id'])
        ->assertJsonPath('aberto', false)
        ->assertJsonPath('reaberto_por.id', $adminDaClinica->id)
        ->assertJsonPath('reaberto_por.nome', $adminDaClinica->nome);
    expect($reabrir->json('reaberto_em'))->not->toBeNull();
    expect(FechamentoCiclo::count())->toBe(1);

    // ...e a trilha reconstrói QUEM destravou O QUÊ e POR QUÊ
    $evento = Auditoria::where('acao', 'reabriu_ciclo')->firstOrFail();
    expect($evento->entidade)->toBe('fechamentos_ciclo');
    expect($evento->entidade_id)->toBe($fechamento['id']);
    expect($evento->usuario_id)->toBe($adminDaClinica->id);
    expect($evento->diff_json['depois'])->toBe([
        'fechamento_id' => $fechamento['id'],
        'convenio_id' => $convenio->id,
        'periodo_inicio' => '2026-06-16',
        'periodo_fim' => '2026-07-15',
        'motivo' => 'Guia fictícia devolvida pela operadora para correção.',
    ]);
});

it('deve exigir motivo na reabertura', function () {
    // ARRANGE — SEC-FC-06
    $adminDaClinica = admin();
    $convenio = convenioUnimedFicticio();
    $fechamento = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/ciclos", [
        'periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-15',
    ])->json();

    // ACT — sem motivo, e com motivo acima do teto
    $sem = $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/ciclos/{$fechamento['id']}/reabertura", []);
    $longo = $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/ciclos/{$fechamento['id']}/reabertura", [
            'motivo' => str_repeat('a', 501),
        ]);

    // ASSERT — o ciclo permanece fechado nos dois casos
    $sem->assertUnprocessable()->assertJsonValidationErrors('motivo');
    $longo->assertUnprocessable()->assertJsonValidationErrors('motivo');
    expect(FechamentoCiclo::firstOrFail()->reaberto_em)->toBeNull();
});

it('deve recusar reabrir um ciclo que já foi reaberto', function () {
    // ARRANGE — SEC-FC-02: reabrir não é idempotente-por-acidente; a segunda passada é
    // o concorrente que perdeu a corrida
    $adminDaClinica = admin();
    $convenio = convenioUnimedFicticio();
    $fechamento = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/ciclos", [
        'periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-15',
    ])->json();
    $rota = "/api/convenios/{$convenio->id}/ciclos/{$fechamento['id']}/reabertura";
    $this->actingAs($adminDaClinica)->postJson($rota, ['motivo' => 'Primeiro motivo fictício.'])->assertOk();

    // ACT
    $segunda = $this->actingAs($adminDaClinica)->postJson($rota, ['motivo' => 'Segundo motivo fictício.']);

    // ASSERT — e o motivo original NÃO foi sobrescrito
    $segunda->assertUnprocessable()->assertJsonValidationErrors('fechamento_id');
    expect(FechamentoCiclo::firstOrFail()->motivo_reabertura)->toBe('Primeiro motivo fictício.');
    expect(Auditoria::where('acao', 'reabriu_ciclo')->count())->toBe(1);
});

it('deve permitir fechar de novo o MESMO período depois de reaberto', function () {
    // ARRANGE — SEC-FC-03, o teste bloqueante: com unique simples em
    // (convênio, início) este segundo fechamento morria em 1062
    $adminDaClinica = admin();
    $convenio = convenioUnimedFicticio();
    $periodo = ['periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-15'];

    $primeiro = $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/ciclos", $periodo)->json();
    $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/ciclos/{$primeiro['id']}/reabertura", [
            'motivo' => 'Correção fictícia da produção.',
        ])->assertOk();

    // ACT — fecha o MESMO período outra vez
    $segundo = $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/ciclos", $periodo);

    // ASSERT — linha NOVA (append-only), e o histórico da primeira sobrevive
    $segundo->assertCreated()->assertJsonPath('aberto', true);
    expect($segundo->json('id'))->not->toBe($primeiro['id']);
    expect(FechamentoCiclo::count())->toBe(2);
    expect(FechamentoCiclo::find($primeiro['id'])->motivo_reabertura)
        ->toBe('Correção fictícia da produção.');

    // ...e um TERCEIRO fechamento do mesmo período, agora com um aberto, é recusado
    $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/ciclos", $periodo)
        ->assertUnprocessable();
});

it('deve nascer com ciclos.fechar e ciclos.reabrir no nível Administrador', function () {
    // ARRANGE + ACT — spec rbac: o Administrador nasce com o catálogo completo
    $adminDaClinica = admin();

    // ASSERT
    expect($adminDaClinica->can('ciclos.fechar'))->toBeTrue();
    expect($adminDaClinica->can('ciclos.reabrir'))->toBeTrue();
    expect(PermissaoCatalogo::PERMISSOES)->toContain('ciclos.fechar', 'ciclos.reabrir');
});

it('deve recusar fechar e listar sem a permissão ciclos.fechar', function () {
    // ARRANGE
    $adminDaClinica = admin();
    // quem cuida do cadastro de convênios NÃO fecha ciclo por tabela. Criado ANTES de
    // qualquer request: um `actingAs` sobre rota de sanctum troca o guard default do
    // processo, e o `givePermissionTo` seguinte procuraria a permissão no guard errado.
    $cadastrista = usuarioCom(['convenios.ver', 'convenios.editar'], 'Cadastro Fictício');
    $convenio = convenioUnimedFicticio();

    // ACT + ASSERT
    $this->actingAs($cadastrista)->getJson("/api/convenios/{$convenio->id}/ciclos")->assertForbidden();
    $this->actingAs($cadastrista)->postJson("/api/convenios/{$convenio->id}/ciclos", [
        'periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-15',
    ])->assertForbidden();
    expect(FechamentoCiclo::count())->toBe(0);
});

it('deve recusar a reabertura a quem tem só ciclos.fechar — mesmo com período inexistente', function () {
    // ARRANGE — SEC-FC-01: o gate vive no authorize() do FormRequest, e é isso que faz o
    // 403 vencer o 404 e o 422. Se o findOrFail viesse antes, o faturista descobriria
    // pelo par 403/404 quais ciclos existem — e a 422 nomearia `motivo` a quem nem pode
    // reabrir, vazando o mecanismo.
    $adminDaClinica = admin();
    // criado ANTES do primeiro request (ver nota no teste do cadastrista)
    $faturista = usuarioCom(['ciclos.fechar'], 'Faturamento Fictício');
    $convenio = convenioUnimedFicticio();
    $fechamento = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/ciclos", [
        'periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-15',
    ])->json();

    // ACT — ciclo EXISTENTE, ciclo INEXISTENTE e payload INVÁLIDO (sem motivo)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $existente = $this->actingAs($faturista)
        ->postJson("/api/convenios/{$convenio->id}/ciclos/{$fechamento['id']}/reabertura", [
            'motivo' => 'Motivo fictício.',
        ]);
    $inexistente = $this->actingAs($faturista)
        ->postJson("/api/convenios/{$convenio->id}/ciclos/999999/reabertura", [
            'motivo' => 'Motivo fictício.',
        ]);
    $semMotivo = $this->actingAs($faturista)
        ->postJson("/api/convenios/{$convenio->id}/ciclos/{$fechamento['id']}/reabertura", []);

    // ASSERT — 403 nos TRÊS: nem existência, nem forma do payload vazam
    $existente->assertForbidden();
    $inexistente->assertForbidden();
    $semMotivo->assertForbidden();
    semVazamento($semMotivo->json(), 'motivo');

    // ...e o ciclo permanece fechado
    expect(FechamentoCiclo::firstOrFail()->reaberto_em)->toBeNull();
    expect(Auditoria::where('acao', 'reabriu_ciclo')->count())->toBe(0);
});

it('deve travar o convênio e gravar o fechamento na MESMA transação', function () {
    // ARRANGE — o epoch-pin (gatilho TEST-LOCK-EPOCH). O teste de concorrência prova que
    // a linha do convênio BLOQUEIA; este prova que ela é travada no lugar certo — antes
    // da checagem de não-sobreposição e na MESMA transação da gravação.
    //
    // Sem o pin, travar numa `DB::transaction` curta e gravar numa segunda transação
    // sequencial passaria: o lock se solta no primeiro commit e a janela TOCTOU reabre
    // entre os dois commits, com tudo verde.
    $adminDaClinica = admin();
    $convenio = convenioUnimedFicticio();
    $capturado = capturarConsultasComEpoch();

    // ACT
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/ciclos", [
        'periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-15',
    ])->assertCreated();

    // ASSERT — as três consultas (lock do convênio, leitura dos fechamentos abertos,
    // insert) no mesmo epoch. `epochDaConsulta` LANÇA se alguma não foi emitida.
    $consultas = $capturado();
    $lock = epochDaConsulta($consultas, ['select', 'from `convenios`', 'for update']);
    $checagem = epochDaConsulta($consultas, ['from `fechamentos_ciclo`', 'reaberto_em` is null']);
    $gravacao = epochDaConsulta($consultas, ['insert into `fechamentos_ciclo`']);

    expect($checagem)->toBe($lock, 'A não-sobreposição foi verificada FORA da transação do lock.');
    expect($gravacao)->toBe($lock, 'O fechamento foi gravado FORA da transação do lock.');
});

it('deve manter a competência em claro na trilha das entidades congeladas', function () {
    // ARRANGE — SEC-FC-05: sem a competência EM CLARO no diff, a reabertura é impune —
    // não dá para reconstruir "o que foi editado depois que destravaram". Esta guarda é
    // de IDIOMA: ela reprova a próxima change que puser esses campos no $auditExclude.
    $atendimento = new Atendimento;
    $lancamento = new LancamentoCaixa;

    // ACT
    $excluidosDoAtendimento = $atendimento->camposAuditaveisExcluidos();
    $excluidosDoLancamento = $lancamento->camposAuditaveisExcluidos();

    // ASSERT
    expect($excluidosDoAtendimento)->not->toContain('finalizado_em');
    expect($excluidosDoLancamento)->not->toContain('competencia');
});
