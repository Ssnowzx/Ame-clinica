<?php

use App\Models\Agendamento;
use App\Models\Auditoria;
use App\Models\Conversa;
use App\Models\LembreteEnviado;
use App\Models\Mensagem;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Usuario;
use App\Support\Auditoria\OrigemDaOperacao;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Mensageria\ClienteSimulado;
use App\Support\Mensageria\ClienteWhatsApp;
use App\Support\Mensageria\DisparoDeLembretes;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/*
 * A clínica marca a sessão como confirmada quando a família confirmou por telefone ou mensagem
 * (change confirmacao-pela-clinica). Vale para o lembrete sem resposta, o não entregue e o que não
 * saiu por falha; e a confirmação encerra os envios daquela sessão.
 *
 * O lembrete sai pelo DISPARO REAL (fila na hora, cliente simulado) sempre que o cenário depende
 * dele. Dados 100% FICTÍCIOS.
 */

const TELEFONE_BOM_DA_CONFIRMACAO = '(11) 98765-4321';

// o formato de 02/10, com dígitos inventados: DDI na frente e um dígito faltando
const TELEFONE_INVALIDO_DA_CONFIRMACAO = '55 49912-3456';

afterEach(function () {
    $this->travelBack();
});

/** Canal conectado, modelo aprovado e automação ligada, com a fila na hora e o cliente simulado. */
function canalDaConfirmacao(): ClienteSimulado
{
    canalConectado();
    templateAprovado();
    app(ConfiguracaoService::class)->set('whatsapp.automatico', true);
    $simulado = new ClienteSimulado;
    app()->instance(ClienteWhatsApp::class, $simulado);
    config(['queue.default' => 'sync']);

    return $simulado;
}

/** Uma sessão de amanhã, marcada, de uma criança com o telefone dado. */
function sessaoParaConfirmar(string $telefone = TELEFONE_BOM_DA_CONFIRMACAO, string $hora = '14:00'): Agendamento
{
    $base = baseDeAgenda();
    Paciente::query()->whereKey($base['paciente_id'])->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => $telefone]]]);
    $agendamento = Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'inicio' => agoraNaClinica()->addDay()->format('Y-m-d').' '.$hora.':00',
    ]);
    $agendamento->forceFill(['lembrete_whatsapp' => true, 'status_id' => StatusAgendamento::inicialId()])->save();

    return $agendamento;
}

/** A linha do lembrete desta sessão, como o disparo a grava — `extras` entram por fora do fillable. */
function lembreteDaSessaoParaConfirmar(Agendamento $agendamento, string $status = LembreteEnviado::ENVIADO, array $extras = []): LembreteEnviado
{
    $linha = LembreteEnviado::create([
        'agendamento_id' => $agendamento->id,
        ...LembreteEnviado::doQueFoiLembrado($agendamento),
        'tipo' => LembreteEnviado::TIPO_AGENDAMENTO,
        'competencia' => $agendamento->inicio->format('Y-m-d'),
        'status' => $status,
    ]);
    $linha->forceFill($extras)->save();

    return $linha;
}

/** Uma mensagem de lembrete que a Meta avisou que falhou — o "não entregue" sem passar pelo disparo. */
function mensagemQueFalhouNaConfirmacao(): Mensagem
{
    $conversa = new Conversa;
    $conversa->telefone_e164 = '+5511987650000';
    $conversa->save();
    $mensagem = new Mensagem;
    $mensagem->forceFill(['conversa_id' => $conversa->id, 'direcao' => 'saida', 'tipo' => 'template', 'status' => 'falhou', 'corpo' => 'Lembrete fictício'])->save();

    return $mensagem;
}

function confirmarPelaClinica(Usuario $usuario, Agendamento $agendamento): TestResponse
{
    return test()->actingAs($usuario)->postJson("/api/agendamentos/{$agendamento->id}/confirmar");
}

/** A confirmação do card, como a GRADE a recebe — não o retorno do POST. */
function confirmacaoNaGrade(Agendamento $agendamento): ?array
{
    $dia = $agendamento->fresh()->inicio->format('Y-m-d');
    $usuario = Usuario::query()->whereHas('roles', fn ($r) => $r->where('name', 'Administrador'))->firstOrFail();
    $cards = test()->actingAs($usuario)->getJson("/api/agenda?de={$dia}&ate={$dia}")->assertOk()->json();

    return collect($cards)->firstWhere('id', $agendamento->id)['confirmacao'] ?? null;
}

/** Corrige o telefone do cadastro da criança — o que a recepção faz depois de ligar. */
function corrigirTelefoneDaSessao(Agendamento $agendamento, string $telefone = TELEFONE_BOM_DA_CONFIRMACAO): void
{
    Paciente::query()->whereKey($agendamento->paciente_id)->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => $telefone]]]);
}

/** Remarca a sessão no MESMO dia, para outra hora, sem passar pela tela (o horário é o que importa). */
function remarcarNoMesmoDia(Agendamento $agendamento, string $hora): void
{
    $dia = $agendamento->inicio->format('Y-m-d');
    DB::table('agendamentos')->where('id', $agendamento->id)->update([
        'inicio' => "{$dia} {$hora}:00",
        'fim' => Carbon\Carbon::parse("{$dia} {$hora}:00")->addMinutes(40)->format('Y-m-d H:i:s'),
    ]);
}

// ── A clínica confirma ─────────────────────────────────────────────────────────────────────────

it('deve confirmar pela clínica a sessão sem resposta, sem mudar o status e sem mandar mensagem', function () {
    // ARRANGE — o lembrete saiu, a família não tocou, e a recepção ligou
    $admin = admin();
    $sessao = sessaoParaConfirmar();
    lembreteDaSessaoParaConfirmar($sessao);
    $mensagensAntes = Mensagem::query()->count();

    // ACT
    $resposta = confirmarPelaClinica($admin, $sessao);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('confirmacao.estado'))->toBe('confirmado')
        ->and($resposta->json('confirmacao.por'))->toBe('clinica')
        ->and(confirmacaoNaGrade($sessao))->toMatchArray(['estado' => 'confirmado', 'por' => 'clinica'])
        ->and(confirmacaoNaGrade($sessao)['em'])->not->toBeNull()
        ->and(LembreteEnviado::query()->sole()->confirmado_por)->toBe($admin->id)
        ->and($sessao->fresh()->status_id)->toBe(StatusAgendamento::inicialId())
        ->and(Mensagem::query()->count())->toBe($mensagensAntes);
});

it('deve confirmar pela clínica o lembrete que não foi entregue', function () {
    // ARRANGE — a Meta avisou que falhou; a recepção ligou
    $admin = admin();
    canalDaConfirmacao();
    $sessao = sessaoParaConfirmar();
    app(DisparoDeLembretes::class)->executar();
    Mensagem::query()->update(['status' => 'falhou']);
    expect(confirmacaoNaGrade($sessao)['estado'])->toBe('nao_entregue');

    // ACT
    $resposta = confirmarPelaClinica($admin, $sessao);

    // ASSERT
    $resposta->assertOk();
    expect(confirmacaoNaGrade($sessao))->toMatchArray(['estado' => 'confirmado', 'por' => 'clinica']);
});

it('deve confirmar pela clínica a sessão que ficou sem lembrete por telefone inválido', function () {
    // ARRANGE — o disparo real recusou o número; a recepção ligou para outro telefone da família
    $admin = admin();
    canalDaConfirmacao();
    $sessao = sessaoParaConfirmar(TELEFONE_INVALIDO_DA_CONFIRMACAO);
    app(DisparoDeLembretes::class)->executar();
    expect(confirmacaoNaGrade($sessao)['estado'])->toBe('nao_enviado');

    // ACT
    $resposta = confirmarPelaClinica($admin, $sessao);

    // ASSERT
    $resposta->assertOk();
    expect(confirmacaoNaGrade($sessao))->toMatchArray(['estado' => 'confirmado', 'por' => 'clinica'])
        ->and(LembreteEnviado::query()->sole()->status)->toBe(LembreteEnviado::NAO_ENVIADO);
});

it('deve recusar confirmar a sessão remarcada depois do lembrete', function () {
    // ARRANGE — o lembrete falava das 14:00; a sessão foi para as 16:00
    $admin = admin();
    $sessao = sessaoParaConfirmar();
    lembreteDaSessaoParaConfirmar($sessao);
    remarcarNoMesmoDia($sessao, '16:00');

    // ACT
    $resposta = confirmarPelaClinica($admin, $sessao);

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors('confirmacao');
    expect(LembreteEnviado::query()->sole()->resposta)->toBeNull();
});

it('deve recusar confirmar por aqui o pedido de desmarque, apontando o Manter a sessão', function () {
    // ARRANGE
    $admin = admin();
    $sessao = sessaoParaConfirmar();
    lembreteDaSessaoParaConfirmar($sessao, extras: ['resposta' => LembreteEnviado::PEDIU_DESMARQUE, 'respondido_em' => now()]);

    // ACT
    $resposta = confirmarPelaClinica($admin, $sessao);

    // ASSERT
    $resposta->assertStatus(422);
    expect($resposta->json('errors.confirmacao.0'))->toContain('Manter a sessão')
        ->and(LembreteEnviado::query()->sole()->resposta)->toBe(LembreteEnviado::PEDIU_DESMARQUE);
});

it('deve recusar confirmar a sessão que a família já confirmou', function () {
    // ARRANGE
    $admin = admin();
    $sessao = sessaoParaConfirmar();
    lembreteDaSessaoParaConfirmar($sessao, extras: ['resposta' => LembreteEnviado::CONFIRMOU, 'respondido_em' => now()]);

    // ACT
    $resposta = confirmarPelaClinica($admin, $sessao);

    // ASSERT — a confirmação da família fica com a origem dela
    $resposta->assertStatus(422);
    expect($resposta->json('errors.confirmacao.0'))->toBe('A sessão já está confirmada.')
        ->and(LembreteEnviado::query()->sole()->confirmado_por)->toBeNull();
});

it('deve recusar confirmar a sessão que ainda não teve lembrete', function () {
    // ARRANGE
    $admin = admin();
    $sessao = sessaoParaConfirmar();

    // ACT
    $resposta = confirmarPelaClinica($admin, $sessao);

    // ASSERT
    $resposta->assertStatus(422);
    expect(LembreteEnviado::query()->count())->toBe(0);
});

it('deve recusar confirmar a sessão dispensada do lembrete pela família', function () {
    // ARRANGE — opt-out é decisão: o card não tem estado, e não há o que confirmar
    $admin = admin();
    $sessao = sessaoParaConfirmar();
    lembreteDaSessaoParaConfirmar($sessao, LembreteEnviado::NAO_ENVIADO, ['motivo' => LembreteEnviado::MOTIVO_OPT_OUT]);

    // ACT
    $resposta = confirmarPelaClinica($admin, $sessao);

    // ASSERT
    $resposta->assertStatus(422);
    expect(LembreteEnviado::query()->sole()->resposta)->toBeNull();
});

it('deve recusar confirmar a sessão que já começou', function () {
    // ARRANGE — o lembrete saiu ontem para a sessão que começou há uma hora
    $admin = admin();
    $sessao = sessaoParaConfirmar();
    $inicio = agoraNaClinica()->subHour()->startOfMinute();
    DB::table('agendamentos')->where('id', $sessao->id)->update([
        'inicio' => $inicio->format('Y-m-d H:i:s'),
        'fim' => $inicio->copy()->addMinutes(40)->format('Y-m-d H:i:s'),
    ]);
    lembreteDaSessaoParaConfirmar($sessao->fresh());

    // ACT
    $resposta = confirmarPelaClinica($admin, $sessao);

    // ASSERT
    $resposta->assertStatus(422);
    expect($resposta->json('errors.confirmacao.0'))->toBe('A sessão já começou.')
        ->and(LembreteEnviado::query()->sole()->resposta)->toBeNull();
});

it('deve recusar do mesmo jeito a sessão de outra agenda e a sessão que não existe', function () {
    // ARRANGE — a profissional escopada não separa "não é minha" de "não existe" pela resposta
    admin();
    $sessao = sessaoParaConfirmar();
    lembreteDaSessaoParaConfirmar($sessao);
    $escopada = usuarioEscopadoEm(Profissional::factory()->create());

    // ACT
    $deOutra = test()->actingAs($escopada)->postJson("/api/agendamentos/{$sessao->id}/confirmar");
    $inexistente = test()->actingAs($escopada)->postJson('/api/agendamentos/999999/confirmar');

    // ASSERT
    $deOutra->assertForbidden();
    $inexistente->assertForbidden();
    expect(LembreteEnviado::query()->sole()->resposta)->toBeNull();
});

it('não deve deixar quem não edita a agenda confirmar a sessão', function () {
    // ARRANGE
    admin();
    $sessao = sessaoParaConfirmar();
    lembreteDaSessaoParaConfirmar($sessao);
    $soVe = usuarioCom(['agenda.ver'], 'Só Vê Fictício');

    // ACT
    $resposta = confirmarPelaClinica($soVe, $sessao);

    // ASSERT
    $resposta->assertForbidden();
    expect(LembreteEnviado::query()->sole()->resposta)->toBeNull();
});

it('deve registrar na trilha da sessão quem confirmou e o estado de antes', function (string $estado, string $antes) {
    // ARRANGE
    $admin = admin();
    $sessao = sessaoParaConfirmar();
    match ($estado) {
        'aguardando' => lembreteDaSessaoParaConfirmar($sessao),
        'nao_entregue' => lembreteDaSessaoParaConfirmar($sessao, extras: ['mensagem_id' => mensagemQueFalhouNaConfirmacao()->id]),
        'nao_enviado' => lembreteDaSessaoParaConfirmar($sessao, LembreteEnviado::NAO_ENVIADO, ['motivo' => 'telefone inválido no cadastro']),
    };
    expect(confirmacaoNaGrade($sessao)['estado'])->toBe($estado);

    // ACT
    confirmarPelaClinica($admin, $sessao)->assertOk();

    // ASSERT
    $trilha = Auditoria::query()->where('entidade', 'agendamentos')->where('entidade_id', $sessao->id)
        ->where('acao', 'confirmou_pela_clinica')->sole();
    expect($trilha->usuario_id)->toBe($admin->id)
        ->and($trilha->autor_tipo)->toBe(OrigemDaOperacao::USUARIO)
        ->and($trilha->diff_json['antes']['confirmacao'])->toBe($antes)
        ->and($trilha->diff_json['depois']['confirmacao'])->toBe('Confirmada pela clínica: a família confirmou por outro canal');
})->with([
    'sem resposta' => ['aguardando', 'Lembrete enviado, sem resposta da família'],
    'não entregue' => ['nao_entregue', 'Lembrete não entregue'],
    'sem lembrete' => ['nao_enviado', 'Lembrete não enviado'],
]);

it('deve dizer na grade que a sessão futura pode ser confirmada e a que já começou não', function () {
    // ARRANGE — gate r1, CR-CC-04: é o servidor que decide, para a tela não oferecer o que ele recusa
    admin();
    $futura = sessaoParaConfirmar();
    lembreteDaSessaoParaConfirmar($futura);
    $comecou = sessaoParaConfirmar(hora: '15:00');
    $inicio = agoraNaClinica()->subHour()->startOfMinute();
    DB::table('agendamentos')->where('id', $comecou->id)->update([
        'inicio' => $inicio->format('Y-m-d H:i:s'),
        'fim' => $inicio->copy()->addMinutes(40)->format('Y-m-d H:i:s'),
    ]);
    lembreteDaSessaoParaConfirmar($comecou->fresh());

    // ACT
    $daFutura = confirmacaoNaGrade($futura);
    $daQueComecou = confirmacaoNaGrade($comecou);

    // ASSERT
    expect($daFutura)->toMatchArray(['estado' => 'aguardando', 'confirmavel' => true])
        ->and($daQueComecou)->toMatchArray(['estado' => 'aguardando', 'confirmavel' => false]);
});

it('deve confirmar a sessão de daqui a duas horas no relógio da clínica', function () {
    // ARRANGE — gate r1, CR-CC-05: o `inicio` é a parede da clínica; comparar com o relógio do servidor
    // (UTC, três horas à frente) recusaria esta sessão
    $admin = admin();
    $sessao = sessaoParaConfirmar();
    $inicio = agoraNaClinica()->addHours(2)->startOfMinute();
    DB::table('agendamentos')->where('id', $sessao->id)->update([
        'inicio' => $inicio->format('Y-m-d H:i:s'),
        'fim' => $inicio->copy()->addMinutes(40)->format('Y-m-d H:i:s'),
    ]);
    lembreteDaSessaoParaConfirmar($sessao->fresh());

    // ACT
    $resposta = confirmarPelaClinica($admin, $sessao);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('confirmacao'))->toMatchArray(['estado' => 'confirmado', 'por' => 'clinica']);
});

it('deve recusar quando a sessão passa para a agenda de outra profissional enquanto a confirmação espera a trava', function () {
    // ARRANGE — gate r1, SEC-CC-01: a recepção passa a sessão para a colega entre a checagem de posse e a
    // trava; a profissional escopada não pode confirmar o que já não é dela
    admin();
    $sessao = sessaoParaConfirmar();
    lembreteDaSessaoParaConfirmar($sessao);
    $dona = usuarioEscopadoEm(Profissional::query()->findOrFail($sessao->profissional_id));
    $colega = Profissional::factory()->create();
    $passou = false;
    DB::listen(function ($consulta) use (&$passou, $sessao, $colega): void {
        if (! $passou && str_contains($consulta->sql, 'lembretes_enviados') && str_contains(strtolower($consulta->sql), 'for update')) {
            $passou = true;
            DB::table('agendamentos')->where('id', $sessao->id)->update(['profissional_id' => $colega->id]);
        }
    });

    // ACT
    $resposta = confirmarPelaClinica($dona, $sessao);

    // ASSERT
    $resposta->assertForbidden();
    expect($passou)->toBeTrue()
        ->and(LembreteEnviado::query()->sole()->resposta)->toBeNull();
});

it('deve recusar manter a sessão quando ela passa para a agenda de outra profissional enquanto espera a trava', function () {
    // ARRANGE — o mesmo furo no "Manter a sessão" (gate r1, SEC-CC-01)
    admin();
    $sessao = sessaoParaConfirmar();
    lembreteDaSessaoParaConfirmar($sessao, extras: ['resposta' => LembreteEnviado::PEDIU_DESMARQUE, 'respondido_em' => now()]);
    $dona = usuarioEscopadoEm(Profissional::query()->findOrFail($sessao->profissional_id));
    $colega = Profissional::factory()->create();
    $passou = false;
    DB::listen(function ($consulta) use (&$passou, $sessao, $colega): void {
        if (! $passou && str_contains($consulta->sql, 'lembretes_enviados') && str_contains(strtolower($consulta->sql), 'for update')) {
            $passou = true;
            DB::table('agendamentos')->where('id', $sessao->id)->update(['profissional_id' => $colega->id]);
        }
    });

    // ACT
    $resposta = test()->actingAs($dona)->postJson("/api/agendamentos/{$sessao->id}/manter-sessao");

    // ASSERT
    $resposta->assertForbidden();
    expect($passou)->toBeTrue()
        ->and(LembreteEnviado::query()->sole()->resposta)->toBe(LembreteEnviado::PEDIU_DESMARQUE);
});

it('deve responder 404, e não erro do servidor, a um id que não é número', function () {
    // ARRANGE — gate r1, SEC-CC-04
    $admin = admin();

    // ACT
    $confirmar = test()->actingAs($admin)->postJson('/api/agendamentos/abc/confirmar');
    $manter = test()->actingAs($admin)->postJson('/api/agendamentos/abc/manter-sessao');
    // gate r2: um número que estoura o `int` do controller também é 404, não 500
    $gigante = test()->actingAs($admin)->postJson('/api/agendamentos/99999999999999999999999/confirmar');

    // ASSERT
    $confirmar->assertNotFound();
    $manter->assertNotFound();
    $gigante->assertNotFound();
});

it('não deve deixar apagar o usuário que confirmou, para a confirmação não virar da família', function () {
    // ARRANGE — gate r1, SEC-CC-05: com o usuário apagado, `confirmado_por` nulo diria "pela família"
    $admin = admin();
    $sessao = sessaoParaConfirmar();
    lembreteDaSessaoParaConfirmar($sessao);
    confirmarPelaClinica($admin, $sessao)->assertOk();

    // ACT
    $apagar = fn () => DB::table('usuarios')->where('id', $admin->id)->delete();

    // ASSERT
    expect($apagar)->toThrow(QueryException::class);
    expect(confirmacaoNaGrade($sessao)['por'])->toBe('clinica');
});

// ── A confirmação encerra os envios daquela sessão ─────────────────────────────────────────────

it('não deve mandar o lembrete quando o telefone é corrigido depois da confirmação pela clínica', function () {
    // ARRANGE — não saiu por telefone inválido, a recepção ligou, confirmou e corrigiu o cadastro
    $admin = admin();
    $simulado = canalDaConfirmacao();
    $sessao = sessaoParaConfirmar(TELEFONE_INVALIDO_DA_CONFIRMACAO);
    app(DisparoDeLembretes::class)->executar();
    confirmarPelaClinica($admin, $sessao)->assertOk();
    corrigirTelefoneDaSessao($sessao);

    // ACT — a volta seguinte do disparo
    app(DisparoDeLembretes::class)->executar();

    // ASSERT
    expect($simulado->enviados)->toBe([])
        ->and(Mensagem::query()->count())->toBe(0)
        ->and(confirmacaoNaGrade($sessao))->toMatchArray(['estado' => 'confirmado', 'por' => 'clinica']);
});

it('deve mandar o lembrete só do irmão que a clínica não confirmou', function () {
    // ARRANGE — dois irmãos com o mesmo telefone inválido; a recepção confirmou só um
    $admin = admin();
    $simulado = canalDaConfirmacao();
    $confirmado = sessaoParaConfirmar(TELEFONE_INVALIDO_DA_CONFIRMACAO, '09:00');
    $irmao = sessaoParaConfirmar(TELEFONE_INVALIDO_DA_CONFIRMACAO, '10:00');
    app(DisparoDeLembretes::class)->executar();
    confirmarPelaClinica($admin, $confirmado)->assertOk();
    corrigirTelefoneDaSessao($confirmado);
    corrigirTelefoneDaSessao($irmao);

    // ACT
    app(DisparoDeLembretes::class)->executar();

    // ASSERT — uma mensagem, e ela fala só da sessão do irmão
    $mensagem = Mensagem::query()->sole();
    expect($simulado->enviados)->toHaveCount(1)
        ->and(LembreteEnviado::query()->where('mensagem_id', $mensagem->id)->pluck('agendamento_id')->all())->toBe([$irmao->id])
        ->and(confirmacaoNaGrade($confirmado))->toMatchArray(['estado' => 'confirmado', 'por' => 'clinica'])
        ->and(confirmacaoNaGrade($irmao)['estado'])->toBe('aguardando');
});

it('deve mandar o lembrete do horário novo quando a sessão confirmada é remarcada no mesmo dia', function () {
    // ARRANGE — a família confirmou as 14:00 por telefone; a sessão foi para as 16:00 e o cadastro foi corrigido
    $admin = admin();
    $simulado = canalDaConfirmacao();
    $sessao = sessaoParaConfirmar(TELEFONE_INVALIDO_DA_CONFIRMACAO);
    app(DisparoDeLembretes::class)->executar();
    confirmarPelaClinica($admin, $sessao)->assertOk();
    remarcarNoMesmoDia($sessao, '16:00');
    corrigirTelefoneDaSessao($sessao);

    // ACT
    app(DisparoDeLembretes::class)->executar();

    // ASSERT — a confirmação era das 14:00: o horário novo pede a família de novo
    $linha = LembreteEnviado::query()->sole();
    expect($simulado->enviados)->toHaveCount(1)
        ->and($linha->status)->toBe(LembreteEnviado::ENVIADO)
        ->and($linha->confirmado_por)->toBeNull()
        ->and($linha->resposta)->toBeNull()
        ->and(confirmacaoNaGrade($sessao)['estado'])->toBe('aguardando');
});

it('não deve herdar a confirmação quando a sessão é remarcada no mesmo dia e o telefone continua inválido', function () {
    // ARRANGE
    $admin = admin();
    canalDaConfirmacao();
    $sessao = sessaoParaConfirmar(TELEFONE_INVALIDO_DA_CONFIRMACAO);
    app(DisparoDeLembretes::class)->executar();
    confirmarPelaClinica($admin, $sessao)->assertOk();
    remarcarNoMesmoDia($sessao, '16:00');

    // ACT — a volta seguinte reescreve a linha para o horário novo
    app(DisparoDeLembretes::class)->executar();

    // ASSERT — o horário novo volta a pedir a ligação
    expect(confirmacaoNaGrade($sessao)['estado'])->toBe('nao_enviado')
        ->and(LembreteEnviado::query()->sole()->confirmado_por)->toBeNull();
});

it('deve continuar confirmada pela clínica quando a volta passa de novo pelo mesmo telefone inválido', function () {
    // ARRANGE
    $admin = admin();
    canalDaConfirmacao();
    $sessao = sessaoParaConfirmar(TELEFONE_INVALIDO_DA_CONFIRMACAO);
    app(DisparoDeLembretes::class)->executar();
    confirmarPelaClinica($admin, $sessao)->assertOk();

    // ACT
    app(DisparoDeLembretes::class)->executar();

    // ASSERT
    expect(confirmacaoNaGrade($sessao))->toMatchArray(['estado' => 'confirmado', 'por' => 'clinica']);
});

it('deve continuar confirmada pela clínica quando o telefone corrigido é de quem pediu para não receber lembretes', function () {
    // ARRANGE — gate r1, CR-CC-02/SEC-CC-02: o motivo do opt-out é DECISÃO, e o card não mostra decisão;
    // gravado na linha confirmada, tirava a confirmação do card
    $admin = admin();
    $simulado = canalDaConfirmacao();
    $sessao = sessaoParaConfirmar(TELEFONE_INVALIDO_DA_CONFIRMACAO);
    app(DisparoDeLembretes::class)->executar();
    confirmarPelaClinica($admin, $sessao)->assertOk();
    // o telefone corrigido, no formato que a conversa guarda (E.164 com o "+")
    $conversa = new Conversa;
    $conversa->telefone_e164 = '+5511987654321';
    $conversa->forceFill(['sem_lembretes' => true])->save();
    corrigirTelefoneDaSessao($sessao);

    // ACT
    app(DisparoDeLembretes::class)->executar();

    // ASSERT — a volta passou pelo opt-out (a prova de que o cenário é o que diz), e a confirmação ficou
    expect($simulado->enviados)->toBe([])
        ->and(LembreteEnviado::query()->sole()->resposta)->toBe(LembreteEnviado::CONFIRMOU)
        ->and(Conversa::query()->count())->toBe(1)
        ->and(confirmacaoNaGrade($sessao))->toMatchArray(['estado' => 'confirmado', 'por' => 'clinica']);
});

it('não deve herdar a confirmação quando a sessão passa para outra criança no mesmo horário', function () {
    // ARRANGE — gate r1, CR-CC-03: a recepção confirmou com a família de uma criança e depois deu o
    // horário a outra, também com o telefone inválido
    $admin = admin();
    canalDaConfirmacao();
    $sessao = sessaoParaConfirmar(TELEFONE_INVALIDO_DA_CONFIRMACAO);
    app(DisparoDeLembretes::class)->executar();
    confirmarPelaClinica($admin, $sessao)->assertOk();
    $outra = Paciente::factory()->create(['contatos_json' => [['tipo' => 'celular', 'valor' => TELEFONE_INVALIDO_DA_CONFIRMACAO]]]);
    DB::table('agendamentos')->where('id', $sessao->id)->update(['paciente_id' => $outra->id]);

    // ACT
    app(DisparoDeLembretes::class)->executar();

    // ASSERT — a outra criança volta a pedir a ligação
    expect(confirmacaoNaGrade($sessao)['estado'])->toBe('nao_enviado')
        ->and(LembreteEnviado::query()->sole()->confirmado_por)->toBeNull();
});

it('deve mandar o lembrete à família da outra criança que ficou com o horário confirmado', function () {
    // ARRANGE — gate r1, CR-CC-03: a outra criança tem telefone bom; a confirmação era da família antiga
    $admin = admin();
    $simulado = canalDaConfirmacao();
    $sessao = sessaoParaConfirmar(TELEFONE_INVALIDO_DA_CONFIRMACAO);
    app(DisparoDeLembretes::class)->executar();
    confirmarPelaClinica($admin, $sessao)->assertOk();
    $outra = Paciente::factory()->create(['contatos_json' => [['tipo' => 'celular', 'valor' => TELEFONE_BOM_DA_CONFIRMACAO]]]);
    DB::table('agendamentos')->where('id', $sessao->id)->update(['paciente_id' => $outra->id]);

    // ACT
    app(DisparoDeLembretes::class)->executar();

    // ASSERT
    expect($simulado->enviados)->toHaveCount(1)
        ->and(LembreteEnviado::query()->sole()->confirmado_por)->toBeNull()
        ->and(confirmacaoNaGrade($sessao)['estado'])->toBe('aguardando');
});

it('não deve mandar confirmavel nos estados que a clínica não confirma', function (string $resposta) {
    // ARRANGE — gate r2, CR-CC-10: a tela oferece a ação só pelo `confirmavel`; mandado num estado
    // confirmado ou de pedido de desmarque, ela ofereceria o que o servidor recusa
    admin();
    $sessao = sessaoParaConfirmar();
    lembreteDaSessaoParaConfirmar($sessao, extras: ['resposta' => $resposta, 'respondido_em' => now()]);

    // ACT
    $confirmacao = confirmacaoNaGrade($sessao);

    // ASSERT
    expect($confirmacao)->not->toHaveKey('confirmavel');
})->with([LembreteEnviado::CONFIRMOU, LembreteEnviado::PEDIU_DESMARQUE]);
