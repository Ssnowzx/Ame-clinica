<?php

use App\Models\Agendamento;
use App\Models\Auditoria;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Agenda\AgendamentoService;
use App\Support\Agenda\AplicadorDeStatusEmLote;
use App\Support\Agenda\BaixaEmLote;
use App\Support\Auditoria\ContextoDoLote;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Database\Events\TransactionBeginning;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;

/*
 * O CONTROLLER da baixa em lote por status (change `baixa-em-lote-por-status`, grupo 5): a
 * prévia não escreve; a execução é uma transação só, com assinatura (D5), status relido (D10),
 * encadeamento suprimido (D9), trilha por lote (D11) e escopo (D13). Dados FICTÍCIOS (LGPD).
 */

/** Uma prévia lida pela API — o que a tela envia de volta na execução. */
function previaLida($teste, $usuario, array $alcance): array
{
    $previa = $teste->actingAs($usuario)->postJson('/api/agendamentos/baixa-em-lote/previa', $alcance);
    $previa->assertOk();

    return [...$alcance, 'assinatura' => $previa->json('assinatura'), 'referencia' => $previa->json('referencia')];
}

/** A foto do que a baixa poderia mudar: status por agendamento, sessões por pacote, linhas da trilha. */
function fotoDaAgenda(): array
{
    return [
        'status' => Agendamento::orderBy('id')->pluck('status_id', 'id')->all(),
        'consumo' => Agendamento::orderBy('id')->pluck('sessao_consumida_em', 'id')->all(),
        'sessoes' => DB::table('tratamentos')->orderBy('id')->pluck('sessoes_realizadas', 'id')->all(),
        'auditoria' => Auditoria::count(),
    ];
}

it('deve não escrever nada na prévia', function () {
    // ARRANGE — um alcance com desconto real à vista
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $pacote = pacoteDaBaixa($base, total: 10);
    agendamentoDaBaixa($base, diaDaBaixa().' 09:00', ['tratamento_id' => $pacote->id]);
    agendamentoDaBaixa($base, diaDaBaixa().' 10:00');
    $antes = fotoDaAgenda();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $base['status']['finalizado']));

    // ASSERT — contou 2, e a foto é a mesma
    $resposta->assertOk()->assertJsonPath('contagens.agendamentos', 2)->assertJsonPath('contagens.sessoes_a_descontar', 1);
    expect(fotoDaAgenda())->toBe($antes);
});

it('deve aplicar o status, descontar por linha e gravar o mesmo lote_id em agendamentos, tratamentos e linha-mãe', function () {
    // ARRANGE — 2 crianças fictícias, cada uma com pacote; 1 sem pacote
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $dia = diaDaBaixa();
    $outraCrianca = Paciente::factory()->create()->id;
    $pacoteA = pacoteDaBaixa($base, total: 10, realizadas: 4);
    $pacoteB = pacoteDaBaixa($base, total: 8, pacienteId: $outraCrianca);
    $comPacoteA = agendamentoDaBaixa($base, "{$dia} 09:00", ['tratamento_id' => $pacoteA->id]);
    $comPacoteB = agendamentoDaBaixa($base, "{$dia} 10:00", ['paciente_id' => $outraCrianca, 'tratamento_id' => $pacoteB->id]);
    $semPacote = agendamentoDaBaixa($base, "{$dia} 11:00");
    $payload = previaLida($this, $adminDaClinica, alcanceDaBaixa($base, $base['status']['finalizado']));
    $trilhaAnterior = Auditoria::pluck('id')->all();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', $payload);

    // ASSERT — a resposta do contrato
    $resposta->assertOk();
    expect(array_keys($resposta->json()))->toBe(['lote_id', 'aplicados', 'contagens', 'recusados'])
        ->and($resposta->json('aplicados'))->toBe(3)
        ->and($resposta->json('contagens'))->toBe(['criancas' => 2, 'sessoes_descontadas' => 2])
        ->and($resposta->json('recusados'))->toBe([]);
    $loteId = $resposta->json('lote_id');
    expect(Str::isUuid($loteId))->toBeTrue();

    // o estado: status aplicado nas 3, sessão descontada nas 2 com pacote, nenhuma na sem pacote
    expect($comPacoteA->refresh()->status_id)->toBe($base['status']['finalizado'])
        ->and($comPacoteA->sessao_consumida_em)->not->toBeNull()
        ->and($comPacoteB->refresh()->sessao_consumida_em)->not->toBeNull()
        ->and($semPacote->refresh()->status_id)->toBe($base['status']['finalizado'])
        ->and($semPacote->sessao_consumida_em)->toBeNull()
        ->and($pacoteA->refresh()->sessoes_realizadas)->toBe(5)
        ->and($pacoteB->refresh()->sessoes_realizadas)->toBe(1);

    // a trilha: TODA linha nascida no lote carrega o lote — as 3 dos agendamentos (status e
    // marcador de consumo), as 2 dos tratamentos e a mãe; nada de antes foi carimbado
    $novas = Auditoria::whereNotIn('id', $trilhaAnterior)->get();
    $linhas = Auditoria::where('lote_id', $loteId)->get();
    $idsDe = fn (string $entidade) => $linhas->where('entidade', $entidade)->where('acao', 'atualizou')
        ->pluck('entidade_id')->map(fn ($id) => (int) $id)->unique()->sort()->values()->all();
    expect($novas->pluck('lote_id')->unique()->all())->toBe([$loteId])
        ->and($linhas->count())->toBe($novas->count())
        ->and($idsDe('agendamentos'))->toBe(collect([$comPacoteA->id, $comPacoteB->id, $semPacote->id])->sort()->values()->all())
        ->and($idsDe('tratamentos'))->toBe(collect([$pacoteA->id, $pacoteB->id])->sort()->values()->all())
        ->and($linhas->where('entidade', 'profissionais'))->toHaveCount(1)
        ->and(Auditoria::whereIn('id', $trilhaAnterior)->whereNotNull('lote_id')->count())->toBe(0);

    $mae = $linhas->firstWhere('acao', 'baixa_em_lote');
    expect($mae->entidade)->toBe('profissionais')
        ->and((int) $mae->entidade_id)->toBe($base['profissional_id'])
        ->and($mae->diff_json['depois'])->toBe([
            'status_id' => $base['status']['finalizado'],
            'status_nome' => 'Finalizado',
            'de' => $dia,
            'ate' => $dia,
            'aplicados' => 3,
            'criancas' => 2,
            'sessoes_descontadas' => 2,
            'recusados' => [],
        ])
        ->and(json_encode($mae->diff_json, JSON_UNESCAPED_UNICODE))->not->toContain('paciente');
    expect(app(ContextoDoLote::class)->id())->toBeNull();
});

it('deve responder 409 previa_desatualizada com a prévia nova quando um agendamento nasce entre a prévia e a execução, sem gravar', function () {
    // ARRANGE — a prévia contou 2; um 3º em aberto nasce antes de confirmar
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $dia = diaDaBaixa();
    agendamentoDaBaixa($base, "{$dia} 09:00");
    agendamentoDaBaixa($base, "{$dia} 10:00");
    $payload = previaLida($this, $adminDaClinica, alcanceDaBaixa($base, $base['status']['finalizado']));
    agendamentoDaBaixa($base, "{$dia} 11:00");
    $antes = fotoDaAgenda();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', $payload);

    // ASSERT — a chave, a frase, e a prévia nova dizendo 3 — nada gravado
    $resposta->assertStatus(409)
        ->assertJsonPath('erro', 'previa_desatualizada')
        ->assertJsonPath('previa.contagens.agendamentos', 3);
    expect($resposta->json('message'))->toContain('mudou desde que você conferiu')
        ->and($resposta->json('previa.assinatura'))->not->toBe($payload['assinatura'])
        ->and(fotoDaAgenda())->toBe($antes)
        ->and(app(ContextoDoLote::class)->id())->toBeNull();
});

it('deve responder 409 quando o saldo de um elegível mudou entre a prévia e a execução', function () {
    // ARRANGE — a prévia viu saldo 1; outro caminho o consumiu antes da execução
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $pacote = pacoteDaBaixa($base, total: 10, realizadas: 9);
    agendamentoDaBaixa($base, diaDaBaixa().' 09:00', ['tratamento_id' => $pacote->id]);
    $payload = previaLida($this, $adminDaClinica, alcanceDaBaixa($base, $base['status']['finalizado']));
    $pacote->forceFill(['sessoes_realizadas' => 10])->save();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', $payload);

    // ASSERT — a prévia nova recusa a linha por sem_saldo
    $resposta->assertStatus(409)
        ->assertJsonPath('erro', 'previa_desatualizada')
        ->assertJsonPath('previa.contagens.agendamentos', 0)
        ->assertJsonPath('previa.recusados.0.motivo', 'sem_saldo');
});

it('deve manter de fora o horário que começou entre a prévia e a execução, pela referência', function () {
    // ARRANGE — a prévia é calculada 10 minutos ATRÁS (relógio de teste); um agendamento das
    // "19:00" começa 5 minutos antes do agora real — depois da referência, antes da execução
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $agora = agoraNaClinica()->copy()->startOfMinute();
    // (horários sem sobreposição: o verificador de conflitos também vale para o lote)
    $noMeio = agendamentoDaBaixa($base, $agora->copy()->subMinutes(5)->format('Y-m-d H:i'));
    $antigo = agendamentoDaBaixa($base, $agora->copy()->subMinutes(60)->format('Y-m-d H:i'));
    $alcance = alcanceDaBaixa($base, $base['status']['falta_justificada'], $antigo->inicio->format('Y-m-d'), $noMeio->inicio->format('Y-m-d'));

    Carbon::setTestNow($agora->copy()->subMinutes(10));
    $payload = previaLida($this, $adminDaClinica, $alcance);
    Carbon::setTestNow();

    // ACT — a execução chega quando o das "19:00" já começou
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', $payload);

    // ASSERT — prossegue, e a linha continua de fora como foi vista
    $resposta->assertOk()
        ->assertJsonPath('aplicados', 1)
        ->assertJsonPath('recusados.0.id', $noMeio->id)
        ->assertJsonPath('recusados.0.motivo', 'ainda_nao_comecou');
    expect($noMeio->refresh()->status_id)->toBe($base['status']['inicial'])
        ->and($antigo->refresh()->status_id)->toBe($base['status']['falta_justificada']);
});

it('deve responder 409 quando a referência tem mais de 30 minutos ou está no futuro', function () {
    // ARRANGE — três prévias REAIS, emitidas pelo servidor com o relógio em três "agoras": o
    // teste não replica a fórmula da assinatura (ela é HMAC com a chave do servidor, SEC-BL-02)
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    agendamentoDaBaixa($base, diaDaBaixa().' 09:00');
    $alcance = alcanceDaBaixa($base, $base['status']['finalizado']);
    $agora = now();
    $previaEmitidaEm = function (Carbon $quando) use ($alcance, $adminDaClinica): array {
        $this->travelTo($quando);
        $payload = previaLida($this, $adminDaClinica, $alcance);
        $this->travelBack();

        return $payload;
    };
    $daVelha = $previaEmitidaEm($agora->copy()->subMinutes(45));
    $daFutura = $previaEmitidaEm($agora->copy()->addMinutes(5));
    $daValida = $previaEmitidaEm($agora->copy()->subMinutes(20));

    // ACT — a execução roda no "agora" de verdade
    $velha = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', $daVelha);
    $futura = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', $daFutura);
    $valida = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', $daValida);

    // ASSERT — os dois 409 com a prévia nova; a de 20 minutos passa
    foreach ([$velha, $futura] as $resposta) {
        $resposta->assertStatus(409)
            ->assertJsonPath('erro', 'previa_desatualizada')
            ->assertJsonPath('previa.contagens.agendamentos', 1);
    }
    expect(Str::length($velha->json('previa.assinatura')))->toBe(64);
    $valida->assertOk()->assertJsonPath('aplicados', 1);
});

it('deve exigir assinatura e referência só na execução', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $alcance = alcanceDaBaixa($base, $base['status']['finalizado']);

    // ACT
    $previa = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa', $alcance);
    $execucao = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', $alcance);
    $malFormada = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', [
        ...$alcance, 'assinatura' => 'nao-e-sha256', 'referencia' => '10/09/2026 18:59',
    ]);

    // ASSERT
    $previa->assertOk();
    $execucao->assertStatus(422)->assertJsonValidationErrors(['assinatura', 'referencia']);
    $malFormada->assertStatus(422)->assertJsonValidationErrors(['assinatura', 'referencia']);
});

it('deve recusar a assinatura montada fora do servidor: a prévia obrigatória é fato da chave, não da tela', function () {
    // ARRANGE — o "cliente" conhece os ids elegíveis (lê a agenda) e a fórmula pública da
    // assinatura, e a monta localmente SEM chamar a prévia (achado SEC-BL-02 do gate)
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $dia = diaDaBaixa();
    $ids = [agendamentoDaBaixa($base, "{$dia} 09:00")->id, agendamentoDaBaixa($base, "{$dia} 10:00")->id];
    $statusId = $base['status']['finalizado'];
    $referencia = app(BaixaEmLote::class)->agoraNaParede()->format('Y-m-d H:i');
    $forjada = hash('sha256', implode(',', $ids).'|'.$statusId.'|'.$referencia);
    $antes = fotoDaAgenda();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', [
        ...alcanceDaBaixa($base, $statusId), 'assinatura' => $forjada, 'referencia' => $referencia,
    ]);

    // ASSERT — 409 como prévia velha (a resposta não distingue forjada de envelhecida), nada
    // gravado; e a prévia REAL do mesmo conjunto tem outra assinatura — a chave do servidor entrou
    $resposta->assertStatus(409)->assertJsonPath('erro', 'previa_desatualizada');
    expect(fotoDaAgenda())->toBe($antes)
        ->and($resposta->json('previa.assinatura'))->toMatch('/^[0-9a-f]{64}$/')
        ->and($resposta->json('previa.assinatura'))->not->toBe($forjada);
});

it('deve deixar o lote passar sem a linha que o domínio recusa: faturado não estorna e não derruba os demais', function () {
    // ARRANGE — alvo não-descontante; 1 em aberto já consumido E faturado, entre outros 2 elegíveis
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $dia = diaDaBaixa();
    $pacote = pacoteDaBaixa($base, total: 10, realizadas: 3);
    $faturado = agendamentoDaBaixa($base, "{$dia} 09:00", ['tratamento_id' => $pacote->id]);
    $faturado->forceFill(['sessao_consumida_em' => "{$dia} 09:40"])->save();
    $lancamento = lancamentoDoTratamento($pacote->id, $dia);
    $lancamento->agendamento_id = $faturado->id;
    $lancamento->save();
    $livre1 = agendamentoDaBaixa($base, "{$dia} 10:00");
    $livre2 = agendamentoDaBaixa($base, "{$dia} 11:00");
    $payload = previaLida($this, $adminDaClinica, alcanceDaBaixa($base, $base['status']['falta_justificada']));

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', $payload);

    // ASSERT — 2 aplicados, o faturado recusado com a frase crua do domínio, sessão intacta
    $resposta->assertOk()
        ->assertJsonPath('aplicados', 2)
        ->assertJsonPath('recusados.0.id', $faturado->id);
    expect($resposta->json('recusados.0.motivo'))->toContain('faturado')
        ->and($faturado->refresh()->status_id)->toBe($base['status']['inicial'])
        ->and($faturado->sessao_consumida_em)->not->toBeNull()
        ->and($pacote->refresh()->sessoes_realizadas)->toBe(3)
        ->and($livre1->refresh()->status_id)->toBe($base['status']['falta_justificada'])
        ->and($livre2->refresh()->status_id)->toBe($base['status']['falta_justificada']);

    // a linha-mãe registra a recusa com o motivo, e o lote reconstitui pelo id
    $mae = Auditoria::where('lote_id', $resposta->json('lote_id'))->where('acao', 'baixa_em_lote')->firstOrFail();
    expect($mae->diff_json['depois']['recusados'][0]['agendamento_id'])->toBe($faturado->id)
        ->and($mae->diff_json['depois']['aplicados'])->toBe(2);
});

it('deve reverter tudo e fechar o contexto quando um passo falha depois da 3ª linha', function () {
    // ARRANGE — 5 em aberto; o aplicador falha no 4º passo (um erro que NÃO é recusa de linha)
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $dia = diaDaBaixa();
    $pacote = pacoteDaBaixa($base, total: 10);
    $agendamentos = collect(['08:00', '09:00', '10:00', '11:00', '12:00'])
        ->map(fn (string $hora) => agendamentoDaBaixa($base, "{$dia} {$hora}", ['tratamento_id' => $pacote->id]));
    $payload = previaLida($this, $adminDaClinica, alcanceDaBaixa($base, $base['status']['finalizado']));
    $antes = fotoDaAgenda();

    $this->app->bind(AplicadorDeStatusEmLote::class, fn () => new class(app(AgendamentoService::class)) extends AplicadorDeStatusEmLote
    {
        public function aplicar(iterable $agendamentos, int $statusId): array
        {
            parent::aplicar(collect($agendamentos)->take(3), $statusId);

            throw new RuntimeException('falha forçada no 4º passo');
        }
    });

    // ACT
    $resposta = $this->withoutExceptionHandling()->actingAs($adminDaClinica);
    $falhou = null;
    try {
        $resposta->postJson('/api/agendamentos/baixa-em-lote', $payload);
    } catch (RuntimeException $erro) {
        $falhou = $erro->getMessage();
    }

    // ASSERT — nada alterado, nada auditado, contexto fechado; a escrita seguinte nasce sem lote
    expect($falhou)->toBe('falha forçada no 4º passo')
        ->and(fotoDaAgenda())->toBe($antes)
        ->and(Auditoria::whereNotNull('lote_id')->count())->toBe(0)
        ->and(app(ContextoDoLote::class)->id())->toBeNull();

    $primeiro = $agendamentos->first();
    app(AgendamentoService::class)->atualizar($primeiro, [
        'status_id' => $base['status']['falta_justificada'],
        'inicio' => $primeiro->inicio->format('Y-m-d H:i'),
        'profissional_id' => $primeiro->profissional_id,
    ]);
    expect(Auditoria::where('entidade', 'agendamentos')->where('entidade_id', $primeiro->id)
        ->where('acao', 'atualizou')->firstOrFail()->lote_id)->toBeNull();
});

it('deve recusar quando aplicavel_em_lote é desligada entre a validação e a transação', function () {
    // ARRANGE — o admin desliga a flag no exato instante em que a transação do lote abre
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $agendamento = agendamentoDaBaixa($base, diaDaBaixa().' 09:00');
    $payload = previaLida($this, $adminDaClinica, alcanceDaBaixa($base, $base['status']['finalizado']));
    $nivelBase = DB::transactionLevel();
    Event::listen(TransactionBeginning::class, function () use ($nivelBase, $base): void {
        if (DB::transactionLevel() === $nivelBase + 1) {
            DB::table('status_agendamento')->where('id', $base['status']['finalizado'])->update(['aplicavel_em_lote' => false]);
        }
    });

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', $payload);

    // ASSERT — a validação antes da transação passou; a releitura dentro dela recusou
    $resposta->assertStatus(422)->assertJsonValidationErrors(['status_id']);
    expect($agendamento->refresh()->status_id)->toBe($base['status']['inicial'])
        ->and(Auditoria::whereNotNull('lote_id')->count())->toBe(0)
        ->and(app(ContextoDoLote::class)->id())->toBeNull();
});

it('deve não encadear ao finalizar em lote com o encadeamento ligado', function () {
    // ARRANGE — a mesma criança 2× hoje: uma que já passou (entra) e uma depois da referência
    // (fica de fora). Com `encadear: true`, finalizar a primeira puxaria a segunda para o alvo
    // do encadeamento — fora do alcance que a prévia mostrou (D9).
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $agora = agoraNaClinica()->copy()->startOfMinute();
    $passou = agendamentoDaBaixa($base, $agora->copy()->subMinutes(60)->format('Y-m-d H:i'));
    $depois = agendamentoDaBaixa($base, $agora->copy()->addMinutes(2)->format('Y-m-d H:i'));
    $alvoDoEncadeamento = StatusAgendamento::where('nome', 'Aguardando Atendimento')->firstOrFail();
    app(ConfiguracaoService::class)->set('agenda.encadeamento_ativo', true);
    app(ConfiguracaoService::class)->set('agenda.encadeamento_status_id', $alvoDoEncadeamento->id);
    $payload = previaLida($this, $adminDaClinica, alcanceDaBaixa(
        $base, $base['status']['finalizado'], $passou->inicio->format('Y-m-d'), $depois->inicio->format('Y-m-d'),
    ));

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', $payload);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('aplicados', 1)->assertJsonPath('recusados.0.motivo', 'ainda_nao_comecou');
    expect($passou->refresh()->status_id)->toBe($base['status']['finalizado'])
        ->and($depois->refresh()->status_id)->toBe($base['status']['inicial']);
});

it('deve responder 403 igual para colega e inexistente, na prévia e na execução, e aceitar a própria agenda', function () {
    // ARRANGE — usuário escopado ao profissional A; B é colega; o inexistente não existe
    admin();
    $base = baseDaBaixa();
    $colega = Profissional::factory()->create()->id;
    $inexistente = Profissional::withoutGlobalScopes()->max('id') + 1000;
    $escopado = usuarioEscopadoEm(Profissional::findOrFail($base['profissional_id']));
    agendamentoDaBaixa($base, diaDaBaixa().' 09:00');
    $alcance = alcanceDaBaixa($base, $base['status']['finalizado']);
    $execucaoFalsa = [...$alcance, 'assinatura' => str_repeat('a', 64), 'referencia' => agoraNaClinica()->format('Y-m-d H:i')];

    // ACT
    $respostas = [];
    foreach (['colega' => $colega, 'inexistente' => $inexistente] as $rotulo => $profissionalId) {
        $respostas["previa/{$rotulo}"] = $this->actingAs($escopado)
            ->postJson('/api/agendamentos/baixa-em-lote/previa', [...$alcance, 'profissional_id' => $profissionalId]);
        $respostas["execucao/{$rotulo}"] = $this->actingAs($escopado)
            ->postJson('/api/agendamentos/baixa-em-lote', [...$execucaoFalsa, 'profissional_id' => $profissionalId]);
    }
    $propria = $this->actingAs($escopado)->postJson('/api/agendamentos/baixa-em-lote/previa', $alcance);

    // ASSERT — os quatro 403 com a mesma frase, sem contagem nenhuma; a própria agenda passa
    foreach ($respostas as $resposta) {
        $resposta->assertStatus(403)->assertJsonPath('message', 'Fora do seu escopo de profissional.');
        expect($resposta->json('contagens'))->toBeNull();
    }
    $propria->assertOk()->assertJsonPath('contagens.agendamentos', 1);
});

it('deve responder 422 em profissional_id para quem vê todos, com profissional inexistente', function () {
    // ARRANGE — o admin é plano
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $inexistente = Profissional::max('id') + 1000;
    $alcance = alcanceDaBaixa($base, $base['status']['finalizado']);

    // ACT
    $naoExiste = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa', [...$alcance, 'profissional_id' => $inexistente]);

    // ASSERT
    $naoExiste->assertStatus(422)->assertJsonValidationErrors(['profissional_id']);
});

it('deve aplicar 100 linhas fictícias numa transação só, com o lote inteiro sob o mesmo id', function () {
    // ARRANGE — 100 crianças fictícias, cada uma com pacote, no mesmo dia (task 5.5: a medição)
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    app(ConfiguracaoService::class)->set('agenda.baixa_em_lote_maximo', 200);
    // 25 por dia em 4 dias, de 40 em 40 minutos: sessões que não se sobrepõem (o verificador
    // de conflitos vale para o lote como para o card)
    $modelo = payloadDeTratamento(); // um convênio e um serviço para os 100 pacotes
    for ($i = 0; $i < 100; $i++) {
        $dia = diaDaBaixa(4 - intdiv($i, 25));
        $crianca = Paciente::factory()->create()->id;
        $pacote = Tratamento::create([
            ...$modelo,
            'paciente_id' => $crianca,
            'profissional_id' => $base['profissional_id'],
            'especialidade_id' => $base['especialidade_id'],
        ]);
        $minutos = ($i % 25) * 40;
        $hora = sprintf('%02d:%02d', intdiv($minutos, 60), $minutos % 60);
        agendamentoDaBaixa($base, "{$dia} {$hora}", ['paciente_id' => $crianca, 'tratamento_id' => $pacote->id]);
    }
    $consultas = 0;
    DB::listen(function () use (&$consultas): void {
        $consultas++;
    });

    // ACT
    $payload = previaLida($this, $adminDaClinica, alcanceDaBaixa($base, $base['status']['finalizado'], diaDaBaixa(4), diaDaBaixa(1)));
    $consultasDaPrevia = $consultas;
    $consultas = 0;
    $inicio = hrtime(true);
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', $payload);
    $milissegundos = (int) ((hrtime(true) - $inicio) / 1_000_000);
    $consultasDaExecucao = $consultas;

    // ASSERT — 100 aplicados, 100 sessões, um lote só. A prévia lê cada tabela do lote UMA vez
    // (agendamentos, atendimentos, tratamentos); o que cresce com N é a guarda de ciclo — a fonte
    // única `emCicloFechado`, 2 consultas por linha com pacote — e o orçamento abaixo é o freio
    // contra um N+1 NOVO (hidratar status ou paciente por linha). Medido em 2026-09-11: prévia
    // 216 consultas; execução 2513 consultas (~25 por linha, o `atualizar` reentrando nas
    // guardas) em ~1,2 s.
    $resposta->assertOk()
        ->assertJsonPath('aplicados', 100)
        ->assertJsonPath('contagens.criancas', 100)
        ->assertJsonPath('contagens.sessoes_descontadas', 100);
    expect(Auditoria::where('lote_id', $resposta->json('lote_id'))->where('entidade', 'tratamentos')->distinct('entidade_id')->count('entidade_id'))->toBe(100)
        ->and($consultasDaPrevia)->toBeLessThanOrEqual(2 * 100 + 50)
        ->and($consultasDaExecucao)->toBeLessThanOrEqual(30 * 100)
        ->and($milissegundos)->toBeLessThan(30_000);
});
