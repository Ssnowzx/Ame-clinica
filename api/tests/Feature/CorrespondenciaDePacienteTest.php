<?php

use App\Models\ContatoNormalizado;
use App\Models\Paciente;
use App\Support\Mensageria\CorrespondenciaDePaciente;
use Illuminate\Support\Facades\DB;

/**
 * O índice E.164 e o vínculo conversa→paciente (change mensageria-whatsapp, D6).
 *
 * O que estes testes protegem: errar aqui é mostrar a conversa de uma criança no prontuário
 * de outra. Por isso a régua é dura — na dúvida, NÃO vincula.
 *
 * Dados 100% FICTÍCIOS (LGPD — menores).
 */
beforeEach(function () {
    admin();
});

function pacienteComContatos(array $contatos, bool $ativo = true): Paciente
{
    return Paciente::factory()->create(['contatos_json' => $contatos, 'ativo' => $ativo]);
}

it('deve indexar o telefone do cadastro em forma canônica ao salvar o paciente', function () {
    // ARRANGE / ACT
    $paciente = pacienteComContatos([
        ['tipo' => 'celular', 'valor' => '(11) 98765-4321'],
        ['tipo' => 'email', 'valor' => 'ficticio@exemplo.test'],
    ]);

    // ASSERT — e-mail não é telefone: não entra no índice
    $indice = ContatoNormalizado::query()->where('paciente_id', $paciente->id)->get();
    expect($indice)->toHaveCount(1);
    expect($indice->first()->e164)->toBe('+5511987654321');
});

it('deve refletir a troca de telefone e NÃO reter o anterior', function () {
    // ARRANGE
    $paciente = pacienteComContatos([['tipo' => 'celular', 'valor' => '(11) 98765-4321']]);

    // ACT
    $paciente->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 91111-2222']]]);

    // ASSERT — o número antigo casaria a conversa com um paciente que não o tem mais
    expect(ContatoNormalizado::query()->where('paciente_id', $paciente->id)->pluck('e164')->all())
        ->toBe(['+5511911112222']);
});

it('NÃO deve travar o cadastro por telefone incompleto — só deixá-lo fora do índice', function () {
    // ARRANGE / ACT — a base da virada traz cadastro antigo pela metade; recusar aqui
    // pararia a recepção por um dado que nunca foi obrigatório
    $paciente = pacienteComContatos([['tipo' => 'celular', 'valor' => '8765-4321']]);

    // ASSERT
    expect($paciente->exists)->toBeTrue();
    expect(ContatoNormalizado::query()->where('paciente_id', $paciente->id)->count())->toBe(0);
});

it('deve unificar o mesmo número repetido em dois contatos do paciente', function () {
    // ARRANGE / ACT
    $paciente = pacienteComContatos([
        ['tipo' => 'celular', 'valor' => '(11) 98765-4321'],
        ['tipo' => 'whatsapp', 'valor' => '+55 11 98765-4321'],
    ]);

    // ASSERT
    expect(ContatoNormalizado::query()->where('paciente_id', $paciente->id)->count())->toBe(1);
});

it('deve encontrar o paciente pelo número que a Meta entrega, apesar do formato do cadastro', function () {
    // ARRANGE
    $paciente = pacienteComContatos([['tipo' => 'celular', 'valor' => '(11) 98765-4321']]);

    // ACT
    $encontrado = CorrespondenciaDePaciente::paraTelefone('5511987654321');

    // ASSERT
    expect($encontrado)->toBe($paciente->id);
});

it('deve indexar e encontrar o celular de fora do país pela forma com o DDI', function () {
    // ARRANGE — Reino Unido na faixa de ficção da Ofcom (change telefone-estrangeiro)
    $paciente = pacienteComContatos([['tipo' => 'whatsapp', 'valor' => '+44 7700 900123']]);

    // ACT
    $encontrado = CorrespondenciaDePaciente::paraTelefone('+447700900123');

    // ASSERT
    expect(ContatoNormalizado::query()->where('paciente_id', $paciente->id)->pluck('e164')->all())
        ->toBe(['+447700900123'])
        ->and($encontrado)->toBe($paciente->id);
});

it('deve casar cadastro SEM o nono dígito com o número que chega COM ele', function () {
    // ARRANGE — cadastro anterior a 2012, ainda vivo na base
    $paciente = pacienteComContatos([['tipo' => 'celular', 'valor' => '(11) 8765-4321']]);

    // ACT / ASSERT — e o caminho inverso também
    expect(CorrespondenciaDePaciente::paraTelefone('5511987654321'))->toBe($paciente->id);
    expect(CorrespondenciaDePaciente::paraTelefone('551187654321'))->toBe($paciente->id);
});

it('NÃO deve adivinhar quando dois irmãos ATIVOS dividem o telefone', function () {
    // ARRANGE — o caso comum de clínica infantil: o celular é da mãe
    $telefone = [['tipo' => 'celular', 'valor' => '(11) 98765-4321']];
    pacienteComContatos($telefone);
    pacienteComContatos($telefone);

    // ACT / ASSERT — não vincula: uma pessoa decide
    expect(CorrespondenciaDePaciente::paraTelefone('5511987654321'))->toBeNull();
});

it('deve preferir o irmão ATIVO quando o outro teve alta', function () {
    // ARRANGE
    $telefone = [['tipo' => 'celular', 'valor' => '(11) 98765-4321']];
    pacienteComContatos($telefone, ativo: false);
    $emTerapia = pacienteComContatos($telefone);

    // ACT / ASSERT — sem o desempate, esta família ficaria não vinculada para sempre
    expect(CorrespondenciaDePaciente::paraTelefone('5511987654321'))->toBe($emTerapia->id);
});

it('deve vincular o paciente INATIVO quando ele é o único com aquele telefone', function () {
    // ARRANGE — a família de uma criança que teve alta continua escrevendo
    $emAlta = pacienteComContatos([['tipo' => 'celular', 'valor' => '(11) 98765-4321']], ativo: false);

    // ACT / ASSERT
    expect(CorrespondenciaDePaciente::paraTelefone('5511987654321'))->toBe($emAlta->id);
});

it('deve devolver null para telefone sem nenhum cadastro', function () {
    // ARRANGE / ACT / ASSERT — a conversa existe do mesmo jeito, só não vinculada
    expect(CorrespondenciaDePaciente::paraTelefone('5511999998888'))->toBeNull();
});

it('deve listar os telefones do paciente com celular antes de fixo', function () {
    // ARRANGE — lembrete em telefone fixo não chega a lugar nenhum
    $paciente = pacienteComContatos([
        ['tipo' => 'telefone', 'valor' => '(11) 3333-4444'],
        ['tipo' => 'celular', 'valor' => '(11) 98765-4321'],
    ]);

    // ACT / ASSERT
    expect(CorrespondenciaDePaciente::telefonesDoPaciente($paciente))
        ->toBe(['+5511987654321', '+551133334444']);
});

it('não deve vincular a conversa de um celular ao paciente que só tem um fixo parecido', function () {
    // ARRANGE — o fixo `3333-4444` de uma família e a mensagem do celular `9 3333-4444` de outra
    // pessoa (change lembrete-com-botoes-de-resposta, SEC-BT-07 / sonda R9 da segurança)
    pacienteComContatos([['tipo' => 'telefone', 'valor' => '(11) 3333-4444']]);

    // ACT
    $vinculo = CorrespondenciaDePaciente::paraTelefone('+5511933334444');

    // ASSERT
    expect($vinculo)->toBeNull();
});

it('deve continuar vinculando o celular com nono dígito à ficha antiga sem ele', function () {
    // ARRANGE — o caso legítimo que a regra do nono dígito existe para cobrir
    $paciente = pacienteComContatos([['tipo' => 'celular', 'valor' => '(11) 8765-4321']]);

    // ACT
    $vinculo = CorrespondenciaDePaciente::paraTelefone('+5511987654321');

    // ASSERT
    expect($vinculo)->toBe($paciente->id);
});

/*
 * `faltaDeTelefone()` (change telefone-que-chega-no-whatsapp, D3): o motivo do "não enviado" dizia
 * "sem telefone cadastrado" para as 6 crianças de 02/10 que TINHAM telefone — digitado errado.
 */
it('deve dizer sem telefone quando o cadastro não tem contato telefônico', function () {
    // ARRANGE
    $semNada = pacienteComContatos([]);
    $soEmail = pacienteComContatos([['tipo' => 'email', 'valor' => 'ficticio@exemplo.test']]);
    $vazio = pacienteComContatos([['tipo' => 'celular', 'valor' => '   ']]);

    // ACT
    $falta = CorrespondenciaDePaciente::faltaDeTelefone([$semNada->id, $soEmail->id, $vazio->id]);

    // ASSERT — um contato em branco não é um telefone errado
    expect($falta)->toBe([
        $semNada->id => CorrespondenciaDePaciente::SEM_TELEFONE,
        $soEmail->id => CorrespondenciaDePaciente::SEM_TELEFONE,
        $vazio->id => CorrespondenciaDePaciente::SEM_TELEFONE,
    ]);
});

it('deve dizer telefone inválido quando o cadastro tem telefone e nenhum serve', function () {
    // ARRANGE — DDI na frente e um dígito a menos, como em 02/10
    $errado = pacienteComContatos([['tipo' => 'celular', 'valor' => '55 49912-3456']]);

    // ACT
    $falta = CorrespondenciaDePaciente::faltaDeTelefone([$errado->id]);

    // ASSERT
    expect($falta)->toBe([$errado->id => CorrespondenciaDePaciente::TELEFONE_INVALIDO]);
});

it('deve responder o lote inteiro numa consulta só', function () {
    // ARRANGE
    $semNada = pacienteComContatos([]);
    $errado = pacienteComContatos([['tipo' => 'whatsapp', 'valor' => '(49) 49912-3456']]);
    DB::enableQueryLog();

    // ACT
    $falta = CorrespondenciaDePaciente::faltaDeTelefone([$semNada->id, $errado->id]);

    // ASSERT — o disparo pergunta pelo dia inteiro de uma vez
    expect(DB::getQueryLog())->toHaveCount(1);
    expect($falta)->toBe([
        $semNada->id => CorrespondenciaDePaciente::SEM_TELEFONE,
        $errado->id => CorrespondenciaDePaciente::TELEFONE_INVALIDO,
    ]);
});

it('NÃO deve consultar nada para lista vazia', function () {
    // ARRANGE
    DB::enableQueryLog();

    // ACT
    $falta = CorrespondenciaDePaciente::faltaDeTelefone([]);

    // ASSERT
    expect($falta)->toBe([]);
    expect(DB::getQueryLog())->toHaveCount(0);
});
