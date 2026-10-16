<?php

use App\Models\Agendamento;
use App\Models\AvisoAFamilia;
use App\Models\Conversa;
use App\Models\Mensagem;
use App\Models\MensagemTemplate;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Mensageria\ClienteSimulado;
use App\Support\Mensageria\ClienteWhatsApp;
use App\Support\Mensageria\EnvioDeMensagens;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;

/*
 * Os avisos do agendamento à família (change avisos-do-agendamento-por-whatsapp): confirmação
 * do primeiro agendamento, mudança de horário pedida pela recepção e cancelamento pela clínica.
 * Dados FICTÍCIOS sempre (LGPD): nenhuma criança real entra em teste.
 */

beforeEach(function () {
    // o canal sem rede: sem ele o envio falaria com a Meta de verdade (token fictício) e toda
    // mensagem terminaria `falhou` — o que esconderia a diferença entre marca válida e marca que falhou
    app()->instance(ClienteWhatsApp::class, new ClienteSimulado);
});

/** Um modelo aprovado com N variáveis — o `templateAprovado()` da casa só tem duas. */
function modeloDoAviso(string $nome, int $variaveis): void
{
    MensagemTemplate::create([
        'nome' => $nome,
        'idioma' => 'pt_BR',
        'categoria' => 'UTILITY',
        'corpo_previa' => 'Modelo fictício.',
        'variaveis_json' => array_map('strval', range(1, $variaveis)),
        'status_meta' => 'APPROVED',
    ]);
}

/** Canal conectado, automação ligada e os três modelos aprovados — o estado do go-live. */
function avisosProntos(): void
{
    canalConectado();
    app(ConfiguracaoService::class)->set('whatsapp.automatico', true);
    modeloDoAviso('confirmacao_agendamento', 3);
    modeloDoAviso('remarcacao_agendamento', 3);
    modeloDoAviso('cancelamento_agendamento', 2);
}

/** Celular fictício pelo MODEL: é o evento que normaliza o contato para o envio achar. */
function celularDaCrianca(int $pacienteId): void
{
    $paciente = Paciente::findOrFail($pacienteId);
    $paciente->contatos_json = [['tipo' => 'celular', 'valor' => '(11) 98765-4321']];
    $paciente->save();
}

/** @return array<string, mixed> o payload de criação, com a criança já com celular */
function criancaNova(): array
{
    $payload = baseDeAgenda();
    celularDaCrianca($payload['paciente_id']);
    Profissional::whereKey($payload['profissional_id'])->update(['nome' => 'Profissional Fictícia']);

    return $payload;
}

/** O agendamento já existente, com WhatsApp, para os testes de alteração. */
function agendamentoComWhatsapp(array $base, string $quando): Agendamento
{
    return agendamentoDoDesmarque($base, $quando, ['lembrete_whatsapp' => true]);
}

/** O PUT da casa exige a versão (`If-Match`) — sem ela o teste mediria o 428, não o aviso. */
function remarcar($teste, $usuario, Agendamento $agendamento, array $mudanca)
{
    return $teste->actingAs($usuario)
        ->withHeader('If-Match', $agendamento->updated_at->toISOString())
        ->putJson("/api/agendamentos/{$agendamento->id}", [
            'inicio' => $agendamento->inicio->format('Y-m-d H:i'),
            'profissional_id' => $agendamento->profissional_id,
            'especialidade_id' => $agendamento->especialidade_id,
            'paciente_id' => $agendamento->paciente_id,
            ...$mudanca,
        ]);
}

function mensagensDoModelo(string $nome): int
{
    return Mensagem::where('template_nome', $nome)->count();
}

// ── Confirmação ─────────────────────────────────────────────────────────────────────────────

it('deve confirmar o primeiro agendamento da criança com dia da semana, hora e profissional', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $inicio = agoraNaClinica()->copy()->addDays(3)->setTime(14, 0);
    $dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    $esperado = $dias[(int) $inicio->format('w')].', '.$inicio->format('d/m').' às 14:00';

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', [...$payload, 'inicio' => $inicio->format('Y-m-d H:i')]);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => true, 'motivo' => null]);
    $mensagem = Mensagem::where('template_nome', 'confirmacao_agendamento')->sole();
    expect($mensagem->variaveis_json['2'])->toBe($esperado)
        ->and($mensagem->variaveis_json['3'])->toBe('Profissional Fictícia')
        ->and($mensagem->automatica)->toBeTrue()
        ->and($mensagem->enviada_por)->toBe($admin->id);
});

it('não deve confirmar de novo quando a criança já tem agendamento', function () {
    // ARRANGE — cancelado também conta: a criança já foi confirmada uma vez
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $cancelado = StatusAgendamento::create([
        'nome' => 'Cancelado Fictício', 'cor' => '#94A3B8', 'tipo' => 'x', 'ordem' => 98,
        'desconta_sessao' => false, 'ocupa_horario' => false,
    ]);
    Agendamento::factory()->create([
        'paciente_id' => $payload['paciente_id'],
        'profissional_id' => $payload['profissional_id'],
        'especialidade_id' => $payload['especialidade_id'],
        'status_id' => $cancelado->id,
    ]);

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json())->not->toHaveKey('aviso_familia')
        ->and(mensagensDoModelo('confirmacao_agendamento'))->toBe(0);
});

it('deve confirmar uma vez só a série, sobre a primeira sessão', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $inicio = agoraNaClinica()->copy()->addDays(2)->setTime(10, 0);

    // ACT — série semanal de quatro sessões
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => $inicio->format('Y-m-d H:i'),
        'recorrencia' => ['ate' => $inicio->copy()->addWeeks(3)->format('Y-m-d')],
    ]);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('criados'))->toBe(4)
        ->and($resposta->json('aviso_familia.enviado'))->toBeTrue()
        ->and(mensagensDoModelo('confirmacao_agendamento'))->toBe(1)
        ->and(Mensagem::where('template_nome', 'confirmacao_agendamento')->sole()->variaveis_json['2'])
        ->toContain($inicio->format('d/m').' às 10:00');
});

it('não deve confirmar a criança que veio da virada do sistema anterior', function () {
    // ARRANGE — o veterano migrado não tem agendamento aqui, mas não é paciente novo
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    DB::table('pacientes')->where('id', $payload['paciente_id'])->update(['importado_clinicaagil_em' => now()]);

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json())->not->toHaveKey('aviso_familia')
        ->and(mensagensDoModelo('confirmacao_agendamento'))->toBe(0);
});

it('deve confirmar também a criança que entra pelo encaixe da fila', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $entrada = $this->actingAs($admin)->postJson('/api/lista-espera', [
        'paciente_id' => $payload['paciente_id'],
        'especialidade_id' => $payload['especialidade_id'],
        'profissional_id' => $payload['profissional_id'],
    ]);
    $entrada->assertCreated();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/lista-espera/'.$entrada->json('id').'/encaixar', [
        'inicio' => agoraNaClinica()->copy()->addDays(2)->setTime(11, 0)->format('Y-m-d H:i'),
        'profissional_id' => $payload['profissional_id'],
        'especialidade_id' => $payload['especialidade_id'],
    ]);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia.enviado'))->toBeTrue()
        ->and(mensagensDoModelo('confirmacao_agendamento'))->toBe(1);
});

// ── Portões ─────────────────────────────────────────────────────────────────────────────────

it('deve criar sem avisar e dizer o motivo quando as mensagens automáticas estão desligadas', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    app(ConfiguracaoService::class)->set('whatsapp.automatico', false);
    $payload = criancaNova();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT — a gravação não depende do canal
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia.enviado'))->toBeFalse()
        ->and($resposta->json('aviso_familia.motivo'))->toContain('desligadas')
        ->and(Agendamento::where('paciente_id', $payload['paciente_id'])->count())->toBe(1);
});

it('deve dizer que o canal não está conectado', function () {
    // ARRANGE — automação ligada e modelos cadastrados, mas sem conexão
    $admin = admin();
    app(ConfiguracaoService::class)->set('whatsapp.automatico', true);
    modeloDoAviso('confirmacao_agendamento', 3);
    $payload = criancaNova();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia.motivo'))->toContain('não está conectado');
});

it('deve desligar o aviso quando a chave do modelo está vazia', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    app(ConfiguracaoService::class)->set('mensagens.template_confirmacao', '');
    $payload = criancaNova();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia.motivo'))->toContain('não está configurado')
        ->and(Mensagem::count())->toBe(0);
});

it('deve dizer o motivo quando o modelo não está aprovado na Meta', function () {
    // ARRANGE — canal e automação prontos, mas o modelo da confirmação nunca foi aprovado
    $admin = admin();
    canalConectado();
    app(ConfiguracaoService::class)->set('whatsapp.automatico', true);
    $payload = criancaNova();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia.enviado'))->toBeFalse()
        ->and($resposta->json('aviso_familia.motivo'))->toBe('o modelo da mensagem não está aprovado na Meta');
});

it('não deve avisar o agendamento marcado sem WhatsApp', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', [...$payload, 'lembrete_whatsapp' => false]);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia.motivo'))->toContain('sem WhatsApp')
        ->and(Mensagem::count())->toBe(0);
});

it('deve dizer que a criança não tem telefone cadastrado', function () {
    // ARRANGE — sem `celularDaCrianca()`
    $admin = admin();
    avisosProntos();
    $payload = baseDeAgenda();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia.motivo'))->toBe('a criança não tem telefone cadastrado');
});

it('deve dizer que o telefone do cadastro não é válido quando foi digitado errado', function () {
    // ARRANGE — change telefone-que-chega-no-whatsapp
    $admin = admin();
    avisosProntos();
    $payload = baseDeAgenda();
    $paciente = Paciente::findOrFail($payload['paciente_id']);
    $paciente->contatos_json = [['tipo' => 'celular', 'valor' => '(49) 49912-3456']];
    $paciente->save();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia.motivo'))->toBe('o telefone do cadastro não é válido para WhatsApp')
        ->and(Mensagem::count())->toBe(0);
});

it('não deve avisar a família que pediu para não receber mensagens automáticas', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $conversa = new Conversa;
    $conversa->telefone_e164 = '+5511987654321';
    $conversa->sem_lembretes = true;
    $conversa->save();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia.motivo'))->toContain('não receber')
        ->and(Mensagem::count())->toBe(0);
});

// ── Remarcação ──────────────────────────────────────────────────────────────────────────────

it('deve avisar a mudança de horário quando a recepção marca a caixa', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $de = agoraNaClinica()->copy()->addDays(3)->setTime(14, 0);
    $para = $de->copy()->addDays(2)->setTime(15, 0);
    $agendamento = agendamentoComWhatsapp($base, $de->format('Y-m-d H:i'));

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['inicio' => $para->format('Y-m-d H:i'), 'avisar_familia' => true]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => true, 'motivo' => null]);
    $variaveis = Mensagem::where('template_nome', 'remarcacao_agendamento')->sole()->variaveis_json;
    expect($variaveis['2'])->toBe($de->format('d/m').' às 14:00')
        ->and($variaveis['3'])->toBe($para->format('d/m').' às 15:00');
});

it('não deve avisar a mudança de horário sem a caixa marcada', function () {
    // ARRANGE — a família pode ter pedido a troca: sem o pedido, nada sai
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $de = agoraNaClinica()->copy()->addDays(3)->setTime(14, 0);
    $agendamento = agendamentoComWhatsapp($base, $de->format('Y-m-d H:i'));

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['inicio' => $de->copy()->addHour()->format('Y-m-d H:i')]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json())->not->toHaveKey('aviso_familia')
        ->and(Mensagem::count())->toBe(0);
});

it('deve ignorar a caixa quando dia, hora e profissional não mudaram', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $agendamento = agendamentoComWhatsapp($base, agoraNaClinica()->copy()->addDays(3)->setTime(14, 0)->format('Y-m-d H:i'));

    // ACT — só a observação muda
    $resposta = remarcar($this, $admin, $agendamento, ['obs' => 'Observação fictícia.', 'avisar_familia' => true]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json())->not->toHaveKey('aviso_familia')
        ->and(Mensagem::count())->toBe(0);
});

it('deve pôr o profissional no aviso quando é ele que muda', function () {
    // ARRANGE — outro profissional que atende a mesma especialidade
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    Profissional::whereKey($base['profissional_id'])->update(['nome' => 'Profissional Fictícia A']);
    $outro = Profissional::factory()->create(['nome' => 'Profissional Fictícia B']);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $outro->id,
        'especialidade_id' => $base['especialidade_id'],
    ]);
    $de = agoraNaClinica()->copy()->addDays(3)->setTime(14, 0);
    $agendamento = agendamentoComWhatsapp($base, $de->format('Y-m-d H:i'));

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['profissional_id' => $outro->id, 'avisar_familia' => true]);

    // ASSERT
    $resposta->assertOk();
    $variaveis = Mensagem::where('template_nome', 'remarcacao_agendamento')->sole()->variaveis_json;
    expect($variaveis['2'])->toBe($de->format('d/m').' às 14:00 com Profissional Fictícia A')
        ->and($variaveis['3'])->toBe($de->format('d/m').' às 14:00 com Profissional Fictícia B');
});

// ── Cancelamento ────────────────────────────────────────────────────────────────────────────

it('deve avisar o cancelamento quando a clínica muda para o status do desmarque do profissional', function () {
    // ARRANGE — `baseDoDesmarque()` configura o status do desmarque do profissional
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $quando = agoraNaClinica()->copy()->addDays(3)->setTime(14, 0);
    $agendamento = agendamentoComWhatsapp($base, $quando->format('Y-m-d H:i'));
    $statusDaClinica = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['status_id' => $statusDaClinica, 'avisar_familia' => true]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('aviso_familia.enviado'))->toBeTrue();
    $variaveis = Mensagem::where('template_nome', 'cancelamento_agendamento')->sole()->variaveis_json;
    expect($variaveis['2'])->toBe($quando->format('d/m').' às 14:00');
});

it('não deve avisar quando o status novo é outro, mesmo liberando o horário', function () {
    // ARRANGE — um status de desmarque a pedido da família, que não é o configurado
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $pelaFamilia = StatusAgendamento::create([
        'nome' => 'Desmarcado pela Família Fictícia',
        'cor' => '#94A3B8',
        'tipo' => 'x',
        'ordem' => 99,
        'desconta_sessao' => false,
        'ocupa_horario' => false,
    ]);
    $agendamento = agendamentoComWhatsapp($base, agoraNaClinica()->copy()->addDays(3)->setTime(14, 0)->format('Y-m-d H:i'));

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['status_id' => $pelaFamilia->id, 'avisar_familia' => true]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json())->not->toHaveKey('aviso_familia')
        ->and(Mensagem::count())->toBe(0);
});

it('não deve avisar cancelamento quando o status do desmarque não foi configurado', function () {
    // ARRANGE — `baseDoDesmarque()` configura o status do desmarque; zerar a chave é a clínica que
    // nunca o escolheu
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    app(ConfiguracaoService::class)->set('agenda.status_desmarque_id', 0);
    celularDaCrianca($base['paciente_id']);
    $status = StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->firstOrFail();
    $agendamento = agendamentoComWhatsapp($base, agoraNaClinica()->copy()->addDays(3)->setTime(14, 0)->format('Y-m-d H:i'));

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['status_id' => $status->id, 'avisar_familia' => true]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json())->not->toHaveKey('aviso_familia');
});

it('não deve mandar aviso de cancelamento junto com o desmarque em grupo', function () {
    // ARRANGE — o desmarque em grupo tem aviso próprio
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    modeloDoAviso('desmarque_agenda', 2);
    app(ConfiguracaoService::class)->set('mensagens.template_desmarque', 'desmarque_agenda');
    celularDaCrianca($base['paciente_id']);
    $dia = agoraNaClinica()->copy()->addDays(3);
    agendamentoComWhatsapp($base, $dia->copy()->setTime(14, 0)->format('Y-m-d H:i'));

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => $dia->format('Y-m-d'), 'ate' => $dia->format('Y-m-d'), 'periodo' => 'tarde',
    ]);

    // ASSERT — só o aviso do desmarque em grupo
    $resposta->assertOk();
    expect(mensagensDoModelo('desmarque_agenda'))->toBe(1)
        ->and(mensagensDoModelo('cancelamento_agendamento'))->toBe(0);
});

// ── Rodada 1 do gate: nome da criança, precedência, pedido explícito, repetição, borda ──────

/** Um status que libera o horário e NÃO é o desmarque configurado (ex.: desmarcado pela família). */
function statusQueLibera(string $nome): int
{
    return StatusAgendamento::create([
        'nome' => $nome, 'cor' => '#94A3B8', 'tipo' => 'x', 'ordem' => 97,
        'desconta_sessao' => false, 'ocupa_horario' => false,
    ])->id;
}

function comNomes(int $pacienteId, string $civil, ?string $social): void
{
    Paciente::whereKey($pacienteId)->update(['nome' => $civil, 'nome_social' => $social]);
}

it('deve chamar a criança pelo nome social na confirmação', function () {
    // ARRANGE — é como a criança é chamada (spec); o nome civil não pode vazar no lugar dele
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    comNomes($payload['paciente_id'], 'Nome Civil Fictício', 'Nome Social Fictício');

    // ACT
    $this->actingAs($admin)->postJson('/api/agendamentos', $payload)->assertCreated();

    // ASSERT
    expect(Mensagem::where('template_nome', 'confirmacao_agendamento')->sole()->variaveis_json['1'])
        ->toBe('Nome Social Fictício');
});

it('deve usar o nome civil na remarcação quando não há nome social', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    comNomes($base['paciente_id'], 'Nome Civil Fictício', null);
    celularDaCrianca($base['paciente_id']);
    $de = agoraNaClinica()->copy()->addDays(3)->setTime(14, 0);
    $agendamento = agendamentoComWhatsapp($base, $de->format('Y-m-d H:i'));

    // ACT
    remarcar($this, $admin, $agendamento, ['inicio' => $de->copy()->addHour()->format('Y-m-d H:i'), 'avisar_familia' => true])->assertOk();

    // ASSERT
    expect(Mensagem::where('template_nome', 'remarcacao_agendamento')->sole()->variaveis_json['1'])
        ->toBe('Nome Civil Fictício');
});

it('deve mandar UMA mensagem, a de cancelamento com o horário antigo, quando status e horário mudam juntos', function () {
    // ARRANGE — um PUT pode trazer os dois; duas mensagens pagas seriam o defeito
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    comNomes($base['paciente_id'], 'Nome Civil Fictício', 'Nome Social Fictício');
    celularDaCrianca($base['paciente_id']);
    $de = agoraNaClinica()->copy()->addDays(3)->setTime(14, 0);
    $agendamento = agendamentoComWhatsapp($base, $de->format('Y-m-d H:i'));
    $statusDaClinica = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, [
        'status_id' => $statusDaClinica,
        'inicio' => $de->copy()->addDay()->format('Y-m-d H:i'),
        'avisar_familia' => true,
    ]);

    // ASSERT — a família conhecia o horário ANTIGO; é dele que ela precisa saber
    $resposta->assertOk();
    expect(mensagensDoModelo('cancelamento_agendamento'))->toBe(1)
        ->and(mensagensDoModelo('remarcacao_agendamento'))->toBe(0);
    $variaveis = Mensagem::where('template_nome', 'cancelamento_agendamento')->sole()->variaveis_json;
    expect($variaveis['1'])->toBe('Nome Social Fictício')
        ->and($variaveis['2'])->toBe($de->format('d/m').' às 14:00');
});

it('não deve avisar o cancelamento sem o pedido explícito de quem gravou', function () {
    // ARRANGE — um clique errado no status não pode, sozinho, avisar a família (SEC-AV-02)
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $agendamento = agendamentoComWhatsapp($base, agoraNaClinica()->copy()->addDays(3)->setTime(14, 0)->format('Y-m-d H:i'));
    $statusDaClinica = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['status_id' => $statusDaClinica]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json())->not->toHaveKey('aviso_familia')
        ->and(Mensagem::count())->toBe(0);
});

it('deve avisar de novo o cancelamento quando a sessão foi reaberta e desmarcada outra vez', function () {
    // ARRANGE — cada pedido explícito é informação nova para a família (rodada 2 do gate: a marca
    // "já avisei" calava aviso necessário); o freio contra o abuso é o limite diário por família
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $agendamento = agendamentoComWhatsapp($base, agoraNaClinica()->copy()->addDays(3)->setTime(14, 0)->format('Y-m-d H:i'));
    $statusDaClinica = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');
    $inicial = StatusAgendamento::inicialId();

    // ACT — desmarca, reabre, desmarca de novo
    remarcar($this, $admin, $agendamento, ['status_id' => $statusDaClinica, 'avisar_familia' => true])->assertOk();
    remarcar($this, $admin, $agendamento->fresh(), ['status_id' => $inicial])->assertOk();
    $segunda = remarcar($this, $admin, $agendamento->fresh(), ['status_id' => $statusDaClinica, 'avisar_familia' => true]);

    // ASSERT
    $segunda->assertOk();
    expect($segunda->json('aviso_familia'))->toBe(['enviado' => true, 'motivo' => null])
        ->and(mensagensDoModelo('cancelamento_agendamento'))->toBe(2);
});

it('deve avisar a volta para um horário já avisado quando a recepção pede', function () {
    // ARRANGE — A→B avisado; B→C sem avisar; C→B com a caixa: o sistema não adivinha o que a
    // família sabe (B→C pode ter sido combinado por telefone) — quem marcou a caixa decidiu
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $a = agoraNaClinica()->copy()->addDays(3)->setTime(14, 0);
    $b = $a->copy()->addHour();
    $c = $a->copy()->addHours(2);
    $agendamento = agendamentoComWhatsapp($base, $a->format('Y-m-d H:i'));

    // ACT
    remarcar($this, $admin, $agendamento, ['inicio' => $b->format('Y-m-d H:i'), 'avisar_familia' => true])->assertOk();
    remarcar($this, $admin, $agendamento->fresh(), ['inicio' => $c->format('Y-m-d H:i')])->assertOk();
    $terceira = remarcar($this, $admin, $agendamento->fresh(), ['inicio' => $b->format('Y-m-d H:i'), 'avisar_familia' => true]);

    // ASSERT
    expect($terceira->json('aviso_familia.enviado'))->toBeTrue()
        ->and(mensagensDoModelo('remarcacao_agendamento'))->toBe(2);
});

it('deve avisar de novo quando o horário volta para um destino antigo depois de outro aviso', function () {
    // ARRANGE — A→B, B→C e C→B, todos com a caixa: a última coisa que a família ouviu foi C, então
    // voltar para B PRECISA sair (SEC-AV-08 — a marca era "destino já avisado alguma vez")
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $a = agoraNaClinica()->copy()->addDays(3)->setTime(14, 0);
    $b = $a->copy()->addHour();
    $c = $a->copy()->addHours(2);
    $agendamento = agendamentoComWhatsapp($base, $a->format('Y-m-d H:i'));

    // ACT
    remarcar($this, $admin, $agendamento, ['inicio' => $b->format('Y-m-d H:i'), 'avisar_familia' => true])->assertOk();
    remarcar($this, $admin, $agendamento->fresh(), ['inicio' => $c->format('Y-m-d H:i'), 'avisar_familia' => true])->assertOk();
    $terceira = remarcar($this, $admin, $agendamento->fresh(), ['inicio' => $b->format('Y-m-d H:i'), 'avisar_familia' => true]);

    // ASSERT
    expect($terceira->json('aviso_familia.enviado'))->toBeTrue()
        ->and(mensagensDoModelo('remarcacao_agendamento'))->toBe(3);
});

it('deve recusar com motivo a remarcação de uma sessão que já está desmarcada', function () {
    // ARRANGE — o horário dela está livre na grade: "remarcada" seria mensagem falsa (SEC-AV-09);
    // a recepção pediu o aviso, então a tela diz por que não saiu
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $pelaFamilia = statusQueLibera('Desmarcado pela Família Fictício');
    $de = agoraNaClinica()->copy()->addDays(3)->setTime(14, 0);
    $agendamento = agendamentoDoDesmarque($base, $de->format('Y-m-d H:i'), ['lembrete_whatsapp' => true, 'status_id' => $pelaFamilia]);

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['inicio' => $de->copy()->addHour()->format('Y-m-d H:i'), 'avisar_familia' => true]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => false, 'motivo' => 'a sessão não está marcada (desmarcada, falta ou reserva)'])
        ->and(Mensagem::count())->toBe(0);
});

it('deve parar no limite diário de avisos por família', function () {
    // ARRANGE — andar por horários diferentes mandava uma mensagem paga por gravação (SEC-AV-10)
    $admin = admin();
    avisosProntos();
    app(ConfiguracaoService::class)->set('mensagens.avisos_por_familia_dia', 2);
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $a = agoraNaClinica()->copy()->addDays(3)->setTime(9, 0);
    $agendamento = agendamentoComWhatsapp($base, $a->format('Y-m-d H:i'));

    // ACT — três destinos diferentes, todos com a caixa
    foreach ([1, 2] as $horas) {
        remarcar($this, $admin, $agendamento->fresh(), ['inicio' => $a->copy()->addHours($horas)->format('Y-m-d H:i'), 'avisar_familia' => true])->assertOk();
    }
    $terceira = remarcar($this, $admin, $agendamento->fresh(), ['inicio' => $a->copy()->addHours(3)->format('Y-m-d H:i'), 'avisar_familia' => true]);

    // ASSERT
    $terceira->assertOk();
    expect(mensagensDoModelo('remarcacao_agendamento'))->toBe(2)
        ->and($terceira->json('aviso_familia.motivo'))->toContain('limite diário');
});

it('não deve confirmar de novo a criança cujo primeiro agendamento foi excluído e recriado', function () {
    // ARRANGE — a marca da confirmação é por CRIANÇA e sobrevive à exclusão (SEC-AV-01)
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $primeiro = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);
    $primeiro->assertCreated();
    $this->actingAs($admin)->deleteJson('/api/agendamentos/'.$primeiro->json('id'))->assertNoContent();

    // ACT
    $recriado = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    $recriado->assertCreated();
    expect(mensagensDoModelo('confirmacao_agendamento'))->toBe(1)
        ->and($recriado->json('aviso_familia.motivo'))->toBe('a confirmação já foi enviada a esta família; veja a conversa');
});

it('deve confirmar de novo quando a confirmação anterior falhou na entrega', function () {
    // ARRANGE — "já recebeu" sobre uma mensagem que nunca chegou mandava a recepção NÃO avisar à
    // mão (rodada 2 do gate): a marca de uma mensagem que falhou não vale
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $primeiro = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);
    $primeiro->assertCreated();
    Mensagem::where('template_nome', 'confirmacao_agendamento')->update(['status' => 'falhou']);
    $this->actingAs($admin)->deleteJson('/api/agendamentos/'.$primeiro->json('id'))->assertNoContent();

    // ACT
    $recriado = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT — saiu de novo, e a marca aponta para a mensagem nova
    $recriado->assertCreated();
    expect($recriado->json('aviso_familia'))->toBe(['enviado' => true, 'motivo' => null])
        ->and(mensagensDoModelo('confirmacao_agendamento'))->toBe(2)
        ->and(AvisoAFamilia::sole()->mensagem_id)->toBe(Mensagem::max('id'));
});

it('deve recusar com motivo o cancelamento de uma sessão que já passou', function () {
    // ARRANGE — "cancelado: hoje às 09:00" dito à tarde é mensagem falsa (SEC-AV-03)
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $agendamento = agendamentoComWhatsapp($base, agoraNaClinica()->copy()->subDay()->setTime(14, 0)->format('Y-m-d H:i'));
    $statusDaClinica = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['status_id' => $statusDaClinica, 'avisar_familia' => true]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => false, 'motivo' => 'a sessão já passou'])
        ->and(Mensagem::count())->toBe(0);
});

it('não deve confirmar o primeiro agendamento criado já num status que libera o horário', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $desmarque = (int) StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->value('id');

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', [...$payload, 'status_id' => $desmarque]);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json())->not->toHaveKey('aviso_familia')
        ->and(Mensagem::count())->toBe(0);
});

it('deve recusar com motivo o aviso quando a gravação troca a criança do agendamento', function () {
    // ARRANGE — a família da criança nova nunca soube desta sessão (SEC-AV-03d)
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    $outra = Paciente::factory()->create()->id;
    celularDaCrianca($outra);
    $agendamento = agendamentoComWhatsapp($base, agoraNaClinica()->copy()->addDays(3)->setTime(14, 0)->format('Y-m-d H:i'));
    $statusDaClinica = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['paciente_id' => $outra, 'status_id' => $statusDaClinica, 'avisar_familia' => true]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => false, 'motivo' => 'a criança do agendamento mudou'])
        ->and(Mensagem::count())->toBe(0);
});

it('deve recusar com motivo a remarcação que também troca a criança', function () {
    // ARRANGE — a família da criança nova nunca soube do horário "de" (SEC-AV-03d)
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    $outra = Paciente::factory()->create()->id;
    celularDaCrianca($outra);
    $de = agoraNaClinica()->copy()->addDays(3)->setTime(14, 0);
    $agendamento = agendamentoComWhatsapp($base, $de->format('Y-m-d H:i'));

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, [
        'paciente_id' => $outra,
        'inicio' => $de->copy()->addHour()->format('Y-m-d H:i'),
        'avisar_familia' => true,
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => false, 'motivo' => 'a criança do agendamento mudou'])
        ->and(Mensagem::count())->toBe(0);
});

it('não deve confirmar bloqueio de agenda', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $base = baseDeAgenda();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', [
        'tipo' => 'bloqueio',
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'duracao_minutos' => 60,
    ]);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json())->not->toHaveKey('aviso_familia')
        ->and(Mensagem::count())->toBe(0);
});

it('deve dizer na remarcação da série que as próximas sessões também mudam', function () {
    // ARRANGE — uma série de três, remarcada inteira a partir da primeira
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $inicio = agoraNaClinica()->copy()->addDays(2)->setTime(10, 0);
    $this->actingAs($admin)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => $inicio->format('Y-m-d H:i'),
        'recorrencia' => ['ocorrencias' => 3],
    ])->assertCreated();
    $primeira = Agendamento::where('paciente_id', $payload['paciente_id'])->orderBy('inicio')->firstOrFail();

    // ACT
    $resposta = remarcar($this, $admin, $primeira, [
        'inicio' => $inicio->copy()->addHour()->format('Y-m-d H:i'),
        'aplicar_na_serie' => true,
        'avisar_familia' => true,
    ]);

    // ASSERT — uma mensagem, sobre a editada, dizendo que as outras duas vão junto
    $resposta->assertOk();
    expect(mensagensDoModelo('remarcacao_agendamento'))->toBe(1)
        ->and(Mensagem::where('template_nome', 'remarcacao_agendamento')->sole()->variaveis_json['3'])
        ->toBe($inicio->format('d/m').' às 11:00 (as próximas 2 sessões também mudam)');
});

/** Remarcação avisada com limite 1, e o agendamento pronto para a segunda. */
function primeiroAvisoDoDia($teste, $usuario): array
{
    avisosProntos();
    app(ConfiguracaoService::class)->set('mensagens.avisos_por_familia_dia', 1);
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $a = agoraNaClinica()->copy()->addDays(3)->setTime(9, 0);
    $agendamento = agendamentoComWhatsapp($base, $a->format('Y-m-d H:i'));
    remarcar($teste, $usuario, $agendamento, ['inicio' => $a->copy()->addHour()->format('Y-m-d H:i'), 'avisar_familia' => true])->assertOk();

    return [$agendamento->fresh(), $a->copy()->addHours(2)->format('Y-m-d H:i')];
}

it('não deve contar no limite diário o aviso de ontem', function () {
    // ARRANGE — o limite é do DIA da clínica: contar tudo que a família já recebeu a calaria para sempre
    $admin = admin();
    [$agendamento, $destino] = primeiroAvisoDoDia($this, $admin);
    DB::table('mensagens')->update(['created_at' => now()->subDay()]);

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['inicio' => $destino, 'avisar_familia' => true]);

    // ASSERT
    expect($resposta->json('aviso_familia.enviado'))->toBeTrue()
        ->and(mensagensDoModelo('remarcacao_agendamento'))->toBe(2);
});

it('não deve contar o lembrete no limite diário dos avisos', function () {
    // ARRANGE — o limite é destes três avisos, não do canal: o lembrete da véspera não cala a remarcação
    $admin = admin();
    [$agendamento, $destino] = primeiroAvisoDoDia($this, $admin);
    DB::table('mensagens')->update(['template_nome' => 'lembrete_agendamento']);

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['inicio' => $destino, 'avisar_familia' => true]);

    // ASSERT
    expect($resposta->json('aviso_familia.enviado'))->toBeTrue()
        ->and(mensagensDoModelo('remarcacao_agendamento'))->toBe(1);
});

it('deve somar no limite diário os avisos dos três modelos', function () {
    // ARRANGE — confirmação + remarcação já no limite 2: contar só o modelo da vez furaria o freio
    $admin = admin();
    avisosProntos();
    app(ConfiguracaoService::class)->set('mensagens.avisos_por_familia_dia', 2);
    $payload = criancaNova();
    $inicio = agoraNaClinica()->copy()->addDays(3)->setTime(9, 0);
    $criado = $this->actingAs($admin)->postJson('/api/agendamentos', [...$payload, 'inicio' => $inicio->format('Y-m-d H:i')]);
    $criado->assertCreated();
    $agendamento = Agendamento::findOrFail($criado->json('id'));
    remarcar($this, $admin, $agendamento, ['inicio' => $inicio->copy()->addHour()->format('Y-m-d H:i'), 'avisar_familia' => true])->assertOk();

    // ACT
    $terceira = remarcar($this, $admin, $agendamento->fresh(), ['inicio' => $inicio->copy()->addHours(2)->format('Y-m-d H:i'), 'avisar_familia' => true]);

    // ASSERT
    expect($terceira->json('aviso_familia.motivo'))->toContain('limite diário')
        ->and(Mensagem::count())->toBe(2);
});

it('deve contar no limite o aviso de mais cedo no mesmo dia da clínica, mesmo em outro dia em UTC', function () {
    // ARRANGE — 23:30 de 28/09 na clínica são 02:30 de 29/09 em UTC; o aviso das 10:00 de 28/09
    // (13:00 UTC) é do MESMO dia da clínica (CR3-03)
    $this->travelTo(Carbon::parse('2026-09-28 23:30', 'America/Sao_Paulo'));
    $admin = admin();
    [$agendamento, $destino] = primeiroAvisoDoDia($this, $admin);
    DB::table('mensagens')->update(['created_at' => '2026-09-28 13:00:00']);

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['inicio' => $destino, 'avisar_familia' => true]);

    // ASSERT
    expect($resposta->json('aviso_familia.motivo'))->toContain('limite diário')
        ->and(mensagensDoModelo('remarcacao_agendamento'))->toBe(1);
});

it('não deve contar no limite o aviso da véspera da clínica, mesmo no mesmo dia em UTC', function () {
    // ARRANGE — 02:00 UTC de 28/09 são 23:00 de 27/09 na clínica: é a véspera (CR3-03)
    $this->travelTo(Carbon::parse('2026-09-28 10:00', 'America/Sao_Paulo'));
    $admin = admin();
    [$agendamento, $destino] = primeiroAvisoDoDia($this, $admin);
    DB::table('mensagens')->update(['created_at' => '2026-09-28 02:00:00']);

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['inicio' => $destino, 'avisar_familia' => true]);

    // ASSERT
    expect($resposta->json('aviso_familia.enviado'))->toBeTrue()
        ->and(mensagensDoModelo('remarcacao_agendamento'))->toBe(2);
});

/** Uma série semanal de N sessões de uma criança nova, e a primeira delas. */
function serieDaCrianca($teste, $usuario, array $payload, $inicio, int $sessoes): Agendamento
{
    $teste->actingAs($usuario)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => $inicio->format('Y-m-d H:i'),
        'recorrencia' => ['ocorrencias' => $sessoes],
    ])->assertCreated();

    return Agendamento::where('paciente_id', $payload['paciente_id'])->orderBy('inicio')->firstOrFail();
}

it('deve contar só as sessões marcadas da série, no singular quando é uma', function () {
    // ARRANGE — série de três, a terceira já desmarcada: para a família só UMA outra muda
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $inicio = agoraNaClinica()->copy()->addDays(2)->setTime(10, 0);
    $primeira = serieDaCrianca($this, $admin, $payload, $inicio, 3);
    $desmarque = (int) StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->value('id');
    Agendamento::where('paciente_id', $payload['paciente_id'])->orderByDesc('inicio')->firstOrFail()->update(['status_id' => $desmarque]);

    // ACT
    $resposta = remarcar($this, $admin, $primeira->fresh(), [
        'inicio' => $inicio->copy()->addHour()->format('Y-m-d H:i'),
        'aplicar_na_serie' => true,
        'avisar_familia' => true,
    ]);

    // ASSERT — o texto E o que de fato mudou: a segunda sessão foi junto para as 11:00
    $resposta->assertOk();
    expect(Mensagem::where('template_nome', 'remarcacao_agendamento')->sole()->variaveis_json['3'])
        ->toBe($inicio->format('d/m').' às 11:00 (a próxima sessão também muda)')
        ->and(Agendamento::where('paciente_id', $payload['paciente_id'])->orderBy('inicio')->get()->pluck('inicio')->map->format('H:i')->all())
        ->toBe(['11:00', '11:00', '11:00']);
});

it('deve dizer no cancelamento da série quantas sessões seguintes caem junto', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $inicio = agoraNaClinica()->copy()->addDays(2)->setTime(10, 0);
    $primeira = serieDaCrianca($this, $admin, $payload, $inicio, 3);
    $desmarque = (int) StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->value('id');
    app(ConfiguracaoService::class)->set('agenda.status_desmarque_id', $desmarque);

    // ACT
    $resposta = remarcar($this, $admin, $primeira->fresh(), [
        'status_id' => $desmarque,
        'aplicar_na_serie' => true,
        'avisar_familia' => true,
    ]);

    // ASSERT — o texto E o que de fato caiu: as três no status do desmarque
    $resposta->assertOk();
    expect(Mensagem::where('template_nome', 'cancelamento_agendamento')->sole()->variaveis_json['2'])
        ->toBe($inicio->format('d/m').' às 10:00 e das próximas 2 sessões')
        ->and(Agendamento::where('paciente_id', $payload['paciente_id'])->pluck('status_id')->unique()->values()->all())
        ->toBe([$desmarque]);
});

it('deve dizer no cancelamento da série de duas que a próxima sessão cai junto', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $inicio = agoraNaClinica()->copy()->addDays(2)->setTime(10, 0);
    $primeira = serieDaCrianca($this, $admin, $payload, $inicio, 2);
    $desmarque = (int) StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->value('id');
    app(ConfiguracaoService::class)->set('agenda.status_desmarque_id', $desmarque);

    // ACT
    $resposta = remarcar($this, $admin, $primeira->fresh(), [
        'status_id' => $desmarque,
        'aplicar_na_serie' => true,
        'avisar_familia' => true,
    ]);

    // ASSERT
    $resposta->assertOk();
    expect(Mensagem::where('template_nome', 'cancelamento_agendamento')->sole()->variaveis_json['2'])
        ->toBe($inicio->format('d/m').' às 10:00 e da próxima sessão');
});

// ── Rodada 3 do gate: sessão passada, hora de parede, status anterior, marca em andamento, log ──

it('deve recusar com motivo a remarcação de uma sessão que já passou', function () {
    // ARRANGE — corrigir o profissional de uma sessão de ontem, com a caixa marcada (CR3-01)
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $outro = Profissional::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $outro->id,
        'especialidade_id' => $base['especialidade_id'],
    ]);
    $agendamento = agendamentoComWhatsapp($base, agoraNaClinica()->copy()->subDay()->setTime(14, 0)->format('Y-m-d H:i'));

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['profissional_id' => $outro->id, 'avisar_familia' => true]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => false, 'motivo' => 'a sessão já passou'])
        ->and(Mensagem::count())->toBe(0);
});

it('não deve confirmar o primeiro agendamento criado no passado', function () {
    // ARRANGE — a clínica que registra retroativo: confirmar sessão que já aconteceu é falso (CR3-01)
    $admin = admin();
    avisosProntos();
    app(ConfiguracaoService::class)->set('agenda.permitir_retroativo', true);
    $payload = criancaNova();
    $ontem = agoraNaClinica()->copy()->subDay()->setTime(14, 0);

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', [...$payload, 'inicio' => $ontem->format('Y-m-d H:i')]);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json())->not->toHaveKey('aviso_familia')
        ->and(Mensagem::count())->toBe(0);
});

it('deve avisar a sessão de mais tarde hoje pela hora da clínica, não pela do servidor', function () {
    // ARRANGE — 14:00 na clínica são 17:00 em UTC: a sessão das 16:00 AINDA vai acontecer
    $this->travelTo(Carbon::parse('2026-10-05 14:00', 'America/Sao_Paulo'));
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $agendamento = agendamentoComWhatsapp($base, '2026-10-05 16:00');
    $statusDaClinica = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['status_id' => $statusDaClinica, 'avisar_familia' => true]);

    // ASSERT
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => true, 'motivo' => null]);
});

it('deve recusar a sessão de mais cedo hoje pela hora da clínica', function () {
    // ARRANGE — 14:00 na clínica: a sessão das 13:00 já passou
    $this->travelTo(Carbon::parse('2026-10-05 14:00', 'America/Sao_Paulo'));
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $agendamento = agendamentoComWhatsapp($base, '2026-10-05 13:00');
    $statusDaClinica = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['status_id' => $statusDaClinica, 'avisar_familia' => true]);

    // ASSERT
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => false, 'motivo' => 'a sessão já passou']);
});

it('deve recusar com motivo o cancelamento de uma sessão que já estava desmarcada', function () {
    // ARRANGE — a tela perguntou com a caixa marcada sobre um card velho: sem motivo, a recepção
    // supunha que a família foi avisada (CR3-02)
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $statusDaClinica = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');
    $agendamento = agendamentoDoDesmarque($base, agoraNaClinica()->copy()->addDays(3)->setTime(14, 0)->format('Y-m-d H:i'), ['lembrete_whatsapp' => true, 'status_id' => $statusDaClinica]);

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['status_id' => $statusDaClinica, 'avisar_familia' => true]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => false, 'motivo' => 'a sessão já estava desmarcada'])
        ->and(Mensagem::count())->toBe(0);
});

it('não deve avisar cancelamento pela clínica de uma sessão que a família já tinha desmarcado', function () {
    // ARRANGE — reclassificar "desmarcado pela família" como "pela clínica" mandava "cancelado pela
    // clínica" sobre sessão que a própria família desmarcou (SEC-AV-16)
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $pelaFamilia = statusQueLibera('Desmarcado pela Família Fictício');
    $statusDaClinica = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');
    $agendamento = agendamentoDoDesmarque($base, agoraNaClinica()->copy()->addDays(3)->setTime(14, 0)->format('Y-m-d H:i'), ['lembrete_whatsapp' => true, 'status_id' => $pelaFamilia]);

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['status_id' => $statusDaClinica, 'avisar_familia' => true]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => false, 'motivo' => 'a sessão já não estava marcada (desmarcada, falta ou reserva)'])
        ->and(Mensagem::count())->toBe(0);
});

it('deve tratar a marca recente sem mensagem como confirmação em andamento', function () {
    // ARRANGE — outra requisição marcou e ainda está enviando: tratar como falha mandaria duas
    // confirmações (CR3-05)
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    AvisoAFamilia::create(['tipo' => 'confirmacao', 'chave' => "paciente:{$payload['paciente_id']}", 'paciente_id' => $payload['paciente_id']]);

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia.motivo'))->toBe('a confirmação já foi enviada a esta família; veja a conversa')
        ->and(Mensagem::count())->toBe(0);
});

it('deve confirmar quando a marca sem mensagem é de um envio que morreu há tempo', function () {
    // ARRANGE — passado o prazo, a marca sem mensagem é de um processo que caiu no meio
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $marca = AvisoAFamilia::create(['tipo' => 'confirmacao', 'chave' => "paciente:{$payload['paciente_id']}", 'paciente_id' => $payload['paciente_id']]);
    $marca->forceFill(['created_at' => now()->subMinutes(11)])->saveQuietly();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => true, 'motivo' => null])
        ->and(AvisoAFamilia::sole()->mensagem_id)->toBe(Mensagem::sole()->id);
});

it('deve dizer que avisou quando a mensagem saiu e só a marca falhou ao gravar', function () {
    // ARRANGE — "não avisada" com a mensagem já na fila fazia a recepção avisar à mão e a família
    // ouvir duas vezes (SEC-AV-18)
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    AvisoAFamilia::updating(function (): void {
        throw new RuntimeException('falha fictícia ao gravar a marca');
    });

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => true, 'motivo' => null])
        ->and(mensagensDoModelo('confirmacao_agendamento'))->toBe(1);
});

it('não deve pôr o telefone da família no log quando o banco falha no aviso', function () {
    // ARRANGE — a mensagem de uma QueryException traz o SQL com os bindings (SEC-AV-15)
    Exceptions::fake();
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $pdo = new PDOException('falha fictícia');
    $pdo->errorInfo = ['HY000', 1205, 'Lock wait timeout'];
    $this->mock(EnvioDeMensagens::class, fn ($envio) => $envio
        ->shouldReceive('enviarTemplate')
        ->andThrow(new QueryException('mysql', 'insert into conversas (telefone_e164) values (?)', ['+5511987654321'], $pdo)));

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT — relatado, mas só a forma do erro
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia.motivo'))->toContain('falha inesperada');
    // o fake casa a CLASSE exata do parâmetro: o relato saneado é uma RuntimeException nova
    Exceptions::assertReported(fn (RuntimeException $erro): bool => str_contains($erro->getMessage(), 'SQLSTATE HY000/1205')
        && ! str_contains($erro->getMessage(), '98765')
        && $erro->getPrevious() === null);
    // e a original (com o SQL e o telefone) NUNCA chega ao log
    Exceptions::assertNotReported(QueryException::class);
});

it('deve avisar pela conversa que outra gravação criou no mesmo instante', function () {
    // ARRANGE — irmãos gravados ao mesmo tempo: a outra requisição cria a conversa entre a leitura e
    // a gravação desta (SEC-AV-11); o 1062 não pode virar "falha inesperada"
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $criouAOutra = false;
    Conversa::creating(function (Conversa $nova) use (&$criouAOutra): void {
        if ($criouAOutra) {
            return;
        }
        $criouAOutra = true;
        $outra = new Conversa;
        $outra->telefone_e164 = $nova->telefone_e164;
        $outra->save();
    });

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT — uma conversa só, e a mensagem nela
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => true, 'motivo' => null])
        ->and(Conversa::count())->toBe(1)
        ->and(Mensagem::sole()->conversa_id)->toBe(Conversa::sole()->id);
});

it('não deve dizer "próximas sessões" ao aplicar na série um agendamento avulso', function () {
    // ARRANGE — fora de série não há irmãs; `recorrencia_grupo_id IS NULL` acharia todo avulso
    // posterior da clínica (CR3-04, fonte única do alcance)
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    $de = agoraNaClinica()->copy()->addDays(3)->setTime(9, 0);
    $agendamento = agendamentoComWhatsapp($base, $de->format('Y-m-d H:i'));
    agendamentoComWhatsapp($base, $de->copy()->addDays(2)->format('Y-m-d H:i'));

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, [
        'inicio' => $de->copy()->addHour()->format('Y-m-d H:i'),
        'aplicar_na_serie' => true,
        'avisar_familia' => true,
    ]);

    // ASSERT
    $resposta->assertOk();
    expect(Mensagem::where('template_nome', 'remarcacao_agendamento')->sole()->variaveis_json['3'])
        ->toBe($de->format('d/m').' às 10:00');
});

it('deve dizer que as sessões seguintes da série mudaram quando a editada estava desmarcada', function () {
    // ARRANGE — mover a série a partir de uma sessão já desmarcada: a recusa sobre ELA não pode
    // esconder que as duas seguintes, que a família conhece, mudaram de horário (CR4-03)
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $inicio = agoraNaClinica()->copy()->addDays(2)->setTime(10, 0);
    $primeira = serieDaCrianca($this, $admin, $payload, $inicio, 3);
    $desmarque = (int) StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->value('id');
    app(ConfiguracaoService::class)->set('agenda.status_desmarque_id', $desmarque);
    $primeira->update(['status_id' => $desmarque]);

    // ACT — o formulário não manda o status: só o horário, na série
    $resposta = remarcar($this, $admin, $primeira->fresh(), [
        'inicio' => $inicio->copy()->addHour()->format('Y-m-d H:i'),
        'aplicar_na_serie' => true,
        'avisar_familia' => true,
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('aviso_familia'))->toBe([
        'enviado' => false,
        'motivo' => 'a sessão não está marcada (desmarcada, falta ou reserva); mas as próximas 2 sessões da série mudaram — avise a família à mão',
    ])->and(mensagensDoModelo('remarcacao_agendamento'))->toBe(0);
});

it('deve dizer que as sessões seguintes caíram quando a editada já não estava marcada', function () {
    // ARRANGE — a editada foi desmarcada pela família; as seguintes, marcadas, caem junto com o
    // status do desmarque da clínica (CR4-03)
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $inicio = agoraNaClinica()->copy()->addDays(2)->setTime(10, 0);
    $primeira = serieDaCrianca($this, $admin, $payload, $inicio, 2);
    $desmarque = (int) StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->value('id');
    app(ConfiguracaoService::class)->set('agenda.status_desmarque_id', $desmarque);
    $primeira->update(['status_id' => statusQueLibera('Desmarcado pela Família Fictício')]);

    // ACT
    $resposta = remarcar($this, $admin, $primeira->fresh(), [
        'status_id' => $desmarque,
        'aplicar_na_serie' => true,
        'avisar_familia' => true,
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('aviso_familia.motivo'))
        ->toBe('a sessão já não estava marcada (desmarcada, falta ou reserva); mas a próxima sessão da série foi desmarcada — avise a família à mão');
});

it('deve devolver as chaves dos avisos com os padrões', function () {
    // ARRANGE
    $admin = admin();

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/configuracoes');

    // ASSERT
    $valores = collect($resposta->json('configuracoes'))->pluck('valor', 'chave');
    expect($valores['mensagens.template_confirmacao'])->toBe('confirmacao_agendamento')
        ->and($valores['mensagens.template_remarcacao'])->toBe('remarcacao_agendamento')
        ->and($valores['mensagens.template_cancelamento'])->toBe('cancelamento_agendamento')
        ->and($valores['mensagens.avisos_por_familia_dia'])->toBe(4);
});

it('deve criar o agendamento e dizer o motivo quando o envio falha de forma inesperada', function () {
    // ARRANGE — nunca 500 depois do commit: a recepção repetiria e duplicaria (SEC-AV-04)
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    $this->mock(EnvioDeMensagens::class, fn ($envio) => $envio
        ->shouldReceive('enviarTemplate')->andThrow(new RuntimeException('falha fictícia')));

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT — criado; o motivo manda avisar à mão; a marca saiu junto (uma próxima pode avisar)
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia.motivo'))->toContain('falha inesperada')
        ->and(AvisoAFamilia::count())->toBe(0);
});

it('deve traduzir o teto mensal atingido para a recepção', function () {
    // ARRANGE — teto 0 = nenhuma conversa iniciada pela clínica
    $admin = admin();
    avisosProntos();
    app(ConfiguracaoService::class)->set('whatsapp.limite_mensal', 0);
    $payload = criancaNova();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia.motivo'))->toBe('o teto mensal de mensagens foi atingido');
});

it('deve dizer na seleção da agenda quais status são de sessão marcada', function () {
    // ARRANGE — é o que decide se a tela oferece o aviso de cancelamento (SEC-AV-16); invertido,
    // o desmarque da clínica gravaria sem perguntar e a família não seria avisada (CR4-01)
    $admin = admin();
    baseDoDesmarque();
    $statusDaClinica = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');
    $reserva = StatusAgendamento::create([
        'nome' => 'Reserva Fictícia', 'cor' => '#94A3B8', 'tipo' => 'x', 'ordem' => 96,
        'desconta_sessao' => false, 'ocupa_horario' => true, 'marca_reserva' => true,
    ]);

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/agenda/selecao');

    // ASSERT — em aberto é sessão marcada; o desmarque (libera o horário) e a reserva não são
    $resposta->assertOk();
    $marcada = collect($resposta->json('status'))->pluck('sessao_marcada', 'id');
    expect($marcada[StatusAgendamento::inicialId()])->toBeTrue()
        ->and($marcada[$statusDaClinica])->toBeFalse()
        ->and($marcada[$reserva->id])->toBeFalse();
});

it('deve marcar na seleção da agenda qual status é o desmarque da clínica', function () {
    // ARRANGE — é o que faz a tela perguntar ANTES de avisar a família (SEC-AV-02)
    $admin = admin();
    baseDoDesmarque();
    $statusDaClinica = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/agenda/selecao');

    // ASSERT — só ele, e os booleanos continuam booleanos
    $resposta->assertOk();
    $status = collect($resposta->json('status'));
    expect($status->where('desmarque_da_clinica', true)->pluck('id')->all())->toBe([$statusDaClinica])
        ->and($status->every(fn (array $s) => is_bool($s['desconta_sessao'])))->toBeTrue();
});

// ── Mensagens automáticas por profissional (change mensagens-automaticas-por-profissional) ───

it('não deve confirmar o primeiro agendamento com o profissional que confirma por conta própria', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    Profissional::whereKey($payload['profissional_id'])->update(['mensagens_automaticas' => false]);

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT — gravado, nada sai, a recepção sabe por quê, e não fica marca de confirmação
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia'))->toBe([
        'enviado' => false,
        'motivo' => 'as mensagens automáticas estão desligadas para este profissional',
    ])
        ->and(mensagensDoModelo('confirmacao_agendamento'))->toBe(0)
        ->and(AvisoAFamilia::query()->count())->toBe(0);
});

it('não deve confirmar pelo encaixe da fila com o profissional que confirma por conta própria', function () {
    // ARRANGE — a fila é o outro caminho que cria o primeiro agendamento
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    Profissional::whereKey($payload['profissional_id'])->update(['mensagens_automaticas' => false]);
    $entrada = $this->actingAs($admin)->postJson('/api/lista-espera', [
        'paciente_id' => $payload['paciente_id'],
        'especialidade_id' => $payload['especialidade_id'],
        'profissional_id' => $payload['profissional_id'],
    ]);
    $entrada->assertCreated();

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/lista-espera/'.$entrada->json('id').'/encaixar', [
        'inicio' => agoraNaClinica()->copy()->addDays(2)->setTime(11, 0)->format('Y-m-d H:i'),
        'profissional_id' => $payload['profissional_id'],
        'especialidade_id' => $payload['especialidade_id'],
    ]);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('aviso_familia'))->toBe([
        'enviado' => false,
        'motivo' => 'as mensagens automáticas estão desligadas para este profissional',
    ])
        ->and(mensagensDoModelo('confirmacao_agendamento'))->toBe(0);
});

it('não deve falar de aviso ao marcar de novo a criança do profissional que confirma por conta própria', function () {
    // ARRANGE — o portão vem DEPOIS de "é caso de aviso": antes dele, toda marcação desta
    // profissional mostraria o aviso amarelo, e a recepção aprenderia a ignorá-lo (CR-MA-02)
    $admin = admin();
    avisosProntos();
    $payload = criancaNova();
    Profissional::whereKey($payload['profissional_id'])->update(['mensagens_automaticas' => false]);
    Agendamento::factory()->create([
        'paciente_id' => $payload['paciente_id'],
        'profissional_id' => $payload['profissional_id'],
        'especialidade_id' => $payload['especialidade_id'],
    ]);

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/agendamentos', $payload);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json())->not->toHaveKey('aviso_familia');
});

it('deve avisar a remarcação pedida mesmo com o profissional sem mensagens automáticas', function () {
    // ARRANGE — a remarcação não é automática: é a recepção que pede, na hora. A sessão nasce PELA
    // TELA depois de desligar: se a chave fosse copiada para o agendamento (`lembrete_whatsapp`), o
    // portão do canal calaria também este aviso (design D1, alternativa recusada)
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    Profissional::whereKey($base['profissional_id'])->update(['mensagens_automaticas' => false]);
    $de = agoraNaClinica()->copy()->addDays(3)->setTime(14, 0);
    $criada = $this->actingAs($admin)->postJson('/api/agendamentos', [
        'paciente_id' => $base['paciente_id'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'inicio' => $de->format('Y-m-d H:i'),
    ]);
    $criada->assertCreated();
    $agendamento = Agendamento::findOrFail($criada->json('id'));

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, [
        'inicio' => $de->copy()->addDays(2)->setTime(15, 0)->format('Y-m-d H:i'),
        'avisar_familia' => true,
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('aviso_familia'))->toBe(['enviado' => true, 'motivo' => null])
        ->and(mensagensDoModelo('remarcacao_agendamento'))->toBe(1);
});

it('deve avisar o cancelamento pedido mesmo com o profissional sem mensagens automáticas', function () {
    // ARRANGE
    $admin = admin();
    avisosProntos();
    $base = baseDoDesmarque();
    celularDaCrianca($base['paciente_id']);
    Profissional::whereKey($base['profissional_id'])->update(['mensagens_automaticas' => false]);
    $agendamento = agendamentoComWhatsapp($base, agoraNaClinica()->copy()->addDays(3)->setTime(14, 0)->format('Y-m-d H:i'));
    $statusDaClinica = (int) app(ConfiguracaoService::class)->get('agenda.status_desmarque_id');

    // ACT
    $resposta = remarcar($this, $admin, $agendamento, ['status_id' => $statusDaClinica, 'avisar_familia' => true]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('aviso_familia.enviado'))->toBeTrue()
        ->and(mensagensDoModelo('cancelamento_agendamento'))->toBe(1);
});
