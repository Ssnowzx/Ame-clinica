<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Auditoria;
use App\Models\Profissional;
use App\Models\Usuario;
use Illuminate\Support\Facades\DB;

/** Agendamento de atendimento pronto para ser atendido. */
function agendamentoParaAtender(array $sobrescreve = []): Agendamento
{
    return Agendamento::factory()->create($sobrescreve);
}

it('deve atender um agendamento com finalizado_em default do servidor', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $agendamento = agendamentoParaAtender();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [
            'observacoes' => 'Sessão fictícia registrada para teste.',
        ]);

    // ASSERT — 1:1 com o agendamento, finalizado_em preenchido pelo servidor
    $resposta->assertCreated()
        ->assertJsonPath('agendamento_id', $agendamento->id);
    expect($resposta->json('finalizado_em'))->not->toBeNull();
});

it('deve rejeitar atender duas vezes e atender bloqueio', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $agendamento = agendamentoParaAtender();
    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [])->assertCreated();

    // ACT + ASSERT — duplicado (1:1 no banco)
    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [])
        ->assertUnprocessable()->assertJsonValidationErrors('agendamento_id');
    expect(Atendimento::where('agendamento_id', $agendamento->id)->count())->toBe(1);

    // bloqueio não é atendível (profissional explícito: a factory vincula o
    // profissional à especialidade, e bloqueio não tem especialidade)
    $bloqueio = Agendamento::factory()->create([
        'tipo' => 'bloqueio', 'paciente_id' => null,
        'especialidade_id' => null, 'status_id' => null,
        'profissional_id' => Profissional::factory()->create()->id,
    ]);
    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$bloqueio->id}/atendimento", [])
        ->assertUnprocessable()->assertJsonValidationErrors('agendamento_id');
});

it('deve rejeitar timestamps falsificados na criação e na edição', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $agendamento = agendamentoParaAtender();

    // ACT + ASSERT — futuro e ordem invertida (T-ate-02), na parede da clínica
    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [
            'finalizado_em' => agoraNaClinica()->addDay()->format('Y-m-d H:i'),
        ])->assertUnprocessable()->assertJsonValidationErrors('finalizado_em');

    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [
            'iniciado_em' => agoraNaClinica()->format('Y-m-d H:i'),
            'finalizado_em' => agoraNaClinica()->subHour()->format('Y-m-d H:i'),
        ])->assertUnprocessable()->assertJsonValidationErrors('iniciado_em');

    // edição revalida no ESTADO FINAL: mover só o início para depois do fim atual
    $atendimento = $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [
            'finalizado_em' => agoraNaClinica()->subHour()->format('Y-m-d H:i'),
        ])->assertCreated();
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/atendimentos/{$atendimento->json('id')}", [
            'iniciado_em' => agoraNaClinica()->format('Y-m-d H:i'),
        ])->assertUnprocessable()->assertJsonValidationErrors('iniciado_em');
});

it('deve manter observações fora da listagem, mascaradas no diff e cifradas no banco', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $agendamento = agendamentoParaAtender();
    $textoClinico = 'Observação clínica fictícia sensível.';
    $id = $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [
            'observacoes' => $textoClinico,
        ])->assertCreated()->json('id');

    // ASSERT — detail-only (T-ate-03)
    $lista = $this->actingAs($adminDaClinica)->getJson('/api/atendimentos');
    $lista->assertOk();
    semVazamento($lista->json(), $textoClinico);
    expect($lista->json('data.0'))->not->toHaveKey('observacoes');
    expect($this->actingAs($adminDaClinica)->getJson("/api/atendimentos/{$id}")
        ->json('observacoes'))->toBe($textoClinico);

    // leitura do detalhe auditada (SEC-ate-01 — mesmo regime do prontuário)
    $consulta = Auditoria::where('entidade', 'atendimentos')->where('acao', 'consultou')
        ->where('entidade_id', $id)->firstOrFail();
    expect($consulta->usuario_id)->toBe($adminDaClinica->id)
        ->and($consulta->ip)->not->toBeNull();

    // mascarada no diff da auditoria
    $registro = Auditoria::where('entidade', 'atendimentos')->where('acao', 'criou')->firstOrFail();
    expect($registro->diff_json['depois']['observacoes'])->toBe('***');
    semVazamento($registro->diff_json, $textoClinico);

    // cifrada em repouso: o valor cru no banco não é o plaintext
    $cru = DB::table('atendimentos')->where('id', $id)->value('observacoes');
    expect($cru)->not->toBeNull()
        ->and($cru)->not->toBe($textoClinico)
        ->and(str_contains($cru, $textoClinico))->toBeFalse();
});

it('deve proteger a exclusão com evolução ou consumo e permitir a legítima com trilha', function () {
    // ARRANGE — atendimento limpo
    $adminDaClinica = admin();
    $agendamento = agendamentoParaAtender();
    $id = $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [])
        ->assertCreated()->json('id');

    // com consumo → 422 (T-ate-04)
    $agendamento->forceFill(['sessao_consumida_em' => now()])->save();
    $this->actingAs($adminDaClinica)->deleteJson("/api/atendimentos/{$id}")
        ->assertUnprocessable()->assertJsonValidationErrors('atendimento');

    // com evolução → 422
    $agendamento->forceFill(['sessao_consumida_em' => null])->save();
    $profissional = Profissional::factory()->create();
    $this->actingAs($adminDaClinica)->postJson("/api/atendimentos/{$id}/evolucao", [
        'profissional_id' => $profissional->id,
        'conteudo' => 'Evolução fictícia.',
        'motivo_assinatura' => 'Registro administrativo em teste.',
    ])->assertCreated();
    $this->actingAs($adminDaClinica)->deleteJson("/api/atendimentos/{$id}")
        ->assertUnprocessable()->assertJsonValidationErrors('atendimento');

    // limpo → 204 auditado (registro errado se corrige)
    $limpo = $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos/'.agendamentoParaAtender()->id.'/atendimento', [])
        ->assertCreated()->json('id');
    $this->actingAs($adminDaClinica)->deleteJson("/api/atendimentos/{$limpo}")->assertNoContent();
    expect(Auditoria::where('entidade', 'atendimentos')->where('acao', 'excluiu')
        ->where('entidade_id', $limpo)->exists())->toBeTrue();
});

it('deve responder 403 sem permissão', function () {
    // ARRANGE
    $semPermissao = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($semPermissao)->getJson('/api/atendimentos')->assertForbidden();
});

it('deve dizer se o atendimento já tem evolução — sem revelar o que ela diz', function () {
    // ARRANGE: a TELA precisa escolher entre "escrever a evolução" e "ler/editar", e
    // precisa do id para buscar o detalhe. `evolucao_id` é IDENTIFICADOR: revela que o
    // prontuário existe, jamais o que ele diz — o conteúdo continua atrás de
    // `evolucoes.ver`, no `show`, e a leitura dele continua auditada.
    $adminDaClinica = admin();
    $semEvolucao = agendamentoParaAtender();
    $comEvolucao = agendamentoParaAtender([
        'inicio' => now()->addDay()->format('Y-m-d').' 14:00',
        'fim' => now()->addDay()->format('Y-m-d').' 14:40',
    ]);

    $idSem = $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$semEvolucao->id}/atendimento", [])->assertCreated()->json('id');
    $idCom = $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$comEvolucao->id}/atendimento", [])->assertCreated()->json('id');

    $idDaEvolucao = $this->actingAs($adminDaClinica)->postJson("/api/atendimentos/{$idCom}/evolucao", [
        'profissional_id' => $comEvolucao->profissional_id,
        'conteudo' => 'Evolução fictícia registrada para teste.',
        'motivo_assinatura' => 'Registro administrativo em teste.',
    ])->assertCreated()->json('id');

    // ACT + ASSERT — detalhe
    $this->actingAs($adminDaClinica)->getJson("/api/atendimentos/{$idSem}")
        ->assertOk()->assertJsonPath('evolucao_id', null);
    $this->actingAs($adminDaClinica)->getJson("/api/atendimentos/{$idCom}")
        ->assertOk()->assertJsonPath('evolucao_id', $idDaEvolucao);

    // ACT + ASSERT — listagem: o conteúdo NUNCA aparece, o id sim
    $lista = $this->actingAs($adminDaClinica)->getJson('/api/atendimentos')->assertOk();
    expect($lista->json('data.0'))->toHaveKey('evolucao_id');
    $lista->assertJsonMissingPath('data.0.conteudo')
        ->assertJsonMissingPath('data.0.observacoes');
});

it('deve listar atendimentos sem N+1 na evolução', function () {
    // ARRANGE: `evolucao_id` por linha é um convite ao N+1 — numa página de 100
    // atendimentos, seriam 100 consultas a mais, e ninguém veria (a suíte ficaria verde).
    $adminDaClinica = admin();
    foreach (range(0, 4) as $indice) {
        $agendamento = agendamentoParaAtender([
            'inicio' => now()->addDays(2)->format('Y-m-d').' 0'.(8 + $indice).':00',
            'fim' => now()->addDays(2)->format('Y-m-d').' 0'.(8 + $indice).':40',
        ]);
        $this->actingAs($adminDaClinica)
            ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [])->assertCreated();
    }

    $consultas = [];
    DB::listen(function ($consulta) use (&$consultas) {
        $consultas[] = $consulta->sql;
    });

    // ACT
    $this->actingAs($adminDaClinica)->getJson('/api/atendimentos')->assertOk();

    // ASSERT: UMA consulta a `evolucoes` para a página inteira — não uma por linha
    $naEvolucao = count(array_filter($consultas, fn ($sql) => str_contains($sql, 'from `evolucoes`')));
    expect($naEvolucao)->toBeLessThanOrEqual(1);
});

it('deve esconder evolucao_id de quem não pode ver evolução', function () {
    // ARRANGE — gate SEC F-03. `evolucao_id` é identificador, não conteúdo. Mas o que ele
    // revela é o NEGATIVO: quem tem `atendimentos.ver` e NÃO tem `evolucoes.ver` pagina a
    // listagem e deriva a FILA INTEIRA de quem está com prontuário atrasado — exatamente o
    // que `/evolucoes/em-aberto` protege atrás de `evolucoes.ver`. Porta lateral que
    // contorna uma permissão não é detalhe de serialização.
    $adminDaClinica = admin();
    $agendamento = agendamentoParaAtender();
    $id = $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [])->assertCreated()->json('id');

    // um usuário que vê atendimento mas NÃO vê evolução. `clinico.ver_todos` (D11): sem a flag,
    // um papel sem vínculo seria fail-closed e nem leria o atendimento — este teste é do
    // `evolucao_id` (ortogonal ao escopo), então o leitor é PLANO no eixo clínico.
    $soAtendimento = Usuario::factory()->create();
    $soAtendimento->givePermissionTo('atendimentos.ver', 'clinico.ver_todos');

    // ACT + ASSERT — para ele, o campo NÃO EXISTE (nem como null: ausência não é contagem)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($soAtendimento)->getJson("/api/atendimentos/{$id}")
        ->assertOk()->assertJsonMissingPath('evolucao_id');
    $this->actingAs($soAtendimento)->getJson('/api/atendimentos')
        ->assertOk()->assertJsonMissingPath('data.0.evolucao_id');

    // ...e a fila continua barrada para ele, que é o que a porta lateral contornava
    $this->actingAs($soAtendimento)->getJson('/api/evolucoes/em-aberto')->assertForbidden();

    // MAS quem tem `evolucoes.criar` recebe o campo (re-review I-1): é quem RESOLVE a
    // pendência — sem ele, o "Escrever evolução" sumia exatamente para quem podia escrever
    $quemEscreve = Usuario::factory()->create();
    $quemEscreve->givePermissionTo('atendimentos.ver', 'evolucoes.criar', 'clinico.ver_todos');
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($quemEscreve)->getJson("/api/atendimentos/{$id}")
        ->assertOk()->assertJsonPath('evolucao_id', null);
});

it('deve registrar o atendimento SOB LOCK, dentro da transação', function () {
    // ARRANGE — gate CR BLOQUEANTE 1. A guarda do PUT fecha a direção "a edição chega
    // depois". O `store` fecha a OUTRA: sem reler o agendamento SOB LOCK, ele decide sobre
    // um SNAPSHOT — e um PUT concorrente converte para `bloqueio` e commita entre a leitura
    // e o INSERT. Sobra um atendimento (e amanhã uma evolução) pendurado num BLOQUEIO, sem
    // criança nenhuma.
    //
    // O lock está lá. O que faltava era o teste: apagar o `lockForUpdate()` do `store`
    // deixava as 421 verdes. Guarda que não se prova não é guarda — a régua é a da casa.
    $adminDaClinica = admin();
    $agendamento = agendamentoParaAtender();

    $capturado = capturarConsultasComEpoch();

    // ACT
    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [])
        ->assertCreated();

    // ASSERT — a releitura do agendamento é TRAVANTE e roda DENTRO de transação própria.
    // Fora dela, o InnoDB solta o lock no fim do statement e a janela reabre em silêncio.
    // `epochDaConsulta` LANÇA se a consulta não existe, ou se rodou fora de transação própria —
    // as duas regressões que este teste protege. A prova não depende de o teste lembrar de
    // assertar a ausência (gate, F-02: `expect(null)->toBe(null)` passava).
    $consultas = $capturado();
    $epochDoLock = epochDaConsulta($consultas, ['from `agendamentos`', 'for update']);

    // O INSERT decisório está na MESMA transação do lock — não apenas "em alguma"
    // (gatilho TEST-LOCK-EPOCH). Travar numa `DB::transaction` curta e gravar numa SEGUNDA
    // solta o lock no commit da primeira: o sinal antigo (`transactionLevel() > base`)
    // ficava verde nos dois casos e não distinguia o certo do errado. Epochs diferentes
    // reprovam.
    $epochDoInsert = epochDaConsulta($consultas, ['insert into `atendimentos`']);

    expect($epochDoInsert)->toBe($epochDoLock,
        'O INSERT do atendimento não está na MESMA transação do lock: o `for update` protege '
        .'a leitura, mas a decisão é gravada depois de o lock soltar — a janela TOCTOU vive '
        .'entre os dois commits.'
    );
});
