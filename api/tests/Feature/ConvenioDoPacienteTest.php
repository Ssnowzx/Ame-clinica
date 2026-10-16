<?php

use App\Models\Auditoria;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Tratamento;

/**
 * O convênio VIGENTE no cadastro do paciente (change convenio-no-cadastro-do-paciente).
 *
 * O convênio já existia — no tratamento. Esta change dá casa ao valor ATUAL, e mantém no
 * tratamento o registro do que valia quando o pacote foi vendido. Os dois PODEM divergir
 * sem que nenhum esteja errado, e é isso que a maior parte destes testes protege.
 */

/** Carrega a migration como objeto para exercitar o backfill sem reflection. */
function migrationDoConvenio(): object
{
    return require dirname(__DIR__, 2)
        .'/database/migrations/2026_08_25_130000_add_convenio_ao_cadastro_do_paciente.php';
}

/**
 * Um pacote fictício do paciente, no convênio dado.
 *
 * Nome longo de propósito: `pacoteDe()` já existe em `TratamentosListagemTest`, e função
 * global duplicada entre dois arquivos de teste é FATAL no PHP — derruba a suíte inteira,
 * não só o arquivo. É a mesma lição que o docblock de `tests/Arquitetura/Fontes.php` registra.
 */
function pacoteNoConvenio(Paciente $paciente, ?Convenio $convenio, string $status = 'andamento', ?string $matricula = null): Tratamento
{
    return Tratamento::factory()->create([
        'paciente_id' => $paciente->id,
        'profissional_id' => Profissional::factory()->create()->id,
        'especialidade_id' => Especialidade::factory()->create()->id,
        'convenio_id' => $convenio?->id,
        'matricula' => $matricula,
        'status' => $status,
        'sessoes_total' => 10,
    ]);
}

// ── Backfill derivado (D8) ──────────────────────────────────────────────────

it('deve preencher o convênio do cadastro quando todos os pacotes concordam', function () {
    /*
     * ARRANGE — a base de produção já tem centenas de crianças com tratamento. Deixar o
     * cadastro de todas vazio joga na recepção o trabalho manual que a change existe para
     * evitar; então o que é INEQUÍVOCO é derivado do histórico.
     */
    admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício A', 'particular' => false]);
    $paciente = Paciente::factory()->create();
    pacoteNoConvenio($paciente, $convenio, matricula: '111222');
    pacoteNoConvenio($paciente, $convenio, matricula: '111222');
    $paciente->update(['convenio_id' => null, 'carteirinha' => null]);

    // ACT
    migrationDoConvenio()->preencherDoHistorico();

    // ASSERT — convênio e carteirinha vêm do histórico, sem ninguém digitar
    $paciente->refresh();
    expect($paciente->convenio_id)->toBe($convenio->id)
        ->and($paciente->carteirinha)->toBe('111222');
});

it('NÃO deve adivinhar o convênio quando os pacotes divergem', function () {
    /*
     * ARRANGE — é a criança que é convênio numa especialidade e particular noutra, ou a
     * que trocou de plano no meio. Escolher um dos dois é exatamente o erro que a trava
     * SEC-IV-14 do importador evitava: preferir descartar a colar no lugar errado.
     */
    admin();
    $unimed = Convenio::create(['nome' => 'Convênio Fictício A', 'particular' => false]);
    $particular = Convenio::create(['nome' => 'Particular Fictício', 'particular' => true]);
    $paciente = Paciente::factory()->create();
    pacoteNoConvenio($paciente, $unimed, matricula: '111222');
    pacoteNoConvenio($paciente, $particular);
    $paciente->update(['convenio_id' => null, 'carteirinha' => null]);

    // ACT
    migrationDoConvenio()->preencherDoHistorico();

    // ASSERT — fica VAZIO: a recepção decide, o sistema não chuta
    $paciente->refresh();
    expect($paciente->convenio_id)->toBeNull()
        ->and($paciente->carteirinha)->toBeNull();
});

it('NÃO deve derivar convênio de paciente sem pacote nenhum', function () {
    // ARRANGE — criança recém-cadastrada, ou só de lista de espera
    admin();
    $paciente = Paciente::factory()->create();
    $paciente->update(['convenio_id' => null]);

    // ACT
    migrationDoConvenio()->preencherDoHistorico();

    // ASSERT
    expect($paciente->refresh()->convenio_id)->toBeNull();
});

it('deve ignorar pacote FINALIZADO ao derivar o convênio vigente', function () {
    /*
     * ARRANGE — pacote encerrado é histórico, não vínculo corrente. A criança fez um
     * pacote particular no ano passado e hoje é do convênio: o cadastro tem de dizer
     * convênio, não particular.
     */
    admin();
    $antigo = Convenio::create(['nome' => 'Particular Fictício', 'particular' => true]);
    $atual = Convenio::create(['nome' => 'Convênio Fictício A', 'particular' => false]);
    $paciente = Paciente::factory()->create();
    pacoteNoConvenio($paciente, $antigo, status: 'finalizado');
    pacoteNoConvenio($paciente, $atual, matricula: '333444');
    $paciente->update(['convenio_id' => null, 'carteirinha' => null]);

    // ACT
    migrationDoConvenio()->preencherDoHistorico();

    // ASSERT — só o não-finalizado conta, então não há ambiguidade
    $paciente->refresh();
    expect($paciente->convenio_id)->toBe($atual->id)
        ->and($paciente->carteirinha)->toBe('333444');
});

it('deve considerar pacote PARADO, que ainda é vínculo corrente', function () {
    /*
     * ARRANGE — tratamento suspenso não encerrou a relação com a operadora. Incluí-lo só
     * AUMENTA a chance de ambiguidade, que é a direção segura: aqui ele diverge do outro
     * pacote, e o resultado tem de ser vazio.
     */
    admin();
    $a = Convenio::create(['nome' => 'Convênio Fictício A', 'particular' => false]);
    $b = Convenio::create(['nome' => 'Convênio Fictício B', 'particular' => false]);
    $paciente = Paciente::factory()->create();
    pacoteNoConvenio($paciente, $a);
    pacoteNoConvenio($paciente, $b, status: 'parado');
    $paciente->update(['convenio_id' => null]);

    // ACT
    migrationDoConvenio()->preencherDoHistorico();

    // ASSERT
    expect($paciente->refresh()->convenio_id)->toBeNull();
});

it('NÃO deve inventar carteirinha quando o mesmo convênio traz números diferentes', function () {
    // ARRANGE — mesmo convênio, matrículas distintas: o convênio é inequívoco, o número não
    admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício A', 'particular' => false]);
    $paciente = Paciente::factory()->create();
    pacoteNoConvenio($paciente, $convenio, matricula: '111222');
    pacoteNoConvenio($paciente, $convenio, matricula: '999888');
    $paciente->update(['convenio_id' => null, 'carteirinha' => null]);

    // ACT
    migrationDoConvenio()->preencherDoHistorico();

    // ASSERT — o convênio entra, a carteirinha não
    $paciente->refresh();
    expect($paciente->convenio_id)->toBe($convenio->id)
        ->and($paciente->carteirinha)->toBeNull();
});

it('deve aproveitar a matrícula que existe quando o outro pacote não tem nenhuma', function () {
    // ARRANGE — mesmo convênio, um pacote sem matrícula (foi o que a trava SEC-IV-14 causou)
    admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício A', 'particular' => false]);
    $paciente = Paciente::factory()->create();
    pacoteNoConvenio($paciente, $convenio, matricula: '111222');
    pacoteNoConvenio($paciente, $convenio);
    $paciente->update(['convenio_id' => null, 'carteirinha' => null]);

    // ACT
    migrationDoConvenio()->preencherDoHistorico();

    // ASSERT
    expect($paciente->refresh()->carteirinha)->toBe('111222');
});

it('deve ser idempotente e NÃO sobrescrever o que a clínica já corrigiu', function () {
    /*
     * ARRANGE — a recepção corrigiu à mão o convênio de uma criança cujos pacotes ainda
     * apontam para o antigo. Rodar o backfill de novo não pode desfazer a correção.
     */
    admin();
    $doPacote = Convenio::create(['nome' => 'Convênio Fictício A', 'particular' => false]);
    $corrigido = Convenio::create(['nome' => 'Convênio Fictício B', 'particular' => false]);
    $paciente = Paciente::factory()->create();
    pacoteNoConvenio($paciente, $doPacote, matricula: '111222');
    $paciente->update(['convenio_id' => $corrigido->id, 'carteirinha' => '555666']);

    // ACT — duas execuções seguidas
    migrationDoConvenio()->preencherDoHistorico();
    migrationDoConvenio()->preencherDoHistorico();

    // ASSERT — a correção humana sobrevive
    $paciente->refresh();
    expect($paciente->convenio_id)->toBe($corrigido->id)
        ->and($paciente->carteirinha)->toBe('555666');
});

// ── Contrato do cadastro ────────────────────────────────────────────────────

it('deve aceitar paciente sem convênio, plano, carteirinha nem validade', function () {
    // ARRANGE — criança particular não tem nada disso, e o cadastro não pode exigir
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        'nome' => 'Criança Fictícia',
        'nascimento' => '2018-05-10',
        'sexo' => 'feminino',
        'necessidade' => 'sem',
        'responsaveis_json' => [['nome' => 'Responsável Fictício', 'parentesco' => 'mãe']],
        'contatos_json' => [],
    ]);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('convenio_id'))->toBeNull()
        ->and($resposta->json('carteirinha'))->toBeNull();
});

it('deve mascarar a CARTEIRINHA no diff de auditoria, como faz com o CPF', function () {
    /*
     * ARRANGE — a carteirinha identifica o menor junto à operadora, mesma classe do CPF.
     * É a política que `Tratamento` já aplica a `matricula` desde o parecer T-trat-06: o
     * dado mudou de casa nesta change, a proteção veio junto (D5).
     */
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício A', 'particular' => false]);
    $paciente = Paciente::factory()->create();

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/pacientes/{$paciente->id}", [
        'nome' => $paciente->nome,
        'nascimento' => $paciente->nascimento?->format('Y-m-d') ?? '2018-05-10',
        'sexo' => $paciente->sexo ?? 'feminino',
        'necessidade' => $paciente->necessidade ?? 'sem',
        'convenio_id' => $convenio->id,
        'carteirinha' => '9988776655',
        'responsaveis_json' => [['nome' => 'Responsável Fictício', 'parentesco' => 'mãe']],
        'contatos_json' => [],
    ])->assertOk();

    // ASSERT — a trilha registra que MUDOU, sem dizer o número
    expect($paciente->refresh()->carteirinha)->toBe('9988776655');
    $trilha = Auditoria::query()->where('entidade', 'pacientes')->get();
    expect($trilha)->not->toBeEmpty();
    semVazamento($trilha->toArray(), '9988776655');
});

it('NÃO deve trazer a carteirinha na LISTAGEM de pacientes', function () {
    /*
     * ARRANGE — a listagem é minimalista por parecer (T-pac-01) e serve para ESCOLHER uma
     * criança; para isso o nome basta. Quem precisa do número abre o cadastro.
     */
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício A', 'particular' => false]);
    $paciente = Paciente::factory()->create();
    $paciente->update(['convenio_id' => $convenio->id, 'carteirinha' => '9988776655']);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/pacientes');

    // ASSERT
    $resposta->assertOk();
    semVazamento($resposta->json(), '9988776655');
});

it('deve entregar o convênio vigente no DETALHE do cadastro', function () {
    // ARRANGE — é onde a recepção procura, sem precisar abrir tratamento nenhum
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício A', 'particular' => false]);
    $paciente = Paciente::factory()->create();
    $paciente->update([
        'convenio_id' => $convenio->id,
        'plano' => 'Plano Fictício',
        'carteirinha' => '9988776655',
        'carteirinha_validade' => '2027-12-31',
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson("/api/pacientes/{$paciente->id}");

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('convenio_id'))->toBe($convenio->id)
        ->and($resposta->json('plano'))->toBe('Plano Fictício')
        ->and($resposta->json('carteirinha'))->toBe('9988776655')
        ->and($resposta->json('carteirinha_validade'))->toBe('2027-12-31');
});

// ── O tratamento é SNAPSHOT (D2) ────────────────────────────────────────────

it('NÃO deve alterar tratamento nenhum ao trocar o convênio do cadastro', function () {
    /*
     * ARRANGE — o pacote guarda o que valia quando foi vendido. Propagar a troca do
     * cadastro apagaria a base do que já foi faturado: um pacote de junho na Unimed
     * viraria particular retroativamente, e o fechamento de ciclo passaria a mentir.
     *
     * É a mesma razão pela qual o preço de uma nota fiscal não muda quando a tabela de
     * preços muda.
     */
    $adminDaClinica = admin();
    $antigo = Convenio::create(['nome' => 'Convênio Fictício A', 'particular' => false]);
    $novo = Convenio::create(['nome' => 'Convênio Fictício B', 'particular' => false]);
    $paciente = Paciente::factory()->create();
    $paciente->update(['convenio_id' => $antigo->id, 'carteirinha' => '111222']);
    $pacote = pacoteNoConvenio($paciente, $antigo, matricula: '111222');

    // ACT — a família troca de plano, e a recepção corrige o CADASTRO
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/pacientes/{$paciente->id}", [
        'nome' => $paciente->nome,
        'nascimento' => $paciente->nascimento?->format('Y-m-d') ?? '2018-05-10',
        'sexo' => $paciente->sexo ?? 'feminino',
        'necessidade' => $paciente->necessidade ?? 'sem',
        'convenio_id' => $novo->id,
        'carteirinha' => '999888',
        'responsaveis_json' => [['nome' => 'Responsável Fictício', 'parentesco' => 'mãe']],
        'contatos_json' => [],
    ])->assertOk();

    // ASSERT — o cadastro mudou, o pacote NÃO
    expect($paciente->refresh()->convenio_id)->toBe($novo->id)
        ->and($paciente->carteirinha)->toBe('999888');
    $pacote->refresh();
    expect($pacote->convenio_id)->toBe($antigo->id)
        ->and($pacote->matricula)->toBe('111222');
});

it('deve deixar conviverem tratamentos com convênios DIFERENTES do cadastro', function () {
    // ARRANGE — a criança é convênio numa especialidade e particular noutra
    admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício A', 'particular' => false]);
    $particular = Convenio::create(['nome' => 'Particular Fictício', 'particular' => true]);
    $paciente = Paciente::factory()->create();
    $paciente->update(['convenio_id' => $convenio->id]);

    // ACT
    $noConvenio = pacoteNoConvenio($paciente, $convenio);
    $noParticular = pacoteNoConvenio($paciente, $particular);

    // ASSERT — nenhuma recusa, nenhum alinhamento forçado
    expect($noConvenio->refresh()->convenio_id)->toBe($convenio->id)
        ->and($noParticular->refresh()->convenio_id)->toBe($particular->id)
        ->and($paciente->refresh()->convenio_id)->toBe($convenio->id);
});
