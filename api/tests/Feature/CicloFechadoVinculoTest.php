<?php

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Tratamento;
use Illuminate\Support\Str;

/**
 * O VÍNCULO com o convênio também congela (D4b · SEC-FC-13 e SEC-FC-14) — os dois
 * bloqueantes sem os quais o SEC-TE-01 **não** pode ser marcado como fechado.
 *
 * Travar o `finalizado_em` do atendimento protege a DATA e deixa o VÍNCULO livre. E o
 * convênio de um atendimento não mora nele: mora em `agendamentos.tratamento_id` — editável
 * sob `agenda.editar`, permissão bem mais distribuída que `atendimentos.editar` — e em
 * `tratamentos.convenio_id`. Basta apontar o agendamento para outro tratamento (ou anular o
 * vínculo, e o registro cair no fail-open do D5 como "fora de todo ciclo") para a produção
 * congelada sair do ciclo sem reabrir nada. O contorno sobreviveria por uma porta que o
 * desenho original nem olhava.
 *
 * Cada teste aqui tem o seu CONTROLE (o caso sem período fechado segue editável): sem ele,
 * uma guarda que recusasse toda troca de vínculo passaria em todas as recusas e teria
 * quebrado a operação da recepção em silêncio.
 */

/** O PUT do agendamento exige `inicio` e `profissional_id`; o resto é parcial. */
function putDoAgendamentoNoCiclo(Agendamento $agendamento, array $extra = []): array
{
    return [
        'inicio' => $agendamento->inicio->format('Y-m-d H:i'),
        'profissional_id' => $agendamento->profissional_id,
        ...$extra,
    ];
}

/** Outro pacote do MESMO paciente/especialidade — coerente para o `validarDominio`. */
function tratamentoIrmaoEm(Agendamento $agendamento, ?Convenio $convenio = null): Tratamento
{
    return Tratamento::factory()->create([
        'convenio_id' => ($convenio ?? Convenio::create([
            'nome' => 'Operadora Fictícia '.fake()->unique()->word(),
        ]))->id,
        'paciente_id' => $agendamento->paciente_id,
        'especialidade_id' => $agendamento->especialidade_id,
        'profissional_id' => $agendamento->profissional_id,
    ]);
}

// ==================== 3.5 · SEC-FC-13 (agendamentos.tratamento_id) ====================

it('deve recusar apontar o agendamento para tratamento de OUTRO convênio com atendimento em ciclo fechado', function () {
    // ARRANGE — a porta do lado do SEC-TE-01: com `agenda.editar` o registro mudaria de
    // convênio e a produção congelada sairia do ciclo enviado
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $destino = tratamentoIrmaoEm($cena['agendamento']); // convênio novo, sem ciclo algum

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        putDoAgendamentoNoCiclo($cena['agendamento'], ['tratamento_id' => $destino->id]),
    );

    // ASSERT — o vínculo permanece
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($cena['agendamento']->fresh()->tratamento_id)->toBe($cena['tratamento']->id);
});

it('deve recusar ANULAR o tratamento do agendamento com atendimento em ciclo fechado', function () {
    // ARRANGE — SEC-FC-16: o fail-open do D5 vale como AUSÊNCIA de vínculo, JAMAIS como
    // REMOÇÃO. Sem esta recusa, apagar o vínculo seria o jeito mais barato de destravar
    // tudo — o registro simplesmente deixaria de alcançar convênio algum.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        putDoAgendamentoNoCiclo($cena['agendamento'], ['tratamento_id' => null]),
    );

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($cena['agendamento']->fresh()->tratamento_id)->toBe($cena['tratamento']->id);
});

it('deve recusar apontar o agendamento para tratamento de outro convênio TAMBÉM fechado', function () {
    // ARRANGE — aqui a ORIGEM está aberta e só o DESTINO está fechado: é a metade da dupla
    // verificação que uma guarda "só origem" perderia, sujando um ciclo já enviado com
    // produção que não estava nele.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo(); // convênio da origem: SEM fechamento

    $convenioFechado = Convenio::create([
        'nome' => 'Operadora Fictícia '.fake()->unique()->word(),
        'ciclo_tipo_corte' => 'dia_fixo',
        'ciclo_dia_corte' => 15,
    ]);
    fecharJanelaDeJulho($convenioFechado, $adminDaClinica);
    $destino = tratamentoIrmaoEm($cena['agendamento'], $convenioFechado);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        putDoAgendamentoNoCiclo($cena['agendamento'], ['tratamento_id' => $destino->id]),
    );

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($cena['agendamento']->fresh()->tratamento_id)->toBe($cena['tratamento']->id);
});

it('deve manter o vínculo do agendamento editável quando não há período fechado', function () {
    // ARRANGE — o CONTROLE. Trocar o pacote de um agendamento é operação corriqueira da
    // recepção; congelá-la sempre seria trocar um buraco por uma paralisia.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo(); // nenhum fechamento
    $destino = tratamentoIrmaoEm($cena['agendamento']);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        putDoAgendamentoNoCiclo($cena['agendamento'], ['tratamento_id' => $destino->id]),
    );

    // ASSERT
    $resposta->assertOk();
    expect($cena['agendamento']->fresh()->tratamento_id)->toBe($destino->id);
});

it('deve aceitar editar o agendamento em ciclo fechado quando o vínculo NÃO muda', function () {
    // ARRANGE — a guarda congela o VÍNCULO, não o agendamento inteiro (a agenda não é
    // produção faturada — Non-Goal explícito do design). Reenviar o mesmo `tratamento_id`,
    // que é o que um PUT completo faz a cada salvamento, não pode virar 422.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        putDoAgendamentoNoCiclo($cena['agendamento'], [
            'tratamento_id' => $cena['tratamento']->id,
            'obs' => 'Observação fictícia da recepção.',
        ]),
    );

    // ASSERT
    $resposta->assertOk();
});

// ============ 3.5b · SEC-FC-13 no ramo de SÉRIE (aplicar_na_serie) ============

/**
 * Grupo de recorrência de DUAS ocorrências sobre a cena do ciclo:
 *
 * - a **clicada** (24/06, sem atendimento) — é ela que o PUT edita;
 * - a **irmã futura**, que é o agendamento da própria cena: tem atendimento finalizado em
 *   01/07, DENTRO da janela 16/06–15/07 que os testes fecham.
 *
 * O arranjo é de propósito assim: quem está congelada é a irmã, não a clicada. No ramo de
 * série "futuro" é relativo ao agendamento CLICADO e não a hoje — ocorrências já ATENDIDAS
 * entram no lote —, e é exatamente esse o raio de dano: uma requisição, N prontuários.
 *
 * @param  array{convenio: Convenio, tratamento: Tratamento, agendamento: Agendamento, atendimento: mixed}  $cena
 * @return array{0: Agendamento, 1: Agendamento} [clicada, irmã atendida]
 */
function serieComIrmaAtendidaEmCiclo(array $cena): array
{
    $grupo = (string) Str::uuid();
    $irma = $cena['agendamento'];

    $clicada = Agendamento::factory()->create([
        'paciente_id' => $irma->paciente_id,
        'especialidade_id' => $irma->especialidade_id,
        'profissional_id' => $irma->profissional_id,
        'status_id' => $irma->status_id,
    ]);
    // forceFill: a série é o ESTADO, não o caminho que levou até ele (idiom do `cenaDeCiclo`)
    $clicada->forceFill([
        'tratamento_id' => $cena['tratamento']->id,
        'recorrencia_grupo_id' => $grupo,
        'inicio' => '2026-06-24 10:00', // quarta, como a irmã — profissional sem restrição de dias
        'fim' => '2026-06-24 10:40',
    ])->save();

    $irma->forceFill([
        'recorrencia_grupo_id' => $grupo,
        'inicio' => '2026-07-01 10:00',
        'fim' => '2026-07-01 10:40',
    ])->save();

    return [$clicada->refresh(), $irma->refresh()];
}

it('deve recusar re-vincular a SÉRIE quando uma irmã tem atendimento em ciclo fechado', function () {
    // ARRANGE — a metade EM LOTE do SEC-FC-13. As irmãs são gravadas por `$futuro->update()`,
    // que não passa por `resolverAtributos` nem por `validarDominio`: sem a guarda dentro da
    // transação, um PUT com `aplicar_na_serie` re-parentearia N prontuários de uma vez, e a
    // produção congelada da irmã sairia do ciclo enviado sem reabrir nada. O ramo individual
    // (os testes acima) não prova isto — são caminhos diferentes no mesmo serviço.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    [$clicada, $irma] = serieComIrmaAtendidaEmCiclo($cena);
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $destino = tratamentoIrmaoEm($clicada); // convênio novo, sem ciclo algum

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$clicada->id}",
        putDoAgendamentoNoCiclo($clicada, [
            'tratamento_id' => $destino->id,
            'aplicar_na_serie' => 1,
        ]),
    );

    // ASSERT — tudo-ou-nada: NENHUMA irmã é re-vinculada, nem a clicada (que sozinha estaria
    // livre — ela não tem atendimento nenhum). É a transação inteira desfazendo.
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($clicada->fresh()->tratamento_id)->toBe($cena['tratamento']->id);
    expect($irma->fresh()->tratamento_id)->toBe($cena['tratamento']->id);
});

it('deve re-vincular a série inteira quando não há período fechado', function () {
    // ARRANGE — o CONTROLE do ramo de série. Sem ele, uma guarda que recusasse TODO
    // `aplicar_na_serie` com `tratamento_id` passaria no teste acima e quebraria em silêncio
    // a operação de remarcar um pacote para a série inteira.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo(); // nenhum fechamento
    [$clicada, $irma] = serieComIrmaAtendidaEmCiclo($cena);
    $destino = tratamentoIrmaoEm($clicada);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$clicada->id}",
        putDoAgendamentoNoCiclo($clicada, [
            'tratamento_id' => $destino->id,
            'aplicar_na_serie' => 1,
        ]),
    );

    // ASSERT — as duas seguem o vínculo novo
    $resposta->assertOk();
    expect($clicada->fresh()->tratamento_id)->toBe($destino->id);
    expect($irma->fresh()->tratamento_id)->toBe($destino->id);
});

// ==================== 3.6 · SEC-FC-14 (tratamentos.convenio_id) ====================

it('deve recusar trocar o convênio do tratamento com atendimento em ciclo fechado, mesmo com status que não desconta sessão', function () {
    // ARRANGE — o caso EXATO que a cerca atual não cobre. Ela condiciona a recusa a
    // `sessoes_realizadas > 0` **ou** lançamento no caixa, e para tratamento DE CONVÊNIO a
    // segunda condição é estruturalmente falsa: produção de convênio não cai no caixa (§14).
    // Com um status que não desconta sessão, as DUAS falham — e o convênio trocaria.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // as duas condições da cerca antiga estão FALSAS: nada consumido, nada no caixa
    expect($cena['tratamento']->sessoes_realizadas)->toBe(0);
    expect($cena['agendamento']->status->desconta_sessao)->toBeFalse();

    $outroConvenio = Convenio::create(['nome' => 'Operadora Fictícia '.fake()->unique()->word()]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/tratamentos/{$cena['tratamento']->id}",
        [
            'paciente_id' => $cena['tratamento']->paciente_id,
            'convenio_id' => $outroConvenio->id,
            'especialidade_id' => $cena['tratamento']->especialidade_id,
            'profissional_id' => $cena['tratamento']->profissional_id,
            'sessoes_total' => $cena['tratamento']->sessoes_total,
        ],
    );

    // ASSERT — a recusa é da guarda de CICLO (`ciclo_fechado`), não da cerca de identidade
    // (`convenio_id`): é a prova de que foi a guarda nova que pegou o caso
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($cena['tratamento']->fresh()->convenio_id)->toBe($cena['convenio']->id);
});

it('deve recusar trocar o convênio do tratamento para outro convênio TAMBÉM fechado', function () {
    // ARRANGE — a metade "destino" da dupla verificação, no tratamento
    $adminDaClinica = admin();
    $cena = cenaDeCiclo(); // origem SEM fechamento

    $convenioFechado = Convenio::create([
        'nome' => 'Operadora Fictícia '.fake()->unique()->word(),
        'ciclo_tipo_corte' => 'dia_fixo',
        'ciclo_dia_corte' => 15,
    ]);
    fecharJanelaDeJulho($convenioFechado, $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/tratamentos/{$cena['tratamento']->id}",
        [
            'paciente_id' => $cena['tratamento']->paciente_id,
            'convenio_id' => $convenioFechado->id,
            'especialidade_id' => $cena['tratamento']->especialidade_id,
            'profissional_id' => $cena['tratamento']->profissional_id,
            'sessoes_total' => $cena['tratamento']->sessoes_total,
        ],
    );

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($cena['tratamento']->fresh()->convenio_id)->toBe($cena['convenio']->id);
});

it('deve manter o convênio do tratamento editável sem produção congelada', function () {
    // ARRANGE — o CONTROLE: as regras de identidade existentes seguem decidindo, sem mudança
    $adminDaClinica = admin();
    $cena = cenaDeCiclo(); // nenhum fechamento
    $outroConvenio = Convenio::create(['nome' => 'Operadora Fictícia '.fake()->unique()->word()]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/tratamentos/{$cena['tratamento']->id}",
        [
            'paciente_id' => $cena['tratamento']->paciente_id,
            'convenio_id' => $outroConvenio->id,
            'especialidade_id' => $cena['tratamento']->especialidade_id,
            'profissional_id' => $cena['tratamento']->profissional_id,
            'sessoes_total' => $cena['tratamento']->sessoes_total,
        ],
    );

    // ASSERT
    $resposta->assertOk();
    expect($cena['tratamento']->fresh()->convenio_id)->toBe($outroConvenio->id);
});
