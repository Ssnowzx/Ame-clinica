<?php

use App\Exceptions\CorridaDoCicloException;
use App\Support\Ciclos\CorridaDoMotor;

/*
 * A fonte única da tradução "corrida do motor → 409" (change `baixa-em-lote-por-status`,
 * achado CR-06 do gate): a guarda de ciclo e a espinha dos lotes delegam para cá. O que se
 * prova é a REGRA, não o banco: os três códigos viram 409, a descida pela cadeia de causas
 * encontra o código embrulhado, e o que não é corrida volta intacto.
 */

/** Um erro de PDO com o `errorInfo` que o driver preenche. */
function erroDoMotor(?int $codigo, string $mensagem = 'mensagem do motor'): PDOException
{
    $erro = new PDOException('SQLSTATE[HY000]: General error');
    $erro->errorInfo = $codigo === null ? null : ['HY000', $codigo, $mensagem];

    return $erro;
}

it('deve traduzir 1020, 1205 e 1213 em CorridaDoCicloException', function (int $codigo) {
    // ARRANGE
    $erro = erroDoMotor($codigo);

    // ACT
    $traduzido = CorridaDoMotor::traduzir($erro);

    // ASSERT
    expect($traduzido)->toBeInstanceOf(CorridaDoCicloException::class);
})->with([1020, 1205, 1213]);

it('deve traduzir o 1305 do SAVEPOINT desfeito por um deadlock aninhado', function () {
    // ARRANGE — gate SEC-EVO-R2-03: o eco do deadlock dentro de transação aninhada
    $erro = erroDoMotor(1305, 'SAVEPOINT trans2 does not exist');

    // ACT
    $traduzido = CorridaDoMotor::traduzir($erro);

    // ASSERT
    expect($traduzido)->toBeInstanceOf(CorridaDoCicloException::class);
});

it('deve devolver intacto o 1305 de função inexistente — erro de programação não é corrida', function (string $mensagem) {
    // ARRANGE — gates CR-EVO-R3-03 e R4-05: o MariaDB usa o mesmo 1305 para "FUNCTION … does not exist",
    // inclusive de uma função cujo nome contém "savepoint"
    $erro = erroDoMotor(1305, $mensagem);

    // ACT + ASSERT
    expect(CorridaDoMotor::traduzir($erro))->toBe($erro);
})->with(['FUNCTION xiax.ANY_VALUE does not exist', 'FUNCTION xiax.savepoint_x does not exist']);

it('deve encontrar o código na cadeia de causas quando o objeto de topo não tem errorInfo', function () {
    // ARRANGE — o embrulho do savepoint: topo sem `errorInfo`, causa com o 1213
    $topo = new PDOException('embrulhado', 0, erroDoMotor(1213));

    // ACT
    $traduzido = CorridaDoMotor::traduzir($topo);

    // ASSERT
    expect($traduzido)->toBeInstanceOf(CorridaDoCicloException::class);
});

it('deve devolver intacto o erro que não é corrida do motor', function () {
    // ARRANGE — um NOT NULL violado (1048) e um erro sem código nenhum
    $naoNulo = erroDoMotor(1048);
    $semCodigo = erroDoMotor(null);

    // ACT + ASSERT — erro de verdade não vira 409 por conveniência
    expect(CorridaDoMotor::traduzir($naoNulo))->toBe($naoNulo)
        ->and(CorridaDoMotor::traduzir($semCodigo))->toBe($semCodigo);
});
