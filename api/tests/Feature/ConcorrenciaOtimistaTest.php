<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Auditoria;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Evolucao;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\TipoPagamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use Spatie\Permission\Models\Role;

/**
 * Vetores de RUNTIME da concorrência otimista (EX-05 · SEC-OCC) — a camada 2.
 * A camada 1 (completude) é a `ConcorrenciaOtimistaPorPadraoTest`; aqui se prova
 * o COMPORTAMENTO nas entidades representativas: 409 sobre versão velha (nada
 * gravado), 200 no round-trip verbatim, 428 fail-closed, token hostil sem 500,
 * precedência de segurança (404/403 vencem) e as exceções classificadas.
 *
 * O idioma do produto é payload INTEIRO no PUT — e a ordem real das defesas põe
 * o 422 do FormRequest ANTES do 404/403/409 (SEC-OCC-02): payload válido é
 * pré-condição para alcançar o que cada teste prova.
 */

/** Payload de paciente que passa o FormRequest inteiro (espelho local do idioma). */
function pacienteValidoParaOcc(string $nome = 'Paciente Fictício Occ'): array
{
    return [
        'nome' => $nome,
        'nascimento' => now()->subYears(7)->toDateString(),
        'sexo' => 'feminino',
        'necessidade' => 'sem',
        'responsaveis_json' => [
            ['nome' => 'Responsável Fictícia', 'parentesco' => 'mãe', 'telefone' => '48999990000'],
        ],
    ];
}

it('deve recusar com 409 salvar sobre versão desatualizada — e nada é gravado', function () {
    // ARRANGE — A lê; o tempo passa; B salva (token fresco via helper)
    $adminDaClinica = admin();
    $criado = $this->actingAs($adminDaClinica)
        ->postJson('/api/pacientes', pacienteValidoParaOcc('Paciente Fictício Original'));
    $criado->assertCreated();
    $id = $criado->json('id');
    $tokenDeA = $criado->json('updated_at');
    expect($tokenDeA)->not->toBeNull();

    $this->travel(5)->seconds();
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/pacientes/{$id}", pacienteValidoParaOcc('Paciente Fictício Corrigido'))
        ->assertOk();

    // ACT — A tenta salvar por cima com o token da leitura antiga
    $resposta = $this->actingAs($adminDaClinica)
        ->putJson("/api/pacientes/{$id}", pacienteValidoParaOcc('Paciente Fictício Sobrescrito'), [
            'If-Match' => $tokenDeA,
        ]);

    // ASSERT — 409; a correção de B permanece; o corpo é FIXO (sem o registro,
    // sem o updated_at atual — reparar o token sem reler é proibido, SEC-OCC-05)
    $resposta->assertStatus(409);
    $paciente = Paciente::findOrFail($id);
    expect($paciente->nome)->toBe('Paciente Fictício Corrigido');
    $corpo = $resposta->getContent();
    expect($corpo)->not->toContain('Sobrescrito')
        ->and($corpo)->not->toContain('Corrigido')
        ->and($corpo)->not->toContain($paciente->updated_at->toISOString());
});

it('deve aceitar o round-trip VERBATIM: o token vindo do JSON da leitura salva com 200', function () {
    // ARRANGE — a leitura que hidrata o formulário é a fonte do token
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $tokenDaLeitura = $this->actingAs($adminDaClinica)
        ->getJson("/api/pacientes/{$paciente->id}")->assertOk()->json('updated_at');
    expect($tokenDaLeitura)->not->toBeNull();

    // ACT + ASSERT — a string crua, sem reformatação, confere
    $this->actingAs($adminDaClinica)
        ->putJson("/api/pacientes/{$paciente->id}", pacienteValidoParaOcc('Paciente Fictício Editado'), [
            'If-Match' => $tokenDaLeitura,
        ])->assertOk();
    expect($paciente->fresh()->nome)->toBe('Paciente Fictício Editado');
});

it('deve recusar com 428 o PUT sem versão — fail-closed, e o body não é superfície de token', function () {
    // ARRANGE — tratamento (o boundary da closure travada, C2), criado pela API
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $payload = payloadDeTratamento();
    $id = $this->postJson('/api/tratamentos', $payload)->assertCreated()->json('id');

    // ACT + ASSERT — sem header → 428, nada gravado
    $this->putJson("/api/tratamentos/{$id}", [...$payload, 'status' => 'parado'])
        ->assertStatus(428);

    // updated_at no BODY não substitui o header (SEC-OCC-09)
    $token = Tratamento::findOrFail($id)->updated_at->toISOString();
    $this->putJson("/api/tratamentos/{$id}", [...$payload, 'status' => 'parado', 'updated_at' => $token])
        ->assertStatus(428);
    expect(Tratamento::findOrFail($id)->status)->toBe('andamento');
});

it('deve responder controlado — nunca 500 — a token hostil', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();

    // ACT + ASSERT — lixo, `*`, e gigante: 409 (token que não representa o
    // instante atual não confere); vazio: 428 (equivale a ausente)
    foreach (['lixo-que-nao-e-data', '*', str_repeat('9', 300)] as $tokenHostil) {
        $this->actingAs($adminDaClinica)
            ->putJson("/api/pacientes/{$paciente->id}", pacienteValidoParaOcc(), [
                'If-Match' => $tokenHostil,
            ])->assertStatus(409);
    }
    $this->actingAs($adminDaClinica)
        ->putJson("/api/pacientes/{$paciente->id}", pacienteValidoParaOcc(), ['If-Match' => ''])
        ->assertStatus(428);
});

it('deve manter a precedência de segurança: id inexistente é 404 com ou sem If-Match', function () {
    // ARRANGE
    $admin = admin();
    $tokenVelho = Paciente::factory()->create()->updated_at->toISOString();

    // ACT + ASSERT — a versão NUNCA vira oráculo de existência (SEC-OCC-02)
    $this->actingAs($admin)
        ->putJson('/api/pacientes/99999999', pacienteValidoParaOcc(), ['If-Match' => $tokenVelho])
        ->assertNotFound();
    $this->actingAs($admin)
        ->putJson('/api/pacientes/99999999', pacienteValidoParaOcc())
        ->assertNotFound();
});

it('deve manter a posse antes da versão: escopado sem posse leva 403, nunca 409/428', function () {
    // ARRANGE — agendamento do profissional B; usuário escopado vinculado a A
    admin();
    $agendamentoDeB = Agendamento::factory()->create();
    $tokenVelho = $agendamentoDeB->updated_at->toISOString();
    $payloadValido = [
        'inicio' => $agendamentoDeB->inicio->format('Y-m-d H:i'),
        'fim' => $agendamentoDeB->fim->format('Y-m-d H:i'),
        'profissional_id' => $agendamentoDeB->profissional_id,
        'obs' => 'Tentativa fictícia.',
    ];
    $profissionalA = Profissional::factory()->create();
    $escopado = usuarioCom(['agenda.ver', 'agenda.criar', 'agenda.editar'], 'Escopado Sem Posse');
    $escopado->update(['profissional_id' => $profissionalA->id]);

    // ACT + ASSERT — com token velho E sem token: sempre 403 (posse primeiro)
    $this->actingAs($escopado)
        ->putJson("/api/agendamentos/{$agendamentoDeB->id}", $payloadValido, ['If-Match' => $tokenVelho])
        ->assertForbidden();
    $this->actingAs($escopado)
        ->putJson("/api/agendamentos/{$agendamentoDeB->id}", $payloadValido)
        ->assertForbidden();
});

it('deve manter as exceções classificadas FORA do regime: salvam sem If-Match', function () {
    // ARRANGE — atores e lookups ANTES das requests (guard pegajoso do sanctum)
    $adminDaClinica = admin();
    $colega = Usuario::factory()->create();
    $nivel = Role::findByName('Administrador');

    // ACT + ASSERT — configuração (upsert chave-a-chave)
    $this->actingAs($adminDaClinica)
        ->putJson('/api/configuracoes', ['chave' => 'agenda.granularidade_min', 'valor' => 30])
        ->assertOk();

    // atribuição de nível (intenção única)
    $this->actingAs($adminDaClinica)
        ->putJson("/api/usuarios/{$colega->id}/nivel-permissao", ['nivel_permissao_id' => $nivel->id])
        ->assertOk();
});

it('deve proteger a evolução: a segunda edição concorrente leva 409 e o texto salvo permanece', function () {
    // ARRANGE — a entidade-motivo da change (conteúdo mascarado na trilha:
    // perda irrecuperável). A e B abrem a mesma evolução.
    $adminDaClinica = admin();
    $atendimento = Atendimento::factory()->create();
    $autor = Profissional::factory()->create();
    $id = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $autor->id,
            'conteudo' => 'Texto original fictício.',
            'motivo_assinatura' => 'Registro administrativo.',
        ])->assertCreated()->json('id');
    $tokenDeA = $this->actingAs($adminDaClinica)
        ->getJson("/api/evolucoes/{$id}")->assertOk()->json('updated_at');
    expect($tokenDeA)->not->toBeNull();

    // B salva primeiro
    $this->travel(5)->seconds();
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/evolucoes/{$id}", ['conteudo' => 'Texto salvo por B, fictício.'])
        ->assertOk();

    // ACT — A tenta por cima com a leitura antiga
    $this->actingAs($adminDaClinica)
        ->putJson("/api/evolucoes/{$id}", ['conteudo' => 'Texto de A que apagaria o de B.'], [
            'If-Match' => $tokenDeA,
        ])->assertStatus(409);

    // ASSERT — o texto de B está intacto (relido pela API, leitura auditada)
    $conteudo = $this->actingAs($adminDaClinica)
        ->getJson("/api/evolucoes/{$id}")->json('conteudo');
    expect($conteudo)->toBe('Texto salvo por B, fictício.');
});

it('deve converter a corrida REAL do unique da evolução em 422 — sem evento órfão (1062)', function () {
    // ARRANGE — OBS-1 herdada da change `autoria-excecao`: a duplicata SEQUENCIAL
    // morre no pré-check; a de CORRIDA só aparece quando o rival nasce ENTRE o
    // pré-check e o save. O listener `creating` abre exatamente essa janela: o
    // rival é gravado (saveQuietly — sem recursão, sem observer) depois do
    // pré-check do controller e antes do INSERT — que então colide no unique.
    $adminDaClinica = admin();
    $atendimento = Atendimento::factory()->create();
    $autor = Profissional::factory()->create();
    $rivalJaNasceu = false;
    Evolucao::creating(function (Evolucao $evolucao) use (&$rivalJaNasceu, $autor): void {
        if ($rivalJaNasceu) {
            return; // dispara UMA vez; nas próximas criações do processo é no-op
        }
        $rivalJaNasceu = true;
        $rival = new Evolucao([
            'profissional_id' => $autor->id,
            'conteudo' => 'Texto rival fictício, nascido na janela da corrida.',
        ]);
        $rival->atendimento_id = $evolucao->atendimento_id;
        $rival->preenchida_em = now()->format('Y-m-d H:i');
        $rival->saveQuietly();
    });

    // ACT — o POST passa o pré-check (ainda não há evolução) e colide no INSERT
    $resposta = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $autor->id,
            'conteudo' => 'Texto que vai colidir no unique.',
            'motivo_assinatura' => 'Registro administrativo.',
        ]);

    // ASSERT — o caminho do 1062 foi EXERCITADO e convertido em 422 (nunca 500);
    // o rollback levou junto o rival (nascido DENTRO da transação do store —
    // numa corrida real entre conexões, o rival comitado sobreviveria; o que
    // este teste prova é o catch + a ausência de evento órfão) e ZERO
    // `assinou_por_outro` sobrou na trilha append-only
    $resposta->assertUnprocessable()->assertJsonValidationErrors('atendimento_id');
    expect(Evolucao::where('atendimento_id', $atendimento->id)->count())->toBe(0)
        ->and(Auditoria::where('entidade', 'evolucoes')->where('acao', 'assinou_por_outro')->count())->toBe(0);

    // ...e a corrida é TRANSIENTE: o retry (listener já consumido) cria normalmente
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $autor->id,
            'conteudo' => 'Texto do retry fictício.',
            'motivo_assinatura' => 'Registro administrativo.',
        ])->assertCreated();
    expect(Auditoria::where('entidade', 'evolucoes')->where('acao', 'assinou_por_outro')->count())->toBe(1);
});

it('deve TRAVAR e GRAVAR a evolução na MESMA transação — o epoch-pin do lock (C1)', function () {
    // ARRANGE — B2 do gate: apagar o DB::transaction+lockForUpdate do update
    // deixava a suíte verde (o 409 sequencial passa sem lock). O epoch reprova:
    // a leitura TRAVADA e o UPDATE têm de compartilhar a transação (padrão
    // TEST-LOCK-EPOCH da casa).
    $adminDaClinica = admin();
    $atendimento = Atendimento::factory()->create();
    $autor = Profissional::factory()->create();
    $id = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$atendimento->id}/evolucao", [
            'profissional_id' => $autor->id,
            'conteudo' => 'Texto fictício original.',
            'motivo_assinatura' => 'Registro administrativo.',
        ])->assertCreated()->json('id');
    $capturadas = capturarConsultasComEpoch();

    // ACT — um PUT real, com o token atual
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/evolucoes/{$id}", ['conteudo' => 'Texto fictício editado.'])
        ->assertOk();

    // ASSERT — a leitura de comparação é SOB LOCK e comita com a gravação
    $consultas = $capturadas();
    $epochDaLeituraTravada = epochDaConsulta($consultas, ['from `evolucoes`', 'for update']);
    $epochDaGravacao = epochDaConsulta($consultas, ['update `evolucoes`']);
    expect($epochDaGravacao)->toBe($epochDaLeituraTravada);
});

it('deve recusar com 409 no lançamento (o caminho do serviço financeiro)', function () {
    // ARRANGE — o PUT de lançamento aceita payload parcial (idioma próprio do módulo)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $categoria = Categoria::create(['nome' => 'Categoria Fictícia Occ', 'tipo' => 'despesa']);
    $conta = Conta::create(['nome' => 'Conta Fictícia Occ']);
    $tipoPagamento = TipoPagamento::create(['nome' => 'Pix Fictício Occ']);
    $id = $this->postJson('/api/lancamentos', [
        'tipo' => 'despesa',
        'competencia' => agoraNaClinica()->toDateString(),
        'vencimento' => agoraNaClinica()->toDateString(),
        'categoria_id' => $categoria->id,
        'valor' => '100.00',
        'tipo_pagamento_id' => $tipoPagamento->id,
        'conta_id' => $conta->id,
    ])->assertCreated()->json('id');
    $tokenVelho = $this->getJson("/api/lancamentos/{$id}")->json('updated_at');
    expect($tokenVelho)->not->toBeNull();

    $this->travel(5)->seconds();
    $this->putJsonComVersao("/api/lancamentos/{$id}", ['valor' => '150.00'])->assertOk();

    // ACT + ASSERT
    $this->putJson("/api/lancamentos/{$id}", ['valor' => '999.00'], ['If-Match' => $tokenVelho])
        ->assertStatus(409);
    expect($this->getJson("/api/lancamentos/{$id}")->json('valor'))->toBe('150.00');
});
