<?php

use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Fornecedor;
use App\Models\Funcionario;
use App\Models\LancamentoAnexo;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\TipoPagamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Support\Financeiro\LancamentosVisiveis;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * Change `financeiro-sem-faturamento-total`: o lançamento de FUNCIONÁRIO (salário) só existe para
 * quem tem `funcionarios.ver` — a recepção lança e dá baixa sem ver a folha. Os agregados de quem
 * vê o caixa continuam somando tudo (D1). Dados 100% fictícios.
 */

/** Um lançamento fictício, vencido ontem e em aberto; `null` = sem interessado. */
function lancamentoDaFolha(?string $interessadoTipo, ?int $interessadoId, string $tipo = 'despesa'): LancamentoCaixa
{
    $ontem = agoraNaClinica()->subDay()->toDateString();
    $lancamento = new LancamentoCaixa([
        'tipo' => $tipo, 'competencia' => $ontem, 'vencimento' => $ontem, 'valor' => '2500.00', 'contabil' => true,
        'interessado_tipo' => $interessadoTipo, 'interessado_id' => $interessadoId,
        'categoria_id' => Categoria::firstOrCreate(['nome' => "Categoria Fictícia ({$tipo})", 'tipo' => $tipo])->id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => 'Transferência Fictícia'])->id,
        'conta_id' => Conta::firstOrCreate(['nome' => 'Banco Fictício'])->id,
    ]);
    $lancamento->save();

    return $lancamento;
}

function salarioFicticio(): LancamentoCaixa
{
    return lancamentoDaFolha('funcionario', Funcionario::create(['nome' => 'Funcionária Fictícia', 'funcao' => 'Aux.'])->id);
}

/** A recepção opera o lançamento inteiro — lança, edita, exclui, dá baixa, cobra — sem a folha. */
function recepcaoSemAFolha(): Usuario
{
    return usuarioCom([
        'lancamentos.ver', 'lancamentos.criar', 'lancamentos.editar', 'lancamentos.excluir', 'lancamentos.pagar',
        'pacientes.ver',
    ], 'Recepção fictícia');
}

/** Um PDF mínimo REAL (o finfo o reconhece como `application/pdf`). */
function holeriteEmPdf(): UploadedFile
{
    return UploadedFile::fake()->createWithContent('holerite-ficticio.pdf', "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
}

function quemCuidaDaFolha(): Usuario
{
    return usuarioCom(['lancamentos.ver', 'funcionarios.ver'], 'Folha fictícia');
}

beforeEach(function () {
    Storage::fake('local');
});

it('deve tirar o salário da lista de quem não vê a folha, e deixar o resto', function () {
    // ARRANGE — salário, receita da criança, despesa de fornecedor e uma sem interessado
    admin();
    $salario = salarioFicticio();
    $daCrianca = lancamentoDaFolha('paciente', Paciente::factory()->create()->id, 'receita');
    $doFornecedor = lancamentoDaFolha('fornecedor', Fornecedor::create(['razao_social' => 'Fornecedor Fictício'])->id);
    $semInteressado = lancamentoDaFolha(null, null);
    $recepcao = recepcaoSemAFolha();
    $folha = quemCuidaDaFolha();

    // ACT
    $daRecepcao = $this->actingAs($recepcao)->getJson('/api/lancamentos')->assertOk()->json('data');
    trocarDeUsuario();
    $daFolha = $this->actingAs($folha)->getJson('/api/lancamentos')->assertOk()->json('data');

    // ASSERT — o lançamento sem interessado continua: `<>` sozinho descartaria o NULL
    expect(collect($daRecepcao)->pluck('id')->sort()->values()->all())->toBe([$daCrianca->id, $doFornecedor->id, $semInteressado->id])
        ->and(collect($daFolha)->pluck('id'))->toContain($salario->id)->toHaveCount(4);
});

it('deve responder 404 ao salário em cada porta do lançamento, e não mexer nele', function (string $metodo, string $caminho, array $corpo) {
    // ARRANGE
    admin();
    $salario = salarioFicticio();
    $recepcao = recepcaoSemAFolha();

    // ACT
    $resposta = $this->actingAs($recepcao)->json($metodo, str_replace('{id}', (string) $salario->id, $caminho), $corpo);

    // ASSERT — igual a um id que não existe (D2)
    $resposta->assertNotFound();
    $intacto = LancamentoCaixa::withoutGlobalScopes()->find($salario->id);
    expect($intacto)->not->toBeNull()
        ->and($intacto->pago_em)->toBeNull()
        ->and($intacto->obs)->toBeNull()
        ->and(LancamentoAnexo::withTrashed()->count())->toBe(0);
})->with([
    'detalhe' => ['GET', '/api/lancamentos/{id}', []],
    'edição' => ['PUT', '/api/lancamentos/{id}', ['obs' => 'Observação fictícia']],
    // o 404 vem ANTES da validação: um 422 aqui diria que o id existe
    'edição com corpo inválido' => ['PUT', '/api/lancamentos/{id}', ['valor' => 'não é número']],
    'exclusão' => ['DELETE', '/api/lancamentos/{id}', []],
    'baixa' => ['POST', '/api/lancamentos/{id}/pagamento', []],
    'anexos' => ['GET', '/api/lancamentos/{id}/anexos', []],
    'cobrança' => ['GET', '/api/lancamentos/{id}/cobranca', []],
    'registro da cobrança' => ['POST', '/api/lancamentos/{id}/cobranca', []],
]);

it('deve responder 404 ao estorno do salário pago', function () {
    // ARRANGE — o estorno só existe no pago; os níveis nascem antes da 1ª requisição (guard)
    $admin = admin();
    $recepcao = recepcaoSemAFolha();
    $salario = salarioFicticio();
    $this->actingAs($admin)->postJson("/api/lancamentos/{$salario->id}/pagamento")->assertOk();
    trocarDeUsuario();

    // ACT
    $resposta = $this->actingAs($recepcao)->deleteJson("/api/lancamentos/{$salario->id}/pagamento");

    // ASSERT
    $resposta->assertNotFound();
    expect(LancamentoCaixa::withoutGlobalScopes()->find($salario->id)->pago_em)->not->toBeNull();
});

it('deve responder 404 ao envio de anexo no salário, sem gravar o arquivo', function () {
    // ARRANGE
    admin();
    $salario = salarioFicticio();
    $recepcao = recepcaoSemAFolha();

    // ACT
    $resposta = $this->actingAs($recepcao)->post("/api/lancamentos/{$salario->id}/anexos", ['arquivo' => holeriteEmPdf()], ['Accept' => 'application/json']);

    // ASSERT
    $resposta->assertNotFound();
    expect(LancamentoAnexo::withTrashed()->count())->toBe(0)
        ->and(Storage::disk('local')->allFiles())->toBe([]);
});

it('deve responder 404 ao baixar ou excluir o anexo do salário', function () {
    // ARRANGE — o holerite anexado por quem cuida da folha
    $admin = admin();
    $recepcao = recepcaoSemAFolha();
    $salario = salarioFicticio();
    $anexoId = $this->actingAs($admin)->post("/api/lancamentos/{$salario->id}/anexos", ['arquivo' => holeriteEmPdf()])->assertCreated()->json('id');
    trocarDeUsuario();

    // ACT
    $download = $this->actingAs($recepcao)->get("/api/lancamentos/anexos/{$anexoId}/download", ['Accept' => 'application/json']);
    $exclusao = $this->actingAs($recepcao)->deleteJson("/api/lancamentos/anexos/{$anexoId}");

    // ASSERT
    $download->assertNotFound();
    $exclusao->assertNotFound();
    expect(LancamentoAnexo::find($anexoId))->not->toBeNull();
});

it('deve abrir o salário e o anexo dele a quem vê a folha', function () {
    // ARRANGE
    $admin = admin();
    $folha = quemCuidaDaFolha();
    $salario = salarioFicticio();
    $anexoId = $this->actingAs($admin)->post("/api/lancamentos/{$salario->id}/anexos", ['arquivo' => holeriteEmPdf()])->assertCreated()->json('id');
    trocarDeUsuario();

    // ACT
    $detalhe = $this->actingAs($folha)->getJson("/api/lancamentos/{$salario->id}");
    $download = $this->actingAs($folha)->get("/api/lancamentos/anexos/{$anexoId}/download");

    // ASSERT
    $detalhe->assertOk()->assertJsonPath('interessado_tipo', 'funcionario');
    $download->assertOk();
});

it('deve recusar 403 a quem lança salário sem a folha, antes de validar o funcionário', function (bool $existe) {
    // ARRANGE — o 422 "inexistente" contra o 201 enumerava os funcionários (D3)
    admin();
    $funcionarioId = $existe ? Funcionario::create(['nome' => 'Funcionária Fictícia', 'funcao' => 'Aux.'])->id : 999999;
    $recepcao = recepcaoSemAFolha();

    // ACT
    $resposta = $this->actingAs($recepcao)->postJson('/api/lancamentos', [
        'tipo' => 'despesa', 'competencia' => '2026-09-01', 'vencimento' => '2026-09-05', 'valor' => '2500.00',
        'interessado_tipo' => 'funcionario', 'interessado_id' => $funcionarioId,
        'categoria_id' => Categoria::firstOrCreate(['nome' => 'Salário Fictício', 'tipo' => 'despesa'])->id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => 'Transferência Fictícia'])->id,
        'conta_id' => Conta::firstOrCreate(['nome' => 'Banco Fictício'])->id,
    ]);

    // ASSERT
    $resposta->assertForbidden();
    expect(LancamentoCaixa::count())->toBe(0);
})->with(['funcionário que existe' => true, 'funcionário que não existe' => false]);

it('deve recusar 403 a quem aponta um lançamento visível para funcionário sem a folha', function () {
    // ARRANGE
    admin();
    $despesa = lancamentoDaFolha(null, null);
    $funcionario = Funcionario::create(['nome' => 'Funcionária Fictícia', 'funcao' => 'Aux.']);
    $recepcao = recepcaoSemAFolha();

    // ACT
    $resposta = $this->actingAs($recepcao)->putJson("/api/lancamentos/{$despesa->id}", [
        'interessado_tipo' => 'funcionario', 'interessado_id' => $funcionario->id,
    ]);

    // ASSERT
    $resposta->assertForbidden();
    expect(LancamentoCaixa::find($despesa->id)->interessado_tipo)->toBeNull();
});

it('deve deixar quem vê a folha lançar o salário', function () {
    // ARRANGE
    admin();
    $funcionario = Funcionario::create(['nome' => 'Funcionária Fictícia', 'funcao' => 'Aux.']);
    $folha = usuarioCom(['lancamentos.ver', 'lancamentos.criar', 'funcionarios.ver'], 'Folha que lança');

    // ACT
    $resposta = $this->actingAs($folha)->postJson('/api/lancamentos', [
        'tipo' => 'despesa', 'competencia' => '2026-09-01', 'vencimento' => '2026-09-05', 'valor' => '2500.00',
        'interessado_tipo' => 'funcionario', 'interessado_id' => $funcionario->id,
        'categoria_id' => Categoria::firstOrCreate(['nome' => 'Salário Fictício', 'tipo' => 'despesa'])->id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => 'Transferência Fictícia'])->id,
        'conta_id' => Conta::firstOrCreate(['nome' => 'Banco Fictício'])->id,
    ]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('interessado_tipo', 'funcionario');
});

it('deve tirar o salário atrasado do sino de quem não vê a folha, na lista e na contagem', function () {
    // ARRANGE — dois vencidos ontem: o salário e a receita da criança
    admin();
    $salario = salarioFicticio();
    $daCrianca = lancamentoDaFolha('paciente', Paciente::factory()->create()->id, 'receita');
    $recepcao = recepcaoSemAFolha();
    $folha = quemCuidaDaFolha();

    // ACT
    $daRecepcao = $this->actingAs($recepcao)->getJson('/api/notificacoes')->assertOk()->json('lancamentos_em_atraso');
    trocarDeUsuario();
    $daFolha = $this->actingAs($folha)->getJson('/api/notificacoes')->assertOk()->json('lancamentos_em_atraso');

    // ASSERT
    expect($daRecepcao['total'])->toBe(1)
        ->and(collect($daRecepcao['itens'])->pluck('lancamento_id')->all())->toBe([$daCrianca->id])
        ->and($daFolha['total'])->toBe(2)
        ->and(collect($daFolha['itens'])->pluck('lancamento_id'))->toContain($salario->id);
});

it('deve manter o salário no total de quem vê o caixa sem ver a folha', function () {
    // ARRANGE — esconder ali faria o caixa não fechar (D1)
    $admin = admin();
    $gestor = usuarioCom(['lancamentos.ver', 'fluxo_caixa.ver'], 'Gestor fictício');
    $salario = salarioFicticio();
    $this->actingAs($admin)->postJson("/api/lancamentos/{$salario->id}/pagamento")->assertOk();
    trocarDeUsuario();
    $hoje = agoraNaClinica()->toDateString();

    // ACT
    $extrato = $this->actingAs($gestor)->getJson("/api/fluxo-caixa?de={$hoje}&ate={$hoje}");

    // ASSERT
    $extrato->assertOk()->assertJsonPath('totais.saidas', '2500.00');
});

// ==================== rodada 1 do gate (CR-FIN-01/02 · SEC-FIN2-01/02/03) ====================

it('deve responder ao salário, no vínculo em lote, o mesmo que a um id que não existe', function () {
    // ARRANGE — CR-FIN-01: "não é pagamento de criança" contra "não existe mais" enumerava a folha
    admin();
    $salario = salarioFicticio();
    $pacote = Tratamento::factory()->create();
    $recepcao = usuarioCom(['lancamentos.ver', 'lancamentos.editar', 'lancamentos.pagar', 'tratamentos.ver', 'agenda.ver_todos'], 'Recepção do lote');
    $lote = fn (int $id) => ['vinculos' => [['lancamento_id' => $id, 'tratamento_id' => $pacote->id]]];

    // ACT
    $doSalario = $this->actingAs($recepcao)->postJson('/api/lancamentos/vincular-tratamentos', $lote($salario->id));
    $doInexistente = $this->actingAs($recepcao)->postJson('/api/lancamentos/vincular-tratamentos', $lote(999999));

    // ASSERT
    $doSalario->assertUnprocessable();
    expect($doSalario->json('errors'))->toBe($doInexistente->json('errors'))
        ->and(LancamentoCaixa::withoutGlobalScopes()->find($salario->id)->tratamento_id)->toBeNull();
});

it('deve apagar no grupo só as parcelas que a pessoa vê, com ou sem anexo na escondida', function (bool $comAnexo) {
    // ARRANGE — CR-FIN-02: um parcelamento com a parcela 2 apontada para um funcionário
    $admin = admin();
    $recepcao = recepcaoSemAFolha();
    $this->actingAs($admin);
    $grupo = $this->postJson('/api/lancamentos', [
        'tipo' => 'despesa', 'competencia' => '2026-09-01', 'vencimento' => '2026-09-05', 'valor' => '200.00',
        'parcelas' => 2, 'interessado_tipo' => 'fornecedor',
        'interessado_id' => Fornecedor::create(['razao_social' => 'Fornecedor Fictício'])->id,
        'categoria_id' => Categoria::firstOrCreate(['nome' => 'Despesa Fictícia', 'tipo' => 'despesa'])->id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => 'Transferência Fictícia'])->id,
        'conta_id' => Conta::firstOrCreate(['nome' => 'Banco Fictício'])->id,
    ])->assertCreated()->json('lancamentos');
    [$visivel, $escondida] = [$grupo[0]['id'], $grupo[1]['id']];
    LancamentoCaixa::whereKey($escondida)->update([
        'interessado_tipo' => 'funcionario',
        'interessado_id' => Funcionario::create(['nome' => 'Funcionária Fictícia', 'funcao' => 'Aux.'])->id,
    ]);
    if ($comAnexo) {
        $this->post("/api/lancamentos/{$escondida}/anexos", ['arquivo' => holeriteEmPdf()])->assertCreated();
    }
    trocarDeUsuario();

    // ACT
    $resposta = $this->actingAs($recepcao)->deleteJson("/api/lancamentos/{$visivel}?aplicar_no_grupo=1");

    // ASSERT — a visível sai; a do salário fica, e a resposta não a menciona
    $resposta->assertNoContent();
    expect(LancamentoCaixa::find($visivel))->toBeNull()
        ->and(LancamentoCaixa::withoutGlobalScopes()->find($escondida))->not->toBeNull();
})->with(['sem anexo' => false, 'com anexo na escondida' => true]);

it('deve manter o salário fora mesmo com um orWhere encadeado depois do filtro', function () {
    // ARRANGE — SEC-FIN2-03: um `where` solto viraria `(filtro) and receita or despesa`
    admin();
    $salario = salarioFicticio();
    $daCrianca = lancamentoDaFolha('paciente', Paciente::factory()->create()->id, 'receita');
    $this->actingAs(recepcaoSemAFolha());

    // ACT
    $ids = LancamentosVisiveis::filtrar(LancamentoCaixa::query())
        ->where('tipo', 'receita')
        ->orWhere('tipo', 'despesa')
        ->pluck('id')->all();

    // ASSERT
    expect($ids)->toBe([$daCrianca->id])->not->toContain($salario->id);
});
