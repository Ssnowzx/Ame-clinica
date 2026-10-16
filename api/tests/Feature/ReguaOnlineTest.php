<?php

use App\Models\CampoCadastro;
use App\Support\CamposCadastro\ReguaDoCadastro;

/**
 * A chave `online` da régua — a que decide o que a família vê no formulário público
 * (change `cadastro-online-do-paciente`).
 *
 * O que este arquivo prova não é "a chave existe": é **onde ela NÃO pode chegar**. O parecer
 * pré-código (condição 1, ameaça A1) mediu que a trava desta casa é **por chave**, e que dizer
 * "o campo é travado" sem dizer em quais chaves deixa aberta justamente a que ninguém olhou:
 * `nascimento` estava travado em `obrigatorio` e `desabilitado`, e livre em `online`. Desmarcar
 * `online` no nascimento tirava a data do formulário público; o envio chegava sem ela, a idade
 * ficava desconhecida e **nenhum responsável era exigido de ninguém** — a guarda do art. 14
 * virava uma caixa de seleção na tela de configurações.
 */
it('deve recusar tirar o NASCIMENTO do formulário público — é ele que diz que o paciente é menor', function () {
    // ARRANGE
    $usuario = admin();

    // ACT
    $resposta = $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['nascimento' => ['online' => false]],
    ]);

    // ASSERT — 422, com a razão em português, e nada gravado
    $resposta->assertUnprocessable()->assertJsonValidationErrors('campos.nascimento');
    expect($resposta->json('errors')['campos.nascimento'][0])->toContain('menor de idade')
        ->and(CampoCadastro::query()->count())->toBe(0);
});

it('deve recusar tirar o NOME e os RESPONSÁVEIS do formulário público', function () {
    // ARRANGE — nome: formulário público sem nome não coleta cadastro nenhum. Responsáveis:
    // exigir um responsável num formulário que não tem onde informá-lo recusa a família sem saída.
    $usuario = admin();

    // ACT + ASSERT
    foreach (['nome', 'responsaveis_json'] as $campo) {
        $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
            'campos' => [$campo => ['online' => false]],
        ])->assertUnprocessable()->assertJsonValidationErrors("campos.{$campo}");
    }

    expect(CampoCadastro::query()->count())->toBe(0);
});

it('deve recusar pôr CONVÊNIO no formulário público — a página não entrega dado da clínica', function () {
    // ARRANGE — oferecer o seletor exigiria devolver a lista de convênios da clínica na rota
    // pública, contra o requisito "nenhum outro dado da clínica" (parecer, condição 8)
    $usuario = admin();

    // ACT + ASSERT
    foreach (['convenio_id', 'plano', 'carteirinha', 'carteirinha_validade'] as $campo) {
        $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
            'campos' => [$campo => ['online' => true]],
        ])->assertUnprocessable()->assertJsonValidationErrors("campos.{$campo}");
    }

    expect(CampoCadastro::query()->count())->toBe(0);
});

it('deve deixar a clínica escolher os campos que NÃO são travados', function () {
    // ARRANGE — o par de controle: sem ele, os testes acima passariam num sistema que
    // simplesmente recusa toda escrita de `online`, e a chave pareceria travada estando quebrada
    $usuario = admin();

    // ACT — tira a profissão do público, põe o nome social
    $resposta = $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => [
            'profissao' => ['online' => false],
            'nome_social' => ['online' => true],
        ],
    ]);

    // ASSERT
    $resposta->assertOk();
    $regua = app(ReguaDoCadastro::class);
    $regua->esquecer();
    expect($regua->doCampo('profissao')['online'])->toBeFalse()
        ->and($regua->doCampo('nome_social')['online'])->toBeTrue()
        // e o que ninguém tocou continua no padrão do catálogo
        ->and($regua->doCampo('nascimento')['online'])->toBeTrue();
});

it('deve fazer DESABILITADO vencer ONLINE na leitura', function () {
    // ARRANGE — "some do meu formulário, mas colete no público" é pedido coerente de se fazer e
    // ruim de atender: seria a clínica pedindo pela porta de fora o que fechou pela de dentro.
    // A escrita não recusa a combinação; quem a resolve é a leitura, num lugar só.
    admin();
    CampoCadastro::create([
        'formulario' => 'paciente',
        'campo' => 'profissao',
        'desabilitado' => true,
        'online' => true,
    ]);

    // ACT
    $regua = app(ReguaDoCadastro::class);
    $regua->esquecer();

    // ASSERT
    expect($regua->doCampo('profissao')['desabilitado'])->toBeTrue()
        ->and($regua->doCampo('profissao')['online'])->toBeFalse()
        ->and($regua->doCampo('profissao')['obrigatorio'])->toBeFalse();
});

it('deve devolver a chave online na régua efetiva, com a trava junto', function () {
    // ARRANGE — a tela de configuração precisa saber que a caixa existe E que está travada,
    // senão desenha um controle que o servidor vai recusar
    $usuario = admin();

    // ACT
    $campos = collect($this->actingAs($usuario)->getJson('/api/campos-cadastro/paciente')->json('campos'))
        ->keyBy('campo');

    // ASSERT
    expect($campos['nascimento']['online'])->toBeTrue()
        ->and($campos['nascimento']['travas'])->toContain('online')
        ->and($campos['convenio_id']['online'])->toBeFalse()
        ->and($campos['convenio_id']['travas'])->toContain('online')
        ->and($campos['profissao']['travas'])->not->toContain('online');
});

/**
 * O GRAMPO DA LEITURA, no eixo `online`.
 *
 * A trava é conferida em dois lugares, e por razões diferentes: a `FormRequest` recusa a escrita
 * (é o que a clínica vê), e a leitura grampeia o que já estiver gravado. O segundo existe porque
 * `gravar()` é caminho de persistência SEM boundary — o `DemoSeeder` já o chama direto, e uma
 * migration de change futura reabriria a porta em silêncio.
 *
 * Só a primeira camada estava provada no eixo que esta change abriu: apagar o grampo da leitura
 * deixava a suíte inteira verde (gate, SEC-CO-40).
 */
it('deve IGNORAR na leitura um online torto gravado direto no banco', function (): void {
    // ARRANGE — a escrita pela porta lateral, que é o cenário do seeder e da migration
    admin();
    app(ReguaDoCadastro::class)->gravar('nascimento', ['online' => false]);

    // ACT
    app(ReguaDoCadastro::class)->esquecer();
    $efetiva = app(ReguaDoCadastro::class)->todos('paciente');

    // ASSERT — a leitura devolve o PADRÃO do catálogo, não o que está no banco
    expect($efetiva['nascimento']['online'])->toBeTrue();
});

it('deve continuar respeitando o override de um campo NÃO travado', function (): void {
    // ARRANGE — o par de controle: sem ele, um grampo que ignorasse tudo passaria no teste acima
    admin();
    app(ReguaDoCadastro::class)->gravar('indicacao', ['online' => false]);

    // ACT
    app(ReguaDoCadastro::class)->esquecer();
    $efetiva = app(ReguaDoCadastro::class)->todos('paciente');

    // ASSERT
    expect($efetiva['indicacao']['online'])->toBeFalse();
});
