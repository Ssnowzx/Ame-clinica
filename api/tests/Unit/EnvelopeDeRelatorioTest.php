<?php

use App\Support\Relatorios\Envelope;

/**
 * O `Envelope` dos relatórios (change `area-de-relatorios`, D2) — em unidade, porque a classe é
 * pura e cada regra dela é uma decisão própria.
 *
 * Nasceu do achado `CRR-09`: o envelope é a fronteira que promete "um envelope mal montado falha
 * AQUI, no construtor, nunca na tela da recepção" — e não tinha teste NENHUM. Apagar a validação
 * de tipo de coluna não derrubava nada em lugar nenhum da suíte: dez relatórios passavam por ele
 * e nenhum provava a guarda, porque nenhum deles monta coluna errada de propósito.
 *
 * A segunda regra sem dono era a semântica de `contagem`, que a tela e o papel imprimem como
 * "N linhas": no analítico é o número de linhas; no sintético é a soma das linhas dos grupos,
 * com o grupo SEM linha contando 1 — porque no sintético por dimensão o grupo É a linha.
 */

/** Um envelope válido mínimo, com os campos sobrescritos pelo teste. */
function envelopeDeTeste(array $sobrescritas = []): Envelope
{
    $padrao = [
        'slug' => 'relatorio-ficticio',
        'titulo' => 'Relatório Fictício',
        'periodo' => ['de' => '2026-09-01', 'ate' => '2026-09-30'],
        'filtrosAplicados' => [],
        'colunas' => [['chave' => 'valor', 'rotulo' => 'Valor', 'tipo' => 'dinheiro']],
        'linhas' => [],
        'grupos' => null,
        'totais' => [],
        'truncado' => false,
    ];

    return new Envelope(...[...$padrao, ...$sobrescritas]);
}

it('deve recusar coluna sem chave, sem rótulo ou sem tipo', function (array $coluna) {
    // ARRANGE + ACT + ASSERT — a tela genérica renderiza PELA declaração; coluna incompleta
    // vira célula em branco sem cabeçalho, e o papel sai com uma coluna a menos
    expect(fn () => envelopeDeTeste(['colunas' => [$coluna]]))
        ->toThrow(InvalidArgumentException::class, 'Coluna sem chave/rotulo/tipo no relatório `relatorio-ficticio`.');
})->with([
    'sem chave' => [['rotulo' => 'Valor', 'tipo' => 'texto']],
    'sem rótulo' => [['chave' => 'valor', 'tipo' => 'texto']],
    'sem tipo' => [['chave' => 'valor', 'rotulo' => 'Valor']],
    // `null` não é "presente": `isset` o trata como ausente, e é o caso que um `?->` produz
    'com tipo nulo' => [['chave' => 'valor', 'rotulo' => 'Valor', 'tipo' => null]],
]);

it('deve recusar tipo de coluna que não está no catálogo', function () {
    // ARRANGE + ACT + ASSERT — o `tipo` é o contrato de FORMATAÇÃO com a tela; um tipo que ela
    // não conhece cairia no default e imprimiria dinheiro como texto cru
    expect(fn () => envelopeDeTeste(['colunas' => [['chave' => 'valor', 'rotulo' => 'Valor', 'tipo' => 'moeda']]]))
        ->toThrow(InvalidArgumentException::class, 'Tipo de coluna `moeda` desconhecido no relatório `relatorio-ficticio`.');
});

it('deve aceitar todos os tipos declarados no catálogo', function () {
    // ARRANGE + ACT — a lista publicada é a que passa; se um tipo sair de lá sem sair dos
    // relatórios, o teste do relatório cai, e este diz por quê
    $colunas = array_map(
        fn (string $tipo): array => ['chave' => $tipo, 'rotulo' => ucfirst($tipo), 'tipo' => $tipo],
        Envelope::TIPOS,
    );

    // ASSERT
    expect(envelopeDeTeste(['colunas' => $colunas])->toArray()['colunas'])->toHaveCount(count(Envelope::TIPOS));
});

it('deve recusar total não numérico, nos totais gerais e nos de um grupo', function () {
    // ARRANGE + ACT + ASSERT — `totais` é o rodapé que a clínica soma no papel; um texto ali
    // (um "—", um "R$ 1.200,00") vira coluna que não fecha com a conta de ninguém
    expect(fn () => envelopeDeTeste(['totais' => ['valor' => '—']]))
        ->toThrow(InvalidArgumentException::class, 'Total `valor` não numérico no relatório `relatorio-ficticio`.');
    expect(fn () => envelopeDeTeste(['totais' => ['valor' => 'R$ 1.200,00']]))
        ->toThrow(InvalidArgumentException::class, 'Total `valor` não numérico no relatório `relatorio-ficticio`.');

    // ...e o do GRUPO também: o sintético soma por grupo, e é lá que a divisão erra primeiro
    expect(fn () => envelopeDeTeste([
        'grupos' => [['titulo' => 'Grupo Fictício', 'linhas' => [], 'totais' => ['valor' => 'zero']]],
    ]))->toThrow(InvalidArgumentException::class, 'Total `valor` não numérico no relatório `relatorio-ficticio`.');
});

it('deve aceitar como total o inteiro, o float e a string decimal — o dinheiro da casa', function () {
    // ARRANGE + ACT — dinheiro trafega como string decimal (`"1234.50"`), e é o servidor quem soma
    $envelope = envelopeDeTeste(['totais' => ['quantidade' => 3, 'media' => 1.5, 'valor' => '1234.50', 'zero' => '0']]);

    // ASSERT — a string decimal ATRAVESSA como string; converter aqui reintroduziria o float
    expect($envelope->toArray()['totais'])->toBe(['quantidade' => 3, 'media' => 1.5, 'valor' => '1234.50', 'zero' => '0']);
});

it('deve contar, no analítico, as linhas devolvidas', function () {
    // ARRANGE + ACT — `grupos` nulo é o analítico
    $envelope = envelopeDeTeste(['linhas' => [['valor' => '1.00'], ['valor' => '2.00'], ['valor' => '3.00']]]);

    // ASSERT
    expect($envelope->toArray()['contagem'])->toBe(3);
});

it('deve contar, no sintético, as linhas dos grupos — e o grupo SEM linha como 1', function () {
    // ARRANGE — dois grupos com linha e um sem: o sem-linha é o sintético por dimensão, onde o
    // grupo É a linha da tabela ("Convênio X … 4 pacientes") e portanto conta 1
    $envelope = envelopeDeTeste([
        'grupos' => [
            ['titulo' => 'Com duas', 'linhas' => [['valor' => '1.00'], ['valor' => '2.00']], 'totais' => ['valor' => '3.00']],
            ['titulo' => 'Com uma', 'linhas' => [['valor' => '4.00']], 'totais' => ['valor' => '4.00']],
            ['titulo' => 'Sem nenhuma', 'linhas' => [], 'totais' => ['valor' => '0.00']],
        ],
    ]);

    // ACT + ASSERT — 2 + 1 + 1
    expect($envelope->toArray()['contagem'])->toBe(4);
});

it('deve contar zero quando não há grupo nenhum — o recorte vazio que a tela explica', function () {
    // ARRANGE + ACT — é o caso que o `CRR-07` criou em `servicos`: grupo sem linha é OMITIDO,
    // e com todos omitidos a lista de grupos fica vazia. `contagem` tem de ser 0, senão a tela
    // acha que tem resultado e nunca mostra o vazio nem o Imprimir
    $envelope = envelopeDeTeste(['grupos' => []]);

    // ASSERT
    expect($envelope->toArray()['contagem'])->toBe(0);
});

it('deve publicar o envelope inteiro, com truncado e periodo, nas chaves que a tela lê', function () {
    // ARRANGE + ACT
    $publicado = envelopeDeTeste([
        'filtrosAplicados' => [['rotulo' => 'Situação', 'valor' => 'Ativos']],
        'linhas' => [['valor' => '10.00']],
        'totais' => ['valor' => '10.00'],
        'truncado' => true,
    ])->toArray();

    // ASSERT — o contrato com a tela genérica; chave a mais ou a menos é tela quebrada
    expect(array_keys($publicado))->toBe([
        'slug', 'titulo', 'periodo', 'filtros_aplicados', 'colunas', 'linhas', 'grupos', 'totais', 'contagem', 'truncado',
        // `avisos` (change recebido-por-profissional, CR-RPP-31): frase ao leitor que NÃO é filtro
        'avisos',
    ])->and($publicado['truncado'])->toBeTrue()
        ->and($publicado['avisos'])->toBe([])
        ->and($publicado['periodo'])->toBe(['de' => '2026-09-01', 'ate' => '2026-09-30'])
        ->and($publicado['filtros_aplicados'])->toBe([['rotulo' => 'Situação', 'valor' => 'Ativos']]);
});

it('deve publicar os avisos e recusar aviso vazio', function () {
    // ARRANGE + ACT — `avisos` é frase ao leitor (CR-RPP-31): publicada como veio; vazia é envelope mal montado
    $publicado = envelopeDeTeste(['avisos' => ['1 pagamento do período está sem profissional.']])->toArray();

    // ASSERT
    expect($publicado['avisos'])->toBe(['1 pagamento do período está sem profissional.'])
        ->and(fn () => envelopeDeTeste(['avisos' => ['']]))->toThrow(InvalidArgumentException::class);
});
