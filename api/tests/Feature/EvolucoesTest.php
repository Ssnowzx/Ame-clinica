<?php

use App\Models\Atendimento;
use App\Models\Auditoria;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Usuario;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Facades\DB;

/** Atendimento pronto para evoluir + profissional para assinar. */
function cenarioDeEvolucao(array $atendimento = []): array
{
    return [
        Atendimento::factory()->create($atendimento),
        Profissional::factory()->create(),
    ];
}

it('deve registrar evolução com preenchida_em do servidor ignorando o payload', function () {
    // ARRANGE
    $adminDaClinica = admin();
    [$atendimento, $profissional] = cenarioDeEvolucao();

    // ACT — payload tenta retrodatar (T-ate-07)
    $resposta = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $profissional->id,
            'conteudo' => 'Evolução clínica fictícia da sessão.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
            'preenchida_em' => '2020-01-01 00:00',
        ]);

    // ASSERT — data do servidor NA PAREDE DA CLÍNICA (CR-03), com autor na trilha
    $resposta->assertCreated();
    expect($resposta->json('preenchida_em'))->not->toBe('2020-01-01 00:00')
        ->and($resposta->json('preenchida_em'))->toStartWith(agoraNaClinica()->format('Y-m-d'));
    $criacao = Auditoria::where('entidade', 'evolucoes')->where('acao', 'criou')->firstOrFail();
    expect($criacao->usuario_id)->toBe($adminDaClinica->id);
});

it('deve rejeitar evolução duplicada no mesmo atendimento', function () {
    // ARRANGE
    $adminDaClinica = admin();
    [$atendimento, $profissional] = cenarioDeEvolucao();
    $payload = ['profissional_id' => $profissional->id, 'conteudo' => 'Primeira evolução fictícia.', 'motivo_assinatura' => 'Registro administrativo em teste.'];
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", $payload)->assertCreated();

    // ACT + ASSERT — 1:1 no banco
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", $payload)
        ->assertUnprocessable()->assertJsonValidationErrors('atendimento_id');
});

it('deve exigir responsável técnico no estado final quando a configuração ativa', function () {
    // ARRANGE — regra é DADO (§13)
    $adminDaClinica = admin();
    app(ConfiguracaoService::class)->set('evolucoes.responsavel_tecnico_obrigatorio', true);
    [$atendimento, $profissional] = cenarioDeEvolucao();

    // ACT + ASSERT — criar sem → 422
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $profissional->id,
            'conteudo' => 'Evolução fictícia.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertUnprocessable()->assertJsonValidationErrors('responsavel_tecnico_id');

    // com responsável → 201; PUT que esvazia → 422 (estado final, T-ate-09)
    $id = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $profissional->id,
            'responsavel_tecnico_id' => $profissional->id,
            'conteudo' => 'Evolução fictícia.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertCreated()->json('id');
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/evolucoes/{$id}", [
        'responsavel_tecnico_id' => null,
    ])->assertUnprocessable()->assertJsonValidationErrors('responsavel_tecnico_id');
});

it('deve impor autoria vinculada: profissional só assina em nome próprio', function () {
    // ARRANGE — usuário VINCULADO ao profissional X (T-ate-06)
    $adminDaClinica = admin();
    [$atendimento, $profissionalX] = cenarioDeEvolucao();
    $profissionalY = Profissional::factory()->create();
    $usuarioVinculado = Usuario::factory()->create([
        'profissional_id' => $profissionalX->id,
    ]);
    $usuarioVinculado->syncRoles(['Administrador']);

    $this->flushSession();
    $this->app['auth']->forgetGuards();

    // ACT + ASSERT — assinar como Y → 422; como si mesmo → 201
    $this->actingAs($usuarioVinculado)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $profissionalY->id,
            'conteudo' => 'Evolução fictícia.',
        ])->assertUnprocessable()->assertJsonValidationErrors('profissional_id');

    $this->actingAs($usuarioVinculado)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $profissionalX->id,
            'conteudo' => 'Evolução fictícia.',
        ])->assertCreated();
});

it('deve manter a autoria do prontuário imutável na edição', function () {
    // ARRANGE — evolução assinada por X, criada por admin SEM vínculo profissional
    $adminDaClinica = admin();
    [$atendimento, $profissionalX] = cenarioDeEvolucao();
    $profissionalY = Profissional::factory()->create();
    $id = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $profissionalX->id,
            'conteudo' => 'Evolução clínica fictícia original.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertCreated()->json('id');

    // ACT + ASSERT — vetor SEC-R2-01/1: usuário SEM vínculo manda profissional_id no PUT.
    // O boundary recusa (`missing`) — esconder o campo na tela era reforço, não controle.
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/evolucoes/{$id}", [
        'profissional_id' => $profissionalY->id,
        'conteudo' => 'Tentativa de reassinar o prontuário.',
    ])->assertUnprocessable()->assertJsonValidationErrors('profissional_id');

    // vetor da rodada 3: `prohibited` = "ausente OU VAZIO" — `null` passava, o update
    // gravava NULL na coluna NOT NULL e o prontuário respondia 500 fora do envelope.
    // `missing` recusa QUALQUER presença da chave, inclusive null.
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/evolucoes/{$id}", [
        'profissional_id' => null,
        'conteudo' => 'Tentativa com null.',
    ])->assertUnprocessable()->assertJsonValidationErrors('profissional_id');

    // vetor SEC-R2-01/2: usuária vinculada a Y tenta roubar a autoria da nota de X para si
    $usuariaVinculada = Usuario::factory()->create([
        'profissional_id' => $profissionalY->id,
    ]);
    $usuariaVinculada->syncRoles(['Administrador']);
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($usuariaVinculada)->putJsonComVersao("/api/evolucoes/{$id}", [
        'profissional_id' => $profissionalY->id,
        'conteudo' => 'Tentativa de roubo de autoria.',
    ])->assertUnprocessable()->assertJsonValidationErrors('profissional_id');

    // e mesmo SEM o campo, vinculada não edita nota alheia (T-ate-06 vale na edição)
    $this->actingAs($usuariaVinculada)->putJsonComVersao("/api/evolucoes/{$id}", [
        'conteudo' => 'Edição de nota alheia.',
    ])->assertUnprocessable()->assertJsonValidationErrors('profissional_id');

    // PUT sem o campo PRESERVA a autoria (M-1: prende a preservação, não só a recusa)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/evolucoes/{$id}", [
        'conteudo' => 'Conteúdo fictício editado.',
    ])->assertOk()->assertJsonPath('profissional_id', $profissionalX->id);
});

it('deve aceitar preencher o responsável técnico na edição de evolução antiga', function () {
    // ARRANGE — evolução criada ANTES de a clínica ligar a exigência (default off)
    $adminDaClinica = admin();
    [$atendimento, $profissional] = cenarioDeEvolucao();
    $id = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $profissional->id,
            'conteudo' => 'Evolução fictícia sem responsável.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertCreated()->json('id');
    app(ConfiguracaoService::class)->set('evolucoes.responsavel_tecnico_obrigatorio', true);

    // ACT + ASSERT — editar só o conteúdo esbarra na exigência do estado final...
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/evolucoes/{$id}", [
        'conteudo' => 'Conteúdo editado.',
    ])->assertUnprocessable()->assertJsonValidationErrors('responsavel_tecnico_id');

    // ...e preencher a LACUNA junto destrava a edição (re-review I-2: sem isso, evolução
    // antiga ficava impossível de editar até desligarem a configuração)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/evolucoes/{$id}", [
        'conteudo' => 'Conteúdo editado.',
        'responsavel_tecnico_id' => $profissional->id,
    ])->assertOk()->assertJsonPath('responsavel_tecnico_id', $profissional->id);
});

it('deve aceitar a evolução mesmo após o prazo e quitar a pendência vencida', function () {
    // ARRANGE — o contrato NOVO (change trava-de-evolucao, D2 — decisão da clínica,
    // 2026-07-19/FA-10): a escrita da evolução NUNCA é recusada por atraso; o prazo
    // (default 100 dias de finalizado_em, na PAREDE da clínica) define VENCIMENTO —
    // fila, aviso e trava do finalizar —, e escrever é o que QUITA a pendência.
    $adminDaClinica = admin();
    [$noLimite, $profissional] = cenarioDeEvolucao([
        'finalizado_em' => agoraNaClinica()->subDays(100)->format('Y-m-d H:i'),
    ]);
    $vencido = Atendimento::factory()->create([
        'finalizado_em' => agoraNaClinica()->subDays(150)->format('Y-m-d H:i'),
    ]);

    // a pendência FORA do prazo está na fila, marcada vencida (derivação intacta)
    $fila = $this->actingAs($adminDaClinica)->getJson('/api/evolucoes/em-aberto');
    $pendencias = collect($fila->json('data'))->keyBy('atendimento_id');
    expect($pendencias[$vencido->id]['vencida'])->toBeTrue()
        ->and($pendencias[$noLimite->id]['vencida'])->toBeFalse();

    // ACT — no dia-limite E depois do prazo, a escrita é aceita
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$noLimite->id}/evolucao", [
            'profissional_id' => $profissional->id,
            'conteudo' => 'Evolução fictícia no dia-limite.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertCreated();
    $criadaComAtraso = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$vencido->id}/evolucao", [
            'profissional_id' => $profissional->id,
            'conteudo' => 'Evolução fictícia registrada com atraso.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ]);
    $criadaComAtraso->assertCreated();

    // ... e EDITAR após o prazo também é aceito (o MUST do requirement cobre os dois)
    $this->actingAs($adminDaClinica)
        ->putJson("/api/evolucoes/{$criadaComAtraso->json('id')}", [
            'conteudo' => 'Evolução fictícia corrigida ainda mais tarde.',
        ], ['If-Match' => $criadaComAtraso->json('updated_at')])
        ->assertOk();

    // ASSERT — a evolução atrasada QUITA a pendência: some da fila
    $depois = $this->actingAs($adminDaClinica)->getJson('/api/evolucoes/em-aberto');
    expect($depois->json('total'))->toBe(0)
        ->and(collect($depois->json('data'))->pluck('atendimento_id'))
        ->not->toContain($vencido->id);
});

it('deve bloquear evolução quando o status atual não desconta e a configuração ativa', function () {
    // ARRANGE — agendamento em "Falta Justificada" (não desconta = atendimento desfeito)
    $adminDaClinica = admin();
    $faltaJustificada = StatusAgendamento::where('nome', 'Falta Justificada')->firstOrFail();
    [$atendimento, $profissional] = cenarioDeEvolucao();
    $atendimento->agendamento->update(['status_id' => $faltaJustificada->id]);
    $payload = ['profissional_id' => $profissional->id, 'conteudo' => 'Evolução fictícia.', 'motivo_assinatura' => 'Registro administrativo em teste.'];

    // ACT + ASSERT — default (off) não bloqueia
    $criada = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", $payload);
    $criada->assertCreated();

    // config ativa bloqueia criar E editar (D6/P3)
    app(ConfiguracaoService::class)->set('evolucoes.bloquear_apos_status', true);
    $outro = Atendimento::factory()->create();
    $outro->agendamento->update(['status_id' => $faltaJustificada->id]);
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$outro->id}/evolucao", $payload)
        ->assertUnprocessable()->assertJsonValidationErrors('evolucao');
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/evolucoes/{$criada->json('id')}", ['conteudo' => 'Tentativa de edição.'])
        ->assertUnprocessable()->assertJsonValidationErrors('evolucao');
});

it('deve listar evoluções em aberto só com metadados e prazo coerente', function () {
    // ARRANGE — um pendente antigo (vencido), um pendente no prazo, um evoluído
    $adminDaClinica = admin();
    $vencido = Atendimento::factory()->create([
        'finalizado_em' => agoraNaClinica()->subDays(150)->format('Y-m-d H:i'),
    ]);
    $noPrazo = Atendimento::factory()->create([
        'finalizado_em' => agoraNaClinica()->subDays(3)->format('Y-m-d H:i'),
    ]);
    [$evoluido, $profissional] = cenarioDeEvolucao();
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$evoluido->id}/evolucao", [
            'profissional_id' => $profissional->id,
            'conteudo' => 'Evolução fictícia concluída.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertCreated();

    // ACT
    $lista = $this->actingAs($adminDaClinica)->getJson('/api/evolucoes/em-aberto');

    // ASSERT — pendentes com prazo_ate/vencida; evoluído fora; nada de conteúdo
    $lista->assertOk()->assertJsonPath('total', 2);
    $porAtendimento = collect($lista->json('data'))->keyBy('atendimento_id');
    expect($porAtendimento[$vencido->id]['vencida'])->toBeTrue()
        ->and($porAtendimento[$noPrazo->id]['vencida'])->toBeFalse()
        ->and($porAtendimento[$noPrazo->id]['prazo_ate'])
        ->toBe(agoraNaClinica()->subDays(3)->addDays(100)->toDateString())
        ->and($porAtendimento[$noPrazo->id]['paciente'])->toHaveKeys(['id', 'nome'])
        ->and(json_encode($lista->json()))->not->toContain('conteudo');

    // per_page acima do teto → 422 (T-ate-18)
    $this->actingAs($adminDaClinica)->getJson('/api/evolucoes/em-aberto?per_page=101')
        ->assertUnprocessable()->assertJsonValidationErrors('per_page');

    // filtro por profissional sem atendimento pendente devolve vazio (T-ate-18)
    $semPendencia = Profissional::factory()->create();
    $this->actingAs($adminDaClinica)
        ->getJson("/api/evolucoes/em-aberto?profissional_id={$semPendencia->id}")
        ->assertOk()->assertJsonPath('total', 0);
});

it('deve manter o prontuário sem delete, cifrado, mascarado e com leitura auditada', function () {
    // ARRANGE
    $adminDaClinica = admin();
    [$atendimento, $profissional] = cenarioDeEvolucao();
    $textoClinico = 'Conteúdo clínico fictício e sensível da evolução.';
    $id = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $profissional->id,
            'conteudo' => $textoClinico,
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertCreated()->json('id');

    // ASSERT — sem rota DELETE (T-ate-08): prontuário não some
    $this->actingAs($adminDaClinica)->deleteJson("/api/evolucoes/{$id}")
        ->assertStatus(405);

    // cifrado em repouso
    $cru = DB::table('evolucoes')->where('id', $id)->value('conteudo');
    expect(str_contains($cru, $textoClinico))->toBeFalse();

    // mascarado no diff (autoria em claro — deliberado)
    $registro = Auditoria::where('entidade', 'evolucoes')->where('acao', 'criou')->firstOrFail();
    expect($registro->diff_json['depois']['conteudo'])->toBe('***')
        ->and($registro->diff_json['depois']['profissional_id'])->toBe($profissional->id);

    // leitura do detalhe auditada com autor e IP (art. 11)
    $this->actingAs($adminDaClinica)->getJson("/api/evolucoes/{$id}")
        ->assertOk()->assertJsonPath('conteudo', $textoClinico);
    $consulta = Auditoria::where('entidade', 'evolucoes')->where('acao', 'consultou')
        ->where('entidade_id', $id)->firstOrFail();
    expect($consulta->usuario_id)->toBe($adminDaClinica->id)
        ->and($consulta->ip)->not->toBeNull();

    // 403 sem permissão de leitura clínica (módulo próprio — parecer §4)
    $semPermissao = Usuario::factory()->create();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($semPermissao)->getJson("/api/evolucoes/{$id}")->assertForbidden();
});

it('deve deixar o DESLIGADO assinar só a sessão que ele mesmo atendeu', function () {
    // ARRANGE — a regra que o usuário decidiu (2026-07-14): a autoria diz a VERDADE. Quem
    // realizou a sessão foi ela; fazer outra pessoa assinar seria FALSIFICAR a autoria do
    // prontuário de um MENOR. Mas a fonoaudióloga que saiu em março NÃO assina, em julho, o
    // registro de uma criança que ela nunca viu.
    //
    // E a regra mora no SERVIDOR: até aqui o único controle era um `.filter()` no React, e uma
    // aba velha ou um `curl` passavam direto (re-review r11, bloqueante).
    $adminDaClinica = admin();
    [$atendimento, $ativo] = cenarioDeEvolucao();
    $desligadoQueAtendeu = $atendimento->agendamento->profissional;
    $desligadoQueAtendeu->update(['ativo' => false]);
    $desligadoAlheio = Profissional::factory()->create(['ativo' => false]);

    // ACT + ASSERT — o desligado ALHEIO à sessão é recusado
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $desligadoAlheio->id,
            'conteudo' => 'Evolução fictícia de quem não atendeu.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertUnprocessable()->assertJsonValidationErrors('profissional_id');

    // ...e o desligado QUE ATENDEU assina a sessão dele
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $desligadoQueAtendeu->id,
            'conteudo' => 'Evolução fictícia da sessão que ela atendeu.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertCreated()->assertJsonPath('profissional_id', $desligadoQueAtendeu->id);

    // e o ATIVO segue livre (a regra não estreitou quem está na casa)
    $outro = Atendimento::factory()->create();
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$outro->id}/evolucao", [
            'profissional_id' => $ativo->id,
            'conteudo' => 'Evolução fictícia de profissional ativo.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertCreated();
});

it('deve continuar EDITÁVEL a evolução cuja autora foi desligada depois', function () {
    // ARRANGE — o beco sem saída que a guarda do desligado criou (re-review r12).
    //
    // A supervisora ATIVA assina a sessão que OUTRA pessoa atendeu — permitido hoje (o usuário
    // sem vínculo escolhe o autor). Três dias depois ela é desligada. A autoria é IMUTÁVEL
    // (SEC-R2-01): revalidá-la no PUT transformaria o fato histórico em erro, e TODA edição
    // daquela evolução viraria 422 — numa chave que o cliente não pode mandar e o formulário nem
    // renderiza. Prontuário congelado, sem saída.
    $adminDaClinica = admin();
    [$atendimento] = cenarioDeEvolucao();
    $supervisora = Profissional::factory()->create(); // ativa, e NÃO atendeu esta sessão
    $id = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $supervisora->id,
            'conteudo' => 'Evolução fictícia assinada pela supervisora.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertCreated()->json('id');

    // ACT — ela é desligada DEPOIS
    $supervisora->update(['ativo' => false]);

    // ASSERT — a evolução continua editável (a autoria não muda; só o conteúdo)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/evolucoes/{$id}", [
        'conteudo' => 'Correção fictícia do texto.',
    ])->assertOk()->assertJsonPath('profissional_id', $supervisora->id);
});

it('deve recusar o DESLIGADO como responsável técnico — na criação e na edição', function () {
    // ARRANGE — o RT é a OUTRA assinatura do prontuário. E, ao contrário da autoria, é uma
    // escolha feita AGORA: não existe "ele foi o RT da sessão". A guarda cobria só o autor, e um
    // `PUT` com o RT da fono desligada respondia 200 (re-review r12, bloqueante).
    $adminDaClinica = admin();
    [$atendimento, $ativo] = cenarioDeEvolucao();
    $desligado = Profissional::factory()->create(['ativo' => false]);

    // ACT + ASSERT — criar com RT desligado → 422
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $ativo->id,
            'responsavel_tecnico_id' => $desligado->id,
            'conteudo' => 'Evolução fictícia.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertUnprocessable()->assertJsonValidationErrors('responsavel_tecnico_id');

    // ...e INSTALAR um desligado como RT numa evolução existente também → 422
    $id = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $ativo->id,
            'conteudo' => 'Evolução fictícia.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertCreated()->json('id');

    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/evolucoes/{$id}", [
        'responsavel_tecnico_id' => $desligado->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('responsavel_tecnico_id');

    // mas o RT que JÁ ESTAVA gravado sobrevive ao desligamento (vínculo histórico)
    $outro = Atendimento::factory()->create();
    $rtQueSaiu = Profissional::factory()->create();
    $comRt = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$outro->id}/evolucao", [
            'profissional_id' => $ativo->id,
            'responsavel_tecnico_id' => $rtQueSaiu->id,
            'conteudo' => 'Evolução fictícia com RT.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertCreated()->json('id');
    $rtQueSaiu->update(['ativo' => false]);

    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/evolucoes/{$comRt}", [
        'conteudo' => 'Correção fictícia.',
    ])->assertOk()->assertJsonPath('responsavel_tecnico_id', $rtQueSaiu->id);

    // ...e REENVIAR o mesmo id também passa. É o caminho que um cliente antigo (ou um `curl` que
    // devolve o objeto inteiro) percorre — e o único que exercita de verdade a comparação
    // payload × banco. Sem esta linha a guarda estava correta e NÃO PROVADA (re-review r13).
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/evolucoes/{$comRt}", [
        'conteudo' => 'Outra correção fictícia.',
        'responsavel_tecnico_id' => $rtQueSaiu->id,
    ])->assertOk()->assertJsonPath('responsavel_tecnico_id', $rtQueSaiu->id);
});
