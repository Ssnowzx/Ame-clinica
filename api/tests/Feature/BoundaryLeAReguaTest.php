<?php

use App\Models\Paciente;
use App\Support\CamposCadastro\CatalogoCamposCadastro as Catalogo;
use App\Support\CamposCadastro\ReguaDoCadastro;

/**
 * O BOUNDARY DO PACIENTE LÊ A RÉGUA (change campos-do-cadastro-configuraveis, tarefas 2.2–2.6).
 *
 * O que estes testes protegem: a obrigatoriedade deixou de ser literal, e a régua é a única
 * autoridade. Dois modos de falha andam juntos aqui —
 *
 *   1. a régua afrouxa e o código continua exigindo (a clínica configura e nada acontece);
 *   2. a régua esconde e a API continua aceitando (meia guarda, contornável por qualquer
 *      cliente que não seja a nossa tela).
 *
 * Dados 100% FICTÍCIOS (LGPD).
 */
function reguaDoTeste(): ReguaDoCadastro
{
    return app(ReguaDoCadastro::class);
}

// `registrarExtra` mexe em estado ESTÁTICO: sem esta limpeza, o teste que simula a trava
// removida contamina os vizinhos que rodam depois no mesmo processo.
afterEach(function () {
    Catalogo::limparExtras();
});

function pacienteAdultoValido(): array
{
    return [
        'nome' => 'Paciente Fictício Adulto',
        'nascimento' => now()->subYears(30)->toDateString(),
        'sexo' => 'masculino',
        'necessidade' => 'sem',
        'responsaveis_json' => [],
    ];
}

it('deve deixar de exigir o campo que a clínica declarou opcional', function () {
    // ARRANGE
    $usuario = admin();
    $semNecessidade = pacienteAdultoValido();
    unset($semNecessidade['necessidade']);

    // sem a régua, este payload é 422 — é a exigência de antes da change
    $this->actingAs($usuario)->postJson('/api/pacientes', $semNecessidade)
        ->assertUnprocessable()->assertJsonValidationErrors('necessidade');

    // ACT
    reguaDoTeste()->gravar('necessidade', ['obrigatorio' => false]);

    // ASSERT
    $this->actingAs($usuario)->postJson('/api/pacientes', $semNecessidade)->assertCreated();
    expect(Paciente::firstOrFail()->necessidade)->toBeNull();
});

it('deve passar a exigir o campo que a clínica declarou obrigatório, mesmo dentro do endereço', function () {
    // ARRANGE — `cidade` mora em `endereco_json`, e é obrigatória na clínica de referência
    $usuario = admin();
    reguaDoTeste()->gravar('endereco_cidade', ['obrigatorio' => true]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/pacientes', [
        ...pacienteAdultoValido(),
        'endereco_json' => ['bairro' => 'Centro'],
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('endereco_json.cidade');
    expect(Paciente::count())->toBe(0);
});

it('deve exigir ao menos um item quando a clínica torna a lista obrigatória', function () {
    // ARRANGE
    $usuario = admin();
    reguaDoTeste()->gravar('contatos_json', ['obrigatorio' => true]);

    // ACT / ASSERT — lista vazia não satisfaz "obrigatório"
    $this->actingAs($usuario)->postJson('/api/pacientes', [
        ...pacienteAdultoValido(),
        'contatos_json' => [],
    ])->assertUnprocessable()->assertJsonValidationErrors('contatos_json');

    $this->actingAs($usuario)->postJson('/api/pacientes', [
        ...pacienteAdultoValido(),
        'contatos_json' => [['tipo' => 'celular', 'valor' => '48999990000']],
    ])->assertCreated();
});

it('deve recusar campo escondido que chega PREENCHIDO', function () {
    // ARRANGE
    $usuario = admin();
    reguaDoTeste()->gravar('estado_civil', ['desabilitado' => true]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/pacientes', [
        ...pacienteAdultoValido(),
        'estado_civil' => 'casado',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('estado_civil');
    expect(Paciente::count())->toBe(0);
});

it('deve recusar campo escondido que chega NULO', function () {
    // ARRANGE — o buraco do `prohibited`: ele aceitaria isto, e o campo escondido
    // continuaria gravável mandando `null` (D4 corrigido)
    $usuario = admin();
    reguaDoTeste()->gravar('estado_civil', ['desabilitado' => true]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/pacientes', [
        ...pacienteAdultoValido(),
        'estado_civil' => null,
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('estado_civil');
});

it('deve aceitar quando o campo escondido simplesmente não vem', function () {
    // ARRANGE
    $usuario = admin();
    reguaDoTeste()->gravar('estado_civil', ['desabilitado' => true]);

    // ACT / ASSERT — é assim que a nossa tela manda: sem a chave
    $this->actingAs($usuario)->postJson('/api/pacientes', pacienteAdultoValido())->assertCreated();
});

it('deve recusar campo escondido DENTRO do endereço', function () {
    // ARRANGE — o complemento é um dos que a clínica de referência escondeu
    $usuario = admin();
    reguaDoTeste()->gravar('endereco_complemento', ['desabilitado' => true]);

    // ACT / ASSERT
    $this->actingAs($usuario)->postJson('/api/pacientes', [
        ...pacienteAdultoValido(),
        'endereco_json' => ['cidade' => 'Lages', 'complemento' => 'Apto 12'],
    ])->assertUnprocessable()->assertJsonValidationErrors('endereco_json.complemento');
});

it('deve nomear o campo escondido como a clínica o chama, nunca pelo slug', function () {
    // ARRANGE — texto de máquina na tela é o defeito que a change
    // `texto-de-maquina-fora-da-tela` corrigiu em produção
    $usuario = admin();
    reguaDoTeste()->gravar('endereco_complemento', ['desabilitado' => true]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/pacientes', [
        ...pacienteAdultoValido(),
        'endereco_json' => ['complemento' => 'Apto 12'],
    ]);

    // ASSERT
    $mensagem = $resposta->json('errors.endereco_json\.complemento.0')
        ?? $resposta->json('errors')['endereco_json.complemento'][0];

    expect($mensagem)->toContain('Complemento')
        ->and($mensagem)->not->toContain('endereco_json')
        ->and($mensagem)->not->toContain('_');
});

it('deve manter a guarda do MENOR mesmo com responsáveis não obrigatório na régua', function () {
    // ARRANGE — a régua governa o adulto; a lei governa o menor (D5). Se esta guarda
    // virasse configurável, bastaria um PUT na régua para gravar dado de criança sem
    // nenhum responsável identificado.
    $usuario = admin();
    reguaDoTeste()->gravar('responsaveis_json', ['obrigatorio' => false]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/pacientes', [
        'nome' => 'Paciente Fictício Menor',
        'nascimento' => now()->subYears(7)->toDateString(),
        'sexo' => 'feminino',
        'necessidade' => 'sem',
        'responsaveis_json' => [],
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('responsaveis_json');
    expect(Paciente::count())->toBe(0);
});

it('deve continuar aceitando adulto sem responsável quando a régua não exige', function () {
    // ARRANGE / ACT / ASSERT — o outro lado da mesma moeda: a guarda é da MENORIDADE,
    // não da lista
    $usuario = admin();
    $this->actingAs($usuario)->postJson('/api/pacientes', pacienteAdultoValido())->assertCreated();
});

it('NÃO deve dizer "CPF inválido" para um CPF exigido e deixado em branco', function () {
    // ARRANGE — com `required` sem a saída antecipada na closure, a recepção lia DUAS
    // mensagens, uma delas mentindo sobre o motivo
    $usuario = admin();
    reguaDoTeste()->gravar('cpf', ['obrigatorio' => true]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/pacientes', [
        ...pacienteAdultoValido(),
        'cpf' => null,
    ]);

    // ASSERT
    $resposta->assertUnprocessable();
    $mensagens = $resposta->json('errors.cpf');
    expect($mensagens)->toHaveCount(1)
        ->and($mensagens[0])->not->toContain('inválido');
});

/*
 * OS EIXOS PELOS QUAIS A GUARDA DO MENOR PODERIA SER DESLIGADA (parecer SEC-RC-01).
 *
 * O teste que já existia cobria o eixo `responsaveis_json` — que é justamente o único
 * travado, e portanto o único que não podia furar. O eixo real era `nascimento`: a guarda
 * lia só o payload, e a régua governa o que entra no payload.
 */

it('NÃO deve deixar a régua afrouxar ou esconder o nascimento', function () {
    // ARRANGE — a porta da frente: `nascimento` virou campo travado nas duas chaves
    $usuario = admin();

    // ACT / ASSERT
    $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['nascimento' => ['obrigatorio' => false]],
    ])->assertUnprocessable()->assertJsonValidationErrors('campos.nascimento');

    $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['nascimento' => ['obrigatorio' => false, 'desabilitado' => true]],
    ])->assertUnprocessable()->assertJsonValidationErrors('campos.nascimento');
});

it('NÃO deve deixar a régua adulterada no BANCO afrouxar o nascimento', function () {
    // ARRANGE — parecer SEC-RC-07: a trava era conferida só na ESCRITA da régua, e
    // `gravar()` é caminho de persistência sem essa checagem (o `DemoSeeder` já o chama
    // direto). Um seeder ou migration das changes seguintes reabriria a porta em silêncio.
    // Agora a LEITURA grampeia a chave travada no padrão do catálogo.
    $usuario = admin();
    reguaDoTeste()->gravar('nascimento', ['obrigatorio' => false, 'desabilitado' => true]);

    // ACT / ASSERT — o dado torto está no banco e não vira comportamento torto
    expect(reguaDoTeste()->obrigatorio('nascimento'))->toBeTrue()
        ->and(reguaDoTeste()->desabilitado('nascimento'))->toBeFalse();

    $this->actingAs($usuario)->postJson('/api/pacientes', [
        'nome' => 'Paciente Fictício Menor',
        'sexo' => 'feminino',
        'necessidade' => 'sem',
        'responsaveis_json' => [['nome' => 'Responsável Fictícia', 'parentesco' => 'mãe']],
    ])->assertUnprocessable()->assertJsonValidationErrors('nascimento');
});

it('NÃO deve apagar os responsáveis de um MENOR já gravado quando o nascimento não vem no payload', function () {
    // ARRANGE — a DEFESA EM PROFUNDIDADE (repro A do parecer). A trava do catálogo fecha a
    // porta da frente; este teste prova a de baixo, simulando o dia em que alguém tirar a
    // trava: a guarda não pode voltar a depender de o cliente mandar a data.
    Catalogo::registrarExtra('nascimento', [
        ...Catalogo::definicao('nascimento'),
        'travas' => [],
    ]);
    $usuario = admin();
    $paciente = Paciente::factory()->create([
        'nascimento' => now()->subYears(8)->toDateString(),
        'necessidade' => 'sem',
        'sexo' => 'feminino',
        'responsaveis_json' => [['nome' => 'Responsável Fictícia', 'parentesco' => 'mãe']],
    ]);

    // a régua é forçada por baixo, sem passar pela API (que agora recusa)
    app(ReguaDoCadastro::class)->gravar('nascimento', ['obrigatorio' => false]);

    // ACT — o PUT do cadastro inteiro, SEM a chave `nascimento`
    $resposta = $this->actingAs($usuario)
        ->withHeader('If-Match', $paciente->updated_at->toISOString())
        ->putJson("/api/pacientes/{$paciente->id}", [
            'nome' => $paciente->nome,
            'sexo' => 'feminino',
            'necessidade' => 'sem',
            'responsaveis_json' => [],
        ]);

    // ASSERT — a idade sai do REGISTRO, não do corpo da requisição
    $resposta->assertUnprocessable()->assertJsonValidationErrors('responsaveis_json');
    expect($paciente->refresh()->responsaveis_json)->toHaveCount(1);
});

it('deve continuar aceitando o PUT de um ADULTO sem responsável e sem nascimento no payload', function () {
    // ARRANGE — o outro lado: a leitura do registro não pode passar a recusar adulto
    // (mesma simulação de trava removida do teste acima)
    Catalogo::registrarExtra('nascimento', [
        ...Catalogo::definicao('nascimento'),
        'travas' => [],
    ]);
    $usuario = admin();
    $paciente = Paciente::factory()->create([
        'nascimento' => now()->subYears(40)->toDateString(),
        'necessidade' => 'sem',
        'sexo' => 'masculino',
        'responsaveis_json' => [],
    ]);
    app(ReguaDoCadastro::class)->gravar('nascimento', ['obrigatorio' => false]);

    // ACT / ASSERT
    $this->actingAs($usuario)
        ->withHeader('If-Match', $paciente->updated_at->toISOString())
        ->putJson("/api/pacientes/{$paciente->id}", [
            'nome' => $paciente->nome,
            'sexo' => 'masculino',
            'necessidade' => 'sem',
            'responsaveis_json' => [],
        ])->assertOk();
});

it('deve exigir a lista obrigatória mesmo quando o cliente OMITE a chave', function () {
    // ARRANGE — parecer SEC-RC-02: `sometimes` desligava o `min:1` na ausência da chave, e
    // o sistema aceitava para depois acusar de incompleto o que ele mesmo aceitou
    $usuario = admin();
    reguaDoTeste()->gravar('contatos_json', ['obrigatorio' => true]);
    $semAChave = pacienteAdultoValido();
    expect($semAChave)->not->toHaveKey('contatos_json');

    // ACT / ASSERT
    $this->actingAs($usuario)->postJson('/api/pacientes', $semAChave)
        ->assertUnprocessable()->assertJsonValidationErrors('contatos_json');
    expect(Paciente::count())->toBe(0);
});

it('deve nomear o campo OBRIGATÓRIO como a clínica o chama, nunca pelo slug', function () {
    // ARRANGE — o caminho oposto ao do campo escondido, e o que está LIGADO na demo:
    // `cidade` obrigatória produzia "O campo endereco json.cidade é obrigatório."
    $usuario = admin();
    reguaDoTeste()->gravar('endereco_cidade', ['obrigatorio' => true]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/pacientes', [
        ...pacienteAdultoValido(),
        'endereco_json' => ['bairro' => 'Centro'],
    ]);

    // ASSERT
    $mensagem = $resposta->json('errors')['endereco_json.cidade'][0];
    expect($mensagem)->toContain('cidade')
        ->and($mensagem)->not->toContain('endereco')
        ->and($mensagem)->not->toContain('_');
});

it('deve nomear a lista obrigatória como a clínica a chama', function () {
    // ARRANGE — a recusa do `min:1` também caía no genérico ("O campo contatos json...")
    $usuario = admin();
    reguaDoTeste()->gravar('contatos_json', ['obrigatorio' => true]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/pacientes', [
        ...pacienteAdultoValido(),
        'contatos_json' => [],
    ]);

    // ASSERT
    /*
     * `not->toContain('json')`, e NÃO `'_json'` (achado CR-N2): o fallback do Laravel já
     * troca `_` por espaço, então "O campo contatos json…" passava nas duas asserções
     * antigas — o teste ficava verde COM e SEM o `attributes()`. Só a palavra inteira
     * separa o fix do fallback.
     *
     * `not->toContain('itens')` é o achado N2 do passe de navegador: o `attributes()`
     * traduzia o NOME do campo e deixava o CORPO da frase no padrão do Laravel, que
     * chegava à tela como "deve ter ao menos 1 itens" — concordância errada.
     */
    $mensagem = $resposta->json('errors')['contatos_json'][0];
    expect($mensagem)->toBe('Informe pelo menos um contato.')
        ->and($mensagem)->not->toContain('json')
        ->and($mensagem)->not->toContain('itens');
});

it('deve nomear o RESPONSÁVEL no singular quando a lista obrigatória chega vazia', function () {
    // ARRANGE — é a recusa que o operador vê ao cadastrar um menor sem responsável
    $usuario = admin();
    reguaDoTeste()->gravar('responsaveis_json', ['obrigatorio' => true]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/pacientes', [
        ...pacienteAdultoValido(),
        'responsaveis_json' => [],
    ]);

    // ASSERT
    $mensagem = $resposta->json('errors')['responsaveis_json'][0];
    expect($mensagem)->toBe('Informe pelo menos um responsável.')
        ->and($mensagem)->not->toContain('json')
        ->and($mensagem)->not->toContain('itens');
});

it('NÃO deve apagar o subcampo de endereço que a clínica escondeu depois de gravado', function () {
    // ARRANGE — a assimetria que os pareceres CR-I4 e SEC-RC-04 apontaram: campo escalar
    // escondido preserva o valor (a chave some do payload e o update não toca a coluna),
    // mas dentro do JSON o cliente remonta o objeto inteiro e o update substitui tudo
    $usuario = admin();
    $paciente = Paciente::factory()->create([
        'nascimento' => now()->subYears(30)->toDateString(),
        'necessidade' => 'sem',
        'sexo' => 'masculino',
        'responsaveis_json' => [],
        'endereco_json' => ['cidade' => 'Lages', 'complemento' => 'Apto 12'],
    ]);
    reguaDoTeste()->gravar('endereco_complemento', ['desabilitado' => true]);

    // ACT — a tela manda o endereço SEM a chave escondida, como o `missing` obriga
    $this->actingAs($usuario)
        ->withHeader('If-Match', $paciente->updated_at->toISOString())
        ->putJson("/api/pacientes/{$paciente->id}", [
            'nome' => $paciente->nome,
            'nascimento' => $paciente->nascimento->format('Y-m-d'),
            'sexo' => 'masculino',
            'necessidade' => 'sem',
            'responsaveis_json' => [],
            'endereco_json' => ['cidade' => 'Lages'],
        ])->assertOk();

    // ASSERT — o complemento sobrevive; a cidade é a que veio
    expect($paciente->refresh()->endereco_json)
        ->toBe(['cidade' => 'Lages', 'complemento' => 'Apto 12']);
});
