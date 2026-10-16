<?php

use App\Models\Auditoria;
use App\Models\Convenio;
use App\Models\Medico;
use App\Models\Usuario;
use Illuminate\Support\Facades\Schema;

it('deve criar, listar, atualizar e excluir médico solicitante', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/medicos', [
        'nome' => 'Dra. Fictícia Exemplo',
        'conselho' => 'CRM',
        'uf_conselho' => 'SC',
        'num_conselho' => '12345',
    ]);
    $criar->assertCreated()->assertJsonPath('conselho', 'CRM');
    $id = $criar->json('id');

    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/medicos/{$id}", [
        'nome' => 'Dra. Fictícia Exemplo Atualizada',
        'conselho' => 'CRM',
        'uf_conselho' => 'SC',
        'num_conselho' => '12345',
    ])->assertOk();

    $this->actingAs($adminDaClinica)->deleteJson("/api/medicos/{$id}")->assertNoContent();
    expect(Medico::count())->toBe(0);
});

it('deve rejeitar registro de conselho duplicado', function () {
    // ARRANGE
    $adminDaClinica = admin();
    Medico::create([
        'nome' => 'Dr. Um', 'conselho' => 'CRM', 'uf_conselho' => 'SC', 'num_conselho' => '111',
    ]);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/medicos', [
        'nome' => 'Dr. Dois', 'conselho' => 'CRM', 'uf_conselho' => 'SC', 'num_conselho' => '111',
    ])->assertUnprocessable()->assertJsonValidationErrors('num_conselho');
});

it('deve validar a uf do conselho', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/medicos', [
        'nome' => 'Dr. X', 'conselho' => 'CRM', 'uf_conselho' => 'XX', 'num_conselho' => '1',
    ])->assertUnprocessable()->assertJsonValidationErrors('uf_conselho');
});

it('deve rejeitar convênio inexistente no mapa de operadoras', function () {
    // ARRANGE — abuse case 7
    $adminDaClinica = admin();
    $inexistente = 999999;

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/medicos', [
        'nome' => 'Dr. X',
        'conselho' => 'CRM',
        'uf_conselho' => 'SC',
        'num_conselho' => '999',
        'codigos_operadora_json' => [(string) $inexistente => 'COD-1'],
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('codigos_operadora_json');
    expect(Medico::count())->toBe(0);
});

it('deve aceitar mapa de operadoras com convênios da clínica', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Particular']);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/medicos', [
        'nome' => 'Dra. Y',
        'conselho' => 'CRM',
        'uf_conselho' => 'SC',
        'num_conselho' => '777',
        'codigos_operadora_json' => [(string) $convenio->id => 'OP-42'],
    ]);

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('codigos_operadora_json'))->toBe([(string) $convenio->id => 'OP-42']);
});

it('deve não aceitar nem persistir cpf de médico', function () {
    // ARRANGE — minimização LGPD (design D7)
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/medicos', [
        'nome' => 'Dr. Z', 'conselho' => 'CRM', 'uf_conselho' => 'SC', 'num_conselho' => '555',
        'cpf' => '000.000.000-00',
    ]);

    // ASSERT — campo ignorado; coluna nem existe
    $resposta->assertCreated();
    expect($resposta->json())->not->toHaveKey('cpf')
        ->and(Schema::hasColumn('medicos', 'cpf'))->toBeFalse();
});

it('deve auditar mutações de médicos', function () {
    // ARRANGE — médico é dado pessoal (parecer §1): trilha obrigatória
    $adminDaClinica = admin();

    // ACT
    $this->actingAs($adminDaClinica)->postJson('/api/medicos', [
        'nome' => 'Dra. Auditada', 'conselho' => 'CRM', 'uf_conselho' => 'SC', 'num_conselho' => '888',
    ])->assertCreated();

    // ASSERT
    $registro = Auditoria::where('entidade', 'medicos')->where('acao', 'criou')->firstOrFail();
    expect($registro->usuario_id)->toBe($adminDaClinica->id);
});

it('deve responder 403 sem permissão', function () {
    // ARRANGE
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)->getJson('/api/medicos')->assertForbidden();
});
