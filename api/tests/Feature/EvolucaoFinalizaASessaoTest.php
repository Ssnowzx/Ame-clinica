<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Auditoria;
use App\Models\Evolucao;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Agenda\AgendamentoService;
use App\Support\Agenda\SerializadorDeAgendamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Database\Events\TransactionBeginning;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Exceptions;

/*
 * A configuração "Status aplicado ao salvar a evolução" (change evolucao-finaliza-a-sessao, D3).
 *
 * A clínica perguntou em 02/10: "escrevemos a evolução e mesmo assim precisa apertar em finalizar
 * com evolução". O status que a evolução aplica é DADO da clínica (§13), nasce desligado, e só aceita
 * status que FINALIZA a sessão — desconta e ocupa horário. Um status que libera o horário seria um
 * desmarque escondido atrás de "salvar a evolução". Dados 100% FICTÍCIOS.
 */

const CHAVE_DO_STATUS_AO_SALVAR = 'evolucoes.status_ao_salvar';

function statusQueFinaliza(): StatusAgendamento
{
    return StatusAgendamento::query()->where('desconta_sessao', true)->where('ocupa_horario', true)->where('marca_falta', false)->firstOrFail();
}

/** O status com estas flags — o da base, ou um FICTÍCIO criado aqui quando a base não o tem. */
function statusComAsFlags(array $flags): StatusAgendamento
{
    return StatusAgendamento::query()->where($flags)->first()
        ?? StatusAgendamento::create(['nome' => 'Status Fictício', 'cor' => '#94A3B8', 'tipo' => 'x', 'ordem' => 98, ...$flags]);
}

it('deve nascer desligada', function () {
    // ARRANGE
    admin();

    // ACT
    $valor = app(ConfiguracaoService::class)->get(CHAVE_DO_STATUS_AO_SALVAR);

    // ASSERT
    expect($valor)->toBe(0);
});

it('deve aceitar um status que desconta a sessão e ocupa o horário', function () {
    // ARRANGE
    $admin = admin();
    $finaliza = statusQueFinaliza();

    // ACT
    $resposta = $this->actingAs($admin)->putJson('/api/configuracoes', ['chave' => CHAVE_DO_STATUS_AO_SALVAR, 'valor' => $finaliza->id]);

    // ASSERT
    $resposta->assertOk();
    expect(app(ConfiguracaoService::class)->get(CHAVE_DO_STATUS_AO_SALVAR))->toBe($finaliza->id);
});

it('deve recusar o status que não finaliza a sessão', function (array $flags) {
    // ARRANGE — "Desmarcado pelo Paciente" libera o horário; "Em Aberto" não desconta; "Não Compareceu"
    // desconta e segura o horário, mas é FALTA: salvar a evolução não pode marcar a criança ausente
    $admin = admin();
    $status = statusComAsFlags($flags);

    // ACT
    $resposta = $this->actingAs($admin)->putJson('/api/configuracoes', ['chave' => CHAVE_DO_STATUS_AO_SALVAR, 'valor' => $status->id]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors(['valor']);
})->with([
    'que libera o horário' => [['ocupa_horario' => false]],
    'que não desconta' => [['desconta_sessao' => false, 'ocupa_horario' => true]],
    'que marca falta' => [['desconta_sessao' => true, 'ocupa_horario' => true, 'marca_falta' => true]],
    // gate CR-EVO-R2-08: a régua do servidor é a mesma do aviso da tela (sessão MARCADA exclui reserva)
    'que é reserva' => [['desconta_sessao' => true, 'ocupa_horario' => true, 'marca_falta' => false, 'marca_reserva' => true]],
]);

it('deve auditar quem ligou a finalização pela evolução', function () {
    // ARRANGE
    $admin = admin();
    $finaliza = statusQueFinaliza();

    // ACT
    $this->actingAs($admin)->putJson('/api/configuracoes', ['chave' => CHAVE_DO_STATUS_AO_SALVAR, 'valor' => $finaliza->id])->assertOk();

    // ASSERT
    $registro = Auditoria::where('entidade', 'configuracoes')->latest('id')->firstOrFail();
    expect($registro->diff_json['depois']['chave'])->toBe(CHAVE_DO_STATUS_AO_SALVAR)
        ->and($registro->usuario_id)->toBe($admin->id);
});

it('deve oferecer à tela a lista dos status que finalizam a sessão', function () {
    // ARRANGE — os alvos de hoje são os que NÃO descontam; a chave nova precisa dos que descontam
    $admin = admin();
    $finaliza = statusQueFinaliza();
    $falta = statusComAsFlags(['desconta_sessao' => true, 'ocupa_horario' => true, 'marca_falta' => true]);

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/configuracoes/alvos-encadeamento');

    // ASSERT — nem o que não desconta, nem o que libera o horário, nem a falta
    $resposta->assertOk();
    $ids = collect($resposta->json('finalizam'))->pluck('id');
    expect($ids)->toContain($finaliza->id)->not->toContain($falta->id)
        ->and(StatusAgendamento::query()->whereKey($ids)->where(fn ($q) => $q->where('desconta_sessao', false)->orWhere('ocupa_horario', false))->count())->toBe(0);
});

/*
 * Salvar a evolução finaliza a sessão (D2) e a evolução se escreve direto da sessão (D1).
 */

/** A sessão de ontem às 14:00, "Em Aberto", com pacote de 10 sessões, e a chave ligada. */
function sessaoParaEvoluir(bool $ligada = true, int $realizadas = 0, ?string $quando = null): array
{
    $base = baseDaBaixa();
    $pacote = pacoteDaBaixa($base, 10, $realizadas);
    $sessao = agendamentoDaBaixa($base, $quando ?? agoraNaClinica()->subDay()->format('Y-m-d').' 14:00', ['tratamento_id' => $pacote->id]);
    if ($ligada) {
        app(ConfiguracaoService::class)->set(CHAVE_DO_STATUS_AO_SALVAR, $base['status']['finalizado']);
    }

    return [$base, $sessao, $pacote];
}

/** A evolução fictícia, assinada pelo profissional da sessão (o admin não tem vínculo). */
function evolucaoDaSessao(array $base): array
{
    return [
        'profissional_id' => $base['profissional_id'],
        'conteudo' => 'Evolução clínica fictícia da sessão.',
        'motivo_assinatura' => 'Registro administrativo em teste.',
    ];
}

it('deve registrar, evoluir e finalizar a sessão num gesto só', function () {
    // ARRANGE
    $admin = admin();
    [$base, $sessao, $pacote] = sessaoParaEvoluir();

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT — atendimento com término no fim da sessão, evolução, status e desconto do pacote
    $resposta->assertCreated()->assertJsonPath('sessao.finalizada', true);
    $sessao->refresh();
    expect($sessao->atendimento?->finalizado_em?->format('Y-m-d H:i'))->toBe($sessao->fim->format('Y-m-d H:i'))
        ->and($sessao->atendimento?->evolucao)->not->toBeNull()
        ->and($sessao->status_id)->toBe($base['status']['finalizado'])
        ->and($pacote->refresh()->sessoes_realizadas)->toBe(1);
});

it('deve finalizar também pelo caminho de hoje, com a sessão já registrada', function () {
    // ARRANGE — "Registrar sessão" primeiro e "Escrever evolução" depois: a regra vale para toda evolução
    $admin = admin();
    [$base, $sessao] = sessaoParaEvoluir();
    $atendimento = atendimentoRegistradoNaBaixa($base, $sessao->id, $sessao->fim->format('Y-m-d H:i'));

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/atendimentos/{$atendimento->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('sessao.finalizada', true);
    expect($sessao->refresh()->status_id)->toBe($base['status']['finalizado']);
});

it('deve salvar a evolução e dizer por que não finalizou quando o pacote está sem saldo', function () {
    // ARRANGE — a recusa do status NUNCA derruba o que a profissional escreveu (D2)
    $admin = admin();
    [$base, $sessao] = sessaoParaEvoluir(realizadas: 10);

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertCreated()
        ->assertJsonPath('sessao.finalizada', false);
    expect($resposta->json('sessao.motivo'))->toContain('saldo')
        ->and($sessao->refresh()->atendimento?->evolucao)->not->toBeNull()
        ->and($sessao->status_id)->toBe($base['status']['inicial']);
});

it('não deve mudar a sessão que não está em aberto', function (array $flags) {
    // ARRANGE — desmarcada (libera o horário), já finalizada (desconta) ou com falta: salvar a
    // evolução não reescreve o que a recepção decidiu
    $admin = admin();
    [$base, $sessao] = sessaoParaEvoluir();
    $statusAtual = statusComAsFlags($flags);
    $sessao->forceFill(['status_id' => $statusAtual->id])->save();

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('sessao.finalizada', false);
    expect($sessao->refresh()->status_id)->toBe($statusAtual->id);
})->with([
    'desmarcada' => [['ocupa_horario' => false]],
    'já finalizada' => [['desconta_sessao' => true, 'ocupa_horario' => true]],
    // a falta que SEGURA o horário: não desconta e é marcada, mas tem desfecho
    'com falta' => [['marca_falta' => true, 'ocupa_horario' => true, 'desconta_sessao' => false]],
    // como na base da clínica: Falta Justificada, Consulta e Reposição são marcadas, sem desconto e sem
    // falta — só a flag `em_aberto` as separa de "Em Aberto"
    'marcada sem desfecho em aberto' => [['marca_falta' => false, 'ocupa_horario' => true, 'desconta_sessao' => false, 'marca_reserva' => false, 'em_aberto' => false]],
]);

it('não deve mudar nada com a chave desligada', function () {
    // ARRANGE
    $admin = admin();
    [$base, $sessao, $pacote] = sessaoParaEvoluir(ligada: false);

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT — registra e evolui; o status fica
    $resposta->assertCreated()->assertJsonPath('sessao.finalizada', false);
    expect($sessao->refresh()->status_id)->toBe($base['status']['inicial'])
        ->and($pacote->refresh()->sessoes_realizadas)->toBe(0);
});

it('não deve finalizar ao editar a evolução', function () {
    // ARRANGE — com a chave desligada a evolução nasce; ligar e editar não finaliza
    $admin = admin();
    [$base, $sessao] = sessaoParaEvoluir(ligada: false);
    $evolucao = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base))->assertCreated()->json();
    app(ConfiguracaoService::class)->set(CHAVE_DO_STATUS_AO_SALVAR, $base['status']['finalizado']);

    // ACT
    $this->actingAs($admin)
        ->withHeader('If-Match', $evolucao['updated_at'])
        ->putJson("/api/evolucoes/{$evolucao['id']}", ['conteudo' => 'Evolução fictícia corrigida.'])
        ->assertOk();

    // ASSERT
    expect($sessao->refresh()->status_id)->toBe($base['status']['inicial']);
});

it('deve registrar com término AGORA a sessão de hoje que ainda não terminou', function () {
    // ARRANGE — término nunca no futuro: mín(fim da sessão, agora). Relógio congelado às 10:00 e a
    // sessão às 14:00: sem o congelamento, entre 23:40 e 23:59 o "fim" passava pelo "agora" (CR-EVO-12)
    $this->travelTo(Carbon::parse('2026-10-05 10:00', 'America/Sao_Paulo'));
    $admin = admin();
    [$base, $sessao] = sessaoParaEvoluir(quando: '2026-10-05 14:00');

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertCreated();
    expect($sessao->refresh()->atendimento?->finalizado_em?->format('Y-m-d H:i'))->toBe('2026-10-05 10:00');
});

it('deve aceitar a evolução com o bloqueio pós-status ligado quando a finalização vai acontecer', function () {
    // ARRANGE — D4: o bloqueio olha o status que SERÁ aplicado
    $admin = admin();
    app(ConfiguracaoService::class)->set('evolucoes.bloquear_apos_status', true);
    [$base, $sessao] = sessaoParaEvoluir();

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('sessao.finalizada', true);
});

it('deve recusar como hoje com o bloqueio pós-status ligado e a finalização desligada', function () {
    // ARRANGE
    $admin = admin();
    app(ConfiguracaoService::class)->set('evolucoes.bloquear_apos_status', true);
    [$base, $sessao] = sessaoParaEvoluir(ligada: false);

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT — e nada fica gravado: nem o atendimento
    $resposta->assertUnprocessable()->assertJsonValidationErrors(['evolucao']);
    expect($sessao->refresh()->atendimento)->toBeNull();
});

it('deve exigir a permissão de registrar atendimento, antes de validar', function () {
    // ARRANGE — quem só escreve evolução não registra a sessão por esta porta
    admin();
    [$base, $sessao] = sessaoParaEvoluir();
    $soEvolucao = usuarioCom(['evolucoes.criar', 'evolucoes.assinar_por_outro', 'agenda.ver'], 'Só Evolução Fictícia');

    // ACT — corpo vazio de propósito: 403 vem antes de 422
    $resposta = $this->actingAs($soEvolucao)->postJson("/api/agendamentos/{$sessao->id}/evolucao", []);

    // ASSERT
    $resposta->assertForbidden();
    expect($sessao->refresh()->atendimento)->toBeNull();
});

it('não deve deixar atendimento órfão quando a evolução é recusada', function () {
    // ARRANGE — a recusa vem das invariantes, DEPOIS de o atendimento ser registrado na transação
    // (CR-EVO-11: um corpo inválido era recusado no FormRequest, antes de chegar à transação)
    $admin = admin();
    [$base, $sessao] = sessaoParaEvoluir();
    app(ConfiguracaoService::class)->set('evolucoes.responsavel_tecnico_obrigatorio', true);

    // ACT — sem responsável técnico
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors(['responsavel_tecnico_id']);
    expect($sessao->refresh()->atendimento)->toBeNull();
});

it('deve usar o atendimento que já existe, sem registrar outro', function () {
    // ARRANGE
    $admin = admin();
    [$base, $sessao] = sessaoParaEvoluir();
    $atendimento = atendimentoRegistradoNaBaixa($base, $sessao->id, $sessao->fim->format('Y-m-d H:i'));

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('atendimento_id'))->toBe($atendimento->id)
        ->and(Atendimento::query()->where('agendamento_id', $sessao->id)->count())->toBe(1);
});

it('deve contar o atendimento da evolução escrita dias depois no dia da sessão', function () {
    // ARRANGE — sessão de três dias atrás
    $admin = admin();
    [$base, $sessao] = sessaoParaEvoluir(quando: agoraNaClinica()->subDays(3)->format('Y-m-d').' 14:00');

    // ACT
    $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base))->assertCreated();

    // ASSERT
    expect($sessao->refresh()->atendimento?->finalizado_em?->format('Y-m-d H:i'))->toBe($sessao->fim->format('Y-m-d H:i'));
});

it('não deve deixar o profissional escopado evoluir a sessão de um colega', function () {
    // ARRANGE — D11, eixo clínico: a porta da sessão tem a mesma posse da evolução e do atendimento
    admin();
    [$base, $sessao] = sessaoParaEvoluir();
    $colega = Profissional::factory()->create();
    $escopado = usuarioEscopadoEm($colega, ['evolucoes.criar', 'atendimentos.criar', 'atendimentos.ver']);

    // ACT
    // (corpo VÁLIDO para quem tem vínculo: assina em nome próprio, sem motivo de assinatura por outro)
    $resposta = $this->actingAs($escopado)->postJson("/api/agendamentos/{$sessao->id}/evolucao", [
        'profissional_id' => $colega->id,
        'conteudo' => 'Evolução clínica fictícia da sessão.',
    ]);

    // ASSERT — 403, e nada gravado nem finalizado
    $resposta->assertForbidden();
    expect($sessao->refresh()->atendimento)->toBeNull()
        ->and($sessao->status_id)->toBe($base['status']['inicial']);
});

it('deve manter o bloqueio pós-status na EDIÇÃO, mesmo com a finalização ligada', function () {
    // ARRANGE — D4 só isenta a CRIAÇÃO: editar não finaliza, então o bloqueio vale como hoje
    $admin = admin();
    [$base, $sessao] = sessaoParaEvoluir(ligada: false);
    $evolucao = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base))->assertCreated()->json();
    app(ConfiguracaoService::class)->set('evolucoes.bloquear_apos_status', true);
    app(ConfiguracaoService::class)->set(CHAVE_DO_STATUS_AO_SALVAR, $base['status']['finalizado']);

    // ACT
    $resposta = $this->actingAs($admin)
        ->withHeader('If-Match', $evolucao['updated_at'])
        ->putJson("/api/evolucoes/{$evolucao['id']}", ['conteudo' => 'Evolução fictícia corrigida.']);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors(['evolucao']);
});

it('não deve aplicar o status configurado que deixou de finalizar a sessão', function () {
    // ARRANGE — a clínica apontou o status e depois o editou para não descontar: a chave é relida
    $admin = admin();
    [$base, $sessao, $pacote] = sessaoParaEvoluir();
    StatusAgendamento::query()->whereKey($base['status']['finalizado'])->update(['desconta_sessao' => false]);

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('sessao.finalizada', false);
    expect($sessao->refresh()->status_id)->toBe($base['status']['inicial'])
        ->and($pacote->refresh()->sessoes_realizadas)->toBe(0);
});

it('deve salvar a evolução e não finalizar a sessão de data futura', function () {
    // ARRANGE — a guarda de data futura é do AgendamentoService: a finalização a respeita
    $admin = admin();
    [$base, $sessao, $pacote] = sessaoParaEvoluir(quando: agoraNaClinica()->addDays(2)->format('Y-m-d').' 14:00');

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('sessao.finalizada', false);
    expect($resposta->json('sessao.motivo'))->toContain('data futura')
        ->and($sessao->refresh()->status_id)->toBe($base['status']['inicial'])
        ->and($pacote->refresh()->sessoes_realizadas)->toBe(0);
});

it('deve responder igual pelas duas rotas de evolução', function () {
    // ARRANGE — contrato (design, riscos): mesma gravação e mesma finalização pelos dois caminhos
    $admin = admin();
    [$base, $nova] = sessaoParaEvoluir();
    $registrada = agendamentoDaBaixa($base, agoraNaClinica()->subDays(2)->format('Y-m-d').' 14:00', ['tratamento_id' => pacoteDaBaixa($base, 10, 0)->id]);
    $atendimento = atendimentoRegistradoNaBaixa($base, $registrada->id, $registrada->fim->format('Y-m-d H:i'));

    // ACT
    $pelaSessao = $this->actingAs($admin)->postJson("/api/agendamentos/{$nova->id}/evolucao", evolucaoDaSessao($base))->assertCreated()->json();
    $peloAtendimento = $this->actingAs($admin)->postJson("/api/atendimentos/{$atendimento->id}/evolucao", evolucaoDaSessao($base))->assertCreated()->json();

    // ASSERT
    expect(array_keys($pelaSessao))->toEqualCanonicalizing(array_keys($peloAtendimento))
        ->and(array_keys($pelaSessao['sessao']))->toBe(array_keys($peloAtendimento['sessao']))
        ->and([$pelaSessao['sessao']['finalizada'], $pelaSessao['sessao']['motivo']])->toBe([true, null])
        ->and([$peloAtendimento['sessao']['finalizada'], $peloAtendimento['sessao']['motivo']])->toBe([true, null]);
});

it('deve dizer à agenda quais status estão em aberto, para o painel avisar antes do clique', function () {
    // ARRANGE
    $admin = admin();
    [$base] = sessaoParaEvoluir();

    // ACT
    $status = collect($this->actingAs($admin)->getJson('/api/agenda/selecao')->assertOk()->json('status'))->keyBy('id');

    // ASSERT
    expect($status[$base['status']['inicial']]['em_aberto'])->toBeTrue()
        ->and($status[$base['status']['finalizado']]['em_aberto'])->toBeFalse();
});

it('deve entregar à agenda a chave da finalização pela evolução, junto das de exibição', function () {
    // ARRANGE
    $admin = admin();
    [$base] = sessaoParaEvoluir();

    // ACT
    $linhas = collect($this->actingAs($admin)->getJson('/api/agenda/configuracoes')->assertOk()->json('configuracoes'));

    // ASSERT
    expect($linhas->firstWhere('chave', CHAVE_DO_STATUS_AO_SALVAR)['valor'] ?? null)->toBe($base['status']['finalizado']);
});

it('não deve aplicar o status configurado que passou a marcar falta', function () {
    // ARRANGE — a chave é relida: um status editado para marcar falta deixa de finalizar
    $admin = admin();
    [$base, $sessao] = sessaoParaEvoluir();
    StatusAgendamento::query()->whereKey($base['status']['finalizado'])->update(['marca_falta' => true]);

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('sessao.finalizada', false);
    expect($sessao->refresh()->status_id)->toBe($base['status']['inicial']);
});

it('deve recusar inteira a evolução quando o bloqueio exige o status final e ele é recusado', function (string $caso) {
    // ARRANGE — gate SEC-EVO-01: com o bloqueio ligado, a evolução só passa porque a sessão VAI ser
    // finalizada. Se o status é recusado (data futura, pacote sem saldo), nada pode ficar gravado
    $admin = admin();
    [$base, $sessao] = $caso === 'data futura'
        ? sessaoParaEvoluir(quando: agoraNaClinica()->addDays(3)->format('Y-m-d').' 14:00')
        : sessaoParaEvoluir(realizadas: 10);
    app(ConfiguracaoService::class)->set('evolucoes.bloquear_apos_status', true);

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors(['evolucao']);
    expect($sessao->refresh()->atendimento)->toBeNull()
        ->and($sessao->status_id)->toBe($base['status']['inicial']);
})->with(['data futura', 'pacote sem saldo']);

it('deve recusar a evolução da sessão que não está em aberto com o bloqueio e a finalização ligados', function (array $flags) {
    // ARRANGE — gate CR-EVO-02: a isenção do D4 vale só para a sessão que VAI ser finalizada
    $admin = admin();
    [$base, $sessao] = sessaoParaEvoluir();
    atendimentoRegistradoNaBaixa($base, $sessao->id, $sessao->fim->format('Y-m-d H:i'));
    $sessao->forceFill(['status_id' => statusComAsFlags($flags)->id])->save();
    app(ConfiguracaoService::class)->set('evolucoes.bloquear_apos_status', true);

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors(['evolucao']);
    expect(Evolucao::query()->count())->toBe(0);
})->with([
    'desmarcada' => [['ocupa_horario' => false, 'desconta_sessao' => false]],
    'com falta' => [['marca_falta' => true, 'ocupa_horario' => true, 'desconta_sessao' => false]],
    'marcada sem desfecho em aberto' => [['marca_falta' => false, 'ocupa_horario' => true, 'desconta_sessao' => false, 'marca_reserva' => false, 'em_aberto' => false]],
]);

it('deve encadear a próxima sessão do dia, como a troca pelo menu de status', function () {
    // ARRANGE — gate CR-EVO-06: a finalização passa pelo mesmo caminho do chip, encadeamento incluído
    $admin = admin();
    [$base, $primeira] = sessaoParaEvoluir(quando: agoraNaClinica()->subDay()->format('Y-m-d').' 09:00');
    $segunda = agendamentoDaBaixa($base, agoraNaClinica()->subDay()->format('Y-m-d').' 10:00');
    $alvo = StatusAgendamento::query()->where('em_aberto', true)->whereKeyNot(StatusAgendamento::inicialId())->firstOrFail();
    app(ConfiguracaoService::class)->set('agenda.encadeamento_ativo', true);
    app(ConfiguracaoService::class)->set('agenda.encadeamento_status_id', $alvo->id);

    // ACT
    $this->actingAs($admin)->postJson("/api/agendamentos/{$primeira->id}/evolucao", evolucaoDaSessao($base))
        ->assertCreated()->assertJsonPath('sessao.finalizada', true);

    // ASSERT
    expect(Agendamento::query()->find($segunda->id)->status_id)->toBe($alvo->id);
});

it('deve salvar a evolução e relatar sem dado da criança quando a finalização quebra', function () {
    // ARRANGE — gate CR-EVO-07: o erro inesperado vira 201 com o motivo fixo; o log leva só a forma
    Exceptions::fake();
    $admin = admin();
    [$base, $sessao] = sessaoParaEvoluir();
    $this->mock(AgendamentoService::class, function ($servico): void {
        $servico->shouldReceive('atualizar')->andThrow(new RuntimeException('falha com Criança Fictícia Rosa'));
    });

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertCreated()
        ->assertJsonPath('sessao.finalizada', false)
        ->assertJsonPath('sessao.motivo', 'não foi possível finalizar a sessão agora; finalize pelo status');
    expect($sessao->refresh()->atendimento?->evolucao)->not->toBeNull();
    Exceptions::assertReported(fn (RuntimeException $erro): bool => str_contains($erro->getMessage(), 'Finalização pela evolução não aplicada')
        && ! str_contains($erro->getMessage(), 'Criança Fictícia'));
});

it('deve desligar a finalização quando o status apontado é excluído', function () {
    // ARRANGE — gate SEC-EVO-03: ponteiro sem chave estrangeira não pode ficar pendurado
    $admin = admin();
    $finaliza = StatusAgendamento::create(['nome' => 'Finalizado Fictício', 'cor' => '#94A3B8', 'tipo' => 'x', 'ordem' => 97, 'desconta_sessao' => true, 'ocupa_horario' => true]);
    app(ConfiguracaoService::class)->set(CHAVE_DO_STATUS_AO_SALVAR, $finaliza->id);

    // ACT
    $this->actingAs($admin)->deleteJson("/api/status-agendamento/{$finaliza->id}")->assertNoContent();

    // ASSERT
    expect((int) app(ConfiguracaoService::class)->get(CHAVE_DO_STATUS_AO_SALVAR))->toBe(0);
});

it('não deve encadear pela evolução para um alvo com desfecho', function (array $flags) {
    // ARRANGE — gates SEC-EVO-R2-02 e R3-04: a configuração aceita "Desmarcado pelo Paciente" ou "Falta
    // Justificada" como alvo; pela evolução, isso desmarcaria (ou marcaria falta) em silêncio na próxima
    // sessão da criança — talvez de outra profissional. A cláusula que barra a Falta Justificada é `em_aberto`
    $admin = admin();
    [$base, $primeira] = sessaoParaEvoluir(quando: agoraNaClinica()->subDay()->format('Y-m-d').' 09:00');
    $segunda = agendamentoDaBaixa($base, agoraNaClinica()->subDay()->format('Y-m-d').' 10:00');
    $alvoComDesfecho = statusComAsFlags($flags);
    app(ConfiguracaoService::class)->set('agenda.encadeamento_ativo', true);
    app(ConfiguracaoService::class)->set('agenda.encadeamento_status_id', $alvoComDesfecho->id);

    // ACT
    $this->actingAs($admin)->postJson("/api/agendamentos/{$primeira->id}/evolucao", evolucaoDaSessao($base))
        ->assertCreated()->assertJsonPath('sessao.finalizada', true);

    // ASSERT — a primeira finalizou; a segunda continua como estava
    expect(Agendamento::query()->find($segunda->id)->status_id)->toBe($base['status']['inicial']);
})->with([
    'que libera o horário' => [['desconta_sessao' => false, 'ocupa_horario' => false]],
    'que segura o horário e tem desfecho' => [['desconta_sessao' => false, 'ocupa_horario' => true, 'marca_falta' => false, 'marca_reserva' => false, 'em_aberto' => false]],
]);

it('deve conferir a posse de novo sob a trava, com o bloqueio e a finalização ligados', function () {
    // ARRANGE — gate SEC-EVO-R2-04: a sessão passa a outra profissional ENQUANTO a escrita espera a trava.
    // O ouvinte faz a troca no começo da transação da evolução, antes da leitura travada
    admin();
    [$base, $sessao] = sessaoParaEvoluir();
    $dona = Profissional::query()->findOrFail($base['profissional_id']);
    $colega = Profissional::factory()->create();
    $escopado = usuarioEscopadoEm($dona, ['evolucoes.criar', 'atendimentos.criar', 'atendimentos.ver']);
    app(ConfiguracaoService::class)->set('evolucoes.bloquear_apos_status', true);
    $trocou = false;
    Event::listen(TransactionBeginning::class, function () use (&$trocou, $sessao, $colega): void {
        if (! $trocou) {
            $trocou = true;
            DB::table('agendamentos')->where('id', $sessao->id)->update(['profissional_id' => $colega->id]);
        }
    });

    // ACT
    $resposta = $this->actingAs($escopado)->postJson("/api/agendamentos/{$sessao->id}/evolucao", [
        'profissional_id' => $dona->id,
        'conteudo' => 'Evolução clínica fictícia da sessão.',
    ]);

    // ASSERT — a sessão já não é dela: 403, e nada gravado nem finalizado
    $resposta->assertForbidden();
    expect($trocou)->toBeTrue()
        ->and($sessao->refresh()->atendimento)->toBeNull()
        ->and($sessao->status_id)->toBe($base['status']['inicial']);
});

it('deve devolver a versão do agendamento antes e depois da finalização', function (bool $bloqueio) {
    // ARRANGE — gate CR-EVO-R3-02: o Editar aberto só adota a versão nova se a de antes for a que ele
    // abriu; senão adotaria, junto, a mudança de outra pessoa. O relógio anda para as versões diferirem.
    // Nos DOIS modos: a finalização junto (bloqueio) e a de depois do commit (padrão)
    $admin = admin();
    [$base, $sessao] = sessaoParaEvoluir();
    app(ConfiguracaoService::class)->set('evolucoes.bloquear_apos_status', $bloqueio);
    $antes = SerializadorDeAgendamento::escalares($sessao->refresh())['updated_at'];
    $this->travelTo(agoraNaClinica()->addMinutes(5));

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('sessao.finalizada', true);
    expect($resposta->json('sessao.versao_antes'))->toBe($antes)
        ->and($resposta->json('sessao.versao_depois'))->toBe(SerializadorDeAgendamento::escalares($sessao->refresh())['updated_at'])
        ->and($resposta->json('sessao.versao_depois'))->not->toBe($antes);
})->with(['bloqueio desligado (o padrão)' => [false], 'bloqueio ligado' => [true]]);

it('deve conferir a posse sob a trava também com o bloqueio desligado', function () {
    // ARRANGE — gate SEC-EVO-R3-01: no modo padrão a posse ainda era conferida fora da trava, e a
    // evolução ficava gravada na sessão já passada à colega
    admin();
    [$base, $sessao] = sessaoParaEvoluir();
    $dona = Profissional::query()->findOrFail($base['profissional_id']);
    $colega = Profissional::factory()->create();
    $escopado = usuarioEscopadoEm($dona, ['evolucoes.criar', 'atendimentos.criar', 'atendimentos.ver']);
    $trocou = false;
    Event::listen(TransactionBeginning::class, function () use (&$trocou, $sessao, $colega): void {
        if (! $trocou) {
            $trocou = true;
            DB::table('agendamentos')->where('id', $sessao->id)->update(['profissional_id' => $colega->id]);
        }
    });

    // ACT
    $resposta = $this->actingAs($escopado)->postJson("/api/agendamentos/{$sessao->id}/evolucao", [
        'profissional_id' => $dona->id,
        'conteudo' => 'Evolução clínica fictícia da sessão.',
    ]);

    // ASSERT
    $resposta->assertForbidden();
    expect($trocou)->toBeTrue()
        ->and($sessao->refresh()->atendimento)->toBeNull();
});

it('não deve finalizar a sessão que passou para outra profissional depois da evolução', function () {
    // ARRANGE — gate SEC-EVO-R4-01: no modo padrão a finalização vem depois do commit; nesse intervalo a
    // recepção passa a sessão à colega. O ouvinte faz a troca quando a transação da finalização começa
    // (a evolução já gravada)
    $admin = admin();
    [$base, $sessao, $pacote] = sessaoParaEvoluir();
    $colega = Profissional::factory()->create();
    $trocou = false;
    Event::listen(TransactionBeginning::class, function () use (&$trocou, $sessao, $colega): void {
        $evolucaoGravada = DB::table('evolucoes')->join('atendimentos', 'atendimentos.id', '=', 'evolucoes.atendimento_id')
            ->where('atendimentos.agendamento_id', $sessao->id)->exists();
        if (! $trocou && $evolucaoGravada) {
            $trocou = true;
            DB::table('agendamentos')->where('id', $sessao->id)->update(['profissional_id' => $colega->id]);
        }
    });

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", evolucaoDaSessao($base));

    // ASSERT — a evolução fica (é da sessão que era dela); a sessão da colega não é finalizada por ela
    $resposta->assertCreated()->assertJsonPath('sessao.finalizada', false);
    expect($trocou)->toBeTrue()
        ->and($resposta->json('sessao.motivo'))->toContain('outra profissional')
        ->and($sessao->refresh()->status_id)->toBe($base['status']['inicial'])
        ->and($pacote->refresh()->sessoes_realizadas)->toBe(0);
});
