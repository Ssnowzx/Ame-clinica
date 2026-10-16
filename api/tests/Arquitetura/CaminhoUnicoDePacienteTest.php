<?php

use Tests\Arquitetura\Fontes;

/**
 * GUARDA DE IDIOMA — paciente nasce por caminhos CONTADOS, e a lista é explícita.
 *
 * Nasceu com a change `cadastro-online-do-paciente`, e o risco que ela cobre está nomeado no
 * design: **o aceite virar um segundo caminho de criação de paciente**. É risco recorrente nesta
 * casa — a mesma classe do `WHITELIST do menor` e do `PROHIBITED-NULL`: um caminho novo que copia
 * 90% das guardas e esquece a que importa, e o esquecimento não aparece como erro.
 *
 * A mitigação escolhida foi de DESENHO, não de vigilância: o aceite **não grava paciente**. Ele
 * marca o envio e devolve o conteúdo para a tela abrir o formulário de sempre, que salva por
 * `POST /pacientes`. Esta guarda é o que impede alguém de "simplificar" isso depois.
 *
 * A lista de exceções é NOMEADA, e uma delas incomoda de propósito: `preCadastro` **já é** um
 * segundo caminho hoje (change `pre-cadastro-de-paciente`, o balcão criando com o mínimo). O
 * parecer pré-código apontou que uma guarda que não a enumerasse seria teatro — ela passaria
 * verde com o problema que existe. Está aqui, escrita, para ser decidida em vez de esquecida.
 */
it('deve manter a criação de paciente nos caminhos declarados', function () {
    // ARRANGE — cada entrada diz ONDE e POR QUÊ; caminho novo reprova até ser justificado aqui
    $declarados = [
        // o boundary completo: `PacienteRequest` + a âncora do aceite de termo. É o caminho que
        // o aceite do auto-cadastro atravessa, pela tela, como qualquer cadastro de balcão
        'Http/Controllers/PacienteController.php',
        // a carga da virada: console, sem HTTP, sob o contrato SEC-IV (dry-run, confirmação
        // digitada, transação sanitizada). Não é superfície de usuário
        'Console/Commands/ViradaImportar.php',
    ];

    // ACT
    $forasteiros = [];
    foreach (Fontes::doApp($declarados) as $caminho => $fonte) {
        if (preg_match('/(?<![A-Za-z_])Paciente::create\(|new Paciente\(/', $fonte) === 1) {
            $forasteiros[] = $caminho;
        }
    }

    // ASSERT
    expect($forasteiros)->toBe(
        [],
        'Arquivo criando Paciente fora dos caminhos declarados: '.implode(', ', $forasteiros)
        .'. Um caminho novo de criação copia as guardas do boundary e esquece uma — foi assim que '
        .'a whitelist do menor e o `prohibited` voltaram. Atravesse `PacienteController@store` ou '
        .'declare o caminho aqui, com a razão.'
    );
});

it('deve manter o ACEITE do auto-cadastro sem criar paciente', function () {
    // ARRANGE — o aceite é o gesto de um humano que olhou; o formulário é onde ele conserta o que
    // a família digitou errado ANTES de a base receber (design D2). Se um dia ele gravar direto,
    // o dado não conferido entra na base com CPF disputando unicidade e homônimo em silêncio
    $fonte = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/FilaDeCadastroController.php');

    // ACT + ASSERT
    expect($fonte)->not->toContain('Paciente::create')
        ->and($fonte)->not->toContain('new Paciente(');
});

it('deve enumerar o segundo caminho que JÁ existe, para ele ser decidido e não esquecido', function () {
    // ARRANGE — `preCadastro` (o balcão criando com o mínimo, change `pre-cadastro-de-paciente`)
    // dispensa o boundary completo por decisão registrada: a recepção põe a criança na fila com o
    // que tem ao telefone. A guarda de menor-sem-responsável não se aplica sem nascimento, e volta
    // a valer no PUT completo.
    //
    // Este teste não o proíbe: ele garante que a exceção continue VISÍVEL. Uma guarda que
    // simplesmente ignorasse o arquivo inteiro esconderia o problema que ela existe para nomear.
    $fonte = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/PacienteController.php');

    // ACT
    $criacoes = preg_match_all('/(?<![A-Za-z_])Paciente::create\(/', $fonte);

    // ASSERT — são DUAS: o `store` (boundary completo) e o `preCadastro` (o mínimo do balcão).
    // Uma terceira aparecendo aqui é um caminho novo dentro do próprio controller, e ele precisa
    // ser olhado — não somado em silêncio.
    expect($criacoes)->toBe(
        2,
        'O PacienteController passou a criar paciente por um caminho a mais. Os dois conhecidos são '
        .'`store` (boundary completo) e `preCadastro` (o mínimo do balcão, exceção registrada).'
    );
});
