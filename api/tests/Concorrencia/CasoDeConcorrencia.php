<?php

namespace Tests\Concorrencia;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * O caso de teste que prova LOCK — e por que ele não pode ser como os outros.
 *
 * Provar um lock exige uma **segunda conexão**: a pergunta é "a linha BLOQUEIA, ou apenas
 * fingimos que sim?", e só outra sessão do banco responde. Mas o `RefreshDatabase` dos testes
 * de feature envolve cada teste numa **transação** — e nada do que ele escreve existe para
 * outra conexão. A prova seria encenação.
 *
 * Daí `$connectionsToTransact = []`: a migration acontece (o schema fica de pé), e os dados
 * são **COMMITADOS**, visíveis a quem olhar de fora.
 *
 * **Por que NÃO `DatabaseMigrations`** (que era a primeira tentativa): ele roda
 * `migrate:rollback` no teardown e deixa o banco de teste **destruído** para quem rodar
 * depois — um `--filter` que atravesse as duas suítes derruba a outra, e o erro que aparece
 * ("Table 'migrations' doesn't exist") não tem nada a ver com o teste que o causou.
 *
 * O preço desta escolha: os dados commitados sobreviveriam ao teste. Como o sistema tem UMA
 * clínica (e não dá para isolar cada teste na sua), as tabelas são **esvaziadas** antes de
 * criar a clínica do teste e de novo no fim dele — o fim importa porque, em paralelo, um teste
 * de feature pode rodar depois deste no mesmo processo (e no mesmo banco), e enxergaria o que
 * ficou commitado aqui.
 */
abstract class CasoDeConcorrencia extends TestCase
{
    use RefreshDatabase;

    /** @var array<int, string|null> */
    protected $connectionsToTransact = [];

    protected function prepararClinica(): void
    {
        $this->esvaziarTabelas();
        $this->beforeApplicationDestroyed(fn () => $this->esvaziarTabelas());

        parent::prepararClinica();
    }

    private function esvaziarTabelas(): void
    {
        // só as do banco de teste deste processo: sem o schema, o MySQL lista as de todos
        $tabelas = array_diff(array_column(Schema::getTables(DB::getDatabaseName()), 'name'), ['migrations']);

        Schema::withoutForeignKeyConstraints(function () use ($tabelas): void {
            foreach ($tabelas as $tabela) {
                DB::table($tabela)->truncate();
            }
        });
    }
}
