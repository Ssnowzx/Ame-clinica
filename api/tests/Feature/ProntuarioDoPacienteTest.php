<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Auditoria;
use App\Models\Evolucao;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Usuario;

/**
 * GUARDA do filtro `paciente_id` no GET /atendimentos — o caminho do PRONTUÁRIO da
 * ficha (change prontuario-na-ficha; parecer pré-código SEC-PF, GO-COM-CONDIÇÕES).
 *
 * O filtro é um EXISTS independente em AND com o escopo D11 na MESMA query
 * (SEC-PF-01): interseção por construção. Resposta uniforme 200-vazia para
 * inexistente/fora-do-escopo (SEC-PF-03) — o filtro não é oráculo.
 * Payload da listagem INALTERADO: `observacoes` nunca; `evolucao_id` como CHAVE
 * AUSENTE (não `null`) para quem não tem permissão de evolução (SEC-PF-04).
 * LGPD: dados 100% fictícios.
 */

/** Atendimento finalizado de $prof com $paciente (agendamento-mãe no passado). */
function prontuarioAtendimento(Profissional $prof, Paciente $paciente): Atendimento
{
    $inicio = agoraNaClinica()->copy()->subDay()->setTime(9, 0);
    $agendamento = Agendamento::factory()->create([
        'tipo' => 'atendimento',
        'profissional_id' => $prof->id,
        'paciente_id' => $paciente->id,
        'inicio' => $inicio,
        'fim' => $inicio->copy()->addMinutes(40),
    ]);

    return Atendimento::factory()->create([
        'agendamento_id' => $agendamento->id,
        'finalizado_em' => agoraNaClinica()->copy()->subHour()->format('Y-m-d H:i'),
    ]);
}

/** Usuário ESCOPADO (sem flags ver_todos) vinculado a $prof, com o leque de atendimento. */
function prontuarioEscopado(Profissional $prof): Usuario
{
    $usuario = usuarioCom(
        ['atendimentos.ver', 'evolucoes.ver'],
        'Prontuário Escopado'
    );
    $usuario->update(['profissional_id' => $prof->id]);

    return $usuario;
}

it('deve listar só os atendimentos do paciente filtrado, com payload minimizado', function () {
    // ARRANGE — dois pacientes, atendimentos de cada
    $adminDaClinica = admin();
    $prof = Profissional::factory()->create();
    $alvo = Paciente::factory()->create();
    $outro = Paciente::factory()->create();
    $doAlvo = prontuarioAtendimento($prof, $alvo);
    prontuarioAtendimento($prof, $outro);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/atendimentos?paciente_id={$alvo->id}");

    // ASSERT — só o do paciente; metadados-só (T-ate-03 sobrevive ao filtro)
    $resposta->assertOk();
    $itens = $resposta->json('data');
    expect(array_column($itens, 'id'))->toBe([$doAlvo->id]);
    expect($itens[0])->not->toHaveKey('observacoes');
});

it('deve listar ao ESCOPADO os atendimentos do paciente que ele próprio atende', function () {
    // ARRANGE — o MESMO paciente é atendido por A e por B; quem consulta é o escopado de A.
    // Guarda POSITIVA do SEC-PF-01: um bug que tornasse escopo∩filtro sempre-vazio deixaria
    // as guardas negativas verdes — esta reprova.
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    $doProprioA = prontuarioAtendimento($profA, $paciente);
    prontuarioAtendimento($profB, $paciente);
    $escopadoDeA = prontuarioEscopado($profA);

    // ACT
    $resposta = $this->actingAs($escopadoDeA)
        ->getJson("/api/atendimentos?paciente_id={$paciente->id}");

    // ASSERT — vê o SEU atendimento do paciente; o de B (mesmo paciente) fica fora
    $resposta->assertOk();
    expect(array_column($resposta->json('data'), 'id'))->toBe([$doProprioA->id]);
});

it('deve interseccionar o filtro com o escopo: paciente de outro profissional vem vazio (SEC-PF-01)', function () {
    // ARRANGE — A escopado; o paciente é atendido SÓ por B
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $pacienteDeB = Paciente::factory()->create();
    prontuarioAtendimento($profB, $pacienteDeB);
    $escopadoDeA = prontuarioEscopado($profA);

    // ACT — o escopado de A tenta o prontuário do paciente de B
    $resposta = $this->actingAs($escopadoDeA)
        ->getJson("/api/atendimentos?paciente_id={$pacienteDeB->id}");

    // ASSERT — o filtro não contorna o escopo
    $resposta->assertOk();
    expect($resposta->json('data'))->toBe([]);
});

it('deve manter o fail-closed sob o filtro: sem vínculo e sem flag, vazio (SEC-PF-02)', function () {
    // ARRANGE — usuário com a permissão mas SEM vínculo e SEM clinico.ver_todos
    admin();
    $prof = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    prontuarioAtendimento($prof, $paciente);
    $semVinculo = usuarioCom(['atendimentos.ver'], 'Sem Vínculo');

    // ACT
    $resposta = $this->actingAs($semVinculo)
        ->getJson("/api/atendimentos?paciente_id={$paciente->id}");

    // ASSERT — Escopo::nenhum sobrevive ao filtro
    $resposta->assertOk();
    expect($resposta->json('data'))->toBe([]);
});

it('deve responder 200-vazia para paciente inexistente (SEC-PF-03)', function () {
    // ARRANGE — a clínica TEM atendimento (de outro paciente); o filtro não pode cair nele
    $adminDaClinica = admin();
    $inexistente = 999999;
    prontuarioAtendimento(Profissional::factory()->create(), Paciente::factory()->create());

    // ACT
    $porInexistente = $this->actingAs($adminDaClinica)
        ->getJson("/api/atendimentos?paciente_id={$inexistente}");

    // ASSERT — 200-vazia, nunca 403/404 diferencial (não-oráculo)
    $porInexistente->assertOk();
    expect($porInexistente->json('data'))->toBe([]);
});

it('deve omitir a CHAVE evolucao_id (não null) de quem não tem permissão de evolução (SEC-PF-04)', function () {
    // ARRANGE — plano via flag, mas SEM evolucoes.ver/criar
    admin();
    $prof = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    prontuarioAtendimento($prof, $paciente);
    $soAtendimentos = usuarioCom(['atendimentos.ver', 'clinico.ver_todos'], 'Só Atendimentos');

    // ACT
    $resposta = $this->actingAs($soAtendimentos)
        ->getJson("/api/atendimentos?paciente_id={$paciente->id}");

    // ASSERT — ausência é AUSÊNCIA: o gate SEC F-03 não vira null (undefined ≠ null no front)
    $resposta->assertOk();
    $itens = $resposta->json('data');
    expect($itens)->toHaveCount(1);
    expect(array_key_exists('evolucao_id', $itens[0]))->toBeFalse();
});

it('deve negar a evolução de outro dono SEM registrar consultou (SEC-PF-12)', function () {
    // ARRANGE — evolução do prof B; quem tenta é o escopado de A (não é dono nenhum)
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $atendimentoDeB = prontuarioAtendimento($profB, Paciente::factory()->create());
    $evolucaoDeB = new Evolucao([
        'profissional_id' => $profB->id,
        'conteudo' => 'Evolução clínica fictícia da sessão.',
    ]);
    $evolucaoDeB->atendimento_id = $atendimentoDeB->id;
    $evolucaoDeB->preenchida_em = agoraNaClinica()->format('Y-m-d H:i');
    $evolucaoDeB->save();
    $escopadoDeA = prontuarioEscopado($profA);

    // ACT
    $resposta = $this->actingAs($escopadoDeA)->getJson("/api/evolucoes/{$evolucaoDeB->id}");

    // ASSERT — 403 ANTES de auditar: negar leitura não entra na trilha como leitura
    $resposta->assertForbidden();
    $linhas = Auditoria::where('entidade', 'evolucoes')
        ->where('entidade_id', $evolucaoDeB->id)
        ->where('acao', 'consultou')
        ->count();
    expect($linhas)->toBe(0);
});

it('deve rejeitar paciente_id malformado com 422', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->getJson('/api/atendimentos?paciente_id=abc')
        ->assertUnprocessable()
        ->assertJsonValidationErrors('paciente_id');
});
