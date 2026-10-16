<?php

use App\Models\Agendamento;
use App\Models\Auditoria;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\TipoPagamento;
use App\Support\Relatorios\RecebidoEPago;

/**
 * Change `relatorio-em-planilha`: o envelope em CSV pt-BR, pela mesma porta da tela, com a
 * trilha da exportação. Dados 100% fictícios.
 */

/** Um pagamento fictício de hoje para a pessoa dada. */
function pagamentoDaPlanilha(string $tipo, string $valor, ?Paciente $crianca = null): LancamentoCaixa
{
    $lancamento = new LancamentoCaixa([
        'tipo' => $tipo, 'competencia' => agoraNaClinica()->toDateString(), 'vencimento' => agoraNaClinica()->toDateString(),
        'valor' => $valor, 'contabil' => true,
        'interessado_tipo' => $crianca === null ? null : 'paciente', 'interessado_id' => $crianca?->id,
        'categoria_id' => Categoria::firstOrCreate(['nome' => "Categoria da Planilha {$tipo}", 'tipo' => $tipo])->id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => 'PIX da Planilha'])->id,
        'conta_id' => Conta::firstOrCreate(['nome' => 'Caixa da Planilha'])->id,
    ]);
    $lancamento->pago_em = agoraNaClinica()->format('Y-m-d H:i');
    $lancamento->save();

    return $lancamento;
}

function planilhaDeHoje(string $slug, array $extra = []): string
{
    $hoje = agoraNaClinica()->toDateString();

    return "/api/relatorios/{$slug}/planilha?".http_build_query(['de' => $hoje, 'ate' => $hoje, ...$extra]);
}

/** @return list<string> as linhas do CSV, sem o BOM */
function linhasDaPlanilha(string $conteudo): array
{
    return explode("\r\n", rtrim(substr($conteudo, 3), "\r\n"));
}

it('deve baixar o CSV do Excel brasileiro: BOM, ponto e vírgula, vírgula decimal e data dd/mm/aaaa', function () {
    // ARRANGE
    $this->actingAs(admin());
    pagamentoDaPlanilha('receita', '1234.50', Paciente::factory()->create(['nome' => 'Criança Fictícia da Planilha']));

    // ACT
    $resposta = $this->get(planilhaDeHoje('recebido-e-pago'));

    // ASSERT
    $resposta->assertOk();
    $hoje = agoraNaClinica()->format('d/m/Y');
    expect($resposta->headers->get('Content-Type'))->toStartWith('text/csv')
        ->and($resposta->headers->get('Content-Disposition'))->toContain('recebido-e-pago_'.agoraNaClinica()->toDateString())
        ->and(substr($resposta->getContent(), 0, 3))->toBe("\xEF\xBB\xBF");
    $linhas = linhasDaPlanilha($resposta->getContent());
    expect($linhas[0])->toBe('"Recebido e pago"')
        ->and($linhas[1])->toBe("\"Período\";\"{$hoje} a {$hoje}\"")
        ->and(implode("\n", $linhas))->toContain("\"{$hoje}\";\"Criança Fictícia da Planilha\"")
        ->and(implode("\n", $linhas))->toContain(';1234,50;')
        ->and(end($linhas))->toStartWith('"Total"');
});

it('deve trazer no sintético um bloco por grupo e o total no fim', function () {
    // ARRANGE
    $this->actingAs(admin());
    pagamentoDaPlanilha('receita', '300.00');
    pagamentoDaPlanilha('despesa', '50.00');

    // ACT
    $linhas = linhasDaPlanilha($this->get(planilhaDeHoje('recebido-e-pago', ['resultado' => 'sintetico', 'dividir_por' => 'categoria']))->getContent());

    // ASSERT — um grupo por categoria, e o resultado (negativo na despesa) como número
    expect($linhas)->toContain('"Categoria da Planilha receita";300,00;0,00;300,00;1')
        ->and($linhas)->toContain('"Categoria da Planilha despesa";0,00;50,00;-50,00;1')
        ->and(end($linhas))->toBe('"Total";300,00;50,00;250,00;2');
});

it('deve neutralizar texto que começa como fórmula, e deixar número como número', function (string $nome) {
    // ARRANGE — um nome hostil cadastrado vira célula de texto, nunca fórmula
    $this->actingAs(admin());
    pagamentoDaPlanilha('receita', '10.00', Paciente::factory()->create(['nome' => $nome]));

    // ACT
    $conteudo = $this->get(planilhaDeHoje('recebido-e-pago'))->getContent();

    // ASSERT
    expect($conteudo)->toContain('"\''.str_replace('"', '""', $nome).'"');
})->with([
    // gravados pela factory, sem passar pelo TrimStrings da API — importação e console chegam assim
    // (CR-API2-03)
    'tabulação' => ["\t=1+1"],
    'retorno' => ["\r=1+1"],
    'quebra de linha' => ["\n=1+1"],
    'largura cheia' => ['＝1+1'],
    'arroba cheia' => ['＠SUM(1)'],
    'mais cheio' => ['＋1+1'],
    'menos cheio' => ['－1+1'],
    'igual' => ['=HYPERLINK("http://exemplo.invalido","clique")'],
    'mais' => ['+1+1'],
    'menos' => ['-2+3'],
    'arroba' => ['@SUM(1)'],
]);

it('deve avisar na primeira linha quando o relatório foi cortado no teto', function () {
    // ARRANGE — teto injetado de 1 linha, dois pagamentos
    $this->actingAs(admin());
    pagamentoDaPlanilha('receita', '10.00');
    pagamentoDaPlanilha('receita', '20.00');
    app()->bind(RecebidoEPago::class, fn () => new RecebidoEPago(1));

    // ACT
    $linhas = linhasDaPlanilha($this->get(planilhaDeHoje('recebido-e-pago'))->getContent());

    // ASSERT
    expect($linhas[0])->toContain('passou do teto');
});

it('deve negar a planilha sem as permissões do relatório, antes de validar', function () {
    // ARRANGE — parâmetro inválido: o 403 vem antes do 422
    admin();
    $semCaixa = usuarioCom(['lancamentos.ver'], 'Sem caixa fictício');

    // ACT + ASSERT
    $this->actingAs($semCaixa)->get('/api/relatorios/recebido-e-pago/planilha?de=ontem')->assertForbidden();
    expect(Auditoria::where('acao', 'exportou')->count())->toBe(0);
});

it('deve registrar quem exportou, qual relatório e quais filtros, sem o conteúdo', function () {
    // ARRANGE
    $admin = admin();
    $this->actingAs($admin);
    pagamentoDaPlanilha('receita', '10.00', Paciente::factory()->create(['nome' => 'Criança Fictícia Exportada']));

    // ACT — uma chave inventada na URL não vai para a trilha (SEC-FIN-06)
    $this->get(planilhaDeHoje('recebido-e-pago', ['tipo' => 'recebido', 'lixo' => 'texto qualquer do cliente']))->assertOk();

    // ASSERT
    // o diff é EXATAMENTE o relatório e os parâmetros validados (CR-API2-01: o `json_encode` cru
    // escapava o acento e a guarda do nome da criança nunca falhava)
    $registro = Auditoria::where('acao', 'exportou')->firstOrFail();
    $hoje = agoraNaClinica()->toDateString();
    expect($registro->usuario_id)->toBe($admin->id)
        ->and($registro->entidade)->toBe('relatorios')
        ->and($registro->diff_json)->toBe(['depois' => [
            'relatorio' => 'recebido-e-pago',
            'parametros' => ['de' => $hoje, 'ate' => $hoje, 'tipo' => 'recebido'],
        ]]);
    semVazamento($registro->diff_json, 'Criança Fictícia Exportada');
});

it('deve aplicar o escopo do profissional na planilha', function () {
    // ARRANGE — o escopado só exporta a própria agenda
    admin();
    $ana = Profissional::factory()->create();
    $bia = Profissional::factory()->create();
    Agendamento::factory()->create(['profissional_id' => $ana->id, 'inicio' => agoraNaClinica()->setTime(9, 0), 'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia da Ana'])->id]);
    Agendamento::factory()->create(['profissional_id' => $bia->id, 'inicio' => agoraNaClinica()->setTime(10, 0), 'paciente_id' => Paciente::factory()->create(['nome' => 'Criança Fictícia da Bia'])->id]);
    $daAna = usuarioEscopadoEm($ana, ['agenda.ver']);

    // ACT
    $conteudo = $this->actingAs($daAna)->get(planilhaDeHoje('agendamentos'))->assertOk()->getContent();

    // ASSERT
    expect($conteudo)->toContain('Criança Fictícia da Ana')->not->toContain('Criança Fictícia da Bia');
});

it('deve recuar as linhas do DRE como na tela, com o nome hostil ainda neutralizado', function () {
    // ARRANGE — uma receita paga hoje, numa categoria cujo nome parece fórmula
    $this->actingAs(admin());
    $lancamento = pagamentoDaPlanilha('receita', '100.00');
    Categoria::whereKey($lancamento->categoria_id)->update(['nome' => '=1+1']);

    // ACT
    $linhas = linhasDaPlanilha($this->get(planilhaDeHoje('dre-gerencial'))->getContent());

    // ASSERT — o grupo sem recuo, a linha da escada com um, a categoria com dois; o apóstrofo
    // vem ANTES do recuo ser posto, então fica colado no texto
    expect($linhas)->toContain('"Receita bruta";100,00;100,00')
        ->and($linhas)->toContain('"    Prestação de serviços";100,00;100,00')
        ->and($linhas)->toContain('"        \'=1+1";100,00;100,00')
        ->and($linhas)->toContain('"Resultado final";100,00;100,00');
});
