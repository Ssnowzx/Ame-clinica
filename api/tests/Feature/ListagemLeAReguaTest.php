<?php

use App\Models\Paciente;
use App\Support\CamposCadastro\ReguaDoCadastro;
use Illuminate\Support\Facades\DB;

/**
 * "CADASTRO INCOMPLETO" PASSA A SER DERIVADO DA RÉGUA (tarefas 2.5, 2.6, 3.1 e 3.2).
 *
 * O que estes testes protegem: o indicador que a recepção usa para saber o que ainda falta
 * preencher. Ele mentiria nos dois sentidos se continuasse na dupla fixa de antes —
 * acusando de incompleto o que a clínica declarou opcional, e dando por completo o que ela
 * declarou obrigatório.
 *
 * E a listagem não pode engordar por causa disso: quem não configura nada tem de continuar
 * pagando exatamente a mesma consulta (design D6).
 *
 * Dados 100% FICTÍCIOS (LGPD).
 */
function pacienteDoBalcao(array $atributos = []): Paciente
{
    return Paciente::factory()->create([
        'nascimento' => null,
        'necessidade' => null,
        'sexo' => null,
        ...$atributos,
    ]);
}

it('deve continuar acusando incompleto exatamente como antes, sem override', function () {
    // ARRANGE
    $usuario = admin();
    pacienteDoBalcao();

    // ACT
    $resposta = $this->actingAs($usuario)->getJson('/api/pacientes');

    // ASSERT
    $resposta->assertOk()->assertJsonPath('data.0.cadastro_incompleto', true);
});

it('NÃO deve acusar incompleto o que a clínica declarou opcional', function () {
    // ARRANGE — o cadastro só não tem `necessidade` e `sexo`
    $usuario = admin();
    pacienteDoBalcao(['nascimento' => now()->subYears(8)->toDateString()]);

    // ACT
    app(ReguaDoCadastro::class)->gravar('necessidade', ['obrigatorio' => false]);
    app(ReguaDoCadastro::class)->gravar('sexo', ['obrigatorio' => false]);

    // ASSERT
    $this->actingAs($usuario)->getJson('/api/pacientes')
        ->assertOk()->assertJsonPath('data.0.cadastro_incompleto', false);
});

it('deve passar a acusar incompleto o que a clínica declarou obrigatório', function () {
    // ARRANGE — cadastro completo pela régua padrão, sem cidade no endereço
    $usuario = admin();
    Paciente::factory()->create([
        'nascimento' => now()->subYears(8)->toDateString(),
        'necessidade' => 'sem',
        'sexo' => 'feminino',
        'endereco_json' => ['bairro' => 'Centro'],
    ]);

    $this->actingAs($usuario)->getJson('/api/pacientes')
        ->assertJsonPath('data.0.cadastro_incompleto', false);

    // ACT
    app(ReguaDoCadastro::class)->gravar('endereco_cidade', ['obrigatorio' => true]);

    // ASSERT — e nenhum cadastro foi alterado para isso
    $this->actingAs($usuario)->getJson('/api/pacientes')
        ->assertJsonPath('data.0.cadastro_incompleto', true);
    expect(Paciente::firstOrFail()->endereco_json)->toBe(['bairro' => 'Centro']);
});

it('NÃO deve acusar incompleto por causa de campo que a clínica escondeu', function () {
    // ARRANGE — esconder um campo obrigatório não pode acender a lista inteira
    $usuario = admin();
    pacienteDoBalcao(['nascimento' => now()->subYears(8)->toDateString(), 'sexo' => 'feminino']);

    // ACT
    app(ReguaDoCadastro::class)->gravar('necessidade', ['desabilitado' => true]);

    // ASSERT
    $this->actingAs($usuario)->getJson('/api/pacientes')
        ->assertJsonPath('data.0.cadastro_incompleto', false);
});

it('deve tratar lista obrigatória vazia como ausência', function () {
    // ARRANGE
    $usuario = admin();
    Paciente::factory()->create([
        'nascimento' => now()->subYears(30)->toDateString(),
        'necessidade' => 'sem',
        'sexo' => 'masculino',
        'contatos_json' => [],
    ]);

    // ACT
    app(ReguaDoCadastro::class)->gravar('contatos_json', ['obrigatorio' => true]);

    // ASSERT — "exige contato" com a lista vazia não está atendido
    $this->actingAs($usuario)->getJson('/api/pacientes')
        ->assertJsonPath('data.0.cadastro_incompleto', true);
});

it('NÃO deve engordar a consulta de quem não configurou nada', function () {
    // ARRANGE
    $usuario = admin();
    pacienteDoBalcao();

    $consultas = [];
    DB::listen(function ($c) use (&$consultas): void {
        if (str_contains(strtolower($c->sql), 'from `pacientes`')) {
            $consultas[] = strtolower($c->sql);
        }
    });

    // ACT
    $this->actingAs($usuario)->getJson('/api/pacientes')->assertOk();

    // ASSERT — o SELECT de antes desta change, coluna por coluna. Nenhum JSON entra.
    $selects = array_values(array_filter($consultas, fn (string $sql): bool => str_contains($sql, 'select `id`')));
    expect($selects)->not->toBe([]);

    foreach (['`id`', '`nome`', '`nome_social`', '`nascimento`', '`necessidade`', '`ativo`', '`sexo`'] as $coluna) {
        expect($selects[0])->toContain($coluna);
    }

    expect($selects[0])->not->toContain('endereco_json')
        ->and($selects[0])->not->toContain('contatos_json')
        ->and($selects[0])->not->toContain('responsaveis_json');
});

it('deve carregar a coluna JSON só quando a régua precisar dela', function () {
    // ARRANGE
    $usuario = admin();
    pacienteDoBalcao();
    app(ReguaDoCadastro::class)->gravar('endereco_cidade', ['obrigatorio' => true]);

    $consultas = [];
    DB::listen(function ($c) use (&$consultas): void {
        if (str_contains(strtolower($c->sql), 'select `id`')) {
            $consultas[] = strtolower($c->sql);
        }
    });

    // ACT
    $resposta = $this->actingAs($usuario)->getJson('/api/pacientes')->assertOk();

    // ASSERT — o endereço entra no SELECT, e continua FORA do payload (T-pac-01)
    expect($consultas[0])->toContain('endereco_json');
    semVazamento($resposta->json('data.0'), 'endereco_json');
    expect(array_keys($resposta->json('data.0')))->not->toContain('endereco_json');
});

it('deve exigir sexo no pré-cadastro enquanto a clínica não o escondeu', function () {
    // ARRANGE
    $usuario = admin();

    // ACT / ASSERT
    $this->actingAs($usuario)->postJson('/api/pacientes/pre-cadastro', [
        'nome' => 'Criança Fictícia do Balcão',
        'telefone' => '48999990000',
    ])->assertUnprocessable()->assertJsonValidationErrors('sexo');
});

it('NÃO deve exigir no balcão o sexo que a clínica escondeu do cadastro', function () {
    // ARRANGE — exigir ao telefone um dado que nem aparece no formulário deixaria a
    // recepção sem saída
    $usuario = admin();
    app(ReguaDoCadastro::class)->gravar('sexo', ['desabilitado' => true]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/pacientes/pre-cadastro', [
        'nome' => 'Criança Fictícia do Balcão',
        'telefone' => '48999990000',
    ]);

    // ASSERT
    $resposta->assertCreated();
    expect(Paciente::firstOrFail()->sexo)->toBeNull();
});

it('deve desativar pré-cadastrado mesmo com a régua apertada ao máximo', function () {
    // ARRANGE — a régua NÃO alcança o endpoint de situação: corrigir um erro de digitação
    // não pode voltar a exigir que alguém invente dado de saúde de um menor
    // (change faxina-de-gatilhos)
    $usuario = admin();
    $paciente = pacienteDoBalcao();

    $regua = app(ReguaDoCadastro::class);
    foreach (['necessidade', 'endereco_cidade', 'endereco_cep', 'cpf', 'contatos_json'] as $campo) {
        $regua->gravar($campo, ['obrigatorio' => true]);
    }

    // ACT
    $resposta = $this->actingAs($usuario)
        ->withHeader('If-Match', $paciente->updated_at->toISOString())
        ->patchJson("/api/pacientes/{$paciente->id}/situacao", ['ativo' => false]);

    // ASSERT
    $resposta->assertOk();
    expect($paciente->refresh()->ativo)->toBeFalse()
        ->and($paciente->nascimento)->toBeNull()
        ->and($paciente->necessidade)->toBeNull();
});

it('deve dizer em português quando o balcão manda o sexo que a clínica escondeu', function () {
    // ARRANGE — a nossa tela omite a chave, mas um cliente antigo (ou uma aba aberta antes
    // da mudança) ainda a manda; a recusa não pode sair como texto de máquina
    $usuario = admin();
    app(ReguaDoCadastro::class)->gravar('sexo', ['desabilitado' => true]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/pacientes/pre-cadastro', [
        'nome' => 'Criança Fictícia do Balcão',
        'sexo' => 'feminino',
        'telefone' => '48999990000',
    ]);

    // ASSERT
    $resposta->assertUnprocessable();
    $mensagem = $resposta->json('errors.sexo.0');
    expect($mensagem)->toContain('Sexo')
        ->and($mensagem)->not->toContain('não pode estar presente');
});
