<?php

use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Tratamento;
use App\Support\Clinica\RealceDoPacote;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Facades\DB;

/**
 * O REALCE DO FIM DE PACOTE — a regra, agora no servidor e agora DADO (§13).
 *
 * Estes cenários existem porque a regra mudou de casa: ela vivia como constante no front (e
 * depois em dois runtimes), e o que a guardava era um teste da suíte do web que abria este
 * arquivo `.php` e comparava por regex. Aquilo funcionava, e era o sintoma.
 */
function pacote(int $total, int $realizadas, string $status = 'andamento'): Tratamento
{
    return Tratamento::factory()->create([
        'paciente_id' => Paciente::factory()->create()->id,
        'profissional_id' => Profissional::factory()->create()->id,
        'especialidade_id' => Especialidade::factory()->create()->id,
        'sessoes_total' => $total,
        'sessoes_realizadas' => $realizadas,
        'status' => $status,
    ]);
}

function realce(): RealceDoPacote
{
    return app(RealceDoPacote::class);
}

it('deve dizer ACABANDO quando ainda há sessões dentro do limiar', function () {
    // ARRANGE — saldo 2 de 10: dá para atender, e é hora de oferecer o próximo pacote
    admin();

    // ACT + ASSERT
    expect(realce()->de(pacote(10, 8)))->toBe(RealceDoPacote::ACABANDO);
});

it('deve dizer SEM-SALDO quando o saldo acabou', function () {
    /*
     * ARRANGE — saldo 0 é OUTRO fato: a criança não pode ser atendida até renovar. O card
     * pintava os dois de vermelho e a lista já os separava; uma tela ensinava "vermelho =
     * acabando" e a outra "vermelho = bloqueado".
     */
    admin();

    // ACT + ASSERT
    expect(realce()->de(pacote(10, 10)))->toBe(RealceDoPacote::SEM_SALDO);
});

it('NÃO deve realçar tratamento de UMA sessão', function () {
    /*
     * ARRANGE — saldo 1 está sempre no limiar, então sem este recorte a sessão única alertava
     * desde o primeiro dia: ruído em cima de quem nunca comprou pacote. Foi o recorte que o
     * usuário nomeou ao pedir a feature ("tem mais que uma sessão").
     */
    admin();

    // ACT + ASSERT
    expect(realce()->de(pacote(1, 0)))->toBe(RealceDoPacote::NENHUM);
});

it('NÃO deve realçar pacote que não está em andamento', function () {
    /*
     * ARRANGE — este é o cenário que o FRONT não conseguia ver: o card recebia saldo e total,
     * e não o `status`. Um pacote parado com saldo baixo ficava realçado na grade enquanto o
     * contador dizia "nenhum" — a divergência que a spec jurava não existir.
     */
    admin();

    // ACT + ASSERT
    expect(realce()->de(pacote(10, 9, 'parado')))->toBe(RealceDoPacote::NENHUM);
    expect(realce()->de(pacote(10, 9, 'finalizado')))->toBe(RealceDoPacote::NENHUM);
});

it('NÃO deve realçar quando não há tratamento', function () {
    // ARRANGE — bloqueio e avulso não têm pacote nenhum
    admin();

    // ACT + ASSERT
    expect(realce()->de(null))->toBe(RealceDoPacote::NENHUM);
});

it('deve obedecer ao limiar da CLÍNICA, não a um número fixo', function () {
    /*
     * ARRANGE — o coração da §13. Com o default 2, saldo 3 não realça; a clínica que pedir 4
     * passa a ver o mesmo tratamento como "acabando" SEM deploy nenhum. Antes disso, o
     * caminho era editar dois arquivos, em dois runtimes, e subir os dois.
     */
    admin();
    $tratamento = pacote(10, 7); // saldo 3

    // ACT + ASSERT — antes
    expect(realce()->de($tratamento))->toBe(RealceDoPacote::NENHUM);

    // ACT — a clínica muda o limiar
    app(ConfiguracaoService::class)->set('tratamentos.saldo_alerta_sessoes', 4);

    // ASSERT — o MESMO tratamento, outro veredito
    expect(app(RealceDoPacote::class)->de($tratamento->fresh()))->toBe(RealceDoPacote::ACABANDO);
});

it('deve grampear limiar adulterado no banco, nos dois extremos', function () {
    /*
     * ARRANGE — clamp defensivo na LEITURA (padrão da casa, SEC-LP-16): a faixa 1..20 vale na
     * escrita do catálogo E aqui. Um valor gravado direto no banco não pode alargar o alerta
     * para a agenda inteira nem desligá-lo.
     */
    admin();
    // a linha precisa EXISTIR para ser adulterada: sem ela, o valor vem do catálogo
    app(ConfiguracaoService::class)->set('tratamentos.saldo_alerta_sessoes', 5);

    // ACT — valor absurdo, escrito por fora do catálogo
    DB::table('configuracoes')
        ->where('chave', 'tratamentos.saldo_alerta_sessoes')
        ->update(['valor' => '9999']);

    app()->forgetInstance(ConfiguracaoService::class);

    // ASSERT — grampeado no teto: o alerta não vira "a agenda inteira"
    expect(app(RealceDoPacote::class)->saldoDeAlerta())->toBe(RealceDoPacote::MAXIMO);

    // ACT — e o outro extremo. O `ConfiguracaoService` memoiza por request (design D5), e o
    // teste é UM request: sem soltar a instância, a segunda leitura devolveria o valor antigo
    // e a asserção passaria sem provar nada.
    DB::table('configuracoes')
        ->where('chave', 'tratamentos.saldo_alerta_sessoes')
        ->update(['valor' => '0']);
    app()->forgetInstance(ConfiguracaoService::class);

    // ASSERT — piso 1: o alerta não pode ser desligado por um zero no banco
    expect(app(RealceDoPacote::class)->saldoDeAlerta())->toBe(RealceDoPacote::MINIMO);
});
