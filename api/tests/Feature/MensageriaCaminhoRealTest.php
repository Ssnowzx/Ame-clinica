<?php

use App\Models\Mensagem;
use App\Support\Mensageria\ClienteSimulado;
use App\Support\Mensageria\ClienteWhatsApp;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/*
 * O CAMINHO REAL do Job — a lacuna que deixou três bloqueantes passarem pelo gate.
 *
 * As suítes acima usam `Queue::fake()` e depois instanciam `new EnviarMensagemJob($t, $id)`
 * SEM carga. Isso nunca exercita o contrato entre quem despacha e quem executa — e era
 * justamente ali que o template saía sem parâmetro nenhum. Aqui a fila é `sync`: despachar
 * EXECUTA, com a carga de verdade.
 */
function executandoAFila(): ClienteSimulado
{
    $simulado = new ClienteSimulado;
    app()->instance(ClienteWhatsApp::class, $simulado);
    config(['queue.default' => 'sync']);

    return $simulado;
}

it('deve entregar o template COM as variáveis preenchidas — o caminho real do Job', function () {
    // ARRANGE — sem isto, todo lembrete da clínica sai sem parâmetro e a Meta recusa: o
    // canal inteiro nasce morto no dia da virada
    $admin = admin();
    canalConectado();
    templateAprovado();
    $conversa = conversaAberta(janelaAberta: false);
    $simulado = executandoAFila();

    // ACT
    $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'template',
        'template' => 'lembrete_agendamento',
        'variaveis' => ['1' => 'Ana', '2' => 'quarta às 14h'],
    ])->assertCreated();

    // ASSERT — o que CHEGOU ao cliente, não o que a API respondeu
    expect($simulado->enviados)->toHaveCount(1);
    expect($simulado->enviados[0]['tipo'])->toBe('template');
    expect($simulado->enviados[0]['variaveis'])->toBe(['1' => 'Ana', '2' => 'quarta às 14h']);
    expect($simulado->enviados[0]['idioma'])->toBe('pt_BR');
});

it('deve usar o IDIOMA do template gravado, nunca um pt_BR chutado', function () {
    // ARRANGE — template aprovado como `pt` recusado como "não existe nesta tradução" é
    // erro permanente: nenhum lembrete sai, e a tela acusa um template que está na lista
    $admin = admin();
    canalConectado();
    templateAprovado()->forceFill(['idioma' => 'pt'])->save();
    $conversa = conversaAberta(janelaAberta: false);
    $simulado = executandoAFila();

    // ACT
    $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'template',
        'template' => 'lembrete_agendamento',
        'variaveis' => ['1' => 'Ana', '2' => 'quarta'],
    ])->assertCreated();

    // ASSERT
    expect($simulado->enviados[0]['idioma'])->toBe('pt');
});

it('deve REENVIAR mídia como mídia — nunca degradar para a legenda solta', function () {
    // ARRANGE — reenfileirar vazio fazia a família receber "Segue o pedido médico da Ana"
    // sem arquivo, com a thread marcando `enviada`: prova visual de um envio que não houve
    Storage::fake('local');
    $admin = admin();
    canalConectado();
    $conversa = conversaAberta();
    $simulado = executandoAFila();

    $this->actingAs($admin)->post("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'midia',
        'legenda' => 'Segue o pedido medico',
        'arquivo' => UploadedFile::fake()->createWithContent(
            'pedido.png',
            base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
        ),
    ])->assertCreated();

    $mensagem = Mensagem::query()->firstOrFail();
    $mensagem->avancarEntrega(fn (Mensagem $m) => $m->status = 'falhou');
    $simulado->enviados = [];

    // ACT
    $this->actingAs($admin)->postJson("/api/mensagens/{$mensagem->id}/reenviar")->assertOk();

    // ASSERT — saiu MÍDIA de novo, com bytes; não um texto com a legenda
    expect($simulado->enviados)->toHaveCount(1);
    expect($simulado->enviados[0]['tipo'])->toBe('midia');
    expect($simulado->enviados[0]['bytes'])->toBeGreaterThan(0);
});

it('deve REENVIAR template com as variáveis que foram gravadas', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();
    templateAprovado();
    $conversa = conversaAberta(janelaAberta: false);
    $simulado = executandoAFila();

    $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'template',
        'template' => 'lembrete_agendamento',
        'variaveis' => ['1' => 'Ana', '2' => 'quarta às 14h'],
    ])->assertCreated();

    $mensagem = Mensagem::query()->firstOrFail();
    $mensagem->avancarEntrega(fn (Mensagem $m) => $m->status = 'falhou');
    $simulado->enviados = [];

    // ACT
    $this->actingAs($admin)->postJson("/api/mensagens/{$mensagem->id}/reenviar")->assertOk();

    // ASSERT — as variáveis sobreviveram ao reenvio porque estão na MENSAGEM, não na carga
    expect($simulado->enviados[0]['variaveis'])->toBe(['1' => 'Ana', '2' => 'quarta às 14h']);
});

it('NÃO deve reenviar mídia cujo arquivo já foi expurgado pela retenção', function () {
    // ARRANGE — sem esta trava, o reenvio mandaria a legenda sozinha
    Storage::fake('local');
    $admin = admin();
    canalConectado();
    $conversa = conversaAberta();
    executandoAFila();

    $this->actingAs($admin)->post("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'midia',
        'arquivo' => UploadedFile::fake()->createWithContent(
            'pedido.png',
            base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
        ),
    ])->assertCreated();

    $mensagem = Mensagem::query()->firstOrFail();
    $mensagem->avancarEntrega(fn (Mensagem $m) => $m->status = 'falhou');
    $mensagem->midia->forceFill(['caminho' => null])->save();

    // ACT / ASSERT
    $this->actingAs($admin)->postJson("/api/mensagens/{$mensagem->id}/reenviar")
        ->assertStatus(422)->assertJsonValidationErrors(['arquivo']);
});
