<?php

use App\Models\Auditoria;
use App\Models\Paciente;

/**
 * GUARDA do pré-cadastro pelo balcão (change pre-cadastro-de-paciente): mínimo
 * obrigatório {nome, sexo, telefone}, "incompleto" DERIVADO na listagem (nunca flag),
 * cura pelo PUT completo, boundary completo intacto e demografia sem inventar idade.
 * LGPD: dados 100% fictícios.
 */
function preCadastroFicticio(): array
{
    return [
        'nome' => 'Paciente Fictício do Balcão',
        'sexo' => 'nao_informado',
        'telefone' => '48988887777',
    ];
}

it('deve criar pelo mínimo, com telefone como contato, auditado e incompleto na listagem', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/pacientes/pre-cadastro', preCadastroFicticio());

    // ASSERT — criado com o telefone na MESMA estrutura do cadastro; trilha de criação
    $resposta->assertCreated()->assertJsonPath('nome', 'Paciente Fictício do Balcão');
    $paciente = Paciente::firstOrFail();
    expect($paciente->nascimento)->toBeNull()
        ->and($paciente->necessidade)->toBeNull()
        ->and($paciente->contatos_json)->toBe([['tipo' => 'celular', 'valor' => '48988887777']]);
    expect(Auditoria::where('entidade', 'pacientes')->where('acao', 'criou')->count())->toBe(1);

    $lista = $this->actingAs($adminDaClinica)->getJson('/api/pacientes');
    expect($lista->json('data.0.cadastro_incompleto'))->toBeTrue();
});

it('deve recusar pré-cadastro sem cada um dos obrigatórios', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT — cada ausência recusa no próprio campo; nada persiste
    foreach (['nome', 'sexo', 'telefone'] as $campo) {
        $payload = preCadastroFicticio();
        unset($payload[$campo]);
        $this->actingAs($adminDaClinica)->postJson('/api/pacientes/pre-cadastro', $payload)
            ->assertUnprocessable()->assertJsonValidationErrors($campo);
    }
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes/pre-cadastro', [
        ...preCadastroFicticio(),
        'sexo' => 'indefinido',
    ])->assertUnprocessable()->assertJsonValidationErrors('sexo');
    expect(Paciente::count())->toBe(0);
});

it('deve negar pré-cadastro sem pacientes.criar', function () {
    // ARRANGE — quem só administra a fila não cria paciente
    admin();
    $fila = usuarioCom(['lista_espera.criar'], 'Fila Sem Criar Paciente');

    // ACT + ASSERT
    $this->actingAs($fila)->postJson('/api/pacientes/pre-cadastro', preCadastroFicticio())
        ->assertForbidden();
    expect(Paciente::count())->toBe(0);
});

it('deve curar o incompleto quando a ficha é completada pelo PUT normal', function () {
    // ARRANGE — pré-cadastro criado
    $adminDaClinica = admin();
    $id = $this->actingAs($adminDaClinica)
        ->postJson('/api/pacientes/pre-cadastro', preCadastroFicticio())->json('id');

    // ACT — a ficha é completada (adulto fictício: sem exigência de responsável)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/pacientes/{$id}", [
        'nome' => 'Paciente Fictício do Balcão',
        'nascimento' => now()->subYears(30)->toDateString(),
        'sexo' => 'nao_informado',
        'necessidade' => 'sem',
        'responsaveis_json' => [],
        'contatos_json' => [['tipo' => 'celular', 'valor' => '48988887777']],
        'consentimentos_json' => [],
    ])->assertOk();

    // ASSERT — derivado: sem flag para limpar, a listagem cura sozinha
    $lista = $this->actingAs($adminDaClinica)->getJson('/api/pacientes');
    expect($lista->json('data.0.cadastro_incompleto'))->toBeFalse();
});

it('não deve afrouxar o boundary completo', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT — POST completo segue exigindo nascimento e necessidade
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        'nome' => 'Paciente Fictício Completo',
        'sexo' => 'feminino',
        'responsaveis_json' => [],
    ])->assertUnprocessable()->assertJsonValidationErrors(['nascimento', 'necessidade']);
    expect(Paciente::count())->toBe(0);
});

it('deve contar pré-cadastro como "não informado" na faixa etária, sem quebrar a partição', function () {
    // ARRANGE — um completo (7 anos) e um pré-cadastro sem nascimento
    $adminDaClinica = admin();
    Paciente::factory()->create(['nascimento' => now()->subYears(7)->toDateString(), 'ativo' => true]);
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes/pre-cadastro', preCadastroFicticio())
        ->assertCreated();
    $mes = agoraNaClinica()->format('Y-m');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson("/api/indicadores/pacientes?mes={$mes}");

    // ASSERT — linha própria, partição preservada (soma = ativos)
    $resposta->assertOk();
    $faixas = collect($resposta->json('por_faixa_etaria'));
    expect($faixas->firstWhere('faixa', 'não informado')['total'])->toBe(1)
        ->and($faixas->sum('total'))->toBe($resposta->json('ativos'));
});

// ── Guarda de HOMÔNIMO exato (change faxina-de-gatilhos) ────────────────────

it('deve recusar pré-cadastro com nome IDÊNTICO, sem criar e sem vazar o existente', function () {
    // ARRANGE — o que produz duplicata de verdade é o mesmo nome digitado outra vez
    $adminDaClinica = admin();
    $existente = Paciente::factory()->create(['nome' => 'Paciente Fictício do Balcão']);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/pacientes/pre-cadastro', preCadastroFicticio());

    // ASSERT — 409 (o payload é VÁLIDO; falta uma decisão humana), nada criado, e a resposta não
    // conta nada sobre o paciente existente além de ele existir
    // asserção EXATA: "não contém o id" passaria por acidente (id 1 não tem dígito na mensagem) e
    // não pegaria vazamento de nome/sexo/telefone do existente. Assim, qualquer campo acrescentado
    // "para ajudar a tela" reprova aqui (achado CR-FX-11 do gate).
    $resposta->assertStatus(409)->assertExactJson([
        'message' => 'Já existe um paciente com este nome. Se for outra criança, confirme para criar.',
        'homonimo' => true,
    ]);
    expect(Paciente::count())->toBe(1);
    expect($existente->fresh()->ativo)->toBeTrue();
});

it('deve tratar caixa, espaço, ACENTO e invisível como o MESMO nome', function () {
    // ARRANGE — a régua da igualdade é normalizada; senão a guarda é contornada por um espaço, uma
    // maiúscula ou um acento. O acento é a variância de digitação mais comum em pt-BR (Andréa ×
    // Andrea) e é justamente "o mesmo nome digitado outra vez" (gate CR-FX-09/SEC-FX-03).
    $adminDaClinica = admin();
    Paciente::factory()->create(['nome' => 'Paciente Fictício do Balcão']);

    // ACT + ASSERT — cada variação é o MESMO nome e tem de ser recusada
    $variacoes = [
        'caixa e espaços' => '  paciente   fictício do balcão ',
        'sem acento' => 'Paciente Ficticio do Balcao',
        'invisível colado' => "Paciente Fict\u{00ED}cio do Balc\u{00E3}o\u{200B}",
        'espaço não-quebrável' => "Paciente\u{00A0}Fictício do Balcão",
    ];
    foreach ($variacoes as $porque => $variacao) {
        $this->actingAs($adminDaClinica)
            ->postJson('/api/pacientes/pre-cadastro', [...preCadastroFicticio(), 'nome' => $variacao])
            ->assertStatus(409, "variação «{$porque}» deveria contar como o mesmo nome");
    }
    expect(Paciente::count())->toBe(1);
});

it('deve tratar nome REALMENTE diferente como outro paciente', function () {
    // ARRANGE — o contraponto do teste acima: a régua não pode colar nomes distintos (é o
    // falso-positivo que a decisão D5 recusa — irmãos com nomes parecidos são a norma)
    $adminDaClinica = admin();
    Paciente::factory()->create(['nome' => 'Maria Fictícia Silva']);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->postJson('/api/pacientes/pre-cadastro', [...preCadastroFicticio(), 'nome' => 'Marina Fictícia Silva'])
        ->assertCreated();
});

it('deve criar a segunda criança quando o homônimo é confirmado', function () {
    // ARRANGE — irmãos homônimos existem: a guarda avisa, não proíbe
    $adminDaClinica = admin();
    $irmao = Paciente::factory()->create(['nome' => 'Paciente Fictício do Balcão']);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/pacientes/pre-cadastro', [
        ...preCadastroFicticio(),
        'confirmar_homonimo' => true,
    ]);

    // ASSERT — criado e auditado como criação, igual a qualquer pré-cadastro (a trilha é do
    // paciente NOVO: a factory do irmão também deixa a sua)
    $resposta->assertCreated();
    expect(Paciente::count())->toBe(2);
    $novo = Paciente::where('id', '!=', $irmao->id)->firstOrFail();
    expect(
        Auditoria::where('entidade', 'pacientes')
            ->where('entidade_id', $novo->id)
            ->where('acao', 'criou')
            ->count()
    )->toBe(1);
});

it('não deve pedir confirmação para nome diferente', function () {
    // ARRANGE
    $adminDaClinica = admin();
    Paciente::factory()->create(['nome' => 'Outra Criança Fictícia']);

    // ACT + ASSERT — o caminho normal não ganhou fricção
    $this->actingAs($adminDaClinica)
        ->postJson('/api/pacientes/pre-cadastro', preCadastroFicticio())
        ->assertCreated();
});

it('deve aceitar a confirmação de homônimo em qualquer forma booleana válida', function () {
    // ARRANGE — a regra `boolean` do Laravel aceita true/false/0/1/'0'/'1', mas a leitura crua com
    // `!== true` só reconhecia o `true` JSON. Um cliente form-encoded (ou curl) manda `1`, recebe o
    // 409 que pede confirmação, reenvia confirmando — e recebe 409 DE NOVO, para sempre: a única
    // saída que a guarda oferece ficava inalcançável (achado CR-FX-01 do gate).
    $adminDaClinica = admin();
    Paciente::factory()->create(['nome' => 'Paciente Fictício do Balcão']);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes/pre-cadastro', [
        ...preCadastroFicticio(),
        'confirmar_homonimo' => 1,
    ])->assertCreated();
});

it('deve aceitar o telefone que não recebe WhatsApp — o aviso é da tela, nunca um bloqueio', function () {
    // ARRANGE — change telefone-que-chega-no-whatsapp: a spec de `pacientes` proíbe travar a
    // recepção por telefone ruim; a tela avisa, o servidor grava
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/pacientes/pre-cadastro', [
        ...preCadastroFicticio(),
        'telefone' => '55 49912-3456',
    ]);

    // ASSERT
    $resposta->assertCreated();
    expect(Paciente::firstOrFail()->contatos_json)->toBe([['tipo' => 'celular', 'valor' => '55 49912-3456']]);
});
