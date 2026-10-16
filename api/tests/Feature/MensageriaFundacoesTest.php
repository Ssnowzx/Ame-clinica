<?php

use App\Models\Auditoria;
use App\Models\Conversa;
use App\Models\Mensagem;
use App\Models\WhatsappConexao;
use Illuminate\Database\QueryException;

/**
 * As fundações do canal (change mensageria-whatsapp): o MASCARAMENTO na trilha
 * e a idempotência do webhook.
 *
 * O mascaramento é o requisito duro desta change. Conversa de clínica infantil é texto livre
 * onde cabe diagnóstico, e o telefone é identificador direto da família de um menor (art. 11).
 * A credencial da Meta é o outro lado: foi por ela vazar na trilha que a conexão ganhou tabela
 * própria em vez de morar em `configuracoes`. Se estes testes ficarem verdes por acidente, a
 * decisão inteira do D1 vira decorativa.
 *
 * Dados 100% FICTÍCIOS.
 */
function conversaFicticia(string $telefone = '+5511987654321'): Conversa
{
    $conversa = new Conversa(['nome_perfil' => 'Perfil Fictício']);
    $conversa->telefone_e164 = $telefone;
    $conversa->save();

    return $conversa;
}

function conexaoFicticia(array $sobrescreve = []): WhatsappConexao
{
    $conexao = new WhatsappConexao(array_merge([
        'phone_number_id' => (string) fake()->unique()->numberBetween(100000, 999999),
        'waba_id' => (string) fake()->unique()->numberBetween(100000, 999999),
        'numero_exibicao' => '+55 11 3333-4444',
    ], $sobrescreve));
    $conexao->access_token = 'TOKEN_FICTICIO_ABCD';
    $conexao->app_secret = 'SEGREDO_FICTICIO_1234';
    $conexao->verify_token = 'VERIFY_FICTICIO_XYZ9';
    $conexao->save();

    return $conexao;
}

it('NÃO deve escrever o CORPO da mensagem na trilha de auditoria', function () {
    // ARRANGE
    admin();
    $conversa = conversaFicticia();
    $teor = 'O laudo do neuro ficticio saiu, posso levar na sessao?';

    // ACT
    $mensagem = new Mensagem(['corpo' => $teor, 'tipo' => 'texto']);
    $mensagem->conversa_id = $conversa->id;
    $mensagem->direcao = Mensagem::DIRECAO_RECEBIDA;
    $mensagem->status = 'recebida';
    $mensagem->wa_message_id = 'wamid.FICTICIO1';
    $mensagem->save();

    // ASSERT — a trilha prova QUE houve mensagem, sem repetir o que foi dito
    $trilha = Auditoria::query()->where('entidade', 'mensagens')->get();
    expect($trilha)->toHaveCount(1);
    expect($trilha->first()->diff_json['depois']['corpo'])->toBe('***');
    semVazamento($trilha->first()->diff_json, $teor);
});

it('NÃO deve escrever o TELEFONE nem o nome de perfil da conversa na trilha', function () {
    // ARRANGE
    admin();

    // ACT
    conversaFicticia('+5511912345678');

    // ASSERT
    $trilha = Auditoria::query()->where('entidade', 'conversas')->firstOrFail();
    expect($trilha->diff_json['depois']['telefone_e164'])->toBe('***');
    expect($trilha->diff_json['depois']['nome_perfil'])->toBe('***');
    semVazamento($trilha->diff_json, '5511912345678');
});

it('NÃO deve escrever NENHUM segredo da conexão na trilha — nem parcialmente', function () {
    // ARRANGE
    admin();

    // ACT
    conexaoFicticia();

    // ASSERT — a trilha registra que a conexão nasceu, e quem a criou; o segredo, não
    $trilha = Auditoria::query()->where('entidade', 'whatsapp_conexoes')->firstOrFail();
    expect($trilha->diff_json['depois']['access_token'])->toBe('***');
    expect($trilha->diff_json['depois']['app_secret'])->toBe('***');
    expect($trilha->diff_json['depois']['verify_token'])->toBe('***');
    semVazamento($trilha->diff_json, 'TOKEN_FICTICIO_ABCD');
    semVazamento($trilha->diff_json, 'SEGREDO_FICTICIO_1234');
    semVazamento($trilha->diff_json, 'VERIFY_FICTICIO_XYZ9');
    // e o identificador público continua legível: é ele que torna a trilha útil
    expect($trilha->diff_json['depois'])->toHaveKey('phone_number_id');
});

it('deve guardar os segredos CIFRADOS no banco, e não em claro', function () {
    // ARRANGE
    admin();

    // ACT
    $conexao = conexaoFicticia();

    // ASSERT — quem abrir a tabela com um cliente SQL não lê a credencial
    $cru = DB::table('whatsapp_conexoes')->where('id', $conexao->id)->first();
    expect($cru->access_token)->not->toBe('TOKEN_FICTICIO_ABCD');
    expect($cru->app_secret)->not->toBe('SEGREDO_FICTICIO_1234');
    expect($cru->verify_token)->not->toBe('VERIFY_FICTICIO_XYZ9');
    // e o model continua devolvendo o valor de verdade a quem tem direito
    expect($conexao->fresh()->access_token)->toBe('TOKEN_FICTICIO_ABCD');
});

it('deve expor só os 4 últimos caracteres do token', function () {
    // ARRANGE
    admin();

    // ACT
    $conexao = conexaoFicticia();

    // ASSERT — o bastante para confirmar QUAL credencial está em uso, insuficiente para usá-la
    expect($conexao->tokenFinal())->toBe('ABCD');
});

it('NÃO deve deixar o cliente gravar o estado da conexão por mass assignment', function () {
    // ARRANGE — um cliente que pudesse gravar `conectado` faria o sistema tentar enviar
    // com credencial que ninguém validou contra a Meta
    admin();

    // ACT
    $conexao = new WhatsappConexao([
        'phone_number_id' => '123456',
        'waba_id' => '654321',
        'estado' => 'conectado',
    ]);
    $conexao->access_token = 'TOKEN_FICTICIO_ABCD';
    $conexao->app_secret = 'SEGREDO_FICTICIO_1234';
    $conexao->verify_token = 'VERIFY_FICTICIO_XYZ9';
    $conexao->save();

    // ASSERT — o que vale é o valor GRAVADO: o objeto em memória nem chega a receber o
    // default, que é do banco. Só o teste de conexão (fato verificado contra a Meta) promove.
    expect($conexao->fresh()->estado)->toBe('nao_conectado');
    expect($conexao->estaConectada())->toBeFalse();
});

it('NÃO deve deixar mass assignment escolher a conversa ou o paciente da mensagem', function () {
    // ARRANGE — `paciente_id` vindo do cliente seria ler a conversa de outra criança
    admin();
    $conversa = conversaFicticia();

    // ACT
    $mensagem = new Mensagem([
        'corpo' => 'texto ficticio',
        'tipo' => 'texto',
        'conversa_id' => $conversa->id,
        'direcao' => Mensagem::DIRECAO_ENVIADA,
        'wa_message_id' => 'wamid.FORJADO',
    ]);

    // ASSERT
    expect($mensagem->conversa_id)->toBeNull();
    expect($mensagem->direcao)->toBeNull();
    expect($mensagem->wa_message_id)->toBeNull();
});

it('deve recusar o MESMO wa_message_id duas vezes (a idempotência do webhook)', function () {
    // ARRANGE — a Meta reentrega eventos; a defesa é o índice, não um SELECT antes do INSERT
    admin();
    $conversa = conversaFicticia();

    $criar = function () use ($conversa) {
        $mensagem = new Mensagem(['corpo' => 'oi ficticio', 'tipo' => 'texto']);
        $mensagem->conversa_id = $conversa->id;
        $mensagem->direcao = Mensagem::DIRECAO_RECEBIDA;
        $mensagem->wa_message_id = 'wamid.REPETIDO';
        $mensagem->save();
    };

    // ACT
    $criar();

    // ASSERT — o banco recusa a segunda; quem chama trata como sucesso idempotente
    expect($criar)->toThrow(QueryException::class);
    expect(Mensagem::query()->count())->toBe(1);
});

it('deve conhecer a ordem da escala de entrega, para status atrasado não rebaixar o estado', function () {
    // ARRANGE / ACT / ASSERT — um `enviada` que chega depois de `lida` é normal na Meta
    expect(Mensagem::posicaoDoStatus('enviada'))->toBeLessThan(Mensagem::posicaoDoStatus('lida'));
    expect(Mensagem::posicaoDoStatus('entregue'))->toBeLessThan(Mensagem::posicaoDoStatus('lida'));
    // fora da escala: não competem com ela
    expect(Mensagem::posicaoDoStatus('falhou'))->toBeNull();
    expect(Mensagem::posicaoDoStatus('recebida'))->toBeNull();
});
