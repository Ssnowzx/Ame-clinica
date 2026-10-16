<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Auditoria;
use App\Models\Paciente;
use App\Models\Tratamento;
use Illuminate\Support\Str;

/** O PUT do agendamento exige `inicio` e `profissional_id`; o resto é parcial. */
function putDoAgendamento(Agendamento $agendamento, array $extra = []): array
{
    return [
        'inicio' => $agendamento->inicio->format('Y-m-d H:i'),
        'profissional_id' => $agendamento->profissional_id,
        ...$extra,
    ];
}

/**
 * O agendamento REAL da clínica: com pacote de sessões vinculado. A factory nua não tem
 * tratamento — e testar a troca de paciente sem ele é testar o caso que não acontece.
 */
function agendamentoComPacote(): Agendamento
{
    $agendamento = Agendamento::factory()->create();
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $agendamento->paciente_id,
        'especialidade_id' => $agendamento->especialidade_id,
        'profissional_id' => $agendamento->profissional_id,
    ]);
    $agendamento->forceFill(['tratamento_id' => $tratamento->id])->save();

    return $agendamento->refresh();
}

/**
 * PAC-REP — o gatilho mais grave que este produto tinha em aberto.
 *
 * O atendimento é 1:1 com o agendamento, e a evolução é 1:1 com o atendimento. Trocar o
 * `paciente_id` de um agendamento JÁ ATENDIDO re-parenta a observação clínica de uma
 * criança para outra — dado de saúde de MENOR, cifrado em repouso e cujo VALOR a auditoria
 * mascara.
 *
 * E o estado resultante NÃO TEM VOLTA: trocar o paciente de novo é recusado (existe
 * atendimento), a evolução não tem rota de exclusão, o atendimento não se exclui (tem
 * evolução) e o agendamento não se exclui (tem atendimento). Sobra SQL manual em produção.
 *
 * Por isso a recusa NÃO é "aceito o risco": ela é a change inteira.
 */
it('deve recusar trocar o paciente de um agendamento que já tem atendimento', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $agendamento = Agendamento::factory()->create();
    $donoOriginal = $agendamento->paciente_id;
    $outraCrianca = Paciente::factory()->create();

    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [])
        ->assertCreated();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$agendamento->id}",
        putDoAgendamento($agendamento, ['paciente_id' => $outraCrianca->id])
    );

    // ASSERT — 422 na chave do campo, e a criança continua sendo a dela
    $resposta->assertUnprocessable()->assertJsonValidationErrors('paciente_id');
    expect($agendamento->fresh()->paciente_id)->toBe($donoOriginal);
});

/**
 * A outra metade da regra, e a razão de a guarda ser CONDICIONAL e não a imutabilidade:
 * marcar a sessão na criança errada (irmãos, nomes parecidos na busca) é o erro mais banal
 * da recepção. Corrigi-lo não pode custar excluir o agendamento e recriá-lo do zero —
 * horário, profissional, sala, tratamento, recorrência.
 */
it('deve permitir corrigir a criança enquanto não há atendimento', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $agendamento = Agendamento::factory()->create();
    $criancaCerta = Paciente::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$agendamento->id}",
        putDoAgendamento($agendamento, ['paciente_id' => $criancaCerta->id])
    );

    // ASSERT
    $resposta->assertOk();
    expect($agendamento->fresh()->paciente_id)->toBe($criancaCerta->id);
});

/**
 * O CAMINHO DA CORREÇÃO, DE PONTA A PONTA — e ele estava QUEBRADO.
 *
 * O agendamento normal tem tratamento, e o pacote é da criança ERRADA. Corrigir a criança
 * exige DESVINCULAR o pacote junto — é o que a tela faz: manda `tratamento_id: null`.
 *
 * `validarDominio` lia esse campo com `??`, que dispara no `null`: a chave presente-com-null
 * caía no fallback do valor ATUAL, e a validação julgava o tratamento VELHO contra a criança
 * NOVA — recusando com "O tratamento pertence a outro paciente".
 *
 * Ou seja: a correção que o produto PERMITE era impossível de fazer sempre que houvesse
 * tratamento — que é o caso normal. A permissão existia na spec e não na prática.
 *
 * Achado DIRIGINDO A APP REAL, com a suíte inteira verde: os testes trocavam o paciente de
 * agendamentos SEM tratamento, e o caminho de verdade nunca era percorrido. *Validar só as
 * recusas não é validar.*
 */
it('deve corrigir a criança desvinculando o pacote dela na mesma edição', function () {
    // ARRANGE — o caso NORMAL: agendamento COM tratamento, e o pacote é da criança errada
    $adminDaClinica = admin();
    $agendamento = agendamentoComPacote();
    expect($agendamento->tratamento_id)->not->toBeNull();
    $criancaCerta = Paciente::factory()->create();

    // ACT — a tela manda `tratamento_id: null` junto com o paciente novo (o pacote é da
    // OUTRA criança, então ele TEM de sair junto — não há como corrigir sem isso)
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$agendamento->id}",
        putDoAgendamento($agendamento, [
            'paciente_id' => $criancaCerta->id,
            'especialidade_id' => $agendamento->especialidade_id,
            'tratamento_id' => null,
        ])
    );

    // ASSERT — a correção acontece: criança nova, sem pacote pendurado
    $resposta->assertOk();
    expect($agendamento->fresh()->paciente_id)->toBe($criancaCerta->id)
        ->and($agendamento->fresh()->tratamento_id)->toBeNull();
});

/**
 * O outro lado da mesma moeda: chave AUSENTE não é chave NULA. Omitir `tratamento_id`
 * PRESERVA o vínculo — senão toda edição de horário desvincularia o pacote em silêncio.
 */
it('deve preservar o tratamento quando a chave nem vem no payload', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $agendamento = agendamentoComPacote();
    $pacoteOriginal = $agendamento->tratamento_id;

    // ACT — mexe só no horário
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$agendamento->id}",
        putDoAgendamento($agendamento, ['inicio' => $agendamento->inicio->copy()->addHour()->format('Y-m-d H:i')])
    )->assertOk();

    // ASSERT
    expect($agendamento->fresh()->tratamento_id)->toBe($pacoteOriginal);
});

/**
 * A guarda impede o caso irreparável. A TRILHA responde à pergunta que a guarda não
 * responde: *quem* trocou esta criança por aquela, *quando*, e *de qual para qual*.
 *
 * A infraestrutura já grava — este teste existe porque controle detectivo que ninguém vê
 * DISPARAR é hipótese (foi assim que uma "defesa em profundidade" desta base se revelou
 * defesa simples). Ele também é o cadeado que impede alguém de pôr `paciente_id` no
 * `auditExclude` do agendamento: identificador não é conteúdo clínico, e mascará-lo cegaria
 * exatamente a pergunta que importa.
 */
it('deve auditar a troca de criança com autor, IP, data e os dois pacientes em claro', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $agendamento = Agendamento::factory()->create();
    $donoOriginal = $agendamento->paciente_id;
    $criancaCerta = Paciente::factory()->create();

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$agendamento->id}",
        putDoAgendamento($agendamento, ['paciente_id' => $criancaCerta->id])
    )->assertOk();

    // ASSERT — a trilha da troca, inteira
    $trilha = Auditoria::where('entidade', 'agendamentos')
        ->where('entidade_id', $agendamento->id)
        ->where('acao', 'atualizou')
        ->latest('id')
        ->firstOrFail();

    expect($trilha->usuario_id)->toBe($adminDaClinica->id)   // QUEM
        ->and($trilha->ip)->not->toBeNull()                 // DE ONDE
        ->and($trilha->criado_em)->not->toBeNull();         // QUANDO

    // DE QUAL CRIANÇA PARA QUAL — em claro, dos dois lados
    expect($trilha->diff_json['antes']['paciente_id'])->toBe($donoOriginal)
        ->and($trilha->diff_json['depois']['paciente_id'])->toBe($criancaCerta->id);
});

/**
 * A TRILHA DA SÉRIE — o caminho em MASSA (gate SEC F-07).
 *
 * Trocar a criança de uma série permitida grava N linhas de auditoria (o `Auditavel::updated`
 * dispara em cada `$futuro->update()`). Ninguém tinha visto isso DISPARAR — e é justamente
 * aqui que um engano se multiplica: uma requisição, vinte prontuários futuros.
 */
it('deve auditar TODAS as ocorrências ao trocar a criança de uma série', function () {
    // ARRANGE — série de três, NENHUMA atendida (a troca é permitida)
    $adminDaClinica = admin();
    $grupo = (string) Str::uuid();
    $base = Agendamento::factory()->create(['recorrencia_grupo_id' => $grupo]);
    $irma = Agendamento::factory()->create([
        'recorrencia_grupo_id' => $grupo,
        'paciente_id' => $base->paciente_id,
        'profissional_id' => $base->profissional_id,
        'especialidade_id' => $base->especialidade_id,
        'inicio' => $base->inicio->copy()->addWeek(),
        'fim' => $base->fim->copy()->addWeek(),
    ]);
    $donoOriginal = $base->paciente_id;
    $criancaCerta = Paciente::factory()->create();

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$base->id}",
        putDoAgendamento($base, ['paciente_id' => $criancaCerta->id, 'aplicar_na_serie' => true])
    )->assertOk();

    // ASSERT — a criança mudou nas DUAS, e as DUAS deixaram rastro completo
    expect($base->fresh()->paciente_id)->toBe($criancaCerta->id)
        ->and($irma->fresh()->paciente_id)->toBe($criancaCerta->id);

    foreach ([$base->id, $irma->id] as $id) {
        $trilha = Auditoria::where('entidade', 'agendamentos')
            ->where('entidade_id', $id)
            ->where('acao', 'atualizou')
            ->latest('id')
            ->firstOrFail();

        expect($trilha->usuario_id)->toBe($adminDaClinica->id)
            ->and($trilha->diff_json['antes']['paciente_id'])->toBe($donoOriginal)
            ->and($trilha->diff_json['depois']['paciente_id'])->toBe($criancaCerta->id);
    }
});

/**
 * A SÉRIE era o pior caminho, e o mais silencioso: o ramo de `aplicar_na_serie` grava as
 * irmãs com `$futuro->update()`, que NÃO passa por `resolverAtributos` nem por
 * `validarDominio` — e "futuro" ali é relativo ao agendamento CLICADO, não a hoje, então
 * ocorrências JÁ ATENDIDAS entram no lote.
 *
 * Uma requisição re-parentaria N prontuários de uma vez. A guarda é TUDO-OU-NADA, como a
 * exclusão de série já é: qualquer linha protegida rejeita a operação inteira.
 */
it('deve recusar a troca de paciente na série quando QUALQUER ocorrência já foi atendida', function () {
    // ARRANGE — três ocorrências do mesmo grupo; a do MEIO já foi atendida
    $adminDaClinica = admin();
    $grupo = (string) Str::uuid();
    $base = Agendamento::factory()->create(['recorrencia_grupo_id' => $grupo]);
    $meio = Agendamento::factory()->create([
        'recorrencia_grupo_id' => $grupo,
        'paciente_id' => $base->paciente_id,
        'profissional_id' => $base->profissional_id,
        'inicio' => $base->inicio->copy()->addWeek(),
        'fim' => $base->fim->copy()->addWeek(),
    ]);
    $fim = Agendamento::factory()->create([
        'recorrencia_grupo_id' => $grupo,
        'paciente_id' => $base->paciente_id,
        'profissional_id' => $base->profissional_id,
        'inicio' => $base->inicio->copy()->addWeeks(2),
        'fim' => $base->fim->copy()->addWeeks(2),
    ]);

    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$meio->id}/atendimento", [])
        ->assertCreated();

    $donoOriginal = $base->paciente_id;
    $outraCrianca = Paciente::factory()->create();

    // ACT — troca o paciente aplicando na série, clicando na PRIMEIRA (que não foi atendida)
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$base->id}",
        putDoAgendamento($base, [
            'paciente_id' => $outraCrianca->id,
            'aplicar_na_serie' => true,
        ])
    );

    // ASSERT — 422 e NENHUMA linha alterada: a irmã atendida trava o lote inteiro
    $resposta->assertUnprocessable()->assertJsonValidationErrors('paciente_id');
    expect($base->fresh()->paciente_id)->toBe($donoOriginal)
        ->and($meio->fresh()->paciente_id)->toBe($donoOriginal)
        ->and($fim->fresh()->paciente_id)->toBe($donoOriginal);
});

/**
 * O ELO QUE FECHA A CORRENTE.
 *
 * `tests/Concorrencia/GuardaClinicaSobLockTest` prova, com duas conexões de verdade, que um
 * X-lock na linha do agendamento BLOQUEIA o nascimento de um atendimento. Só que isso é uma
 * propriedade do BANCO — não prova que a GUARDA pega esse lock. Sem este teste, alguém pode
 * "simplificar" o `lockForUpdate` para fora do serviço e as três provas de concorrência
 * continuariam verdes, com a janela reaberta.
 *
 * Aqui a corrente fecha: a guarda TRAVA (este teste) + a linha travada BLOQUEIA o INSERT
 * (o de concorrência) ⇒ a guarda serializa contra o atendimento que tentaria nascer.
 */
it('deve travar as linhas do agendamento e do atendimento ao aplicar as guardas', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $agendamento = Agendamento::factory()->create();

    // O EPOCH DA TRANSAÇÃO (gatilho TEST-LOCK-EPOCH). Duas tentativas de sinal já falharam
    // aqui, e cada uma ensinou:
    //
    // 1. `DB::transactionLevel() > 0` — o RefreshDatabase já envolve TODO teste numa
    //    transação, então até código em AUTOCOMMIT parecia "dentro de transação". Proxy.
    // 2. `> $nivelBase` — prova que existe transação PRÓPRIA, mas não que o lock e a gravação
    //    estão na MESMA: travar numa `DB::transaction` curta e gravar numa SEGUNDA ficava
    //    verde, com a janela TOCTOU viva entre os dois commits.
    //
    // O epoch sobe uma vez por transação de topo. Mesma transação ⇒ mesmo epoch.
    $capturado = capturarConsultasComEpoch();

    // ACT — um PUT que MUDA algo: sem atributo sujo o Eloquent nem emite o UPDATE, e a
    // asserção do M-2 (o UPDATE dentro da transação) não teria estatement para conferir
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$agendamento->id}",
        putDoAgendamento($agendamento, ['obs' => 'Observação fictícia do teste de lock.'])
    )->assertOk();

    // ASSERT — a IMPRESSÃO DIGITAL da guarda, não um `for update` qualquer.
    //
    // Procurar só por "`for update` em `agendamentos`" seria um PROXY, e ele mente: o
    // `ConsumoSessaoService` também trava a linha do agendamento (relê `sessao_consumida_em`
    // sob lock, com `whereKey`) no MESMO request. Com essa asserção frouxa, apagar a âncora
    // da guarda deixava o teste VERDE — provado. Contrato que confere proxy não confere nada.
    //
    // A guarda trava o LOTE: `where id in (...) order by id ... for update`. É essa forma que
    // este teste prende.
    // ...e cada uma tem de estar DENTRO DA TRANSAÇÃO. Este é o terceiro elo da corrente, e
    // era o que faltava (gate SEC F-01): um `for update` em AUTOCOMMIT solta o lock no fim do
    // próprio statement. O log de queries continuaria idêntico, os dois testes acima
    // continuariam verdes — e a janela TOCTOU reabriria em SILÊNCIO. Travar sem segurar até o
    // commit é o mesmo que não travar.
    // `epochDaConsulta` LANÇA se a consulta sumiu (a guarda foi apagada) ou se ela rodou fora de
    // transação própria (o `for update` em autocommit solta o lock no fim do statement). As duas
    // regressões falham por CONSTRUÇÃO — sem o teste precisar lembrar de assertá-las.
    $consultas = $capturado();
    $epochDaAncora = epochDaConsulta($consultas, ['from `agendamentos`', '`id` in (', 'for update']);

    // A FORMA, não "ninguém mais trava `atendimentos`" — isso era verdade ontem e virou
    // comentário hoje: o `store` do atendimento passou a travar o agendamento, e um dia
    // travará esta tabela também. Asserção que se apoia em "só existe um" é proxy com data
    // de validade (gate CR, NIT 2). A guarda lê o LOTE: `where agendamento_id in (...)`.
    $epochDoReforco = epochDaConsulta($consultas, ['from `atendimentos`', '`agendamento_id` in (', 'for update']);

    // Os dois locks e a gravação, na MESMA transação (gatilho TEST-LOCK-EPOCH). Embrulhar
    // cada `for update` na sua própria transação curta e gravar numa terceira deixaria os
    // dois elos acima verdes — e a janela TOCTOU viveria entre os commits.
    $epochDoUpdate = epochDaConsulta($consultas, ['update `agendamentos`']);

    expect($epochDoReforco)->toBe($epochDaAncora,
        'A âncora e o reforço travam em transações DIFERENTES: o lock da primeira já soltou '
        .'quando a segunda começa — a corrente tem um elo solto no meio.'
    );
    expect($epochDoUpdate)->toBe($epochDaAncora,
        'O UPDATE do agendamento não está na MESMA transação dos locks: a guarda trava, '
        .'decide — e grava depois de soltar. Travar sem gravar dentro é não travar.'
    );
});

/**
 * A guarda IRMÃ, que vivia num `SELECT` em autocommit ANTES da transação, agora decide
 * dentro do mesmo escopo travado. Este teste garante que a mudança de lugar não a matou.
 */
it('deve continuar recusando a conversão para bloqueio de um agendamento atendido', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $agendamento = Agendamento::factory()->create();
    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [])
        ->assertCreated();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$agendamento->id}",
        putDoAgendamento($agendamento, ['tipo' => 'bloqueio'])
    );

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('tipo');
    expect($agendamento->fresh()->tipo)->toBe('atendimento')
        ->and(Atendimento::where('agendamento_id', $agendamento->id)->count())->toBe(1);
});
