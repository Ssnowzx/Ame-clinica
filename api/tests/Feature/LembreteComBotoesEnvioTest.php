<?php

use App\Models\Agendamento;
use App\Models\Mensagem;
use App\Models\MensagemTemplate;
use App\Models\Paciente;
use App\Models\StatusAgendamento;
use App\Models\WhatsappConexao;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Mensageria\ClienteCloudApi;
use App\Support\Mensageria\ClienteSimulado;
use App\Support\Mensageria\ClienteWhatsApp;
use App\Support\Mensageria\DisparoDeLembretes;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

/*
 * O modelo com botões de resposta rápida (change lembrete-com-botoes-de-resposta, grupo 2): a
 * sincronização guarda os botões, e o envio manda o payload de cada um PELA POSIÇÃO — o significado
 * é decidido na chegada. Dados FICTÍCIOS sempre (LGPD).
 */

/** Um modelo aprovado com os dois botões do lembrete. */
function modeloComBotoes(string $nome = 'lembrete_com_resposta'): MensagemTemplate
{
    return MensagemTemplate::create([
        'nome' => $nome,
        'idioma' => 'pt_BR',
        'categoria' => 'UTILITY',
        'corpo_previa' => 'Olá {{1}}, amanhã tem atendimento {{2}}. Podemos confirmar?',
        'variaveis_json' => ['1', '2'],
        'botoes_json' => [
            ['tipo' => 'QUICK_REPLY', 'texto' => '✅ Confirmo'],
            ['tipo' => 'QUICK_REPLY', 'texto' => '❌ Preciso desmarcar'],
        ],
        'status_meta' => 'APPROVED',
    ]);
}

/** O cliente da Meta de verdade, falando com um HTTP simulado. */
function clienteDaMetaSimulado(): ClienteCloudApi
{
    $conexao = WhatsappConexao::query()->firstOrFail();

    return new ClienteCloudApi($conexao);
}

/** A fila executa na hora e o cliente registra o que enviaria. */
function filaNaHora(): ClienteSimulado
{
    $simulado = new ClienteSimulado;
    app()->instance(ClienteWhatsApp::class, $simulado);
    config(['queue.default' => 'sync']);

    return $simulado;
}

it('deve mandar à Meta o payload de cada botão pela posição', function () {
    // ARRANGE
    admin();
    canalConectado();
    Http::fake(['*' => Http::response(['messages' => [['id' => 'wamid.FICTICIO1']]])]);

    // ACT
    clienteDaMetaSimulado()->enviarTemplate('+5511987654321', 'lembrete_com_resposta', 'pt_BR', ['1' => 'Criança Fictícia', '2' => '14:00'], [0 => 'botao:0', 1 => 'botao:1']);

    // ASSERT — o corpo e os dois botões, com o índice como TEXTO (é o que a Meta exige)
    Http::assertSent(function (Request $pedido): bool {
        $componentes = $pedido->data()['template']['components'] ?? [];

        return count($componentes) === 3
            && $componentes[0]['type'] === 'body'
            && $componentes[1] === ['type' => 'button', 'sub_type' => 'quick_reply', 'index' => '0', 'parameters' => [['type' => 'payload', 'payload' => 'botao:0']]]
            && $componentes[2] === ['type' => 'button', 'sub_type' => 'quick_reply', 'index' => '1', 'parameters' => [['type' => 'payload', 'payload' => 'botao:1']]];
    });
});

it('deve mandar o modelo sem botões exatamente como antes', function () {
    // ARRANGE — o lembrete de hoje não tem botão: nada pode mudar para ele
    admin();
    canalConectado();
    Http::fake(['*' => Http::response(['messages' => [['id' => 'wamid.FICTICIO2']]])]);

    // ACT
    clienteDaMetaSimulado()->enviarTemplate('+5511987654321', 'lembrete_agendamento', 'pt_BR', ['1' => 'Criança Fictícia', '2' => '14:00']);

    // ASSERT — só o corpo
    Http::assertSent(fn (Request $pedido): bool => count($pedido->data()['template']['components'] ?? []) === 1
        && $pedido->data()['template']['components'][0]['type'] === 'body');
});

it('deve ler os botões de resposta rápida do modelo na ordem da Meta', function () {
    // ARRANGE
    admin();
    canalConectado();
    Http::fake(['*' => Http::response(['data' => [[
        'name' => 'lembrete_com_resposta',
        'language' => 'pt_BR',
        'category' => 'UTILITY',
        'status' => 'APPROVED',
        'components' => [
            ['type' => 'BODY', 'text' => 'Olá {{1}}, amanhã {{2}}.'],
            ['type' => 'BUTTONS', 'buttons' => [
                ['type' => 'QUICK_REPLY', 'text' => '✅ Confirmo'],
                ['type' => 'QUICK_REPLY', 'text' => '❌ Preciso desmarcar'],
            ]],
        ],
    ]]])]);

    // ACT
    $modelos = clienteDaMetaSimulado()->listarTemplates();

    // ASSERT
    expect($modelos[0]['botoes'])->toBe([
        ['tipo' => 'QUICK_REPLY', 'texto' => '✅ Confirmo'],
        ['tipo' => 'QUICK_REPLY', 'texto' => '❌ Preciso desmarcar'],
    ]);
});

it('deve guardar os botões do modelo na sincronização', function () {
    // ARRANGE — a lista que a Meta devolveria, pelo cliente simulado
    $admin = admin();
    canalConectado();
    app()->instance(ClienteWhatsApp::class, new class extends ClienteSimulado
    {
        public function listarTemplates(): array
        {
            return [[
                'nome' => 'lembrete_com_resposta', 'idioma' => 'pt_BR', 'categoria' => 'UTILITY',
                'corpo' => 'Olá {{1}}, amanhã {{2}}.', 'variaveis' => ['1', '2'],
                'botoes' => [['tipo' => 'QUICK_REPLY', 'texto' => '✅ Confirmo'], ['tipo' => 'QUICK_REPLY', 'texto' => '❌ Preciso desmarcar']],
                'status' => 'APPROVED',
            ]];
        }
    });

    // ACT
    $this->actingAs($admin)->postJson('/api/mensagens/templates/sincronizar')->assertOk();

    // ASSERT
    $modelo = MensagemTemplate::where('nome', 'lembrete_com_resposta')->sole();
    expect($modelo->temBotoesDeResposta())->toBeTrue()
        ->and($modelo->payloadsDosBotoes())->toBe([0 => 'botao:0', 1 => 'botao:1']);
});

it('não deve dar payload a botão que não é de resposta rápida', function () {
    // ARRANGE — um botão de link no meio: o índice do toque é a posição REAL na lista da Meta
    admin();
    $modelo = MensagemTemplate::create([
        'nome' => 'modelo_misto', 'idioma' => 'pt_BR', 'categoria' => 'UTILITY', 'corpo_previa' => 'Olá.',
        'variaveis_json' => [], 'status_meta' => 'APPROVED',
        'botoes_json' => [['tipo' => 'URL', 'texto' => 'Site'], ['tipo' => 'QUICK_REPLY', 'texto' => 'Ok']],
    ]);

    // ACT
    $payloads = $modelo->payloadsDosBotoes();

    // ASSERT
    expect($payloads)->toBe([1 => 'botao:1'])
        ->and($modelo->temBotoesDeResposta())->toBeFalse();
});

it('deve mandar os botões pelo caminho real do job, e de novo no reenvio', function () {
    // ARRANGE — o reenvio pela tela chega SEM carga: os botões têm de vir do modelo gravado
    $admin = admin();
    canalConectado();
    modeloComBotoes();
    $conversa = conversaAberta(janelaAberta: false);
    $simulado = filaNaHora();
    $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'template', 'template' => 'lembrete_com_resposta',
        'variaveis' => ['1' => 'Criança Fictícia', '2' => '14:00'],
    ])->assertCreated();
    $primeiro = $simulado->enviados[0]['botoes'];
    $mensagem = Mensagem::query()->firstOrFail();
    $mensagem->avancarEntrega(fn (Mensagem $m) => $m->status = 'falhou');
    $simulado->enviados = [];

    // ACT
    $this->actingAs($admin)->postJson("/api/mensagens/{$mensagem->id}/reenviar")->assertOk();

    // ASSERT
    expect($primeiro)->toBe([0 => 'botao:0', 1 => 'botao:1'])
        ->and($simulado->enviados[0]['botoes'])->toBe([0 => 'botao:0', 1 => 'botao:1']);
});

it('deve mandar o lembrete com os botões quando o modelo configurado os tem', function () {
    // ARRANGE
    admin();
    canalConectado();
    modeloComBotoes();
    app(ConfiguracaoService::class)->set('whatsapp.automatico', true);
    app(ConfiguracaoService::class)->set('lembretes.template', 'lembrete_com_resposta');
    $simulado = filaNaHora();
    $base = baseDeAgenda();
    Paciente::query()->whereKey($base['paciente_id'])->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 98765-4321']]]);
    $agendamento = Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'], 'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'inicio' => agoraNaClinica()->addDay()->format('Y-m-d').' 14:00:00',
    ]);
    $agendamento->forceFill(['lembrete_whatsapp' => true, 'status_id' => StatusAgendamento::inicialId()])->save();

    // ACT
    app(DisparoDeLembretes::class)->executar();

    // ASSERT
    expect($simulado->enviados)->toHaveCount(1)
        ->and($simulado->enviados[0]['nome'])->toBe('lembrete_com_resposta')
        ->and($simulado->enviados[0]['botoes'])->toBe([0 => 'botao:0', 1 => 'botao:1']);
});
