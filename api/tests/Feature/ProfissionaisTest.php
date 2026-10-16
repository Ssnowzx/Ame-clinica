<?php

use App\Models\Auditoria;
use App\Models\Especialidade;
use App\Models\Profissional;
use App\Models\Usuario;
use Illuminate\Support\Facades\DB;

it('deve criar, listar, atualizar e excluir profissional', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT — criar com horários por dia (turno partido na terça)
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/profissionais', [
        'nome' => 'Terapeuta Fictícia',
        'horarios' => [
            2 => [['inicio' => '09:00', 'fim' => '12:00'], ['inicio' => '16:00', 'fim' => '19:00']],
            4 => [['inicio' => '08:00', 'fim' => '18:00']],
        ],
    ]);
    $criar->assertCreated()
        ->assertJsonPath('nome', 'Terapeuta Fictícia')
        ->assertJsonPath('horarios.2', [['inicio' => '09:00', 'fim' => '12:00'], ['inicio' => '16:00', 'fim' => '19:00']]);
    $id = $criar->json('id');

    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/profissionais/{$id}", [
        'nome' => 'Terapeuta Fictícia Sênior',
    ])->assertOk()->assertJsonPath('nome', 'Terapeuta Fictícia Sênior');

    $this->actingAs($adminDaClinica)->deleteJson("/api/profissionais/{$id}")->assertNoContent();
    expect(Profissional::count())->toBe(0);
});

it('deve sincronizar especialidades do profissional e auditar a mudança', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $aba = Especialidade::factory()->create(['nome' => 'Terapia ABA']);
    $fono = Especialidade::factory()->create(['nome' => 'Fonoaudiologia']);
    $profissional = Profissional::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/profissionais/{$profissional->id}", [
        'nome' => $profissional->nome,
        'especialidades' => [$aba->id, $fono->id],
    ]);

    // ASSERT
    $resposta->assertOk();
    expect(collect($resposta->json('especialidades'))->pluck('id')->sort()->values()->all())
        ->toBe([$aba->id, $fono->id]);

    $registro = Auditoria::where('acao', 'alterou_especialidades')
        ->where('entidade_id', $profissional->id)->firstOrFail();
    expect($registro->diff_json['depois']['especialidades'])->toBe([$aba->id, $fono->id]);
});

it('deve rejeitar especialidade inexistente no profissional', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/profissionais', [
        'nome' => 'Profissional Fictícia',
        'especialidades' => [999999],
    ])->assertUnprocessable()->assertJsonValidationErrors('especialidades.0');
    expect(Profissional::count())->toBe(0);
});

it('deve bloquear exclusão de especialidade vinculada a profissional', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $especialidade = Especialidade::factory()->create();
    $profissional = Profissional::factory()->create();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/profissionais/{$profissional->id}", [
        'nome' => $profissional->nome,
        'especialidades' => [$especialidade->id],
    ])->assertOk();

    // ACT + ASSERT — restrict no pivot vira 422
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/especialidades/{$especialidade->id}")
        ->assertUnprocessable();
    expect(Especialidade::count())->toBe(1);
});

it('deve rejeitar horários inválidos: invertido, sobreposto, dia fora de faixa, dia sem intervalo', function () {
    // ARRANGE
    $admin = admin();

    // intervalo invertido (fim ≤ início)
    $this->actingAs($admin)->postJson('/api/profissionais', [
        'nome' => 'Prof A', 'horarios' => [2 => [['inicio' => '12:00', 'fim' => '09:00']]],
    ])->assertUnprocessable()->assertJsonValidationErrors('horarios.2.0.fim');

    // sobreposição no mesmo dia
    $this->actingAs($admin)->postJson('/api/profissionais', [
        'nome' => 'Prof B', 'horarios' => [2 => [['inicio' => '09:00', 'fim' => '12:00'], ['inicio' => '11:00', 'fim' => '14:00']]],
    ])->assertUnprocessable();

    // dia fora de [1..7]
    $this->actingAs($admin)->postJson('/api/profissionais', [
        'nome' => 'Prof C', 'horarios' => [8 => [['inicio' => '09:00', 'fim' => '12:00']]],
    ])->assertUnprocessable();

    // dia presente sem intervalo
    $this->actingAs($admin)->postJson('/api/profissionais', [
        'nome' => 'Prof D', 'horarios' => [2 => []],
    ])->assertUnprocessable();
});

it('deve aceitar horários vazios como "todos os dias" (retrocompat)', function () {
    // ARRANGE — mapa vazio = sem escala = atende todos os dias na janela padrão
    $admin = admin();

    // ACT + ASSERT
    $this->actingAs($admin)->postJson('/api/profissionais', ['nome' => 'Prof E', 'horarios' => []])
        ->assertCreated()->assertJsonPath('horarios', []);
});

it('deve rejeitar registro de conselho duplicado e aceitar dois sem conselho', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica)->postJson('/api/profissionais', [
        'nome' => 'Com Conselho', 'conselho' => 'CREFITO', 'uf_conselho' => 'SC', 'num_conselho' => '10',
    ])->assertCreated();

    // ACT + ASSERT — duplicado
    $this->actingAs($adminDaClinica)->postJson('/api/profissionais', [
        'nome' => 'Duplicada', 'conselho' => 'CREFITO', 'uf_conselho' => 'SC', 'num_conselho' => '10',
    ])->assertUnprocessable()->assertJsonValidationErrors('num_conselho');

    // dois sem conselho convivem (NULLs distintos no unique)
    $this->actingAs($adminDaClinica)->postJson('/api/profissionais', ['nome' => 'Sem Conselho 1'])
        ->assertCreated();
    $this->actingAs($adminDaClinica)->postJson('/api/profissionais', ['nome' => 'Sem Conselho 2'])
        ->assertCreated();
});

it('deve responder 404 para profissional inexistente e 403 sem permissão', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->getJson('/api/profissionais/999999')->assertNotFound();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($usuarioSemNivel)->getJson('/api/profissionais')->assertForbidden();
});

it('deve deixar o DONO ler a própria ficha sem profissionais.ver — e só ela', function () {
    // ARRANGE — usuário vinculado ao profissional A, sem NENHUMA permissão de cadastro
    admin();
    $profissionalProprio = Profissional::factory()->create(['nome' => 'Profissional Fictício Dono']);
    $profissionalColega = Profissional::factory()->create(['nome' => 'Profissional Fictício Colega']);
    $dono = usuarioCom(['agenda.ver'], 'Dono da Própria Ficha');
    $dono->update(['profissional_id' => $profissionalProprio->id]);

    // ACT + ASSERT — a própria ficha abre (own-show, change ficha-do-profissional)...
    $this->actingAs($dono)
        ->getJson("/api/profissionais/{$profissionalProprio->id}")
        ->assertOk()
        ->assertJsonPath('nome', 'Profissional Fictício Dono');

    // ...a do colega NÃO (a exceção é do dono, não da rota)...
    $this->actingAs($dono)
        ->getJson("/api/profissionais/{$profissionalColega->id}")
        ->assertForbidden();

    // ...e a LISTA continua exigindo a permissão do módulo
    $this->actingAs($dono)->getJson('/api/profissionais')->assertForbidden();
});

it('deve manter o show fechado para quem não é dono nem tem a permissão', function () {
    // ARRANGE — usuário SEM vínculo e sem profissionais.ver
    $adminDaClinica = admin();
    $profissional = Profissional::factory()->create();
    $semNada = usuarioCom([], 'Sem Nada do Show');

    // ACT + ASSERT — 403 sem vínculo; com a permissão, 200
    $this->actingAs($semNada)
        ->getJson("/api/profissionais/{$profissional->id}")
        ->assertForbidden();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($adminDaClinica)
        ->getJson("/api/profissionais/{$profissional->id}")
        ->assertOk();
});

it('deve devolver os horários no cadastro — o form e a ficha dependem deles', function () {
    // ARRANGE — horários gravados; o show/index não podem omiti-los (o form de edição
    // reidrata deles e a ficha os exibe)
    $this->actingAs(admin());
    $profissional = Profissional::factory()->comHorarios([
        1 => [['inicio' => '08:00', 'fim' => '12:00']],
        3 => [['inicio' => '13:00', 'fim' => '18:00']],
    ])->create();

    // ACT + ASSERT
    $this->getJson("/api/profissionais/{$profissional->id}")
        ->assertOk()
        ->assertJsonPath('horarios.1', [['inicio' => '08:00', 'fim' => '12:00']])
        ->assertJsonPath('horarios.3', [['inicio' => '13:00', 'fim' => '18:00']]);
    $lista = $this->getJson('/api/profissionais')->assertOk();
    expect(collect($lista->json())->firstWhere('id', $profissional->id)['horarios'])
        ->toBe(['1' => [['inicio' => '08:00', 'fim' => '12:00']], '3' => [['inicio' => '13:00', 'fim' => '18:00']]]);
});

it('deve manter a exceção do dono SÓ na leitura — escrever no próprio cadastro segue 403', function () {
    // ARRANGE — a fronteira exata do own-show (SEC-FPR-04a): um "own-edit" acidental
    // no futuro tem que reprovar AQUI
    admin();
    $profissionalProprio = Profissional::factory()->create();
    $dono = usuarioCom(['agenda.ver'], 'Dono Só de Leitura');
    $dono->update(['profissional_id' => $profissionalProprio->id]);

    // ACT + ASSERT — PUT e DELETE do PRÓPRIO id continuam atrás da permissão do módulo
    $this->actingAs($dono)
        ->putJson("/api/profissionais/{$profissionalProprio->id}", ['nome' => 'Tentativa'])
        ->assertForbidden();
    $this->actingAs($dono)
        ->deleteJson("/api/profissionais/{$profissionalProprio->id}")
        ->assertForbidden();
});

it('deve responder 403 uniforme a não-dono sem permissão — inclusive para id inexistente', function () {
    // ARRANGE — fixa o NÃO-ORÁCULO (SEC-FPR-04b): a ordem autorização→findOrFail é o
    // que impede "403 vs 404" de revelar existência; um refactor que inverta reprova aqui
    admin();
    $profissionalProprio = Profissional::factory()->create();
    $dono = usuarioCom([], 'Dono Sem Oráculo');
    $dono->update(['profissional_id' => $profissionalProprio->id]);

    // ACT + ASSERT — id que NÃO existe: 403 (a mesma resposta de um id alheio real)
    $this->actingAs($dono)
        ->getJson('/api/profissionais/999999')
        ->assertForbidden();
});

// ── Mensagens automáticas às famílias (change mensagens-automaticas-por-profissional) ────────

it('deve nascer com as mensagens automáticas às famílias ligadas', function () {
    // ARRANGE — o padrão É o comportamento de hoje: ninguém muda sem a clínica desligar
    $adminDaClinica = admin();

    // ACT
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/profissionais', ['nome' => 'Profissional Fictícia']);

    // ASSERT
    $criado->assertCreated();
    expect($criado->json('mensagens_automaticas'))->toBeTrue();
    $this->actingAs($adminDaClinica)->getJson('/api/profissionais/'.$criado->json('id'))
        ->assertOk()->assertJsonPath('mensagens_automaticas', true);
});

it('deve manter ligadas as mensagens do profissional que já existia antes da coluna', function () {
    // ARRANGE — a linha gravada SEM a coluna é a de todo profissional da produção na hora da migration
    admin();
    $id = DB::table('profissionais')->insertGetId([
        'nome' => 'Profissional Antiga Fictícia',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    // ACT
    $profissional = Profissional::findOrFail($id);

    // ASSERT — o default é do BANCO, não só do model
    expect($profissional->mensagens_automaticas)->toBeTrue();
});

it('deve desligar as mensagens automáticas e auditar o antes e o depois', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $profissional = Profissional::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/profissionais/{$profissional->id}", [
        'nome' => $profissional->nome,
        'mensagens_automaticas' => false,
    ]);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('mensagens_automaticas', false);
    $trilha = Auditoria::where('entidade', 'profissionais')->where('acao', 'atualizou')
        ->where('entidade_id', $profissional->id)->latest('id')->firstOrFail();
    expect((bool) $trilha->diff_json['antes']['mensagens_automaticas'])->toBeTrue()
        ->and((bool) $trilha->diff_json['depois']['mensagens_automaticas'])->toBeFalse();
});

it('deve manter as mensagens desligadas quando a edição não traz o campo', function () {
    // ARRANGE — o formulário só manda o que mudou; a ausência não pode religar
    $adminDaClinica = admin();
    $profissional = Profissional::factory()->create(['mensagens_automaticas' => false]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/profissionais/{$profissional->id}", [
        'nome' => 'Nome Novo Fictício',
    ]);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('mensagens_automaticas', false);
});

it('deve recusar mensagens automáticas que não são sim ou não', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $profissional = Profissional::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/profissionais/{$profissional->id}", [
        'nome' => $profissional->nome,
        'mensagens_automaticas' => 'talvez',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()
        ->assertJsonValidationErrors(['mensagens_automaticas' => 'Escolha se o profissional recebe as mensagens automáticas: sim ou não.']);
    expect($profissional->fresh()->mensagens_automaticas)->toBeTrue();
});

it('não deve desligar as mensagens automáticas sem a permissão de editar profissional', function () {
    // ARRANGE
    admin();
    $profissional = Profissional::factory()->create();
    $recepcao = usuarioCom(['profissionais.ver'], 'Recepção Fictícia');

    // ACT
    $resposta = $this->actingAs($recepcao)->putJsonComVersao("/api/profissionais/{$profissional->id}", [
        'nome' => $profissional->nome,
        'mensagens_automaticas' => false,
    ]);

    // ASSERT
    $resposta->assertForbidden();
    expect($profissional->fresh()->mensagens_automaticas)->toBeTrue();
});

it('deve gravar na auditoria "não" quando as mensagens chegam desligadas como "0"', function () {
    // ARRANGE — `boolean` aceita "0"; sem normalizar, a trilha guardava `true → "0"` (SEC-MA-01)
    $adminDaClinica = admin();
    $profissional = Profissional::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/profissionais/{$profissional->id}", [
        'nome' => $profissional->nome,
        'mensagens_automaticas' => '0',
    ]);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('mensagens_automaticas', false);
    $trilha = Auditoria::where('entidade', 'profissionais')->where('acao', 'atualizou')
        ->where('entidade_id', $profissional->id)->latest('id')->firstOrFail();
    expect($trilha->diff_json['depois']['mensagens_automaticas'])->toBeFalse();
});
