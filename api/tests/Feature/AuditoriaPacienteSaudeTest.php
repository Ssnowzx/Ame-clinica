<?php

use App\Models\Paciente;

/**
 * Payload mínimo de paciente menor VÁLIDO — local a esta suite (helpers definidos
 * dentro de um `*Test.php` só existem quando aquela suite roda; ver Pest.php).
 *
 * @return array<string, mixed>
 */
function pacienteMenorParaAuditoria(): array
{
    return [
        'nome' => 'Paciente Fictício Menor',
        'sexo' => 'feminino',
        'responsaveis_json' => [
            ['nome' => 'Responsável Fictícia', 'parentesco' => 'mãe', 'telefone' => '48999990000'],
        ],
    ];
}

/**
 * GUARDA MECÂNICA do gatilho AUDIT-PACIENTE-SAUDE (parecer SEC-APS-01).
 *
 * A trilha de auditoria de `pacientes` NÃO pode expor em claro `necessidade` (dado de
 * saúde de MENOR — LGPD art. 11) nem `nascimento` (data de nascimento de menor). O
 * mascaramento é write-time (`Paciente::$auditExclude`), mas estes testes afirmam sobre a
 * RESPOSTA FINAL de `GET /api/auditoria` — o PRODUTO das camadas write-time + Resource
 * (lição SEC-TR-18). Por isso também protegem o boundary do resolvedor (SEC-APS-04): se um
 * `ResolvedorDeValores` futuro for estendido a `pacientes` e ressuscitar o valor mascarado,
 * estes testes ficam vermelhos.
 *
 * Cobre as DUAS ações que carregam os campos (SEC-APS-02): `criou` (o cadastro despeja
 * todas as colunas — é a via real onde `necessidade` é preenchida) e `atualizou`. `excluiu`
 * fica dispensado enquanto `Paciente` não tiver exclusão física/soft-delete.
 */
it('deve mascarar necessidade e nascimento na trilha de pacientes — CRIAÇÃO (SEC-APS-02)', function () {
    // ARRANGE
    $admin = admin();
    $nascimento = '2015-03-10'; // data fictícia distinta, fácil de rastrear no corpo

    // ACT — criação via rota real: o evento `criou` despeja TODAS as colunas do paciente
    $criar = $this->actingAs($admin)->postJson('/api/pacientes', [
        ...pacienteMenorParaAuditoria(),
        'necessidade' => 'necessidades_especiais',
        'nascimento' => $nascimento,
    ])->assertCreated();
    $id = $criar->json('id');

    // ASSERT — a trilha do paciente não revela nenhum dos dois em claro
    $resposta = $this->actingAs($admin)
        ->getJson("/api/auditoria?entidade=pacientes&entidade_id={$id}")
        ->assertOk();

    // corpo inteiro: o valor sensível e a data crua NÃO aparecem em lugar nenhum
    expect($resposta->getContent())
        ->not->toContain('necessidades_especiais')
        ->not->toContain($nascimento);

    // e a linha de criação EXISTE e traz os dois campos mascarados (prova que o campo é
    // auditado — não um falso-verde por ausência de trilha)
    $criou = collect($resposta->json('data'))->firstWhere('acao', 'criou');
    expect($criou)->not->toBeNull();
    $alteracoes = collect($criou['alteracoes'])->keyBy('campo');
    expect($alteracoes['Necessidade']['para'])->toBe('***')
        ->and($alteracoes['Nascimento']['para'])->toBe('***');
});

it('deve mascarar necessidade e nascimento na trilha de pacientes — EDIÇÃO (SEC-APS-02)', function () {
    // ARRANGE — paciente criado sem necessidade especial
    $admin = admin();
    $criar = $this->actingAs($admin)->postJson('/api/pacientes', [
        ...pacienteMenorParaAuditoria(),
        'necessidade' => 'sem',
        'nascimento' => '2016-01-01',
    ])->assertCreated();
    $id = $criar->json('id');
    $novoNascimento = '2014-08-22';

    // ACT — troca de necessidade (sem → necessidades_especiais) e de nascimento
    $this->actingAs($admin)->putJsonComVersao("/api/pacientes/{$id}", [
        ...pacienteMenorParaAuditoria(),
        'necessidade' => 'necessidades_especiais',
        'nascimento' => $novoNascimento,
    ])->assertOk();

    // ASSERT
    $resposta = $this->actingAs($admin)
        ->getJson("/api/auditoria?entidade=pacientes&entidade_id={$id}")
        ->assertOk();

    // nem o valor novo, nem o antigo, nem as datas aparecem em claro no corpo
    expect($resposta->getContent())
        ->not->toContain('necessidades_especiais')
        ->not->toContain('2016-01-01')
        ->not->toContain($novoNascimento);

    // a linha de alteração traz os dois campos mascarados dos DOIS lados (de/para)
    $atualizou = collect($resposta->json('data'))->firstWhere('acao', 'atualizou');
    expect($atualizou)->not->toBeNull();
    $alteracoes = collect($atualizou['alteracoes'])->keyBy('campo');
    expect($alteracoes['Necessidade']['de'])->toBe('***')
        ->and($alteracoes['Necessidade']['para'])->toBe('***')
        ->and($alteracoes['Nascimento']['de'])->toBe('***')
        ->and($alteracoes['Nascimento']['para'])->toBe('***');
});

it('deve manter necessidade e nascimento na lista de campos mascarados do Paciente', function () {
    // ARRANGE + ACT — asserção estrutural documental: remover qualquer um dos dois
    // reabre a exposição (a guarda behavioral acima é quem pega o efeito).
    $excluidos = (new Paciente)->camposAuditaveisExcluidos();

    // ASSERT
    expect($excluidos)->toContain('necessidade')->toContain('nascimento');
});
