<?php

use App\Models\Agendamento;
use App\Models\Auditoria;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Usuario;
use Carbon\Carbon;

/**
 * O relatório `movimentacao-da-agenda` (change `area-de-relatorios`, task 2.4): SÓ sob
 * `auditoria.ver`; classifica pelos CAMPOS do diff (nunca pelo nome do status); antes/depois
 * legíveis pelo resolvedor da tela de auditoria; `por` é o nome de quem fez; filtros por tipo e
 * profissional; período pela data do registro na parede da clínica.
 *
 * LGPD: dados 100% fictícios.
 */

/** A query string de `de`/`ate` cobrindo `$dias` para trás a partir de hoje da clínica. */
function periodoDaMovimentacao(int $dias = 7): string
{
    return 'de='.agoraNaClinica()->subDays($dias)->toDateString().'&ate='.agoraNaClinica()->toDateString();
}

/**
 * Um registro da trilha de um agendamento gravado por um USUÁRIO, na forma que o trait
 * `Auditavel` grava (`antes` só com o que mudou, `depois` idem).
 *
 * @param  array<string, mixed>  $antes
 * @param  array<string, mixed>  $depois
 */
function trilhaDoAgendamento(Agendamento $agendamento, Usuario $por, array $antes, array $depois, ?Carbon $quando = null): Auditoria
{
    return Auditoria::create([
        'autor_tipo' => 'usuario',
        'usuario_id' => $por->id,
        'entidade' => 'agendamentos',
        'entidade_id' => $agendamento->id,
        'acao' => 'atualizou',
        'diff_json' => ['antes' => $antes, 'depois' => $depois],
        'criado_em' => $quando ?? now(),
    ]);
}

it('deve exigir auditoria.ver E agenda.ver, recusando com 403 quem tem só uma delas, mesmo com período inválido', function () {
    // ARRANGE — a movimentação exige as DUAS (`SEC-REL-03`): `auditoria.ver` porque lê a trilha,
    // `agenda.ver` porque preenche o NOME da criança pela foto atual de `agendamentos` — quem só
    // audita receberia, por este relatório, a agenda nominal do período inteiro, que a tela
    // `/auditoria` não dá. Os usuários nascem ANTES da primeira requisição (o `auth:sanctum`
    // troca o guard default e o `usuarioCom` passaria a procurar a permissão no guard errado)
    admin();
    $soAgenda = usuarioCom(['agenda.ver', 'agenda.ver_todos'], 'Só agenda');
    $soAuditoria = usuarioCom(['auditoria.ver'], 'Só auditoria');
    $asDuas = usuarioCom(['auditoria.ver', 'agenda.ver'], 'Auditoria e agenda');

    // ACT + ASSERT — 403 antes de o validador olhar o período
    $this->actingAs($soAgenda)->getJson('/api/relatorios/movimentacao-da-agenda?de=nao-e-data')->assertForbidden();
    $this->actingAs($soAgenda)->getJson('/api/relatorios/movimentacao-da-agenda?'.periodoDaMovimentacao())->assertForbidden();

    // ...quem SÓ audita também para aqui: era o buraco do `SEC-REL-03`
    trocarDeUsuario();
    $this->actingAs($soAuditoria)->getJson('/api/relatorios/movimentacao-da-agenda?de=nao-e-data')->assertForbidden();
    trocarDeUsuario();
    $this->actingAs($soAuditoria)->getJson('/api/relatorios/movimentacao-da-agenda?'.periodoDaMovimentacao())->assertForbidden();

    // ...e só com as duas o relatório abre
    trocarDeUsuario();
    $this->actingAs($asDuas)->getJson('/api/relatorios/movimentacao-da-agenda?'.periodoDaMovimentacao())->assertOk();
});

it('deve classificar criado, remarcado, troca de situação e desmarcado pelos campos do diff, com antes/depois legíveis e quem fez', function () {
    // ARRANGE — um agendamento da Ana (o `criou` da trilha nasce da factory, autor "Sistema") e
    // depois cinco registros de um USUÁRIO: horário, profissional, status que ocupa, status que
    // NÃO ocupa horário, e uma observação (que não é movimentação)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $hoje = agoraNaClinica()->toDateString();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia da Movimentação']);
    $agendamento = Agendamento::factory()->create([
        'paciente_id' => $crianca->id,
        'profissional_id' => $ana->id,
        'inicio' => "{$hoje} 09:00",
        'fim' => "{$hoje} 09:40",
    ]);
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
    $naoOcupa = StatusAgendamento::where('ocupa_horario', false)->firstOrFail();

    trilhaDoAgendamento($agendamento, $adminDaClinica, ['inicio' => "{$hoje} 09:00:00"], ['inicio' => "{$hoje} 10:00:00"]);
    trilhaDoAgendamento($agendamento, $adminDaClinica, ['profissional_id' => $ana->id], ['profissional_id' => $bia->id]);
    trilhaDoAgendamento($agendamento, $adminDaClinica, ['status_id' => $emAberto->id], ['status_id' => $finalizado->id]);
    trilhaDoAgendamento($agendamento, $adminDaClinica, ['status_id' => $finalizado->id], ['status_id' => $naoOcupa->id]);
    trilhaDoAgendamento($agendamento, $adminDaClinica, ['obs' => '***'], ['obs' => '***']);
    trilhaDoAgendamento($agendamento, $adminDaClinica, ['sala_id' => null], ['sala_id' => 3]);

    // ACT
    $resposta = $this->getJson('/api/relatorios/movimentacao-da-agenda?'.periodoDaMovimentacao())->assertOk();

    // ASSERT — o envelope e as colunas declaradas
    $resposta->assertJsonPath('slug', 'movimentacao-da-agenda')
        ->assertJsonPath('titulo', 'Movimentação da agenda')
        ->assertJsonPath('periodo.ate', $hoje)
        ->assertJsonPath('filtros_aplicados', [])
        ->assertJsonPath('grupos', null)
        ->assertJsonPath('totais.quantidade', 5)
        ->assertJsonPath('contagem', 5);
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())
        ->toBe(['data', 'hora', 'tipo', 'paciente', 'profissional', 'antes', 'depois', 'por'])
        ->and(collect($resposta->json('colunas'))->pluck('tipo')->all())
        ->toBe(['data', 'hora', 'texto', 'texto', 'texto', 'texto', 'texto', 'texto']);

    // ...a classificação em ordem cronológica, pelos campos — obs e sala ficaram de fora
    $linhas = collect($resposta->json('linhas'));
    $dia = Carbon::parse($hoje)->format('d/m/Y');
    expect($linhas->pluck('tipo')->all())->toBe(['Criado', 'Remarcado', 'Remarcado', 'Troca de situação', 'Desmarcado'])
        ->and($linhas->pluck('paciente')->unique()->all())->toBe(['Criança Fictícia da Movimentação'])
        ->and($linhas->pluck('por')->all())->toBe(['Sistema', $adminDaClinica->nome, $adminDaClinica->nome, $adminDaClinica->nome, $adminDaClinica->nome])
        ->and($linhas[0]['antes'])->toBe('—')
        ->and($linhas[0]['depois'])->toBe("{$dia} às 09:00 · Ana Fictícia")
        ->and($linhas[0]['data'])->toBe($hoje)
        // horário mudou: o profissional (que não mudou) vem da foto atual do agendamento
        ->and($linhas[1]['antes'])->toBe("{$dia} às 09:00 · Ana Fictícia")
        ->and($linhas[1]['depois'])->toBe("{$dia} às 10:00 · Ana Fictícia")
        // profissional mudou: o horário (que não mudou) vem da foto; a coluna é o dono NOVO
        ->and($linhas[2]['antes'])->toBe("{$dia} às 09:00 · Ana Fictícia")
        ->and($linhas[2]['depois'])->toBe("{$dia} às 09:00 · Bia Fictícia")
        ->and($linhas[2]['profissional'])->toBe('Bia Fictícia')
        // status é DADO: o nome sai, a regra é a flag
        ->and($linhas[3]['antes'])->toBe('Em Aberto')
        ->and($linhas[3]['depois'])->toBe('Finalizado')
        ->and($linhas[4]['antes'])->toBe('Finalizado')
        ->and($linhas[4]['depois'])->toBe($naoOcupa->nome);
});

it('deve ler o diff REAL que o trait Auditavel grava, inclusive a exclusão pela API com o nome de quem excluiu', function () {
    // ARRANGE — remarcação pelo model (o diff como a casa o grava) e exclusão pela ROTA (autor = usuário)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $hoje = agoraNaClinica()->toDateString();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia Excluída']);
    $agendamento = Agendamento::factory()->create([
        'paciente_id' => $crianca->id,
        'profissional_id' => $ana->id,
        'inicio' => "{$hoje} 09:00",
        'fim' => "{$hoje} 09:40",
    ]);
    $agendamento->forceFill(['inicio' => "{$hoje} 11:00", 'fim' => "{$hoje} 11:40"])->save();
    $this->deleteJson("/api/agendamentos/{$agendamento->id}")->assertNoContent();

    // ACT
    $resposta = $this->getJson('/api/relatorios/movimentacao-da-agenda?'.periodoDaMovimentacao())->assertOk();

    // ASSERT — o horário que não existe mais ainda tem nome de criança (pela foto do `excluiu`)
    $linhas = collect($resposta->json('linhas'));
    $dia = Carbon::parse($hoje)->format('d/m/Y');
    expect($linhas->pluck('tipo')->all())->toBe(['Criado', 'Remarcado', 'Desmarcado'])
        ->and($linhas[1]['antes'])->toBe("{$dia} às 09:00 · Ana Fictícia")
        ->and($linhas[1]['depois'])->toBe("{$dia} às 11:00 · Ana Fictícia")
        ->and($linhas[2]['paciente'])->toBe('Criança Fictícia Excluída')
        ->and($linhas[2]['profissional'])->toBe('Ana Fictícia')
        ->and($linhas[2]['antes'])->toBe('Em Aberto')
        ->and($linhas[2]['depois'])->toBe('Excluído')
        ->and($linhas[2]['por'])->toBe($adminDaClinica->nome);
});

it('deve filtrar por tipo e por profissional com o filtro legível no cabeçalho, e recusar tipo ou id desconhecidos', function () {
    // ARRANGE — a Ana tem um agendamento (criado + troca de situação); a Bia só o criado
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    $daAna = Agendamento::factory()->create(['profissional_id' => $ana->id]);
    Agendamento::factory()->create(['profissional_id' => $bia->id]);
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
    trilhaDoAgendamento($daAna, $adminDaClinica, ['status_id' => $emAberto->id], ['status_id' => $finalizado->id]);

    // ACT
    $porTipo = $this->getJson('/api/relatorios/movimentacao-da-agenda?'.periodoDaMovimentacao().'&tipo=status')->assertOk();
    $porProfissional = $this->getJson('/api/relatorios/movimentacao-da-agenda?'.periodoDaMovimentacao()."&profissional_id={$ana->id}")->assertOk();

    // ASSERT
    expect(collect($porTipo->json('linhas'))->pluck('tipo')->all())->toBe(['Troca de situação'])
        ->and($porTipo->json('filtros_aplicados'))->toBe([['rotulo' => 'Movimentação', 'valor' => 'Troca de situação']])
        ->and(collect($porProfissional->json('linhas'))->pluck('tipo')->all())->toBe(['Criado', 'Troca de situação'])
        ->and(collect($porProfissional->json('linhas'))->pluck('profissional')->unique()->all())->toBe(['Ana Fictícia'])
        ->and($porProfissional->json('filtros_aplicados'))->toBe([['rotulo' => 'Profissional', 'valor' => 'Ana Fictícia']]);

    $this->getJson('/api/relatorios/movimentacao-da-agenda?'.periodoDaMovimentacao().'&tipo=virou')
        ->assertUnprocessable()->assertJsonValidationErrors(['tipo']);
    $this->getJson('/api/relatorios/movimentacao-da-agenda?'.periodoDaMovimentacao().'&profissional_id=999999')
        ->assertUnprocessable()->assertJsonValidationErrors(['profissional_id']);
});

it('deve recortar pela data do registro da trilha', function () {
    // ARRANGE — um registro de hoje e um de dez dias atrás (fora do período de 7)
    $administradora = admin();
    $this->actingAs($administradora);
    $agendamento = Agendamento::factory()->create();
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
    trilhaDoAgendamento($agendamento, $administradora, ['status_id' => $emAberto->id], ['status_id' => $finalizado->id], now()->subDays(10));

    // ACT
    $resposta = $this->getJson('/api/relatorios/movimentacao-da-agenda?'.periodoDaMovimentacao())->assertOk();

    // ASSERT — só o de hoje entra no período
    expect(collect($resposta->json('linhas'))->pluck('tipo')->all())->toBe(['Criado']);
});
