<?php

use App\Models\Auditoria;
use App\Models\Paciente;
use App\Models\Usuario;

const CPF_VALIDO = '52998224725';

it('deve criar paciente menor com responsável', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/pacientes', pacienteMenorValido());

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('nome', 'Paciente Fictício Menor');
    $registro = Auditoria::where('entidade', 'pacientes')->where('acao', 'criou')->firstOrFail();
    expect($registro->usuario_id)->toBe($adminDaClinica->id);
});

it('deve rejeitar menor de idade sem responsável', function () {
    // ARRANGE — abuse case: menoridade calculada do nascimento (D7)
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'responsaveis_json' => [],
    ])->assertUnprocessable()->assertJsonValidationErrors('responsaveis_json');
    expect(Paciente::count())->toBe(0);
});

it('deve aceitar paciente adulto sem responsável', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'nome' => 'Paciente Fictício Adulto',
        'nascimento' => now()->subYears(30)->toDateString(),
        'responsaveis_json' => [],
    ])->assertCreated();
});

it('deve rejeitar cpf inválido e cpf duplicado', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT — dígito verificador errado
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'cpf' => '12345678901',
    ])->assertUnprocessable()->assertJsonValidationErrors('cpf');

    // válido cria; duplicado → 422
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'cpf' => CPF_VALIDO,
    ])->assertCreated();
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'nome' => 'Outro Paciente Fictício',
        'cpf' => CPF_VALIDO,
    ])->assertUnprocessable()->assertJsonValidationErrors('cpf');
});

it('deve mascarar o cpf no diff de auditoria', function () {
    // ARRANGE — design D5 (LGPD)
    $adminDaClinica = admin();
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'cpf' => CPF_VALIDO,
    ]);
    $criar->assertCreated();
    $id = $criar->json('id');

    // ACT — remover o cpf (mudança auditada)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/pacientes/{$id}", [
        ...pacienteMenorValido(),
        'cpf' => null,
    ])->assertOk();

    // ASSERT — nem criação nem alteração expõem o CPF
    $registros = Auditoria::where('entidade', 'pacientes')->get();
    foreach ($registros as $registro) {
        expect(json_encode($registro->diff_json))->not->toContain(CPF_VALIDO);
    }
});

it('deve rejeitar contato de tipo desconhecido e chave extra em responsável', function () {
    // ARRANGE — abuse case: whitelist dos JSONs (D6)
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'contatos_json' => [['tipo' => 'pombo-correio', 'valor' => 'x']],
    ])->assertUnprocessable()->assertJsonValidationErrors('contatos_json.0.tipo');

    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'responsaveis_json' => [
            ['nome' => 'R', 'parentesco' => 'pai', 'cpf' => '00000000000'],
        ],
    ])->assertUnprocessable()->assertJsonValidationErrors('responsaveis_json.0');
    expect(Paciente::count())->toBe(0);
});

it('deve registrar consentimento carimbando o aceite no servidor', function () {
    // ARRANGE — o instante do aceite é PROVA LEGAL do consentimento de um MENOR: ele não
    // pode vir do relógio do balcão (gate cadastros-pessoas, SEC-01/SEC-10). E, desde a
    // change aceite-do-regulamento (FA-08), a RÉGUA também é do servidor: o aceite aponta
    // para a versão VIGENTE do termo, e o cliente manda só quem aceitou.
    $adminDaClinica = admin();
    $termo = termoVigente();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'consentimentos_json' => [['responsavel' => 'Responsável Fictícia']],
    ]);

    // ASSERT — a prova é montada inteira pelo servidor
    $resposta->assertCreated();
    expect($resposta->json('consentimentos_json.0.termo_id'))->toBe($termo->id)
        ->and($resposta->json('consentimentos_json.0.versao'))->toBe(1)
        ->and($resposta->json('consentimentos_json.0.termo'))->toBe($termo->titulo)
        ->and($resposta->json('consentimentos_json.0.responsavel'))->toBe('Responsável Fictícia')
        ->and($resposta->json('consentimentos_json.0.forma'))->toBe('papel')
        ->and($resposta->json('consentimentos_json.0.registrado_por'))->toBe($adminDaClinica->id)
        ->and($resposta->json('consentimentos_json.0.aceito_em'))->not->toBeNull();
});

it('deve salvar cadastro normalmente numa clínica SEM termo vigente', function () {
    // ARRANGE — a guarda `$novos === []` do carimbo é o que impede que a ausência de
    // termo trave TODO o cadastro. Hoje ela está coberta por acidente (dezenas de testes
    // criam paciente sem publicar termo); acidente não é cobertura (lição de 2026-07-24)
    $adminDaClinica = admin();
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/pacientes', pacienteMenorValido());
    $criar->assertCreated();

    // ACT — e o PUT com a lista VAZIA também passa
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/pacientes/{$criar->json('id')}", [
        ...pacienteMenorValido(),
        'obs' => 'Observação fictícia.',
        'consentimentos_json' => [],
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('consentimentos_json'))->toBe([]);
});

it('deve recusar o aceite quando nenhum termo está vigente', function () {
    // ARRANGE — registrar que alguém aceitou um texto que ninguém consegue exibir depois
    // é registrar prova de nada (design D4)
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'consentimentos_json' => [['responsavel' => 'Responsável Fictícia']],
    ])->assertUnprocessable()->assertJsonValidationErrors('consentimentos_json');
    expect(Paciente::count())->toBe(0);
});

it('deve recusar a régua escolhida pelo cliente, campo a campo', function () {
    // ARRANGE — quem escolhe o termo, a versão, a forma ou o autor do registro está
    // fabricando prova, exatamente como quem carimbava o instante
    $adminDaClinica = admin();
    termoVigente();

    // ACT + ASSERT
    $proibidos = [
        'termo' => 'Termo digitado no balcão',
        'termo_id' => 999,
        'versao' => 7,
        'forma' => 'digital',
        'registrado_por' => 1,
    ];
    foreach ($proibidos as $campo => $valor) {
        $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
            ...pacienteMenorValido(),
            'consentimentos_json' => [['responsavel' => 'Responsável Fictícia', $campo => $valor]],
        ])->assertUnprocessable()->assertJsonValidationErrors("consentimentos_json.0.{$campo}");
    }
    expect(Paciente::count())->toBe(0);
});

it('deve recusar o aceite carimbado pelo cliente', function () {
    // ARRANGE — quem manda `aceito_em` está fabricando prova
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'consentimentos_json' => [
            ['responsavel' => 'R', 'aceito_em' => '2020-01-01T00:00:00+00:00'],
        ],
    ])->assertUnprocessable()->assertJsonValidationErrors('consentimentos_json.0.aceito_em');
    expect(Paciente::count())->toBe(0);

    // ...e a chave NULA também é fabricação de prova (gatilho PROHIBITED-NULL): `prohibited`
    // (= "ausente OU vazio") a deixava PASSAR — e o carimbo do servidor cairia sobre uma
    // chave que o cliente já pôs na estrutura. Quem manda a chave está mandando o campo.
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'consentimentos_json' => [
            ['responsavel' => 'R', 'aceito_em' => null],
        ],
    ])->assertUnprocessable()->assertJsonValidationErrors('consentimentos_json.0.aceito_em');
    expect(Paciente::count())->toBe(0);
});

it('deve anexar consentimentos sem apagar os existentes', function () {
    // ARRANGE — o PUT do cadastro inteiro, montado sobre cache VELHO, apagava em
    // silêncio o consentimento que outra aba tinha acabado de registrar (SEC-02)
    $adminDaClinica = admin();
    termoVigente();
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'consentimentos_json' => [['responsavel' => 'Primeira Responsável Fictícia']],
    ]);
    $criar->assertCreated();
    $id = $criar->json('id');

    // ACT — um PUT que NÃO conhece o consentimento antigo
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/pacientes/{$id}", [
        ...pacienteMenorValido(),
        'consentimentos_json' => [['responsavel' => 'Segunda Responsável Fictícia']],
    ]);

    // ASSERT — os dois convivem: consentimento não se apaga por sobrescrita
    $resposta->assertOk();
    expect($resposta->json('consentimentos_json'))->toHaveCount(2)
        ->and($resposta->json('consentimentos_json.0.responsavel'))->toBe('Primeira Responsável Fictícia')
        ->and($resposta->json('consentimentos_json.1.responsavel'))->toBe('Segunda Responsável Fictícia');
});

it('deve preservar, intocado, o consentimento anterior ao termo versionado', function () {
    // ARRANGE — prova não se reescreve: o aceite de texto livre gravado antes da change
    // continua exatamente como está, ainda que não satisfaça a versão vigente
    $adminDaClinica = admin();
    termoVigente();
    $paciente = Paciente::factory()->create([
        'consentimentos_json' => [[
            'termo' => 'Termo antigo de texto livre',
            'responsavel' => 'Responsável Fictícia',
            'aceito_em' => '2026-01-10T09:00:00-03:00',
        ]],
    ]);

    // ACT — um PUT qualquer, sem aceite novo
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/pacientes/{$paciente->id}", [
        ...pacienteMenorValido(),
        'consentimentos_json' => [],
    ]);

    // ASSERT — o registro antigo sobrevive byte a byte (sem termo_id inventado)
    $resposta->assertOk();
    expect($resposta->json('consentimentos_json'))->toHaveCount(1)
        ->and($resposta->json('consentimentos_json.0.termo'))->toBe('Termo antigo de texto livre')
        ->and($resposta->json('consentimentos_json.0.aceito_em'))->toBe('2026-01-10T09:00:00-03:00')
        ->and($resposta->json('consentimentos_json.0'))->not->toHaveKey('termo_id');
});

it('deve listar apenas os campos mínimos do paciente', function () {
    // ARRANGE — abuse case 1 (T-pac-01): listagem nunca expõe cadastro completo
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'cpf' => CPF_VALIDO,
        'contatos_json' => [['tipo' => 'celular', 'valor' => '48999990000']],
    ])->assertCreated();

    // ACT
    $lista = $this->actingAs($adminDaClinica)->getJson('/api/pacientes');

    // ASSERT — sem cpf/responsáveis/contatos/endereço em massa
    $lista->assertOk();
    $item = $lista->json('data.0');
    expect($item)->toHaveKeys(['id', 'nome', 'nascimento', 'necessidade', 'ativo'])
        ->not->toHaveKey('cpf')
        ->not->toHaveKey('responsaveis_json')
        ->not->toHaveKey('contatos_json')
        ->not->toHaveKey('endereco_json')
        ->not->toHaveKey('obs')
        ->not->toHaveKey('consentimentos_json');
    // o corpo CRU escapa o acento (`Respons\u00e1vel`): a guarda do NOME DO RESPONSÁVEL de um
    // MENOR nunca podia falhar (re-review r12). O CPF, sendo dígitos, funcionava.
    expect($lista->getContent())->not->toContain(CPF_VALIDO);
    semVazamento($lista->json(), 'Responsável Fictícia');
});

it('deve mascarar responsáveis, contatos, endereço e obs no diff', function () {
    // ARRANGE — abuse case 3 (T-pac-02): diff não é segunda cópia do cadastro
    $adminDaClinica = admin();
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/pacientes', pacienteMenorValido());
    $criar->assertCreated();
    $id = $criar->json('id');

    // ACT — altera os blobs
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/pacientes/{$id}", [
        ...pacienteMenorValido(),
        'responsaveis_json' => [
            ['nome' => 'Novo Responsável Fictício', 'parentesco' => 'pai', 'telefone' => '48988887777'],
        ],
        'obs' => 'Observação operacional fictícia',
    ])->assertOk();

    // ASSERT — nenhum registro de auditoria contém os valores dos blobs
    foreach (Auditoria::where('entidade', 'pacientes')->get() as $registro) {
        // 2 das 3 asserções eram vácuas (acento escapado) — só o telefone, dígitos, mordia
        expect(json_encode($registro->diff_json))->not->toContain('48988887777');
        semVazamento($registro->diff_json, 'Novo Responsável Fictício');
        semVazamento($registro->diff_json, 'Observação operacional fictícia');
    }
});

it('não deve permitir apagar consentimento, e mantém a prova em claro no diff', function () {
    // ARRANGE — abuse case 9 (T-pac-04): o aceite é prova; adulterá-lo é rastreável
    // — e, desde o gate de cadastros-pessoas (SEC-02), apagá-lo é IMPOSSÍVEL
    $adminDaClinica = admin();
    $termo = termoVigente();
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'consentimentos_json' => [['responsavel' => 'Responsável Fictícia']],
    ]);
    $criar->assertCreated();
    $id = $criar->json('id');

    // ACT — editor tenta remover o aceite mandando a lista vazia
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/pacientes/{$id}", [
        ...pacienteMenorValido(),
        'consentimentos_json' => [],
    ]);

    // ASSERT — o consentimento continua lá
    $resposta->assertOk();
    expect($resposta->json('consentimentos_json'))->toHaveCount(1)
        ->and($resposta->json('consentimentos_json.0.termo_id'))->toBe($termo->id);

    // e o diff da criação guarda a prova EM CLARO, com autor
    $registro = Auditoria::where('entidade', 'pacientes')->where('acao', 'criou')
        ->orderByDesc('id')->firstOrFail();
    // (texto ASCII de propósito: `json_encode` escapa acento — `Fictícia` vira
    // `Fictícia` —, e um `toContain` acentuado sobre ele NUNCA falharia)
    expect(json_encode($registro->diff_json['depois']))->toContain('Regulamento dos Atendimentos')
        ->and($registro->usuario_id)->toBe($adminDaClinica->id)
        // o IP é a prova SUBSTITUTA do que o aceite deliberadamente não grava (design D5):
        // se ele sumir da trilha, a decisão de não gravá-lo no aceite perde a base
        ->and($registro->ip)->not->toBeNull();
});

it('deve bloquear virar menor sem responsável e esvaziar responsáveis de menor', function () {
    // ARRANGE — abuse cases 4 e 5 (T-pac-03): invariante vale no update
    $adminDaClinica = admin();
    $adulto = $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'nome' => 'Paciente Fictício Adulto',
        'nascimento' => now()->subYears(30)->toDateString(),
        'responsaveis_json' => [],
    ]);
    $adulto->assertCreated();

    // ACT + ASSERT — (a) adulto vira menor sem responsáveis
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/pacientes/{$adulto->json('id')}", [
        ...pacienteMenorValido(),
        'nome' => 'Paciente Fictício Adulto',
        'nascimento' => now()->subYears(7)->toDateString(),
        'responsaveis_json' => [],
    ])->assertUnprocessable()->assertJsonValidationErrors('responsaveis_json');

    // (b) menor tem responsáveis esvaziados
    $menor = $this->actingAs($adminDaClinica)->postJson('/api/pacientes', pacienteMenorValido());
    $menor->assertCreated();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/pacientes/{$menor->json('id')}", [
        ...pacienteMenorValido(),
        'responsaveis_json' => [],
    ])->assertUnprocessable()->assertJsonValidationErrors('responsaveis_json');
});

it('deve rejeitar nascimento no futuro ou anterior a 1900', function () {
    // ARRANGE — abuse case 13
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'nascimento' => now()->addYear()->toDateString(),
    ])->assertUnprocessable()->assertJsonValidationErrors('nascimento');

    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'nascimento' => '1850-01-01',
    ])->assertUnprocessable()->assertJsonValidationErrors('nascimento');
});

it('deve rejeitar per_page acima do teto e tratar curinga como literal', function () {
    // ARRANGE — abuse case 14 (colheita em massa)
    $adminDaClinica = admin();
    Paciente::factory()->count(2)->create();

    // ACT + ASSERT — teto
    $this->actingAs($adminDaClinica)->getJson('/api/pacientes?per_page=1000')
        ->assertUnprocessable()->assertJsonValidationErrors('per_page');

    // curinga vira literal: nenhum nome contém '%' de verdade
    $this->actingAs($adminDaClinica)->getJson('/api/pacientes?busca=%')
        ->assertOk()->assertJsonPath('total', 0);
});

it('deve rejeitar uf inválida no endereço e consentimento sem responsável', function () {
    // ARRANGE — cenários da spec (estruturas tipadas) + gate r1 I3
    $adminDaClinica = admin();

    // ACT + ASSERT — UF fora da lista
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'endereco_json' => ['cidade' => 'Cidade Fictícia', 'uf' => 'XX'],
    ])->assertUnprocessable()->assertJsonValidationErrors('endereco_json.uf');

    // consentimento sem responsável não serve de prova
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'consentimentos_json' => [['termo' => 'Termo']],
    ])->assertUnprocessable()->assertJsonValidationErrors('consentimentos_json.0.responsavel');
    expect(Paciente::count())->toBe(0);
});

it('deve serializar nascimento como data pura no detalhe', function () {
    // ARRANGE — gate r1 I1: detalhe e lista com o MESMO formato Y-m-d (sem ISO/UTC)
    $adminDaClinica = admin();
    $nascimento = now()->subYears(7)->toDateString();
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'nascimento' => $nascimento,
    ]);
    $criar->assertCreated()->assertJsonPath('nascimento', $nascimento);

    // ACT + ASSERT — detalhe idêntico à lista
    $this->actingAs($adminDaClinica)->getJson("/api/pacientes/{$criar->json('id')}")
        ->assertOk()->assertJsonPath('nascimento', $nascimento);
});

it('deve não expor rota de exclusão de paciente', function () {
    // ARRANGE — design D5: exclusão física é do fluxo de direitos do titular
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->deleteJson("/api/pacientes/{$paciente->id}")
        ->assertStatus(405);
    expect(Paciente::whereKey($paciente->id)->exists())->toBeTrue();
});

it('deve listar paginado com busca e responder 404 inexistente e 403 sem permissão', function () {
    // ARRANGE
    $adminDaClinica = admin();
    Paciente::factory()->create(['nome' => 'Paciente Fictício Alvo']);
    Paciente::factory()->create(['nome' => 'Paciente Fictício Fora da Busca']);
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT — busca paginada
    $lista = $this->actingAs($adminDaClinica)->getJson('/api/pacientes?busca=Alvo');
    $lista->assertOk()->assertJsonPath('total', 1);
    expect($lista->json('data.0.nome'))->toBe('Paciente Fictício Alvo');

    $this->actingAs($adminDaClinica)->getJson('/api/pacientes/999999')->assertNotFound();

    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($usuarioSemNivel)->getJson('/api/pacientes')->assertForbidden();
});

/*
 * OS TETOS DO ENDEREÇO (change `tetos-do-cadastro-na-tela`).
 *
 * Nasceram do chamado de 04/09/2026: a recepção preencheu a ficha inteira e o servidor
 * recusou o salvamento por tamanho do logradouro. Estes testes prendem os números novos
 * nas MEDIDAS que os justificam — endereço brasileiro real escrito por inteiro, com ponto
 * de referência —, para que ninguém os aperte de volta sem antes derrubar um caso concreto.
 */

it('deve aceitar complemento com condomínio, portaria e ponto de referência', function () {
    // ARRANGE — 94 caracteres: encostava no teto antigo de 100
    $adminDaClinica = admin();
    $complemento = 'Apto 502, Bloco B, Condomínio Residencial Jardim das Acácias, portaria 2, em frente ao mercado';

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'endereco_json' => ['complemento' => $complemento],
    ]);

    // ASSERT
    $resposta->assertCreated();
    expect(Paciente::firstOrFail()->endereco_json['complemento'])->toBe($complemento);
});

it('deve aceitar logradouro rural descrito por rodovia e estrada geral', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $logradouro = 'Rodovia SC-114, Km 12 - Estrada Geral do Bairro Fictício, ao lado do posto de saúde';

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'endereco_json' => ['logradouro' => $logradouro],
    ])->assertCreated();
});

it('deve recusar logradouro acima do teto dizendo o campo', function () {
    // ARRANGE — o teto continua existindo; o que mudou foi onde ele fica
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'endereco_json' => ['logradouro' => str_repeat('a', 501)],
    ])->assertUnprocessable()->assertJsonValidationErrors('endereco_json.logradouro');
    expect(Paciente::count())->toBe(0);
});

it('deve aceitar cada campo do endereço no tamanho exato do teto', function () {
    // ARRANGE — a fronteira, campo a campo: o limite declarado é ACEITO
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'endereco_json' => [
            'logradouro' => str_repeat('a', 500),
            'complemento' => str_repeat('b', 255),
            'bairro' => str_repeat('c', 150),
            'cidade' => str_repeat('d', 150),
        ],
    ])->assertCreated();
});

it('deve continuar aceitando o cadastro gravado sob os tetos antigos', function () {
    // ARRANGE — os tetos só AFROUXARAM: endereço válido antes segue válido, e reabrir
    // e salvar sem mexer no endereço não pode virar recusa nova
    $adminDaClinica = admin();
    $endereco = ['logradouro' => 'Rua Fictícia das Acácias', 'complemento' => 'Apto 12', 'bairro' => 'Centro'];
    $paciente = $this->actingAs($adminDaClinica)
        ->postJson('/api/pacientes', [...pacienteMenorValido(), 'endereco_json' => $endereco])
        ->assertCreated()->json();

    // ACT — o PUT carrega a versão (concorrência otimista), como a tela faz
    $resposta = $this->actingAs($adminDaClinica)
        ->withHeader('If-Match', Paciente::findOrFail($paciente['id'])->updated_at->toISOString())
        ->putJson("/api/pacientes/{$paciente['id']}", [
            ...pacienteMenorValido(),
            'endereco_json' => $endereco,
        ]);

    // ASSERT
    $resposta->assertOk();
    expect(Paciente::findOrFail($paciente['id'])->endereco_json)->toBe($endereco);
});

it('deve gravar o paciente com telefone que não recebe WhatsApp, na criação e na edição', function () {
    // ARRANGE — change telefone-que-chega-no-whatsapp: o aviso é da tela; travar a gravação pararia
    // a recepção num cadastro antigo com telefone ruim (spec de `pacientes`)
    $adminDaClinica = admin();
    $contatos = [['tipo' => 'celular', 'valor' => '55 49912-3456']];

    // ACT — criar
    $criado = $this->actingAs($adminDaClinica)
        ->postJson('/api/pacientes', [...pacienteMenorValido(), 'contatos_json' => $contatos]);

    // ASSERT
    $criado->assertCreated();

    // ACT — editar para outro número que também não chega (um dígito a mais)
    $id = $criado->json('id');
    $editado = $this->actingAs($adminDaClinica)
        ->withHeader('If-Match', Paciente::findOrFail($id)->updated_at->toISOString())
        ->putJson("/api/pacientes/{$id}", [
            ...pacienteMenorValido(),
            'contatos_json' => [['tipo' => 'whatsapp', 'valor' => '49 99912-34567']],
        ]);

    // ASSERT
    $editado->assertSuccessful();
    expect(Paciente::findOrFail($id)->contatos_json[0]['valor'])->toBe('49 99912-34567');
});
