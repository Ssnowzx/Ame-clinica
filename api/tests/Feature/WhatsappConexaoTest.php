<?php

use App\Models\WhatsappConexao;
use App\Support\Mensageria\ClienteSimulado;
use App\Support\Mensageria\ClienteWhatsApp;
use App\Support\Mensageria\ErroDeEnvio;
use App\Support\Mensageria\FabricaDeCliente;
use Illuminate\Support\Facades\Http;

/**
 * A tela de conexão (change mensageria-whatsapp, D1) — a porta pela qual a clínica liga o
 * canal SEM deploy, e a garantia de que o segredo entra e não sai.
 *
 * Credenciais 100% FICTÍCIAS.
 */
$credencial = [
    'phone_number_id' => '123456789012345',
    'waba_id' => '987654321098765',
    'access_token' => 'EAAF_TOKEN_FICTICIO_PARA_TESTE_WXYZ',
    'app_secret' => 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    'verify_token' => 'verify-ficticio-para-teste-1234567890',
];

it('deve começar em NÃO CONECTADO e já entregar a URL do webhook', function () {
    // ARRANGE — o estado do dia de hoje: sistema pronto, credencial ainda não pedida
    $admin = admin();

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/mensagens/conexao');

    // ASSERT — a URL sai daqui porque é o valor que a clínica cola no painel da Meta
    $resposta->assertOk()
        ->assertJsonPath('estado', 'nao_conectado')
        ->assertJsonPath('token_final', null)
        ->assertJsonPath('webhook_url', rtrim((string) config('app.url'), '/').'/api/webhooks/whatsapp');
});

it('deve montar o webhook pelo APP_URL, ignorando o Host da requisicao', function () {
    // ARRANGE — atrás de proxy reverso o Host chega interno e o esquema chega http;
    // a URL é COLADA no painel da Meta, que só aceita https no domínio público.
    config(['app.url' => 'https://clinica.exemplo.com.br']);
    $admin = admin();

    // ACT — requisição chegando com o Host errado, como o proxy entrega
    $resposta = $this->actingAs($admin)
        ->withHeaders(['Host' => '127.0.0.1'])
        ->getJson('/api/mensagens/conexao');

    // ASSERT
    $resposta->assertOk()
        ->assertJsonPath('webhook_url', 'https://clinica.exemplo.com.br/api/webhooks/whatsapp');
});

it('deve gravar a credencial e NUNCA devolvê-la — só os 4 últimos do token', function () use ($credencial) {
    // ARRANGE
    $admin = admin();

    // ACT
    $resposta = $this->actingAs($admin)->putJson('/api/mensagens/conexao', $credencial);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('token_final', 'WXYZ');
    semVazamento($resposta->json(), $credencial['access_token']);
    semVazamento($resposta->json(), $credencial['app_secret']);
    semVazamento($resposta->json(), $credencial['verify_token']);

    // e a leitura seguinte também não revela
    $leitura = $this->actingAs($admin)->getJson('/api/mensagens/conexao');
    semVazamento($leitura->json(), $credencial['access_token']);
});

it('NÃO deve deixar a credencial nascer CONECTADA sem alguém ter perguntado à Meta', function () use ($credencial) {
    // ARRANGE
    $admin = admin();

    // ACT — mesmo mandando `estado` no payload
    $resposta = $this->actingAs($admin)
        ->putJson('/api/mensagens/conexao', $credencial + ['estado' => 'conectado']);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('estado', 'nao_conectado');
    expect(WhatsappConexao::query()->firstOrFail()->estado)->toBe('nao_conectado');
});

it('deve exigir a credencial INTEIRA na troca, nunca um pedaço', function () use ($credencial) {
    // ARRANGE — token novo com Phone Number ID velho é o "manda e não chega" silencioso
    $admin = admin();
    $this->actingAs($admin)->putJson('/api/mensagens/conexao', $credencial)->assertOk();

    // ACT
    $resposta = $this->actingAs($admin)
        ->putJson('/api/mensagens/conexao', ['access_token' => 'EAAF_OUTRO_TOKEN_FICTICIO_1234']);

    // ASSERT
    $resposta->assertStatus(422)
        ->assertJsonValidationErrors(['phone_number_id', 'waba_id', 'app_secret', 'verify_token']);
});

it('deve voltar a NÃO CONECTADO quando a credencial é trocada', function () use ($credencial) {
    // ARRANGE — conexão já verificada
    $admin = admin();
    app()->instance(ClienteWhatsApp::class, new ClienteSimulado);
    $this->actingAs($admin)->putJson('/api/mensagens/conexao', $credencial)->assertOk();
    $this->actingAs($admin)->postJson('/api/mensagens/conexao/testar')->assertJsonPath('estado', 'conectado');

    // ACT — troca o token
    $resposta = $this->actingAs($admin)
        ->putJson('/api/mensagens/conexao', ['access_token' => 'EAAF_TOKEN_FICTICIO_NOVO_ABCD'] + $credencial);

    // ASSERT — credencial nova é credencial não verificada
    $resposta->assertOk()->assertJsonPath('estado', 'nao_conectado');
});

it('deve promover a CONECTADO só pelo teste contra a Meta', function () use ($credencial) {
    // ARRANGE
    $admin = admin();
    app()->instance(ClienteWhatsApp::class, new ClienteSimulado);
    $this->actingAs($admin)->putJson('/api/mensagens/conexao', $credencial);

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/mensagens/conexao/testar');

    // ASSERT
    $resposta->assertOk()
        ->assertJsonPath('estado', 'conectado')
        ->assertJsonPath('numero_exibicao', '+55 11 0000-0000');
    expect($resposta->json('ultimo_teste_em'))->not->toBeNull();
});

it('deve virar INVÁLIDO com o motivo legível quando a Meta recusa', function () use ($credencial) {
    // ARRANGE — sem diagnóstico, o operador não distingue token expirado de número errado
    $admin = admin();
    // estende o simulado em vez de reimplementar a interface: um duplo que copia os seis
    // métodos quebra a cada mudança de assinatura, e o que este teste precisa é de UM
    // comportamento diferente
    $recusa = new class extends ClienteSimulado
    {
        public function verificarCredencial(): string
        {
            throw ErroDeEnvio::permanente('Error validating access token: Session has expired.');
        }
    };
    app()->instance(ClienteWhatsApp::class, $recusa);
    $this->actingAs($admin)->putJson('/api/mensagens/conexao', $credencial);

    // ACT
    $resposta = $this->actingAs($admin)->postJson('/api/mensagens/conexao/testar');

    // ASSERT
    $resposta->assertOk()
        ->assertJsonPath('estado', 'invalido')
        ->assertJsonPath('ultimo_erro', 'Error validating access token: Session has expired.');
});

it('deve recusar testar quando não há credencial gravada', function () {
    // ARRANGE
    $admin = admin();

    // ACT / ASSERT
    $this->actingAs($admin)->postJson('/api/mensagens/conexao/testar')->assertStatus(422);
});

it('NÃO deve deixar quem só LÊ mensagens chegar perto da credencial', function () use ($credencial) {
    // ARRANGE
    admin();
    $recepcao = usuarioCom(['mensagens.ver', 'mensagens.responder'], 'Recepção');

    // ACT / ASSERT — os três caminhos
    $this->actingAs($recepcao)->getJson('/api/mensagens/conexao')->assertForbidden();
    $this->actingAs($recepcao)->putJson('/api/mensagens/conexao', $credencial)->assertForbidden();
    $this->actingAs($recepcao)->postJson('/api/mensagens/conexao/testar')->assertForbidden();
});

it('NÃO deve deixar `configuracoes.editar` conectar o WhatsApp', function () use ($credencial) {
    // ARRANGE — o catálogo de parametrização não carrega segredo de canal (spec rbac)
    admin();
    $parametrizador = usuarioCom(['configuracoes.ver', 'configuracoes.editar'], 'Parametrizador');

    // ACT / ASSERT
    $this->actingAs($parametrizador)->putJson('/api/mensagens/conexao', $credencial)->assertForbidden();
});

it('deve RECUSAR resolver cliente com a conexão desconectada — nunca cair no simulado', function () {
    // ARRANGE — o defeito que isto impede (SEC-WA-03): a conexão cai entre o enfileiramento
    // e o worker (rotar o token devolve o estado a `nao_conectado`), o Job resolveria o
    // SIMULADO e marcaria a mensagem como `enviada` com um `wamid.SIMULADO1` — registro
    // FALSO num histórico que a clínica usa como prova de ter avisado a família.
    Http::preventStrayRequests();
    admin();
    app()->forgetInstance(ClienteWhatsApp::class);

    // ACT / ASSERT — fail-closed, e TEMPORÁRIO: a mensagem fica pendente e sai ao reconectar
    expect(fn () => app(FabricaDeCliente::class)->paraClinica())
        ->toThrow(ErroDeEnvio::class, 'O WhatsApp da clínica não está conectado.');
});
