<?php

use App\Support\Mensageria\TelefoneE164;

/**
 * A forma canônica do telefone (change mensageria-whatsapp, D6).
 *
 * O que estes testes protegem: o cadastro da clínica guarda `(11) 98765-4321` e a Meta
 * entrega `5511987654321`. Se estes dois deixarem de casar, toda conversa chega não
 * vinculada e a recepção passa a vincular à mão, uma por uma.
 *
 * Números 100% FICTÍCIOS.
 */
it('deve casar o telefone do cadastro com o que a Meta entrega, apesar do formato', function () {
    // ARRANGE / ACT / ASSERT
    expect(TelefoneE164::normalizar('(11) 98765-4321'))->toBe('+5511987654321');
    expect(TelefoneE164::normalizar('5511987654321'))->toBe('+5511987654321');
    expect(TelefoneE164::normalizar('+55 11 98765-4321'))->toBe('+5511987654321');
    expect(TelefoneE164::normalizar(' 11 9 8765 4321 '))->toBe('+5511987654321');
});

it('deve aceitar telefone fixo de 8 dígitos', function () {
    // ARRANGE / ACT / ASSERT
    expect(TelefoneE164::normalizar('(11) 3333-4444'))->toBe('+551133334444');
    expect(TelefoneE164::normalizar('551133334444'))->toBe('+551133334444');
});

it('NÃO deve comer o DDD 55 achando que é o código do país', function () {
    // ARRANGE — Santa Maria (RS) tem DDD 55; `5533334444` é um fixo de lá, não um número
    // com DDI. Descascar o `55` aqui produziria `+5533334444` — outro telefone.
    // ACT / ASSERT
    expect(TelefoneE164::normalizar('5533334444'))->toBe('+555533334444');
    expect(TelefoneE164::normalizar('55987654321'))->toBe('+5555987654321');
    // com DDI de verdade (13 dígitos), aí sim descasca
    expect(TelefoneE164::normalizar('5555987654321'))->toBe('+5555987654321');
});

it('deve recusar o que não dá para usar, sem inventar dígito', function () {
    // ARRANGE / ACT / ASSERT
    expect(TelefoneE164::normalizar(null))->toBeNull();
    expect(TelefoneE164::normalizar(''))->toBeNull();
    expect(TelefoneE164::normalizar('98765-4321'))->toBeNull();      // sem DDD: não se adivinha
    expect(TelefoneE164::normalizar('3333-4444'))->toBeNull();       // idem
    expect(TelefoneE164::normalizar('(01) 98765-4321'))->toBeNull(); // DDD inexistente
    expect(TelefoneE164::normalizar('(11) 88765-4321'))->toBeNull(); // 9 dígitos sem começar em 9
    expect(TelefoneE164::normalizar('não tenho'))->toBeNull();
});

it('deve produzir as duas leituras do celular para a BUSCA — com e sem o nono dígito', function () {
    // ARRANGE / ACT
    $doNove = TelefoneE164::variantes('5511987654321');
    $doOito = TelefoneE164::variantes('(11) 8765-4321');

    // ASSERT — o cadastro pode ter sido feito de qualquer um dos dois lados da mudança de 2012
    expect($doNove)->toEqualCanonicalizing(['+5511987654321', '+551187654321']);
    expect($doOito)->toEqualCanonicalizing(['+551187654321', '+5511987654321']);
});

it('NÃO deve inventar variante de telefone fixo', function () {
    // ARRANGE / ACT / ASSERT — `+551193333444` não existe; gerar essa variante casaria
    // a conversa com o telefone de outra pessoa
    expect(TelefoneE164::variantes('(11) 3333-4444'))->toBe(['+551133334444']);
});

it('deve devolver lista vazia quando o número é inutilizável', function () {
    // ARRANGE / ACT / ASSERT — quem consome faz `whereIn` com isso: lista vazia não casa nada
    expect(TelefoneE164::variantes('98765-4321'))->toBe([]);
});

it('não deve ler o celular que começa por 9 3 como o telefone fixo de outra pessoa', function () {
    // ARRANGE — `9 3333-4444` sem o 9 seria o FIXO `3333-4444`: só celular antigo (6–9) tinha o 9
    // acrescentado (change lembrete-com-botoes-de-resposta, SEC-BT-07)
    $celular = '+5511933334444';

    // ACT
    $variantes = TelefoneE164::variantes($celular);

    // ASSERT
    expect($variantes)->toBe([$celular]);
});

/*
 * `classificar()` (change telefone-que-chega-no-whatsapp, D1): o que o cadastro diz ao lado do
 * campo. É a regra que a tela copia, e a cópia é conferida contra `telefones:casos`.
 */
it('deve classificar o celular de 9 dígitos e o móvel antigo de 8 como celular', function () {
    // ARRANGE / ACT
    $novo = TelefoneE164::classificar('(49) 99123-4567');
    $antigo = TelefoneE164::classificar('(49) 8123-4567');

    // ASSERT
    expect($novo)->toBe(['forma' => '+5549991234567', 'tipo' => TelefoneE164::CELULAR]);
    expect($antigo)->toBe(['forma' => '+554981234567', 'tipo' => TelefoneE164::CELULAR]);
});

it('deve classificar o número de 8 dígitos iniciado em 2 a 5 como fixo', function () {
    // ARRANGE / ACT
    $classe = TelefoneE164::classificar('(49) 3222-1234');

    // ASSERT
    expect($classe)->toBe(['forma' => '+554932221234', 'tipo' => TelefoneE164::FIXO]);
});

it('deve devolver sem forma e sem tipo os formatos digitados errado em 02/10', function (string $digitado) {
    // ARRANGE / ACT
    $classe = TelefoneE164::classificar($digitado);

    // ASSERT — DDI ou DDD na frente com dígito faltando, ou dígito a mais: nada disso chega
    expect($classe)->toBe(['forma' => null, 'tipo' => null]);
})->with([
    'DDI na frente, um dígito a menos' => '55 49912-3456',
    'DDD repetido, um dígito a menos' => '(49) 49912-3456',
    'um dígito a mais' => '49 99912-34567',
    'vazio' => '',
]);

it('deve classificar sempre pela forma que normalizar() grava', function (string $digitado) {
    // ARRANGE / ACT
    $classe = TelefoneE164::classificar($digitado);

    // ASSERT — a forma da classificação é a da projeção; divergir aqui faria a tela prometer um
    // número que o lembrete não usa
    expect($classe['forma'])->toBe(TelefoneE164::normalizar($digitado));
})->with(['(11) 98765-4321', '5511987654321', '5533334444', '(11) 8765-4321', '(01) 98765-4321']);

/*
 * O número de fora do país (change telefone-estrangeiro): uma família da clínica tem celular do Reino
 * Unido. Com `+` e país que não é 55 ele vale como veio; sem o `+`, continua lido como brasileiro.
 * Reino Unido só na faixa de ficção da Ofcom (`+44 7700 900000`–`900999`); EUA na 555-01xx.
 */
it('deve guardar o número estrangeiro com + em E.164, como veio', function (string $digitado, string $forma) {
    // ARRANGE / ACT
    $canonico = TelefoneE164::normalizar($digitado);

    // ASSERT
    expect($canonico)->toBe($forma);
})->with([
    'Reino Unido' => ['+44 7700 900123', '+447700900123'],
    'Reino Unido com espaço em volta' => ['  +44 7700 900123 ', '+447700900123'],
    'Portugal' => ['+351 912 345 678', '+351912345678'],
    'Estados Unidos com máscara' => ['+1 (202) 555-0101', '+12025550101'],
]);

it('deve aceitar o número estrangeiro de 8 a 15 dígitos, e só ele', function (string $digitado, ?string $forma) {
    // ARRANGE / ACT
    $canonico = TelefoneE164::normalizar($digitado);

    // ASSERT — o E.164 tem no máximo 15 dígitos; menos de 8 não é telefone de país nenhum
    expect($canonico)->toBe($forma);
})->with([
    '7 dígitos' => ['+44 7700 9', null],
    '8 dígitos' => ['+44 770 090', '+44770090'],
    '15 dígitos' => ['+44 7700 900123 456', '+447700900123456'],
    '16 dígitos' => ['+44 7700 900123 4567', null],
]);

it('não deve aceitar código de país que começa por 0', function () {
    // ARRANGE / ACT / ASSERT — nenhum código de país começa por 0: é o zero do DDD digitado depois do +
    expect(TelefoneE164::normalizar('+0 44 7700 900123'))->toBeNull();
});

it('deve continuar lendo pela regra brasileira o número sem o +', function () {
    // ARRANGE / ACT / ASSERT — sem `+` não se adivinha o país: `447700900123` pode ser um erro de
    // digitação, e o DDD 55 do RS continua sendo DDD
    expect(TelefoneE164::normalizar('447700900123'))->toBeNull();
    expect(TelefoneE164::normalizar('351912345678'))->toBeNull();
    expect(TelefoneE164::normalizar('5533334444'))->toBe('+555533334444');
});

it('deve manter a régua brasileira para o número com +55', function (string $digitado, ?string $forma) {
    // ARRANGE / ACT
    $canonico = TelefoneE164::normalizar($digitado);

    // ASSERT — o `+55` não vira "estrangeiro": dígito a menos ou a mais continua recusado
    expect($canonico)->toBe($forma);
})->with([
    'celular' => ['+55 11 98765-4321', '+5511987654321'],
    'fixo' => ['+55 11 3333-4444', '+551133334444'],
    'um dígito a menos' => ['+55 49912-3456', null],
    'um dígito a mais' => ['+55 11 98765-43210', null],
]);

it('deve classificar o número estrangeiro como celular', function () {
    // ARRANGE / ACT
    $classe = TelefoneE164::classificar('+44 7700 900123');

    // ASSERT — de fora do país não se sabe se é fixo; recusar o lembrete seria o pior dos dois erros
    expect($classe)->toBe(['forma' => '+447700900123', 'tipo' => TelefoneE164::CELULAR]);
});

it('não deve inventar variante de nono dígito para número de fora do país', function (string $estrangeiro) {
    // ARRANGE / ACT
    $variantes = TelefoneE164::variantes($estrangeiro);

    // ASSERT — o nono dígito é história do Brasil; uma variante aqui seria um `+55…` de outra pessoa
    expect($variantes)->toBe([TelefoneE164::normalizar($estrangeiro)]);
})->with([
    'Reino Unido' => '+44 7700 900123',
    // código de país vago na UIT (28x): não é de ninguém, e tem o formato que, lido como brasileiro,
    // ganharia o "celular antigo" `+5500961234567`
    'código vago com cara de celular antigo' => '+28 0061 234567',
]);

it('deve devolver a mesma forma ao normalizar de novo o número estrangeiro', function () {
    // ARRANGE — a projeção grava a forma, e o lembrete, a conversa e a busca a normalizam outra vez
    $forma = TelefoneE164::normalizar('+44 7700 900123');

    // ACT / ASSERT
    expect(TelefoneE164::normalizar($forma))->toBe($forma);
    expect(TelefoneE164::classificar($forma)['forma'])->toBe($forma);
});

it('deve ler o número da Meta com o DDI completo', function (string $daMeta, ?string $forma) {
    // ARRANGE / ACT
    $telefone = TelefoneE164::daMeta($daMeta);

    // ASSERT — a Meta manda o país sempre, sem o `+`; o brasileiro casa como antes
    expect($telefone)->toBe($forma);
})->with([
    'Reino Unido' => ['447700900123', '+447700900123'],
    'celular brasileiro' => ['5511987654321', '+5511987654321'],
    'celular brasileiro de antes do nono dígito' => ['551187654321', '+551187654321'],
    'vazio' => ['', null],
]);

it('deve tirar as marcas invisíveis do número copiado do WhatsApp antes de olhar o +', function (string $copiado, string $forma) {
    // ARRANGE / ACT — o WhatsApp embrulha o número em marcas de direção de texto (Unicode Cf); com
    // elas o `+` não é o primeiro caractere (gate r1 da change telefone-estrangeiro)
    $canonico = TelefoneE164::normalizar($copiado);

    // ASSERT
    expect($canonico)->toBe($forma);
})->with([
    'Reino Unido entre marcas' => ["\u{202A}+44 7700 900123\u{202C}", '+447700900123'],
    'espaço antes da marca' => [" \u{2066}+351 912 345 678\u{2069}", '+351912345678'],
    'marca entre o + e o número' => ["+\u{200E}44 7700 900123", '+447700900123'],
    'brasileiro entre marcas' => ["\u{202A}(11) 98765-4321\u{202C}", '+5511987654321'],
]);

it('não deve quebrar com texto que não é UTF-8 válido', function () {
    // ARRANGE — o `/u` devolve null para UTF-8 inválido; o texto segue como veio e os dígitos decidem
    $invalido = "\xFF(11) 98765-4321";

    // ACT / ASSERT
    expect(TelefoneE164::normalizar($invalido))->toBe('+5511987654321');
});
