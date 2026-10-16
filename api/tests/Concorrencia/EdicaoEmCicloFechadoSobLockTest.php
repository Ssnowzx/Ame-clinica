<?php

use App\Exceptions\CorridaDoCicloException;
use App\Models\Convenio;
use App\Models\Tratamento;
use App\Support\Ciclos\GuardaDeCicloFechado;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * EDIÇÃO × FECHAMENTO com duas conexões (SEC-FC-10/12) — a outra metade do que
 * `FechamentoDeCicloSobLockTest` já provou para fechamento × fechamento.
 *
 * A guarda é a FONTE ÚNICA que os cinco caminhos de escrita consomem (atendimento, evolução,
 * lançamento, agendamento e tratamento). Provar aqui que ELA serializa prova para os cinco;
 * que cada um a chama de dentro da sua transação é o que os testes de feature asseguram — o
 * de epoch (`CicloFechadoGuardaTest`) compara o epoch do `for update` no convênio com o da
 * gravação, e um caminho que a chamasse fora da transação morre no `LogicException` da
 * própria guarda.
 *
 * **Os dois testes medem coisas DIFERENTES, e faltar qualquer um deixa o TOCTOU aberto:**
 *
 * 1. **A linha do convênio BLOQUEIA** — o ponto de serialização comum existe de fato.
 * 2. **A guarda ENXERGA o fechamento comitado por outra sessão** — que é uma pergunta
 *    independente. Sob REPEATABLE READ o snapshot da transação de edição foi fixado na
 *    primeira leitura consistente dela (o `findOrFail` do controller, muito antes), e um
 *    `SELECT` comum em `fechamentos_ciclo` continuaria cego ao commit alheio MESMO depois de
 *    o lock ser adquirido. Quem fecha esse buraco é a leitura TRAVANTE.
 *
 * **Provados por MUTAÇÃO** (o aviso do engenheiro da fundação, que vale ainda mais aqui):
 * apagando o `comLockDoConvenio` da guarda, o teste 1 fica vermelho; apagando o
 * `lockForUpdate()` da consulta de `fechamentos_ciclo`, o teste 2 fica vermelho. Nenhum dos
 * dois é bloqueado por acidente pelo S-lock de FK de um INSERT, porque aqui não há INSERT: o
 * caminho sob teste só LÊ e decide.
 */
function segundaConexaoDaEdicaoEmCiclo(): string
{
    config(['database.connections.segunda_edicao_ciclo' => config('database.connections.mysql')]);
    DB::purge('segunda_edicao_ciclo');

    return 'segunda_edicao_ciclo';
}

/** Convênio com calendário + tratamento nele, COMITADOS (esta suíte não roda em transação). */
function convenioETratamentoComitados(): array
{
    $convenio = Convenio::create([
        'nome' => 'Operadora Fictícia '.fake()->unique()->word(),
        'ciclo_tipo_corte' => 'dia_fixo',
        'ciclo_dia_corte' => 15,
    ]);
    $tratamento = Tratamento::factory()->create(['convenio_id' => $convenio->id]);

    return [$convenio, $tratamento];
}

it('deve BLOQUEAR a guarda de edição enquanto um fechamento segura a linha do convênio', function () {
    // ARRANGE — dados COMMITADOS: sem isso a segunda conexão não veria nada e a prova seria
    // encenação (ver CasoDeConcorrencia)
    admin();
    [$convenio, $tratamento] = convenioETratamentoComitados();
    $segunda = segundaConexaoDaEdicaoEmCiclo();

    // a conexão do código sob teste desiste rápido — sem isto, esperaríamos 50s
    DB::statement('SET SESSION innodb_lock_wait_timeout = 2');

    // ACT — a conexão B é um fechamento no meio do caminho: linha do convênio travada,
    // transação ainda aberta (exatamente o que `comLockDoConvenio` faz do outro lado)
    DB::connection($segunda)->beginTransaction();
    DB::connection($segunda)->table('convenios')->where('id', $convenio->id)->lockForUpdate()->get();

    // ...e a conexão A entra pela GUARDA DE EDIÇÃO, dentro da transação que o caminho de
    // escrita abre. Não há período fechado nenhum: se o lock não existisse, ela passaria
    // reto e devolveria "pode editar" — que é precisamente a regressão a evitar.
    $bloqueou = false;
    $corpo = [];
    try {
        DB::transaction(function () use ($tratamento): void {
            app(GuardaDeCicloFechado::class)
                ->assegurarPorTratamento([[$tratamento->id, '2026-07-01']]);
        });
    } catch (HttpException $excecao) {
        // o 409 traduzido pela guarda: o motor recusou (1205/1213) e a recusa chegou ao
        // usuário como "recarregue e tente de novo", nunca como 500 (ver
        // `recusarCorridaDoCiclo`). Fail-closed — nada foi gravado.
        $bloqueou = $excecao->getStatusCode() === 409;
        $corpo = $excecao instanceof CorridaDoCicloException
            ? $excecao->render(request())->getData(true)
            : [];
    }

    DB::connection($segunda)->rollBack();

    // ASSERT
    expect($bloqueou)->toBeTrue(
        'A guarda de edição NÃO bloqueou com a linha do convênio travada por um fechamento '
        .'em curso: o ponto de serialização comum do SEC-FC-10 não está sendo tomado pelo '
        .'caminho de escrita, e a edição pode gravar dentro de um ciclo que acabou de fechar.'
    );

    // ...e o 409 se IDENTIFICA no corpo. O produto tem dois 409 com recuperações opostas —
    // este ("recarregue e tente de novo") e o da concorrência otimista ("seus dados estão
    // velhos"). Sem chave, o cliente teria de diferenciá-los pela string da mensagem.
    expect($corpo['erro'] ?? null)->toBe(
        CorridaDoCicloException::CHAVE,
        'O 409 da corrida do ciclo saiu sem chave no corpo: no cliente ele fica '
        .'indistinguível do 409 do `ConcorrenciaOtimista`, e as duas recuperações são opostas.'
    );
});

it('deve enxergar o fechamento comitado por OUTRA conexão depois de a edição já ter começado', function () {
    // ARRANGE — o TOCTOU inteiro, na ordem em que ele acontece em produção
    $adminDaClinica = admin();
    [$convenio, $tratamento] = convenioETratamentoComitados();
    $segunda = segundaConexaoDaEdicaoEmCiclo();

    $recusou = false;
    DB::transaction(function () use ($convenio, $tratamento, $segunda, $adminDaClinica, &$recusou): void {
        // (1) a edição começa e faz a sua primeira leitura CONSISTENTE — é ela que fixa o
        // snapshot de REPEATABLE READ da transação (num caminho real, o `findOrFail` do
        // controller). A partir daqui, todo `SELECT` comum enxerga o banco DESTE instante.
        Tratamento::findOrFail($tratamento->id);

        // (2) o faturamento fecha o período e COMITA, por outra sessão
        DB::connection($segunda)->table('fechamentos_ciclo')->insert([
            'convenio_id' => $convenio->id,
            'periodo_inicio' => '2026-06-16',
            'periodo_fim' => '2026-07-15',
            'fechado_por' => $adminDaClinica->id,
            'fechado_em' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // (3) só AGORA a edição consulta a guarda. Com `SELECT` comum ela olharia o snapshot
        // do passo (1) — um banco sem o fechamento — e devolveria SEM EXCEÇÃO NENHUMA,
        // liberando a gravação dentro de um ciclo já enviado à operadora. É essa ausência
        // silenciosa que a asserção abaixo reprova.
        //
        // Com a leitura TRAVANTE, dois desfechos são corretos e ambos fecham o TOCTOU:
        // o 422 do período fechado, ou — no MariaDB, que é o banco deste produto — o 409
        // traduzido do `ER_CHECKREAD` (1020), o motor recusando ler estado velho sob
        // `FOR UPDATE`. O que NÃO pode acontecer é passar batido.
        try {
            app(GuardaDeCicloFechado::class)
                ->assegurarPorTratamento([[$tratamento->id, '2026-07-01']]);
        } catch (ValidationException $excecao) {
            $recusou = array_key_exists(GuardaDeCicloFechado::CHAVE, $excecao->errors());
        } catch (HttpException $excecao) {
            $recusou = $excecao->getStatusCode() === 409;
        }
    });

    // ASSERT
    expect($recusou)->toBeTrue(
        'A guarda NÃO enxergou o fechamento comitado por outra sessão depois de a transação '
        .'de edição ter começado: a consulta de `fechamentos_ciclo` está lendo o SNAPSHOT de '
        .'REPEATABLE READ em vez do último estado comitado. O lock do convênio sozinho não '
        .'resolve isso — a leitura precisa ser TRAVANTE.'
    );

    // ...e o CONTROLE: fora do período fechado a guarda continua liberando. Sem ele, uma
    // guarda que recusasse tudo passaria no teste acima.
    DB::transaction(function () use ($tratamento): void {
        app(GuardaDeCicloFechado::class)
            ->assegurarPorTratamento([[$tratamento->id, '2026-07-16']]);
    });
});
