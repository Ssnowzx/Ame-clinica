<?php

use App\Models\Agendamento;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Tratamento;

/** Agendamento do paciente numa data (parede da clínica), FKs livres para a factory. */
function sessaoEm(Paciente $paciente, Carbon\Carbon $quando): Agendamento
{
    return Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'inicio' => $quando->copy()->setSeconds(0),
        'fim' => $quando->copy()->setSeconds(0)->addMinutes(40),
    ]);
}

describe('resumo do paciente (ficha — Painel)', function () {
    it('deve devolver o resumo agregado: profissional, contrato, sessões', function () {
        // ARRANGE — paciente com contrato em andamento + sessões passada e futura
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $profissional = Profissional::factory()->create(['nome' => 'Profissional Fictício']);
        $tratamento = Tratamento::factory()->create([
            'paciente_id' => $paciente->id,
            'profissional_id' => $profissional->id,
            'sessoes_total' => 10,
            'status' => 'andamento',
        ]);
        $tratamento->sessoes_realizadas = 4; // server-set (não fillable)
        $tratamento->save();
        sessaoEm($paciente, agoraNaClinica()->subDays(10)->setTime(9, 0));  // primeira
        sessaoEm($paciente, agoraNaClinica()->addDays(5)->setTime(14, 0));  // próxima

        // ACT
        $resumo = $this->getJson("/api/pacientes/{$paciente->id}/resumo");

        // ASSERT
        $resumo->assertOk()
            ->assertJsonPath('profissional_atual.nome', 'Profissional Fictício')
            ->assertJsonPath('contrato.status', 'andamento')
            ->assertJsonPath('contrato.sessoes_total', 10)
            ->assertJsonPath('contrato.sessoes_realizadas', 4)
            ->assertJsonPath('contrato.sessoes_saldo', 6)
            ->assertJsonPath('primeira_sessao', agoraNaClinica()->subDays(10)->format('Y-m-d').' 09:00')
            ->assertJsonPath('proxima_sessao', agoraNaClinica()->addDays(5)->format('Y-m-d').' 14:00')
            ->assertJsonPath('sessoes_realizadas', 4);
    });

    it('deve preferir o contrato EM ANDAMENTO ao mais antigo finalizado', function () {
        // ARRANGE
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $doAndamento = Profissional::factory()->create(['nome' => 'Do Andamento']);
        Tratamento::factory()->create(['paciente_id' => $paciente->id, 'status' => 'finalizado']);
        Tratamento::factory()->create([
            'paciente_id' => $paciente->id,
            'profissional_id' => $doAndamento->id,
            'status' => 'andamento',
        ]);

        // ACT + ASSERT
        expect($this->getJson("/api/pacientes/{$paciente->id}/resumo")->json('profissional_atual.nome'))
            ->toBe('Do Andamento');
    });

    it('deve devolver nulos quando o paciente não tem contrato nem sessões', function () {
        // ARRANGE
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();

        // ACT + ASSERT
        $resumo = $this->getJson("/api/pacientes/{$paciente->id}/resumo");
        $resumo->assertOk()
            ->assertJsonPath('profissional_atual', null)
            ->assertJsonPath('contrato', null)
            ->assertJsonPath('primeira_sessao', null)
            ->assertJsonPath('proxima_sessao', null)
            ->assertJsonPath('sessoes_realizadas', 0);
    });

    it('deve minimizar: sem nome/CPF/nascimento do menor no resumo', function () {
        // ARRANGE — paciente com CPF
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create([
            'nome' => 'Menor Fictício',
            'cpf' => '39053344705',
            'nascimento' => '2018-03-01',
        ]);

        // ACT
        $resumo = $this->getJson("/api/pacientes/{$paciente->id}/resumo");

        // ASSERT — nenhuma coluna do menor atravessa o resumo
        $resumo->assertOk();
        expect($resumo->json())->not->toHaveKeys(['nome', 'cpf', 'nascimento', 'responsaveis_json']);
        semVazamento($resumo->json(), '39053344705');
        semVazamento($resumo->json(), 'Menor Fictício');
    });

    it('deve exigir pacientes.ver e não ter caminho de escrita', function () {
        // ARRANGE — usuário sem pacientes.ver
        $admin = admin();
        $paciente = Paciente::factory()->create();
        $tratamento = Tratamento::factory()->create(['paciente_id' => $paciente->id]);
        $tratamento->sessoes_realizadas = 2;
        $tratamento->save();
        $semPacientes = usuarioCom(['agenda.ver'], 'Sem Pacientes');

        // ACT + ASSERT — leitura negada sem a permissão
        $this->actingAs($semPacientes)
            ->getJson("/api/pacientes/{$paciente->id}/resumo")
            ->assertForbidden();

        // é READ: consultar não muda o estado (sessoes_realizadas intacto)
        $this->flushSession();
        $this->app['auth']->forgetGuards();
        $this->actingAs($admin)->getJson("/api/pacientes/{$paciente->id}/resumo")->assertOk();
        expect($tratamento->fresh()->sessoes_realizadas)->toBe(2);
    });
});
