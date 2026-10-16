<?php

use App\Models\Agendamento;
use App\Support\Rbac\Escopo;
use Illuminate\Contracts\Database\Query\Expression;
use Illuminate\Support\Facades\DB;

/**
 * `Escopo::aplicar` aceita uma EXPRESSÃO além de uma coluna (change `recebido-por-profissional`,
 * design D3): no relatório de recebidos o dono é `COALESCE(quem atendeu, dono do pacote)`, e é a
 * mesma expressão que atribui que tem de escopar. Os três estados continuam os de sempre.
 */
function expressaoDeDono(): Expression
{
    return DB::raw('COALESCE(agendamentos.profissional_id, 0)');
}

it('deve comparar a expressão com o profissional no escopo de um profissional', function () {
    // ARRANGE
    admin();

    // ACT
    $consulta = Escopo::de(987654)->aplicar(Agendamento::query(), expressaoDeDono());

    // ASSERT — a expressão vai crua para o SQL e o id vai como binding, nunca interpolado
    expect($consulta->toSql())->toContain('COALESCE(agendamentos.profissional_id, 0) = ?')
        ->and($consulta->getBindings())->toBe([987654]);
});

it('deve zerar a consulta no escopo nenhum mesmo com expressão', function () {
    // ARRANGE
    admin();

    // ACT
    $consulta = Escopo::nenhum()->aplicar(Agendamento::query(), expressaoDeDono());

    // ASSERT — fail-closed igual ao da coluna
    expect($consulta->toSql())->toContain('0 = 1')->not->toContain('COALESCE');
});

it('não deve tocar a consulta no escopo plano', function () {
    // ARRANGE
    admin();
    $semEscopo = Agendamento::query()->toSql();

    // ACT
    $consulta = Escopo::plano()->aplicar(Agendamento::query(), expressaoDeDono());

    // ASSERT
    expect($consulta->toSql())->toBe($semEscopo);
});
