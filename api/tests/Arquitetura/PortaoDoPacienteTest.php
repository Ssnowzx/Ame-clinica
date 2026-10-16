<?php

use Tests\Arquitetura\Fontes;

/**
 * GUARDA DE IDIOMA — quem protege leitura de dado clínico de MENOR usa a API que ABORTA.
 *
 * `EscopoDoProfissional` expõe três irmãs sobre o mesmo branching:
 *   - `assegurarPaciente()` → 403. É a que protege anamnese, presença, comparecimento e resumo.
 *   - `restringirAosPacientesDoEscopo()` → filtra a LISTA em silêncio. É a versão em consulta do
 *     predicado, para catálogos (a seleção da agenda, `SEC-VP-36`; a fila do auto-cadastro); um
 *     controller que a use para
 *     resolver UM id (`->whereKey($id)->firstOrFail()`) devolveria 404 calado onde a leitura por-id
 *     exige 403 — por isso ela entra na mesma cerca (re-review da rodada 4, CR4b-05).
 *   - `enxergaPaciente()`   → `false` em SILÊNCIO. Existe para DOIS casos, nomeados: o eixo
 *     PACIENTE do conflito da agenda, onde recusar seria oráculo (change `conflito-do-paciente`,
 *     D8), e a SELEÇÃO de pacientes/pacotes do formulário da agenda (`SEC-VP-36`, rodada 4 de
 *     `vinculo-previo-para-agendar`), que é catálogo: criança fora do escopo simplesmente não
 *     aparece — um 403 ali seria o mesmo oráculo com outra roupa (`SEC-CP-01`).
 *
 * O risco que esta guarda cobre nasceu quando o predicado virou público (rodada 3 do gate): um
 * controller novo pode escolher a irmã errada e transformar um 403 em "passa calado", sem erro,
 * sem log e com a suíte verde. É o modo exato como `SEC-VP-03` descreve o fail-closed decaindo.
 *
 * Camada de TEXTO, complementar ao `PortaoDoPacienteSemVinculoTest` (runtime): esta pega o
 * chamador NOVO, aquela prova o comportamento dos que já existem.
 */
it('deve manter o predicado silencioso do portão fora dos controllers', function () {
    // ARRANGE — os consumidores legítimos: o eixo do conflito (Support/Agenda) e a seleção da
    // agenda, que é catálogo e cala por desenho (`SEC-VP-36`). Toda leitura POR ID continua
    // obrigada a `assegurarPaciente()`.
    $permitidos = [
        'Support/Rbac/EscopoDoProfissional.php',
        'Support/Agenda/AgendamentoService.php',
        'Http/Controllers/AgendaSelecaoController.php',
        // a FILA do auto-cadastro (change cadastro-online-do-paciente): o bloco de candidatos
        // parecidos é LISTA filtrada, não leitura por id — a criança de um colega simplesmente
        // não aparece entre os candidatos, e um 403 ali seria absurdo (quem confere não pediu
        // aquela criança; pediu a fila). A leitura POR ID do paciente continua obrigada a
        // `assegurarPaciente`, e este controller não faz nenhuma.
        'Http/Controllers/FilaDeCadastroController.php',
        // o relatório de PACIENTES (change area-de-relatorios): é LISTA, como a seleção da agenda
        // e a fila do auto-cadastro — a criança fora do escopo não aparece na relação, e um 403
        // ali seria absurdo (quem gera o relatório não pediu aquela criança; pediu a lista).
        // Conferido: o arquivo não faz nenhuma leitura POR ID de paciente (os `paciente_id` que
        // ele cita são comparações de coluna em subconsulta). Leitura por id continua obrigada a
        // `assegurarPaciente()` — inclusive no `extrato-do-paciente`, que NÃO usa o predicado
        // silencioso.
        'Support/Relatorios/Pacientes.php',
        // "este número também está no cadastro de…" (change telefone-que-chega-no-whatsapp, gate r1
        // SEC-TEL-03): é LISTA, como a fila do auto-cadastro — a criança de um colega simplesmente
        // não aparece, e o `total` sai da mesma consulta. Um 403 ali seria o oráculo que a lista
        // filtrada evita (quem digita o número não pediu aquela criança). O controller não faz
        // leitura POR ID de paciente: o `ignorar_paciente_id` só tira um id da busca.
        'Http/Controllers/TelefoneEmUsoController.php',
    ];

    // ACT
    $infratores = collect(Fontes::doApp($permitidos))
        ->filter(fn (string $fonte) => str_contains($fonte, 'enxergaPaciente(')
            || str_contains($fonte, 'restringirAosPacientesDoEscopo('))
        ->keys()->all();

    // ASSERT
    expect($infratores)->toBe(
        [],
        'Leitura por-id de paciente se protege com assegurarPaciente() (403). '
        .'enxergaPaciente() e restringirAosPacientesDoEscopo() calam em vez de recusar: só o eixo do '
        .'conflito e a seleção da agenda (catálogo) podem usá-los.'
    );
});
