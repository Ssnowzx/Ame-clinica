<?php

use App\Models\Agendamento;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Especialidade;
use App\Models\NivelPermissao;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\TipoPagamento;
use App\Models\Usuario;
use Database\Seeders\EscopoProfissionalBackfillSeeder;
use Illuminate\Support\Facades\DB;

/**
 * GUARDA MECÂNICA do gatilho 🔴 D11 — ESCOPO por vínculo profissional (parecer SEC-VP-01).
 *
 * (O VÍNCULO em si — usuario.profissional_id — é testado em VinculoProfissionalTest; aqui é a
 * FISCALIZAÇÃO.) Regra GATED-PELA-FLAG: papel COM `agenda.ver_todos`/`clinico.ver_todos` = PLANO;
 * papel SEM a flag + usuário vinculado = ESCOPADO ao próprio; sem vínculo = FAIL-CLOSED (nada). O
 * escopo é FORÇADO no servidor. Abuse cases AB-01..AB-13.
 */
function usuarioEscopado(Profissional $prof): Usuario
{
    return usuarioEscopadoEm($prof, [
        'agenda.excluir', 'atendimentos.ver', 'evolucoes.ver', 'anamneses.ver',
    ]);
}

/** Um agendamento de atendimento do profissional `$prof`, amanhã 09:00. */
function agendamentoDe(Profissional $prof): Agendamento
{
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $prof->id,
        'especialidade_id' => $especialidade->id,
    ]);

    return Agendamento::factory()->create([
        'tipo' => 'atendimento',
        'profissional_id' => $prof->id,
        'especialidade_id' => $especialidade->id,
        'paciente_id' => Paciente::factory()->create()->id,
        'status_id' => StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail()->id,
        'inicio' => agoraNaClinica()->copy()->addDay()->setTime(9, 0)->setSeconds(0),
        'fim' => agoraNaClinica()->copy()->addDay()->setTime(9, 40)->setSeconds(0),
    ]);
}

it('deve escopar a grade ao próprio profissional, ignorando o filtro do cliente (AB-01)', function () {
    // ARRANGE
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $agA = agendamentoDe($profA);
    $agB = agendamentoDe($profB);
    $usuario = usuarioEscopado($profA);
    $dia = $agA->inicio->format('Y-m-d');

    // ACT — o escopado pede a grade de B; o servidor força o próprio (A)
    $resposta = $this->actingAs($usuario)
        ->getJson("/api/agenda?de={$dia}&ate={$dia}&profissional_id={$profB->id}")->assertOk();

    // ASSERT — só A; B nunca
    $ids = collect($resposta->json())->pluck('id');
    expect($ids)->toContain($agA->id)->not->toContain($agB->id);
});

it('deve recusar (403) abrir/editar/excluir o agendamento de outro (AB-03/04)', function () {
    // ARRANGE
    admin();
    $profA = Profissional::factory()->create();
    $agB = agendamentoDe(Profissional::factory()->create());
    $usuario = usuarioEscopado($profA);

    // ACT + ASSERT — show, update, destroy de B → 403
    $this->actingAs($usuario)->getJson("/api/agendamentos/{$agB->id}")->assertForbidden();
    $this->actingAs($usuario)->putJsonComVersao("/api/agendamentos/{$agB->id}", [
        'inicio' => $agB->inicio->format('Y-m-d H:i'),
        'profissional_id' => $agB->profissional_id,
    ])->assertForbidden();
    $this->actingAs($usuario)->deleteJson("/api/agendamentos/{$agB->id}")->assertForbidden();
});

it('deve recusar (403) criar para outro profissional (AB-02)', function () {
    // ARRANGE — a criança é do PRÓPRIO A, de propósito.
    //
    // Antes da change `vinculo-previo-para-agendar` este teste usava a criança de B, e o 403 vinha
    // do escopo do profissional. Com a trava de vínculo, a validação passou a recusar ANTES, com
    // 422 no `paciente_id` — e o teste mediria a trava, não o AB-02. Usando a criança de A, a
    // única variável que resta é o `profissional_id`, que é o que o abuse case nomeia.
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $baseB = agendamentoDe($profB); // cria a especialidade vinculada a B
    $daPropriaAgenda = agendamentoDe($profA);
    $usuario = usuarioEscopado($profA);

    // ACT + ASSERT — POST com profissional_id de B → 403
    $this->actingAs($usuario)->postJson('/api/agendamentos', [
        'profissional_id' => $profB->id,
        'especialidade_id' => $baseB->especialidade_id,
        'paciente_id' => $daPropriaAgenda->paciente_id,
        'inicio' => agoraNaClinica()->copy()->addDays(2)->setTime(9, 0)->format('Y-m-d H:i'),
    ])->assertForbidden();
});

it('deve recusar (403) re-parentear o próprio para outro profissional (AB-05)', function () {
    // ARRANGE — o escopado tenta "dar" o próprio agendamento a B
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $agA = agendamentoDe($profA);
    $usuario = usuarioEscopado($profA);

    // ACT + ASSERT
    $this->actingAs($usuario)->putJsonComVersao("/api/agendamentos/{$agA->id}", [
        'inicio' => $agA->inicio->format('Y-m-d H:i'),
        'profissional_id' => $profB->id,
    ])->assertForbidden();
});

it('deve FAIL-CLOSED: escopado sem vínculo vê NADA e não muta (AB-12)', function () {
    // ARRANGE — papel sem flag, usuário SEM profissional_id
    admin();
    $agA = agendamentoDe(Profissional::factory()->create());
    $semVinculo = usuarioCom(['agenda.ver', 'agenda.editar'], 'Prof. e Agenda');
    $dia = $agA->inicio->format('Y-m-d');

    // ACT + ASSERT — grade vazia, show 403
    expect($this->actingAs($semVinculo)->getJson("/api/agenda?de={$dia}&ate={$dia}")->assertOk()->json())
        ->toBe([]);
    $this->actingAs($semVinculo)->getJson("/api/agendamentos/{$agA->id}")->assertForbidden();
});

it('deve manter o ADMIN plano: enxerga a agenda inteira mesmo vinculado (AB-13)', function () {
    // ARRANGE — admin tem todas as permissões (inclui agenda.ver_todos) → plano
    $admin = admin();
    $agOutro = agendamentoDe(Profissional::factory()->create());
    $admin->update(['profissional_id' => Profissional::factory()->create()->id]); // vinculado a OUTRO
    $dia = $agOutro->inicio->format('Y-m-d');

    // ACT + ASSERT — vê o de qualquer profissional
    $ids = collect($this->actingAs($admin)->getJson("/api/agenda?de={$dia}&ate={$dia}")->assertOk()->json())
        ->pluck('id');
    expect($ids)->toContain($agOutro->id);
    $this->actingAs($admin)->getJson("/api/agendamentos/{$agOutro->id}")->assertOk();
});

it('deve preservar papéis existentes PLANOS via backfill das flags (SEC-VP-02/P1)', function () {
    // ARRANGE — um papel EXISTENTE sem as flags (estado pré-D11), usuário sem vínculo
    admin();
    $agOutro = agendamentoDe(Profissional::factory()->create());
    $recepcao = usuarioCom(['agenda.ver'], 'Recepção Legada'); // sem agenda.ver_todos ⇒ seria fail-closed
    $recepcao->update(['profissional_id' => null]);
    $dia = $agOutro->inicio->format('Y-m-d');

    // sanity: ANTES do backfill, o papel legado é fail-closed (não vê nada)
    expect($this->actingAs($recepcao)->getJson("/api/agenda?de={$dia}&ate={$dia}")->assertOk()->json())
        ->toBe([]);

    // ACT — o backfill concede as duas flags a TODOS os papéis existentes
    (new EscopoProfissionalBackfillSeeder)->run();

    // ASSERT — o papel legado volta a ser PLANO (vê a agenda inteira)
    $this->app['auth']->forgetGuards();
    $ids = collect($this->actingAs($recepcao->fresh())->getJson("/api/agenda?de={$dia}&ate={$dia}")->assertOk()->json())
        ->pluck('id');
    expect($ids)->toContain($agOutro->id);
});

it('deve impedir o escopado de trocar o próprio vínculo ou virar admin (AB-09/AB-10)', function () {
    // ARRANGE — o papel escopado NÃO tem usuarios.editar nem niveis_permissao.editar (SEC-VP-11)
    admin();
    $usuario = usuarioEscopado(Profissional::factory()->create());
    $outroProf = Profissional::factory()->create();
    $adminRole = NivelPermissao::where('name', 'Administrador')->firstOrFail();

    // ACT + ASSERT — trocar o próprio vínculo → 403; atribuir-se o Administrador → 403 (middleware)
    $this->actingAs($usuario)->putJsonComVersao("/api/usuarios/{$usuario->id}", [
        'profissional_id' => $outroProf->id,
    ])->assertForbidden();
    $this->actingAs($usuario)->putJsonComVersao("/api/usuarios/{$usuario->id}/nivel-permissao", [
        'nivel_permissao_id' => $adminRole->id,
    ])->assertForbidden();
});

it('deve recusar (403) faturar a sessão de outro profissional (SEC-VP-13/P3)', function () {
    // ARRANGE — escopado a A, COM permissão financeira, tenta faturar o agendamento de B.
    // O portão de posse é a 1ª coisa do controller (antes de faturar), com payload VÁLIDO.
    admin();
    $agB = agendamentoDe(Profissional::factory()->create());
    $usuario = usuarioCom(['lancamentos.criar'], 'Prof. com Financeiro');
    $usuario->update(['profissional_id' => Profissional::factory()->create()->id]);
    $payload = [
        'categoria_id' => Categoria::create(['nome' => 'Rec '.fake()->unique()->numberBetween(1, 99999), 'tipo' => 'receita'])->id,
        'tipo_pagamento_id' => TipoPagamento::create(['nome' => 'PIX '.fake()->unique()->numberBetween(1, 99999)])->id,
        'conta_id' => Conta::create(['nome' => 'Caixa '.fake()->unique()->numberBetween(1, 99999)])->id,
    ];

    // ACT + ASSERT
    $this->actingAs($usuario)->postJson("/api/agendamentos/{$agB->id}/faturamento", $payload)
        ->assertForbidden();
});
