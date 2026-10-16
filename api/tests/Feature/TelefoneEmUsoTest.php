<?php

use App\Models\Agendamento;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Support\Mensageria\TelefoneE164;

/*
 * O número que já está em outro paciente (change telefone-que-chega-no-whatsapp, D6).
 *
 * Em 08/09 a mesma pessoa cadastrou uma criança e, 5 minutos depois, outra paciente — e a criança
 * ficou com o celular da outra. Em 01/10 o lembrete com o nome da criança chegou a essa outra
 * família. O alerta tem de chegar ENQUANTO a pessoa ainda está com a ficha na mão.
 *
 * Só a tela interna pergunta, sob `pacientes.ver` — quem pode listar a base inteira. A resposta
 * leva id, nome e situação, nada além. Dados e telefones 100% FICTÍCIOS.
 */

const ROTA_DO_TELEFONE = '/api/pacientes/telefone/conferir';

function pacienteComCelular(string $nome, string $celular, bool $ativo = true): Paciente
{
    return Paciente::factory()->create([
        'nome' => $nome,
        'ativo' => $ativo,
        'contatos_json' => [['tipo' => 'celular', 'valor' => $celular]],
    ]);
}

it('deve mostrar o outro paciente que tem o mesmo número', function () {
    // ARRANGE
    $admin = admin();
    $outra = pacienteComCelular('Paciente Fictícia Adulta', '(49) 99123-4567');

    // ACT
    $resposta = $this->actingAs($admin)->postJson(ROTA_DO_TELEFONE, ['numero' => '49 99123-4567']);

    // ASSERT
    $resposta->assertOk()->assertExactJson([
        'forma' => '+5549991234567',
        'tipo' => TelefoneE164::CELULAR,
        'tambem_em' => [['id' => $outra->id, 'nome' => 'Paciente Fictícia Adulta', 'ativo' => true]],
        'total' => 1,
    ]);
});

it('NÃO deve mostrar o próprio paciente que está sendo editado', function () {
    // ARRANGE
    $admin = admin();
    $proprio = pacienteComCelular('Criança Fictícia', '(49) 99123-4567');

    // ACT
    $resposta = $this->actingAs($admin)->postJson(ROTA_DO_TELEFONE, [
        'numero' => '(49) 99123-4567',
        'ignorar_paciente_id' => $proprio->id,
    ]);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('tambem_em', [])->assertJsonPath('total', 0);
});

it('deve casar o mesmo celular escrito com e sem o nono dígito', function () {
    // ARRANGE — o cadastro antigo tem 8 dígitos; a recepção digita 9
    $admin = admin();
    $antigo = pacienteComCelular('Irmão Fictício', '(49) 8123-4567');

    // ACT
    $resposta = $this->actingAs($admin)->postJson(ROTA_DO_TELEFONE, ['numero' => '(49) 98123-4567']);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('tambem_em.0.id', $antigo->id);
});

it('deve recusar com 403 quem não pode ver pacientes, antes de validar', function () {
    // ARRANGE — a fila faz pré-cadastro sem `pacientes.ver`; a pergunta seria um oráculo da base
    admin();
    $daFila = usuarioCom(['lista_espera.criar', 'pacientes.criar'], 'Só a Fila do Telefone');

    // ACT — corpo inválido de propósito: 403 vem antes de 422
    $resposta = $this->actingAs($daFila)->postJson(ROTA_DO_TELEFONE, []);

    // ASSERT
    $resposta->assertForbidden();
});

it('NÃO deve devolver nada além de id, nome e situação', function () {
    // ARRANGE
    $admin = admin();
    pacienteComCelular('Paciente Fictícia Adulta', '(49) 99123-4567');

    // ACT
    $resposta = $this->actingAs($admin)->postJson(ROTA_DO_TELEFONE, ['numero' => '(49) 99123-4567']);

    // ASSERT — nada de CPF, nascimento, responsável ou contatos do outro paciente
    expect(array_keys($resposta->json('tambem_em.0')))->toBe(['id', 'nome', 'ativo']);
    semVazamento($resposta->json(), '99123-4567');
});

it('deve contar todos e listar no máximo cinco', function () {
    // ARRANGE — um número de recepção, de escola, colado em muitos cadastros
    $admin = admin();
    foreach (range(1, 7) as $i) {
        pacienteComCelular("Paciente Fictício {$i}", '(49) 99123-4567');
    }

    // ACT
    $resposta = $this->actingAs($admin)->postJson(ROTA_DO_TELEFONE, ['numero' => '(49) 99123-4567']);

    // ASSERT
    $resposta->assertOk()->assertJsonCount(5, 'tambem_em')->assertJsonPath('total', 7);
});

it('deve mostrar o outro paciente que tem o mesmo celular de fora do país', function () {
    // ARRANGE — Reino Unido na faixa de ficção da Ofcom (change telefone-estrangeiro)
    $admin = admin();
    $outra = pacienteComCelular('Paciente Fictícia do Reino Unido', '+44 7700 900123');

    // ACT
    $resposta = $this->actingAs($admin)->postJson(ROTA_DO_TELEFONE, ['numero' => '+44 7700-900-123']);

    // ASSERT — celular, porque de fora do país não se sabe se é fixo
    $resposta->assertOk()->assertExactJson([
        'forma' => '+447700900123',
        'tipo' => TelefoneE164::CELULAR,
        'tambem_em' => [['id' => $outra->id, 'nome' => 'Paciente Fictícia do Reino Unido', 'ativo' => true]],
        'total' => 1,
    ]);
});

it('deve responder vazio, sem erro, para número que não recebe WhatsApp', function () {
    // ARRANGE
    $admin = admin();

    // ACT
    $resposta = $this->actingAs($admin)->postJson(ROTA_DO_TELEFONE, ['numero' => '55 49912-3456']);

    // ASSERT
    $resposta->assertOk()->assertExactJson(['forma' => null, 'tipo' => null, 'tambem_em' => [], 'total' => 0]);
});

it('deve exigir o número', function () {
    // ARRANGE
    $admin = admin();

    // ACT
    $resposta = $this->actingAs($admin)->postJson(ROTA_DO_TELEFONE, []);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors(['numero']);
});

it('NÃO deve aceitar o número no endereço — ele iria para o log de acesso', function () {
    // ARRANGE
    $admin = admin();

    // ACT
    $resposta = $this->actingAs($admin)->getJson(ROTA_DO_TELEFONE.'?numero=49991234567');

    // ASSERT
    $resposta->assertStatus(405);
});

it('deve respeitar o escopo do profissional vinculado, inclusive na contagem', function () {
    // ARRANGE — gate r1, SEC-TEL-03: a fila de cadastro já não deixa um profissional escopado
    // enxergar criança de colega; a pergunta "este número está em quem?" tem de valer o mesmo
    admin();
    $base = baseDeAgenda();
    $minha = Paciente::query()->findOrFail($base['paciente_id']);
    $minha->contatos_json = [['tipo' => 'celular', 'valor' => '(49) 99123-4567']];
    $minha->save();
    Agendamento::factory()->create([
        'paciente_id' => $minha->id, 'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'], 'inicio' => '2026-10-20 10:00:00',
    ]);
    pacienteComCelular('Paciente Fictícia de Colega', '(49) 99123-4567');
    $escopado = usuarioEscopadoEm(Profissional::query()->findOrFail($base['profissional_id']), ['pacientes.ver']);

    // ACT
    $resposta = $this->actingAs($escopado)->postJson(ROTA_DO_TELEFONE, ['numero' => '(49) 99123-4567']);

    // ASSERT — só a criança do vínculo, e a contagem não denuncia a outra
    $resposta->assertOk()
        ->assertJsonPath('total', 1)
        ->assertJsonPath('tambem_em.0.id', $minha->id)
        ->assertJsonCount(1, 'tambem_em');
});
