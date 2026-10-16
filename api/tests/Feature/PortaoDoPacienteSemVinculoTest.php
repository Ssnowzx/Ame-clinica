<?php

use App\Models\Paciente;
use App\Models\Usuario;

/**
 * O estado FAIL-CLOSED do portão por-id: papel SEM `ver_todos` e usuário SEM vínculo
 * profissional ⇒ `Escopo::nenhum()` ⇒ 403 em toda leitura por-id de dado clínico de MENOR.
 *
 * Por que este arquivo existe (achado da rodada 3 do gate de `conflito-do-paciente`):
 * `EscopoDoProfissional::assegurarPaciente` tem 7 chamadores e o estado `nenhum` **não era
 * exercitado por nenhum deles**. O revisor mutou o portão para fail-open nesse estado e a suíte
 * inteira ficou VERDE — um usuário com as permissões de leitura, sem `ver_todos` e sem vínculo,
 * passaria a ler anamnese, presença, comparecimento e resumo de QUALQUER criança da clínica, e
 * nada acusaria. O comportamento estava (e está) correto; o que faltava era a rede.
 *
 * A change que motivou a rede não foi a que criou o portão — foi a que o promoveu a API pública
 * com dois consumidores (`enxergaPaciente`). O próprio docblock da fonte única diz que "cópia do
 * branching é onde o fail-closed decai para fail-open num refactor": esta é a guarda por trás
 * daquela frase.
 *
 * Dados 100% fictícios (LGPD art. 11).
 */

/** Usuário com as leituras por-id, SEM `ver_todos` em nenhum eixo e SEM `profissional_id`. */
function semVinculoNemVerTodos(): Usuario
{
    return usuarioCom(
        ['agenda.ver', 'pacientes.ver', 'anamneses.ver', 'atendimentos.ver', 'evolucoes.ver'],
        'Sem vínculo',
    );
}

it('deve responder 403 nas leituras por-id do EIXO AGENDA para quem não tem vínculo', function () {
    // ARRANGE
    admin();
    $crianca = Paciente::factory()->create();
    $semVinculo = semVinculoNemVerTodos();
    expect($semVinculo->profissional_id)->toBeNull();

    // ACT + ASSERT
    // o resumo da ficha é do eixo AGENDA desde a rodada 4 de `vinculo-previo-para-agendar` (`SEC-VP-52`)
    foreach (["/api/pacientes/{$crianca->id}/comparecimento-recente", "/api/pacientes/{$crianca->id}/presenca", "/api/pacientes/{$crianca->id}/resumo"] as $rota) {
        $this->actingAs($semVinculo)->getJson($rota)->assertForbidden();
    }
});

it('deve responder 403 nas leituras por-id do EIXO CLÍNICO para quem não tem vínculo', function () {
    // ARRANGE
    admin();
    $crianca = Paciente::factory()->create();
    $semVinculo = semVinculoNemVerTodos();

    // ACT + ASSERT — a listagem de anamneses da criança (o resumo migrou para o eixo agenda)
    $this->actingAs($semVinculo)->getJson("/api/pacientes/{$crianca->id}/anamneses")->assertForbidden();
});
