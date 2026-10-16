<?php

use App\Jobs\EnviarMensagemJob;
use App\Models\Agendamento;
use App\Models\Mensagem;
use App\Models\Paciente;
use App\Models\StatusAgendamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Facades\Queue;

/**
 * Dá ao paciente um celular fictício, para o aviso ter para onde ir.
 *
 * Pelo MODEL, não por `whereKey()->update()`: o update do query builder não dispara os
 * eventos, e é o evento que normaliza o contato em `contatos_normalizados` — sem ele o
 * telefone existe no JSON e o envio não o encontra.
 */
function comCelular(int $pacienteId, string $telefone = '(11) 98765-4321'): void
{
    $paciente = Paciente::findOrFail($pacienteId);
    $paciente->contatos_json = [['tipo' => 'celular', 'valor' => $telefone]];
    $paciente->save();
}

/** Canal conectado + template aprovado + a chave apontando para ele. */
function canalDoDesmarquePronto(): void
{
    canalConectado();
    templateAprovado('desmarque_agenda');
    app(ConfiguracaoService::class)->set('mensagens.template_desmarque', 'desmarque_agenda');
}

it('deve avisar UMA vez por família, mesmo com duas sessões no lote', function () {
    // ARRANGE — cada mensagem iniciada pela clínica é uma conversa cobrada pela Meta
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    canalDoDesmarquePronto();
    comCelular($base['paciente_id']);
    agendamentoDoDesmarque($base, '2026-09-14 14:00');
    agendamentoDoDesmarque($base, '2026-09-14 15:00');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
    ]);

    // ASSERT — dois desmarques, UM aviso
    $resposta->assertOk();
    expect($resposta->json('desmarcados'))->toBe(2)
        ->and($resposta->json('avisados'))->toBe(1)
        ->and(Mensagem::where('tipo', 'template')->count())->toBe(1);
});

it('deve pôr a família sem telefone na lista de não-avisados, sem derrubar o lote', function () {
    // ARRANGE — derrubar 2 desmarques porque uma mãe não tem telefone seria trocar um
    // problema pequeno por um grande
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    canalDoDesmarquePronto();
    comCelular($base['paciente_id']);
    $semTelefone = Paciente::factory()->create()->id;
    agendamentoDoDesmarque($base, '2026-09-14 14:00');
    agendamentoDoDesmarque($base, '2026-09-14 15:00', ['paciente_id' => $semTelefone]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
    ]);

    // ASSERT — os dois desmarcados; um avisado, um na lista com o motivo
    $resposta->assertOk();
    expect($resposta->json('desmarcados'))->toBe(2)
        ->and($resposta->json('avisados'))->toBe(1)
        ->and($resposta->json('nao_avisados'))->toHaveCount(1)
        ->and($resposta->json('nao_avisados.0.motivo'))->toBe('sem telefone no cadastro');
});

it('deve desmarcar sem enviar quando o usuário não tem permissão de mensagens', function () {
    // ARRANGE — o desmarque não fica refém do canal: quem não pode enviar recebe a lista
    $semMensagens = usuarioCom(['agenda.ver', 'agenda.editar', 'agenda.ver_todos'], 'Recepção Fictícia');
    $base = baseDoDesmarque();
    canalDoDesmarquePronto();
    comCelular($base['paciente_id']);
    agendamentoDoDesmarque($base, '2026-09-14 14:00');

    // ACT
    $resposta = $this->actingAs($semMensagens)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
    ]);

    // ASSERT — desmarcou, não enviou, e disse quem falta avisar
    $resposta->assertOk();
    expect($resposta->json('desmarcados'))->toBe(1)
        ->and($resposta->json('avisados'))->toBe(0)
        ->and(Mensagem::where('tipo', 'template')->count())->toBe(0)
        ->and($resposta->json('nao_avisados.0.motivo'))->toContain('permissão');
});

it('não deve enviar aviso nenhum quando a caixa vem desmarcada', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    canalDoDesmarquePronto();
    comCelular($base['paciente_id']);
    agendamentoDoDesmarque($base, '2026-09-14 14:00');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
        'avisar' => false,
    ]);

    // ASSERT — nem envio, nem lista (não foi pedido)
    $resposta->assertOk();
    expect(Mensagem::where('tipo', 'template')->count())->toBe(0)
        ->and($resposta->json('nao_avisados'))->toBe([]);
});

it('deve avisar por padrão quando a chave não vem no payload', function () {
    // ARRANGE — a caixa nasce MARCADA (decisão da clínica): omitir significa avisar
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    canalDoDesmarquePronto();
    comCelular($base['paciente_id']);
    agendamentoDoDesmarque($base, '2026-09-14 14:00');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
    ])->assertOk();

    // ASSERT
    expect($resposta->json('nao_avisados'))->toBe([]);
    expect(Mensagem::where('tipo', 'template')->count())->toBe(1);
});

it('NÃO deve enviar mensagem quando a validação recusa antes de escrever', function () {
    // ARRANGE — recusa de configuração: 422 ANTES da transação. Note que este teste NÃO prova
    // o pós-commit (a falha acontece antes de qualquer escrita); quem prova é o de baixo.
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    canalDoDesmarquePronto();
    comCelular($base['paciente_id']);
    $agendamento = agendamentoDoDesmarque($base, '2026-09-14 14:00');
    $descontante = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();

    // ACT
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
        'status_id' => $descontante->id,
    ])->assertStatus(422);

    // ASSERT — nada escrito, NADA enviado
    expect($agendamento->refresh()->status_id)->toBe(StatusAgendamento::inicialId())
        ->and(Mensagem::where('tipo', 'template')->count())->toBe(0);
});

it('deve devolver a lista quando o canal não está conectado, sem falhar o lote', function () {
    // ARRANGE — canal desconectado é estado da clínica, não falha a alarmar
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    comCelular($base['paciente_id']);
    agendamentoDoDesmarque($base, '2026-09-14 14:00');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('desmarcados'))->toBe(1)
        ->and($resposta->json('avisados'))->toBe(0)
        ->and($resposta->json('nao_avisados.0.motivo'))->toContain('não conectado')
        ->and(Agendamento::where('tipo', 'atendimento')->first()->status_id)
        ->not->toBe(StatusAgendamento::inicialId());
});

it('deve reverter TUDO e não enviar nada quando a falha acontece DENTRO da transação', function () {
    // ARRANGE — este é o teste que prova o design D3 e a transação única (4.4) de verdade: a
    // falha tem de acontecer DEPOIS de agendamentos já terem sido alterados. Um bloqueio já
    // existente na mesma tarde faz o bloqueio novo conflitar, e o conflito estoura no meio da
    // transação, com os desmarques já aplicados.
    // a asserção é sobre a FILA, não sobre a linha no banco: a `Mensagem` criada dentro da
    // transação seria revertida junto e a contagem continuaria zero — foi assim que a primeira
    // versão deste teste sobreviveu à mutação que ele promete guardar. O que o design D3
    // protege é o JOB, que a fila real já teria levado embora antes do rollback.
    Queue::fake();
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    canalDoDesmarquePronto();
    comCelular($base['paciente_id']);
    $agendamento = agendamentoDoDesmarque($base, '2026-09-14 14:00');
    $statusOriginal = $agendamento->status_id;
    // O bloqueio pré-existente fica DEPOIS do agendamento, mas ainda dentro da janela da
    // tarde. É deliberado: se ele cobrisse o horário da sessão, o conflito estouraria já no
    // PRIMEIRO `atualizar` e a falha aconteceria antes de qualquer escrita — foi assim que a
    // primeira versão deste teste não conseguiu distinguir nada. Aqui o desmarque acontece,
    // e só então a criação do bloqueio conflita: a falha nasce no MEIO da transação.
    Agendamento::create([
        'tipo' => 'bloqueio',
        'profissional_id' => $base['profissional_id'],
        'inicio' => '2026-09-14 18:00',
        'fim' => '2026-09-14 18:30',
        'obs' => 'Bloqueio fictício anterior',
    ]);

    // ACT — pede o bloqueio: ele vai conflitar com o que já existe
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
        'bloquear' => true, 'motivo' => 'Atestado fictício',
    ]);

    // ASSERT — a operação falhou, o agendamento voltou ao status original (rollback) e
    // NENHUMA família foi avisada de um desmarque que não aconteceu
    expect($resposta->status())->toBeGreaterThanOrEqual(400)
        ->and($agendamento->refresh()->status_id)->toBe($statusOriginal)
        ->and(Agendamento::where('tipo', 'bloqueio')->count())->toBe(1);
    Queue::assertNotPushed(EnviarMensagemJob::class);
});

it('deve gravar o AUTOR da mensagem — dezenas de avisos sobre crianças sem autor é repudiation', function () {
    // ARRANGE — a trilha de `agendamentos` sabe quem mudou cada status; a das mensagens não
    // sabia quem as mandou. E o autor aqui é uma PESSOA que clicou, não o cron (achado do gate
    // de segurança). Por isso `automatica` também é falsa: o regime é operado por gente.
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    canalDoDesmarquePronto();
    comCelular($base['paciente_id']);
    agendamentoDoDesmarque($base, '2026-09-14 14:00');

    // ACT
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
    ])->assertOk();

    // ASSERT
    $mensagem = Mensagem::where('tipo', 'template')->firstOrFail();
    expect($mensagem->enviada_por)->toBe($adminDaClinica->id)
        ->and($mensagem->automatica)->toBeFalse();
});

it('deve dizer telefone inválido para a família com o número digitado errado', function () {
    // ARRANGE — change telefone-que-chega-no-whatsapp: o motivo tem de mandar a recepção ao campo
    // certo (o número existe, está errado), não procurar um campo vazio
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    canalDoDesmarquePronto();
    comCelular($base['paciente_id'], '55 49912-3456');
    agendamentoDoDesmarque($base, '2026-09-14 14:00');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('avisados'))->toBe(0)
        ->and($resposta->json('nao_avisados.0.motivo'))->toBe('telefone inválido no cadastro');
});
