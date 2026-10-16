<?php

use App\Models\Auditoria;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Fornecedor;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\TipoPagamento;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Financeiro\MensagemDeCobranca;

/**
 * Change `cobranca-pelo-whatsapp`: o servidor monta os responsáveis com telefone e a mensagem da
 * clínica; a tela abre o link de conversa. Nomes e telefones 100% fictícios.
 */

/** Uma criança fictícia com os responsáveis dados. */
function criancaDaCobranca(array $responsaveis): Paciente
{
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia da Cobrança', 'nome_social' => null]);
    $crianca->forceFill(['responsaveis_json' => $responsaveis])->saveQuietly();

    return $crianca->refresh();
}

/** Uma receita da criança, em aberto por padrão. */
function receitaDaCobranca(Paciente $crianca, array $extra = [], ?string $pagoEm = null): LancamentoCaixa
{
    $lancamento = new LancamentoCaixa([
        'tipo' => 'receita', 'competencia' => '2026-10-01', 'vencimento' => '2026-10-10', 'valor' => '450.00',
        'contabil' => true, 'interessado_tipo' => 'paciente', 'interessado_id' => $crianca->id,
        'categoria_id' => Categoria::firstOrCreate(['nome' => 'Receita da Cobrança', 'tipo' => 'receita'])->id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => 'PIX da Cobrança'])->id,
        'conta_id' => Conta::firstOrCreate(['nome' => 'Caixa da Cobrança'])->id,
        ...$extra,
    ]);
    $lancamento->pago_em = $pagoEm;
    $lancamento->save();

    return $lancamento;
}

it('deve montar a mensagem da clínica para cada responsável com telefone', function () {
    // ARRANGE
    $this->actingAs(admin());
    app(ConfiguracaoService::class)->set('clinica.nome', 'Clínica Fictícia');
    $crianca = criancaDaCobranca([
        ['nome' => 'Mãe Fictícia', 'parentesco' => 'Mãe', 'telefone' => '(49) 99876-5432'],
        ['nome' => 'Avó Fictícia', 'parentesco' => 'Avó', 'telefone' => '1234'],
    ]);
    $receita = receitaDaCobranca($crianca, ['juros' => '4.50']);

    // ACT
    $resposta = $this->getJson("/api/lancamentos/{$receita->id}/cobranca");

    // ASSERT — o telefone incompleto não vira link; o valor é o LÍQUIDO, em reais
    $resposta->assertOk()->assertJsonCount(1, 'responsaveis');
    expect($resposta->json('responsaveis.0'))->toMatchArray([
        'nome' => 'Mãe Fictícia',
        'parentesco' => 'Mãe',
        'telefone' => '5549998765432',
    ])->and($resposta->json('responsaveis.0.mensagem'))
        ->toContain('Mãe Fictícia')->toContain('Clínica Fictícia')->toContain('R$ 454,50')
        ->toContain('Criança Fictícia da Cobrança')->toContain('10/10/2026');
});

it('deve usar o texto que a clínica configurou', function () {
    // ARRANGE
    $this->actingAs(admin());
    app(ConfiguracaoService::class)->set('financeiro.mensagem_cobranca', 'Oi {responsavel}, {valor} até {vencimento}.');
    $receita = receitaDaCobranca(criancaDaCobranca([['nome' => 'Pai Fictício', 'parentesco' => 'Pai', 'telefone' => '49988887777']]));

    // ACT + ASSERT
    expect($this->getJson("/api/lancamentos/{$receita->id}/cobranca")->json('responsaveis.0.mensagem'))
        ->toBe('Oi Pai Fictício, R$ 450,00 até 10/10/2026.');
});

it('deve devolver a lista vazia quando ninguém tem telefone', function () {
    // ARRANGE
    $this->actingAs(admin());
    $receita = receitaDaCobranca(criancaDaCobranca([['nome' => 'Mãe Fictícia', 'parentesco' => 'Mãe', 'telefone' => '']]));

    // ACT + ASSERT
    $this->getJson("/api/lancamentos/{$receita->id}/cobranca")->assertOk()->assertJsonCount(0, 'responsaveis');
});

it('deve abrir a conversa com os dígitos do responsável de fora do país', function () {
    // ARRANGE — celular do Reino Unido na faixa de ficção da Ofcom (change telefone-estrangeiro)
    $this->actingAs(admin());
    $receita = receitaDaCobranca(criancaDaCobranca([
        ['nome' => 'Pai Fictício', 'parentesco' => 'Pai', 'telefone' => '+44 7700 900123'],
        ['nome' => 'Tio Fictício', 'parentesco' => 'Tio', 'telefone' => '447700900123'],
    ]));

    // ACT
    $resposta = $this->getJson("/api/lancamentos/{$receita->id}/cobranca");

    // ASSERT — o link leva o país e o número, sem o `+`; o que veio sem `+` não vira link
    $resposta->assertOk()->assertJsonCount(1, 'responsaveis');
    expect($resposta->json('responsaveis.0.nome'))->toBe('Pai Fictício')
        ->and($resposta->json('responsaveis.0.telefone'))->toBe('447700900123');
});

it('deve recusar cobrar o que não é receita em aberto de criança', function (Closure $montar) {
    // ARRANGE
    $this->actingAs(admin());
    $lancamento = $montar(criancaDaCobranca([['nome' => 'Mãe Fictícia', 'parentesco' => 'Mãe', 'telefone' => '49999990000']]));

    // ACT + ASSERT
    $this->getJson("/api/lancamentos/{$lancamento->id}/cobranca")->assertUnprocessable()->assertJsonValidationErrors('lancamento');
    $this->postJson("/api/lancamentos/{$lancamento->id}/cobranca")->assertUnprocessable();
})->with([
    'já paga' => [fn (Paciente $c): LancamentoCaixa => receitaDaCobranca($c, pagoEm: '2026-10-05 10:00')],
    'despesa' => [fn (Paciente $c): LancamentoCaixa => receitaDaCobranca($c, [
        'tipo' => 'despesa',
        'categoria_id' => Categoria::firstOrCreate(['nome' => 'Despesa da Cobrança', 'tipo' => 'despesa'])->id,
    ])],
    'de fornecedor' => [fn (Paciente $c): LancamentoCaixa => receitaDaCobranca($c, [
        'interessado_tipo' => 'fornecedor',
        'interessado_id' => Fornecedor::create(['razao_social' => 'Fornecedor Fictício'])->id,
    ])],
]);

it('deve exigir lancamentos.ver e pacientes.ver', function (array $permissoes) {
    // ARRANGE — o telefone é contato do cadastro da criança
    admin();
    $usuario = usuarioCom($permissoes, 'Meio acesso '.implode('-', $permissoes));
    $receita = receitaDaCobranca(criancaDaCobranca([['nome' => 'Mãe Fictícia', 'parentesco' => 'Mãe', 'telefone' => '49999990000']]));

    // ACT + ASSERT — o GET e o POST (CR-API2-04): sem as duas, nem telefone sai nem cobrança entra
    $this->actingAs($usuario)->getJson("/api/lancamentos/{$receita->id}/cobranca")->assertForbidden();
    $this->actingAs($usuario)->postJson("/api/lancamentos/{$receita->id}/cobranca")->assertForbidden();
    expect(Auditoria::where('acao', 'cobrou')->count())->toBe(0);
})->with([
    'só lançamentos' => [['lancamentos.ver']],
    'só pacientes' => [['pacientes.ver']],
]);

it('deve registrar a cobrança sem o texto e mostrá-la no lançamento', function () {
    // ARRANGE
    $admin = admin();
    $this->actingAs($admin);
    $receita = receitaDaCobranca(criancaDaCobranca([['nome' => 'Mãe Fictícia', 'parentesco' => 'Mãe', 'telefone' => '49999990000']]));

    // ACT
    $this->postJson("/api/lancamentos/{$receita->id}/cobranca")->assertNoContent();

    // ASSERT
    // o diff é VAZIO — nada do texto, do nome ou do telefone (CR-API2-01: o `json_encode` cru
    // escapava o acento e o `not->toContain('Mãe…')` nunca falhava)
    $registro = Auditoria::where('entidade', 'lancamentos_caixa')->where('acao', 'cobrou')->firstOrFail();
    expect($registro->diff_json)->toBe([])
        ->and($this->getJson("/api/lancamentos/{$receita->id}")->json('ultima_cobranca.por'))->toBe($admin->nome);
});

it('deve recusar marca desconhecida na mensagem, nomeando a marca', function () {
    // ARRANGE
    $this->actingAs(admin());

    // ACT
    $resposta = $this->putJson('/api/configuracoes', ['chave' => 'financeiro.mensagem_cobranca', 'valor' => 'Olá {responsavel}, {paciente} deve {valor}.']);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('valor');
    expect($resposta->json('errors.valor.0'))->toContain('{paciente}');
});

it('deve recusar a mensagem vazia e a longa demais', function (string $texto) {
    // ARRANGE
    $this->actingAs(admin());

    // ACT + ASSERT
    $this->putJson('/api/configuracoes', ['chave' => 'financeiro.mensagem_cobranca', 'valor' => $texto])
        ->assertUnprocessable()->assertJsonValidationErrors('valor');
})->with([
    'vazia' => ['   '],
    'longa' => [str_repeat('a', MensagemDeCobranca::TETO + 1)],
]);

it('deve escrever o valor em reais com o ponto do milhar, sem ponto flutuante', function (string $decimal, string $esperado) {
    // ARRANGE + ACT + ASSERT — o caminho do milhar (CR-R2, mutação T6)
    expect(MensagemDeCobranca::emReais($decimal))->toBe($esperado);
})->with([
    'centavos' => ['0.5', 'R$ 0,50'],
    'milhar' => ['1234.50', 'R$ 1.234,50'],
    'milhão' => ['1234567.00', 'R$ 1.234.567,00'],
    'negativo' => ['-1234.50', '-R$ 1.234,50'],
]);
