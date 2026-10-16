<?php

use App\Models\Convenio;
use App\Models\FechamentoCiclo;
use App\Support\Ciclos\CalendarioDoCiclo;

/**
 * O calendário do ciclo como DADO do convênio (task 1.3 · spec convenios).
 *
 * O teste que carrega o peso é o do **SEC-FC-18**: sem ele, `convenios.editar` — uma
 * permissão de CADASTRO — destravaria toda a produção congelada sem `ciclos.reabrir`,
 * sem motivo digitado e sem trilha de reabertura. Chave-mestra duplicada por uma porta
 * que não se anuncia como tal.
 */
function convenioComCiclo(string $tipo = CalendarioDoCiclo::TIPO_DIA_FIXO, ?int $dia = 15): Convenio
{
    return Convenio::create([
        'nome' => 'Convênio Fictício '.fake()->unique()->word(),
        'ciclo_tipo_corte' => $tipo,
        'ciclo_dia_corte' => $dia,
    ]);
}

function fecharCicloDireto(Convenio $convenio, string $inicio, string $fim, int $usuarioId): FechamentoCiclo
{
    $fechamento = new FechamentoCiclo;
    $fechamento->convenio_id = $convenio->id;
    $fechamento->periodo_inicio = $inicio;
    $fechamento->periodo_fim = $fim;
    $fechamento->fechado_por = $usuarioId;
    $fechamento->fechado_em = now();
    $fechamento->save();

    return $fechamento;
}

it('deve gravar e devolver o calendário do ciclo no cadastro do convênio', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT — o calendário da Unimed (decisão da clínica 2026-07-19)
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/convenios', [
        'nome' => 'Operadora Fictícia',
        'ciclo_tipo_corte' => 'dia_fixo',
        'ciclo_dia_corte' => 15,
    ]);

    // ASSERT — vai e VOLTA: a tela que não enxerga o campo não tem como preservá-lo
    $criar->assertCreated()
        ->assertJsonPath('ciclo_tipo_corte', 'dia_fixo')
        ->assertJsonPath('ciclo_dia_corte', 15);

    $this->actingAs($adminDaClinica)->getJson("/api/convenios/{$criar->json('id')}")
        ->assertOk()
        ->assertJsonPath('ciclo_tipo_corte', 'dia_fixo')
        ->assertJsonPath('ciclo_dia_corte', 15);
});

it('deve aceitar o corte de último dia sem dia de corte', function () {
    // ARRANGE — o calendário da SC Saúde
    $adminDaClinica = admin();

    // ACT
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/convenios', [
        'nome' => 'Operadora Fictícia Mensal',
        'ciclo_tipo_corte' => 'ultimo_dia',
    ]);

    // ASSERT
    $criar->assertCreated()
        ->assertJsonPath('ciclo_tipo_corte', 'ultimo_dia')
        ->assertJsonPath('ciclo_dia_corte', null);
});

it('deve recusar calendário fora do domínio sem ecoar o valor recebido', function () {
    // ARRANGE — SEC-FC-21: o domínio para em 28 porque acima disso a derivação deixaria
    // dias órfãos (ver CalendarioDoCicloTest)
    $adminDaClinica = admin();

    // ACT + ASSERT — dia 29 (dentro de 1..31, fora do domínio)
    $dia29 = $this->actingAs($adminDaClinica)->postJson('/api/convenios', [
        'nome' => 'Operadora Fictícia A', 'ciclo_tipo_corte' => 'dia_fixo', 'ciclo_dia_corte' => 29,
    ]);
    $dia29->assertUnprocessable()->assertJsonValidationErrors('ciclo_dia_corte');

    // dia 32
    $this->actingAs($adminDaClinica)->postJson('/api/convenios', [
        'nome' => 'Operadora Fictícia B', 'ciclo_tipo_corte' => 'dia_fixo', 'ciclo_dia_corte' => 32,
    ])->assertUnprocessable()->assertJsonValidationErrors('ciclo_dia_corte');

    // tipo desconhecido — sem ecoar o valor
    $tipo = $this->actingAs($adminDaClinica)->postJson('/api/convenios', [
        'nome' => 'Operadora Fictícia C', 'ciclo_tipo_corte' => 'quinzenal', 'ciclo_dia_corte' => 15,
    ]);
    $tipo->assertUnprocessable()->assertJsonValidationErrors('ciclo_tipo_corte');
    semVazamento($tipo->json(), 'quinzenal');

    expect(Convenio::count())->toBe(0);
});

it('deve recusar calendário meio configurado', function () {
    // ARRANGE — `dia_fixo` sem dia não deriva período algum; dia solto é lixo que a
    // próxima leitura interpretaria como calendário
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/convenios', [
        'nome' => 'Operadora Fictícia D', 'ciclo_tipo_corte' => 'dia_fixo',
    ])->assertUnprocessable()->assertJsonValidationErrors('ciclo_dia_corte');

    $this->actingAs($adminDaClinica)->postJson('/api/convenios', [
        'nome' => 'Operadora Fictícia E', 'ciclo_tipo_corte' => 'ultimo_dia', 'ciclo_dia_corte' => 10,
    ])->assertUnprocessable()->assertJsonValidationErrors('ciclo_dia_corte');

    expect(Convenio::count())->toBe(0);
});

it('deve permitir alterar o calendário do convênio SEM fechamento aberto', function () {
    // ARRANGE — SEC-FC-18, o lado permissivo: o fail-safe "sem ciclo, nada muda" vale
    // para quem nunca congelou nada
    $adminDaClinica = admin();
    $convenio = convenioComCiclo();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/convenios/{$convenio->id}", [
        'nome' => $convenio->nome, 'ciclo_tipo_corte' => 'ultimo_dia', 'ciclo_dia_corte' => null,
    ]);

    // ASSERT
    $resposta->assertOk()
        ->assertJsonPath('ciclo_tipo_corte', 'ultimo_dia')
        ->assertJsonPath('ciclo_dia_corte', null);
});

it('deve recusar alterar ou apagar o calendário com fechamento ABERTO', function () {
    // ARRANGE — SEC-FC-18 (bloqueante): sem esta cerca, `convenios.editar` destravaria a
    // produção congelada sem `ciclos.reabrir`, sem motivo e sem trilha
    $adminDaClinica = admin();
    $convenio = convenioComCiclo();
    fecharCicloDireto($convenio, '2026-06-16', '2026-07-15', $adminDaClinica->id);

    // ACT + ASSERT — ALTERAR o calendário
    $alterar = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/convenios/{$convenio->id}", [
        'nome' => $convenio->nome, 'ciclo_tipo_corte' => 'ultimo_dia', 'ciclo_dia_corte' => null,
    ]);
    $alterar->assertUnprocessable()->assertJsonValidationErrors('ciclo_tipo_corte');

    // ...e APAGAR o calendário (o caminho mais direto de destravamento)
    $apagar = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/convenios/{$convenio->id}", [
        'nome' => $convenio->nome, 'ciclo_tipo_corte' => null, 'ciclo_dia_corte' => null,
    ]);
    $apagar->assertUnprocessable()->assertJsonValidationErrors('ciclo_tipo_corte');

    // o congelamento permanece intacto
    $convenio->refresh();
    expect($convenio->ciclo_tipo_corte)->toBe('dia_fixo');
    expect($convenio->ciclo_dia_corte)->toBe(15);
});

it('deve permitir editar o resto do convênio com fechamento aberto', function () {
    // ARRANGE — a cerca do SEC-FC-18 é sobre o CALENDÁRIO, não sobre o cadastro: a tela
    // reenvia o convênio inteiro a cada edição, e travar o nome seria travar a operação
    $adminDaClinica = admin();
    $convenio = convenioComCiclo();
    fecharCicloDireto($convenio, '2026-06-16', '2026-07-15', $adminDaClinica->id);

    // ACT — mesmo calendário, nome novo
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/convenios/{$convenio->id}", [
        'nome' => 'Operadora Fictícia Renomeada',
        'ciclo_tipo_corte' => 'dia_fixo',
        'ciclo_dia_corte' => 15,
    ]);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('nome', 'Operadora Fictícia Renomeada');
});

it('deve liberar o calendário depois que o ciclo é reaberto', function () {
    // ARRANGE — a cerca é sobre fechamento ABERTO; linha reaberta é histórico
    $adminDaClinica = admin();
    $convenio = convenioComCiclo();
    $fechamento = fecharCicloDireto($convenio, '2026-06-16', '2026-07-15', $adminDaClinica->id);

    $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/ciclos/{$fechamento->id}/reabertura", [
            'motivo' => 'Correção de produção fictícia enviada com erro.',
        ])->assertOk();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/convenios/{$convenio->id}", [
        'nome' => $convenio->nome, 'ciclo_tipo_corte' => 'ultimo_dia', 'ciclo_dia_corte' => null,
    ]);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('ciclo_tipo_corte', 'ultimo_dia');
});

it('deve manter as fronteiras do período fechado quando o calendário muda depois', function () {
    // ARRANGE — SEC-FC-17: a guarda decide por INTERVALO PERSISTIDO, jamais re-derivando
    // do calendário atual. Trocar o dia de corte não pode mover o que já foi congelado.
    $adminDaClinica = admin();
    $convenio = convenioComCiclo();
    $fechamento = fecharCicloDireto($convenio, '2026-06-16', '2026-07-15', $adminDaClinica->id);

    // ACT — reabre (única porta legítima) e então troca o calendário
    $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/ciclos/{$fechamento->id}/reabertura", [
            'motivo' => 'Motivo fictício.',
        ])->assertOk();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/convenios/{$convenio->id}", [
        'nome' => $convenio->nome, 'ciclo_tipo_corte' => 'ultimo_dia', 'ciclo_dia_corte' => null,
    ])->assertOk();

    // ASSERT — as fronteiras persistidas são as de quando se fechou
    $fechamento->refresh();
    expect($fechamento->periodo_inicio->format('Y-m-d'))->toBe('2026-06-16');
    expect($fechamento->periodo_fim->format('Y-m-d'))->toBe('2026-07-15');
});
