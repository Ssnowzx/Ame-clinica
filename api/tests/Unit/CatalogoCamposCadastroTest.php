<?php

use App\Support\CamposCadastro\CatalogoCamposCadastro as Catalogo;

/**
 * O catálogo da régua do cadastro (change campos-do-cadastro-configuraveis, D1).
 *
 * O que estes testes protegem: a promessa de que **clínica sem override não muda de
 * comportamento**. Toda a change se apoia nela — se o padrão do catálogo divergir do que
 * `PacienteRequest` exigia antes, a régua entra afrouxando ou apertando o cadastro de
 * todo mundo em silêncio, e a migração de comportamento vira acidente.
 */
it('deve reproduzir exatamente a obrigatoriedade que valia antes da régua', function () {
    // ARRANGE — o que `PacienteRequest` declarava `required` até esta change
    $obrigatoriosDeAntes = ['nome', 'nascimento', 'sexo', 'necessidade'];

    // ACT
    $obrigatoriosNoCatalogo = collect(Catalogo::todos())
        ->filter(fn (array $d): bool => $d['padrao']['obrigatorio'])
        ->keys()
        ->sort()
        ->values()
        ->all();

    // ASSERT
    expect($obrigatoriosNoCatalogo)->toBe(collect($obrigatoriosDeAntes)->sort()->values()->all());
});

it('deve nascer com nenhum campo escondido', function () {
    // ARRANGE / ACT
    $escondidos = collect(Catalogo::todos())
        ->filter(fn (array $d): bool => $d['padrao']['desabilitado'])
        ->keys()
        ->all();

    // ASSERT — o cadastro de hoje mostra tudo; esconder é escolha da clínica, nunca default
    expect($escondidos)->toBe([]);
});

it('deve declarar as quatro chaves em todo campo, mesmo as que ainda não têm efeito', function () {
    // ARRANGE / ACT / ASSERT — o schema comporta `rapido`/`online` desde já (D2); um campo
    // sem elas produziria régua meio definida quando as changes 3 e 4 chegarem
    foreach (Catalogo::todos() as $campo => $definicao) {
        expect(array_keys($definicao['padrao']))->toEqualCanonicalizing(
            Catalogo::CHAVES,
            "o campo {$campo} não declara as quatro chaves"
        );
    }
});

it('deve travar o nome nas duas chaves e o CPF só em desabilitado', function () {
    // ARRANGE / ACT / ASSERT
    expect(Catalogo::estaTravado('nome', 'obrigatorio'))->toBeTrue()
        ->and(Catalogo::estaTravado('nome', 'desabilitado'))->toBeTrue()
        // CPF pode virar obrigatório — o que não pode é sumir, ou a recusa por CPF
        // repetido fica sem campo onde aparecer
        ->and(Catalogo::estaTravado('cpf', 'obrigatorio'))->toBeFalse()
        ->and(Catalogo::estaTravado('cpf', 'desabilitado'))->toBeTrue()
        // responsáveis some do formulário quebraria a guarda legal do menor
        ->and(Catalogo::estaTravado('responsaveis_json', 'desabilitado'))->toBeTrue()
        ->and(Catalogo::estaTravado('responsaveis_json', 'obrigatorio'))->toBeFalse();
});

it('deve dar um motivo em português para toda trava', function () {
    // ARRANGE / ACT / ASSERT — a tela mostra o motivo em vez de oferecer a escolha e
    // recusá-la depois; sem texto, ela mostraria o slug
    foreach (Catalogo::todos() as $campo => $definicao) {
        if (($definicao['travas'] ?? []) === []) {
            continue;
        }

        expect($definicao['motivo'] ?? '')->not->toBe('', "o campo {$campo} trava sem dizer por quê");
    }
});

it('deve pôr todo campo numa seção que existe e dar rótulo em português', function () {
    // ARRANGE / ACT / ASSERT
    foreach (Catalogo::todos() as $campo => $definicao) {
        // `toHaveKey($chave, $valor)` do Pest compara o VALOR no 2º argumento — não é
        // mensagem. Aqui a asserção é sobre a EXISTÊNCIA da seção.
        expect(array_key_exists($definicao['secao'], Catalogo::SECOES))
            ->toBeTrue("seção desconhecida em {$campo}");
        expect($definicao['rotulo'])->not->toBe('')
            // rótulo é o que a clínica lê: slug na tela é o defeito que a change
            // `texto-de-maquina-fora-da-tela` corrigiu
            ->and($definicao['rotulo'])->not->toBe($campo);
    }
});

it('deve reduzir os campos às colunas que a listagem precisa carregar', function () {
    // ARRANGE — os seis campos do endereço moram todos na mesma coluna JSON
    $camposDeEndereco = ['endereco_cep', 'endereco_cidade', 'endereco_uf'];

    // ACT
    $colunas = Catalogo::colunasDe([...$camposDeEndereco, 'nascimento', 'sexo']);

    // ASSERT — uma coluna só para os três de endereço (D6: o SELECT não incha por campo)
    expect($colunas)->toEqualCanonicalizing(['endereco_json', 'nascimento', 'sexo']);
});

it('deve recusar campo e formulário que não existem', function () {
    // ARRANGE / ACT / ASSERT
    expect(fn () => Catalogo::definicao('campo_que_nao_existe'))
        ->toThrow(InvalidArgumentException::class);
    expect(fn () => Catalogo::todos('formulario_que_nao_existe'))
        ->toThrow(InvalidArgumentException::class);
});

it('deve dar a todo campo-LISTA o nome do item no singular', function () {
    // ARRANGE — sem `rotulo_item`, o `min:1` cai no padrão do Laravel e a tela recebe
    // "deve ter ao menos 1 itens": plural errado e sem dizer de que item se trata.
    $listas = array_filter(Catalogo::todos(), fn (array $d) => $d['lista'] ?? false);

    // ACT
    $semRotulo = array_keys(array_filter($listas, fn (array $d) => ! isset($d['rotulo_item'])));

    // ASSERT — a lista de faltantes vem no erro, para dizer QUAL campo esqueceu
    expect($listas)->not->toBeEmpty()
        ->and($semRotulo)->toBe([]);

    foreach ($listas as $definicao) {
        expect($definicao['rotulo_item'])->toStartWith('um ');
    }
});
