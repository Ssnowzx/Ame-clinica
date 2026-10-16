<?php

use App\Models\Auditoria;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\CarbonImmutable;

/**
 * A chave `indicadores.comparar_a_partir_de` (change inicio-dos-indicadores, D2/D3): data real, nunca
 * futura no relógio DA CLÍNICA, vazia por padrão, auditada como qualquer chave.
 *
 * Relógio FIXO: terça, 6 de outubro de 2026, 23h30 em Brasília — já é dia 7 em UTC. É a hora em que
 * "hoje" do servidor e "hoje" da clínica discordam.
 */
function relogioDoInicioDosIndicadores(): void
{
    test()->travelTo(CarbonImmutable::parse('2026-10-06 23:30:00', 'America/Sao_Paulo'));
}

it('deve devolver a chave vazia, no bloco Indicadores da seção Clínica, para a clínica que nunca configurou', function () {
    // ARRANGE
    relogioDoInicioDosIndicadores();

    // ACT
    $resposta = $this->actingAs(admin())->getJson('/api/configuracoes')->assertOk();
    $chave = collect($resposta->json('configuracoes'))->firstWhere('chave', 'indicadores.comparar_a_partir_de');

    // ASSERT — a frase de ajuda vem do catálogo: a tela não inventa texto de configuração
    expect($chave['valor'])->toBe('')
        ->and($chave['secao'])->toBe('clinica')
        ->and($chave['bloco'])->toBe('indicadores')
        ->and($chave['formato'])->toBe('date')
        ->and($chave['ajuda'])->toContain('dia 1º do mês');
});

it('deve aceitar o dia 1º do mês corrente', function () {
    // ARRANGE
    relogioDoInicioDosIndicadores();

    // ACT
    $resposta = $this->actingAs(admin())->putJsonComVersao('/api/configuracoes', [
        'chave' => 'indicadores.comparar_a_partir_de', 'valor' => '2026-10-01',
    ]);

    // ASSERT
    $resposta->assertOk();
    expect(app(ConfiguracaoService::class)->get('indicadores.comparar_a_partir_de'))->toBe('2026-10-01');
});

it('deve recusar o dia no meio do mês, que as séries não sabem cortar', function () {
    // ARRANGE — gate r1: "a partir de 10 de setembro" contava desde o dia 1º
    relogioDoInicioDosIndicadores();
    $this->actingAs(admin());

    // ACT
    $resposta = $this->putJsonComVersao('/api/configuracoes', [
        'chave' => 'indicadores.comparar_a_partir_de', 'valor' => '2026-09-10',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors(['valor' => 'Escolha o dia 1º do mês.']);
});

it('deve recusar o dia 1º do mês que vem no relógio da clínica, mesmo quando ele já chegou em UTC', function () {
    // ARRANGE — 31/10 às 23h30 em Brasília: em UTC já é 1º de novembro
    test()->travelTo(CarbonImmutable::parse('2026-10-31 23:30:00', 'America/Sao_Paulo'));
    $this->actingAs(admin());
    app(ConfiguracaoService::class)->set('indicadores.comparar_a_partir_de', '2026-10-01');

    // ACT
    $resposta = $this->putJsonComVersao('/api/configuracoes', [
        'chave' => 'indicadores.comparar_a_partir_de', 'valor' => '2026-11-01',
    ]);

    // ASSERT — recusa com a frase de quem escolheu o dia (não "incompatível com o tipo string"), e o
    // valor anterior continua valendo
    $resposta->assertUnprocessable()->assertJsonValidationErrors(['valor' => 'A data não pode ser depois de hoje.']);
    expect(app(ConfiguracaoService::class)->get('indicadores.comparar_a_partir_de'))->toBe('2026-10-01');
});

it('deve recusar data que não existe no calendário e data fora do formato', function () {
    // ARRANGE
    relogioDoInicioDosIndicadores();
    $this->actingAs(admin());

    foreach (['2026-02-30', '01/10/2026', '2026-1-1'] as $invalida) {
        // ACT
        $resposta = $this->putJsonComVersao('/api/configuracoes', [
            'chave' => 'indicadores.comparar_a_partir_de', 'valor' => $invalida,
        ]);

        // ASSERT
        $resposta->assertUnprocessable()->assertJsonValidationErrors(['valor' => 'Data inválida: escolha um dia que existe no calendário.']);
    }
});

it('deve aceitar vazio para voltar ao primeiro agendamento, auditando a troca', function () {
    // ARRANGE
    relogioDoInicioDosIndicadores();
    $administradora = admin();
    $this->actingAs($administradora)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'indicadores.comparar_a_partir_de', 'valor' => '2026-10-01',
    ])->assertOk();

    // ACT
    $resposta = $this->putJsonComVersao('/api/configuracoes', [
        'chave' => 'indicadores.comparar_a_partir_de', 'valor' => '',
    ]);

    // ASSERT
    $resposta->assertOk();
    $trilha = Auditoria::where('entidade', 'configuracoes')->orderBy('id')->get();
    expect(app(ConfiguracaoService::class)->get('indicadores.comparar_a_partir_de'))->toBe('')
        ->and($trilha)->toHaveCount(2)
        ->and($trilha->last()->usuario_id)->toBe($administradora->id);
});

it('deve continuar recusando o nulo nas chaves de texto que não são data', function () {
    // ARRANGE — o vazio vira nulo no stack; só a DATA o traduz de volta (normalizarVazio)
    relogioDoInicioDosIndicadores();
    $this->actingAs(admin());

    // ACT
    $resposta = $this->putJsonComVersao('/api/configuracoes', ['chave' => 'clinica.nome', 'valor' => '']);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors(['valor' => 'Valor incompatível com o tipo string.']);
});

it('deve deixar esvaziar também a data das notificações, pela mesma regra das datas', function () {
    // ARRANGE — antes desta change, "apagar a data" de qualquer chave de data dava 422
    relogioDoInicioDosIndicadores();
    $this->actingAs(admin());
    app(ConfiguracaoService::class)->set('notificacoes.a_partir_de', '2026-01-01');

    // ACT
    $resposta = $this->putJsonComVersao('/api/configuracoes', ['chave' => 'notificacoes.a_partir_de', 'valor' => '']);

    // ASSERT
    $resposta->assertOk();
    expect(app(ConfiguracaoService::class)->get('notificacoes.a_partir_de'))->toBe('');
});
