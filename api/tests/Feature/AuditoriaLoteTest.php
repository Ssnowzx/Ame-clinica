<?php

use App\Models\Auditoria;
use App\Models\Profissional;
use App\Models\Usuario;
use App\Support\Auditoria\ContextoDoLote;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Auditoria\RotulosDeAuditoria;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Support\ItemTeste;

/*
 * Identificador de lote na trilha (change `baixa-em-lote-por-status`, D11). Os controllers que
 * abrem lote de verdade (baixa e desmarque) chegam nas ondas seguintes; aqui o lote é SIMULADO
 * pela mesma porta que eles vão usar — o `ContextoDoLote` e a fonte única `RegistroDeAuditoria`
 * — sobre models fictícios (`ItemTeste`) e um profissional fictício como dono da linha-mãe.
 */

/**
 * O diff da linha-mãe como a baixa vai gravar: ids de agendamento e contagens, NUNCA criança.
 *
 * @return array<string, array<string, mixed>>
 */
function diffDaLinhaMae(): array
{
    return ['depois' => [
        'status_id' => 7,
        'status_nome' => 'Finalizado',
        'de' => '2026-09-10',
        'ate' => '2026-09-10',
        'aplicados' => 3,
        'criancas' => 2,
        'sessoes_descontadas' => 2,
        'recusados' => [['agendamento_id' => 99, 'motivo' => 'ainda não começou']],
    ]];
}

/**
 * Abre um lote, audita três itens fictícios e a linha-mãe no profissional, fecha o contexto.
 * Devolve o id do lote. `$sufixo` distingue os nomes (únicos) entre dois lotes.
 */
function loteFicticio(Profissional $profissional, string $sufixo, string $operacao = 'baixa_em_lote'): string
{
    $contexto = app(ContextoDoLote::class);
    $loteId = $contexto->abrir($operacao);

    foreach ([1, 2, 3] as $n) {
        $item = ItemTeste::create(['nome' => "Item {$sufixo}{$n}"]);
        RegistroDeAuditoria::registrar($item, 'atualizou', [
            'antes' => ['nome' => 'anterior'], 'depois' => ['nome' => $item->nome],
        ]);
    }
    RegistroDeAuditoria::registrar($profissional, $operacao, diffDaLinhaMae());

    $contexto->fechar();

    return $loteId;
}

it('deve criar a coluna lote_id nula e o índice na auditoria', function () {
    // ASSERT — a migration nasceu sem backfill: coluna nula, índice (lote_id)
    expect(Schema::hasColumn('auditoria', 'lote_id'))->toBeTrue();
    $indices = collect(Schema::getIndexes('auditoria'))->pluck('columns');
    expect($indices->contains(fn (array $colunas): bool => $colunas === ['lote_id']))->toBeTrue();
});

it('deve gravar lote_id nulo fora de lote', function () {
    // ARRANGE
    admin();

    // ACT — escrita auditada pelo trait, sem lote aberto
    $usuario = Usuario::factory()->create();

    // ASSERT
    $registro = Auditoria::where('entidade', 'usuarios')->where('entidade_id', $usuario->id)
        ->where('acao', 'criou')->firstOrFail();
    expect($registro->lote_id)->toBeNull()
        ->and(app(ContextoDoLote::class)->id())->toBeNull();
});

it('deve carimbar o mesmo lote_id em cada linha auditada dentro do lote, inclusive na linha-mãe', function () {
    // ARRANGE — o profissional nasce ANTES do lote: a linha `criou` dele fica sem lote
    admin();
    $profissional = Profissional::factory()->create();

    // ACT
    $loteId = loteFicticio($profissional, 'a');

    // ASSERT — 3 filhas + 1 mãe com o mesmo uuid; nada de antes do lote foi carimbado
    expect(Str::isUuid($loteId))->toBeTrue();
    $linhas = Auditoria::where('lote_id', $loteId)->get();
    expect($linhas)->toHaveCount(4)
        ->and($linhas->where('entidade', 'itens_teste'))->toHaveCount(3)
        ->and($linhas->where('entidade', 'profissionais')->where('acao', 'baixa_em_lote'))->toHaveCount(1)
        ->and(Auditoria::where('entidade', 'profissionais')->where('acao', 'criou')->value('lote_id'))->toBeNull()
        ->and(app(ContextoDoLote::class)->id())->toBeNull();
});

it('deve devolver pelo filtro lote_id a linha-mãe e as filhas do lote, e nada de outro lote', function () {
    // ARRANGE — dois lotes na clínica
    $adminDaClinica = admin();
    $profissional = Profissional::factory()->create();
    $loteA = loteFicticio($profissional, 'a');
    $loteB = loteFicticio($profissional, 'b');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson("/api/auditoria?lote_id={$loteA}");

    // ASSERT — o lote inteiro (4), todos com o id do lote A; nenhuma linha do lote B
    $resposta->assertOk()->assertJsonPath('total', 4);
    $linhas = collect($resposta->json('data'));
    expect($linhas->pluck('lote_id')->unique()->all())->toBe([$loteA])
        ->and($linhas->pluck('lote_id'))->not->toContain($loteB)
        ->and($linhas->where('acao', 'baixa_em_lote')->where('entidade', 'profissionais'))->toHaveCount(1);

    // a linha-mãe sai com rótulo humano por chave e sem dado de criança
    $mae = $linhas->firstWhere('acao', 'baixa_em_lote');
    expect(collect($mae['alteracoes'])->pluck('campo')->all())
        ->toContain('Status aplicado', 'Data inicial', 'Data final', 'Agendamentos aplicados', 'Crianças distintas', 'Sessões descontadas', 'Recusados');
    expect(json_encode($mae, JSON_UNESCAPED_UNICODE))->not->toContain('paciente');
});

it('deve combinar lote_id com os filtros existentes da rota', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $profissional = Profissional::factory()->create();
    $loteId = loteFicticio($profissional, 'a');

    // ACT + ASSERT — só a mãe; só as filhas
    $this->actingAs($adminDaClinica)
        ->getJson("/api/auditoria?lote_id={$loteId}&entidade=profissionais")
        ->assertOk()->assertJsonPath('total', 1);
    $this->getJson("/api/auditoria?lote_id={$loteId}&acao=atualizou")
        ->assertOk()->assertJsonPath('total', 3);
});

it('deve devolver página vazia 200 para lote desconhecido', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $desconhecido = (string) Str::uuid7();

    // ACT + ASSERT — vazio, nunca 4xx: o filtro não é oráculo de existência
    $this->actingAs($adminDaClinica)->getJson("/api/auditoria?lote_id={$desconhecido}")
        ->assertOk()->assertJsonPath('total', 0);
});

it('deve recusar 422 em lote_id mal formado sem consultar a trilha', function (string $malFormado) {
    // ARRANGE
    $adminDaClinica = admin();
    DB::enableQueryLog();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/auditoria?lote_id='.urlencode($malFormado));

    // ASSERT — 422 no campo, e nenhuma consulta chegou à tabela da trilha
    $resposta->assertStatus(422)->assertJsonValidationErrors('lote_id');
    $consultasNaTrilha = collect(DB::getQueryLog())->filter(fn (array $q): bool => str_contains($q['query'], '`auditoria`'));
    expect($consultasNaTrilha)->toHaveCount(0);
    DB::disableQueryLog();
})->with([
    'texto curto' => ['abc'],
    '36 caracteres que não são uuid' => [str_repeat('x', 36)],
    'uuid com um caractere a menos' => ['0192b7e4-5d1a-7c3e-9f00-3a1c2b4d5e6'],
]);

it('deve fechar o contexto depois do rollback: o lote revertido não deixa rastro e a escrita seguinte nasce sem lote', function () {
    // ARRANGE
    admin();
    $profissional = Profissional::factory()->create();
    $contexto = app(ContextoDoLote::class);
    $loteId = null;

    // ACT — um PASSO falha depois de linhas já auditadas
    // closure clássica (não arrow fn): a arrow fn copiaria `$loteId` e a referência interna
    // apontaria para a cópia, não para a variável que o ASSERT lê
    $execucao = function () use ($contexto, $profissional, &$loteId): void {
        $contexto->executar('baixa_em_lote', function (string $id) use (&$loteId, $profissional): void {
            $loteId = $id;
            foreach ([1, 2] as $n) {
                $item = ItemTeste::create(['nome' => "Item revertido {$n}"]);
                RegistroDeAuditoria::registrar($item, 'atualizou', ['depois' => ['nome' => $item->nome]]);
            }
            RegistroDeAuditoria::registrar($profissional, 'baixa_em_lote', diffDaLinhaMae());
            throw new RuntimeException('falha forçada no meio do lote');
        });
    };

    // ASSERT — a exceção sobe; nada com aquele lote existe; o contexto está fechado
    expect($execucao)->toThrow(RuntimeException::class);
    expect($loteId)->not->toBeNull()
        ->and(Auditoria::where('lote_id', $loteId)->count())->toBe(0)
        ->and($contexto->id())->toBeNull();

    // a escrita auditada seguinte, na mesma requisição, nasce sem lote (o `finally` é a prova)
    $usuario = Usuario::factory()->create();
    expect(Auditoria::where('entidade', 'usuarios')->where('entidade_id', $usuario->id)->value('lote_id'))->toBeNull();
});

it('deve devolver o resultado do corpo e fechar o contexto quando o lote commita', function () {
    // ARRANGE
    admin();
    $profissional = Profissional::factory()->create();
    $contexto = app(ContextoDoLote::class);

    // ACT — dentro do corpo, o lote está aberto (abrir outro falha nomeando o que já está lá)
    $resultado = $contexto->executar('desmarque_em_lote', function (string $id) use ($profissional): array {
        RegistroDeAuditoria::registrar($profissional, 'desmarque_em_lote', ['depois' => ['motivo' => 'Consulta médica do profissional']]);

        try {
            app(ContextoDoLote::class)->abrir('baixa_em_lote');
            $aberto = null;
        } catch (LogicException $erro) {
            $aberto = $erro->getMessage();
        }

        return ['lote_id' => $id, 'aberto' => $aberto];
    });

    // ASSERT
    expect($resultado['aberto'])->toContain('desmarque_em_lote')
        ->and(Auditoria::where('lote_id', $resultado['lote_id'])->where('acao', 'desmarque_em_lote')->count())->toBe(1)
        ->and($contexto->id())->toBeNull();
});

it('deve recusar abrir um lote dentro de outro', function () {
    // ARRANGE
    $contexto = app(ContextoDoLote::class);
    $contexto->abrir('baixa_em_lote');

    // ACT + ASSERT — lote aninhado é bug de quem chamou, não caso a acomodar
    expect(fn () => $contexto->abrir('desmarque_em_lote'))->toThrow(LogicException::class);
    $contexto->fechar();
    expect(Str::isUuid($contexto->abrir('desmarque_em_lote')))->toBeTrue();
    $contexto->fechar();
});

it('deve rotular as chaves da linha-mãe e a operação em lote', function () {
    // ASSERT — a chave crua nunca sai; o rótulo do lote vale em qualquer entidade
    expect(RotulosDeAuditoria::rotular('profissionais', 'sessoes_descontadas'))->toBe('Sessões descontadas')
        ->and(RotulosDeAuditoria::rotular('profissionais', 'periodo'))->toBe('Período')
        ->and(RotulosDeAuditoria::rotular('profissionais', 'desmarcados'))->toBe('Agendamentos desmarcados')
        ->and(RotulosDeAuditoria::rotular('agendamentos', 'lote_id'))->toBe('Operação em lote')
        ->and(RotulosDeAuditoria::rotular('tratamentos', 'lote_id'))->toBe('Operação em lote');
});
