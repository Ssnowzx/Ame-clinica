<?php

use App\Models\Auditoria;
use App\Models\CampoCadastro;
use App\Models\Paciente;
use App\Support\CamposCadastro\ReguaDoCadastro;

/**
 * A API DA RÉGUA (tarefas 2.4 e 4.1–4.4).
 *
 * O que estes testes protegem: esta é uma superfície de ESCRITA nova que muda o que o
 * sistema exige de toda família atendida. Três coisas não podem ser negociáveis por ela —
 * as travas, a combinação impossível, e quem pode escrever.
 *
 * E a leitura precisa ser LARGA: a recepção monta o formulário com ela e não tem
 * `configuracoes.ver`. Se a leitura exigisse a permissão de configurações, o cadastro de
 * paciente pararia para quem não é administrador.
 */
it('deve devolver a régua efetiva com rótulo, seção e travas', function () {
    // ARRANGE
    $usuario = admin();

    // ACT
    $resposta = $this->actingAs($usuario)->getJson('/api/campos-cadastro/paciente');

    // ASSERT
    $resposta->assertOk()->assertJsonPath('formulario', 'paciente');

    $campos = collect($resposta->json('campos'))->keyBy('campo');

    expect($campos['nome']['rotulo'])->toBe('Nome')
        ->and($campos['nome']['secao'])->toBe('identificacao')
        ->and($campos['nome']['obrigatorio'])->toBeTrue()
        ->and($campos['nome']['travas'])->toEqualCanonicalizing(['obrigatorio', 'desabilitado', 'online'])
        ->and($campos['nome']['motivo_trava'])->not->toBeNull()
        ->and($campos['estado_civil']['obrigatorio'])->toBeFalse()
        ->and($campos['estado_civil']['travas'])->toBe([]);

    // as seções vêm com rótulo em português, para a tela não manter o dicionário
    expect(collect($resposta->json('secoes'))->pluck('rotulo'))->toContain('Identificação');
});

it('NÃO deve expor a chave que ainda não tem efeito, e deve expor a que passou a ter', function () {
    // ARRANGE — `rapido` segue no schema sem efeito (change 3 da cadeia); devolvê-la poria na
    // tela um controle que não faz nada. `online` passou a ter efeito com o auto-cadastro
    // público, e a tela de configuração precisa dela para a clínica decidir o formulário.
    $usuario = admin();

    // ACT
    $resposta = $this->actingAs($usuario)->getJson('/api/campos-cadastro/paciente');

    // ASSERT
    expect(array_keys($resposta->json('campos.0')))
        ->not->toContain('rapido')
        ->and(array_keys($resposta->json('campos.0')))->toContain('online');
});

it('deve deixar quem cadastra paciente LER a régua sem a permissão de configurações', function () {
    // ARRANGE — o caso que trava o cadastro inteiro se a leitura for estreita demais
    admin();
    $recepcao = usuarioCom(['pacientes.ver', 'pacientes.criar'], 'Recepção Fictícia');

    // ACT / ASSERT
    $this->actingAs($recepcao)->getJson('/api/campos-cadastro/paciente')->assertOk();
});

it('NÃO deve deixar quem só lê a régua escrevê-la', function () {
    // ARRANGE
    admin();
    $recepcao = usuarioCom(['pacientes.ver', 'pacientes.criar'], 'Recepção Fictícia');

    // ACT
    $resposta = $this->actingAs($recepcao)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['sexo' => ['obrigatorio' => false]],
    ]);

    // ASSERT
    $resposta->assertForbidden();
    expect(CampoCadastro::query()->count())->toBe(0);
});

it('deve gravar a régua e devolver a efetiva já atualizada', function () {
    // ARRANGE — é assim que a clínica de referência opera hoje
    $usuario = admin();

    // ACT
    $resposta = $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => [
            'sexo' => ['obrigatorio' => false],
            'endereco_cidade' => ['obrigatorio' => true],
            'estado_civil' => ['desabilitado' => true],
        ],
    ]);

    // ASSERT
    $resposta->assertOk();
    $campos = collect($resposta->json('campos'))->keyBy('campo');

    expect($campos['sexo']['obrigatorio'])->toBeFalse()
        ->and($campos['endereco_cidade']['obrigatorio'])->toBeTrue()
        ->and($campos['estado_civil']['desabilitado'])->toBeTrue();
});

it('deve devolver o campo ao padrão do catálogo quando a chave vem nula', function () {
    // ARRANGE
    $usuario = admin();
    app(ReguaDoCadastro::class)->gravar('sexo', ['obrigatorio' => false]);

    // ACT — `null` é "não opinei", diferente de `false` (design D2)
    $resposta = $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['sexo' => ['obrigatorio' => null]],
    ]);

    // ASSERT
    $campos = collect($resposta->json('campos'))->keyBy('campo');
    expect($campos['sexo']['obrigatorio'])->toBeTrue();
});

it('deve recusar afrouxar campo travado', function () {
    // ARRANGE
    $usuario = admin();

    // ACT
    $resposta = $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['nome' => ['obrigatorio' => false]],
    ]);

    // ASSERT — e a mensagem explica, em português, por que não dá
    $resposta->assertUnprocessable()->assertJsonValidationErrors('campos.nome');
    expect($resposta->json('errors')['campos.nome'][0])->toContain('nome')
        ->and(CampoCadastro::query()->count())->toBe(0);
});

it('deve recusar esconder campo travado', function () {
    // ARRANGE
    $usuario = admin();

    // ACT / ASSERT — o CPF pode virar obrigatório, mas não pode sumir: a recusa por CPF
    // repetido ficaria sem campo onde aparecer
    $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['cpf' => ['desabilitado' => true]],
    ])->assertUnprocessable()->assertJsonValidationErrors('campos.cpf');

    $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['responsaveis_json' => ['desabilitado' => true]],
    ])->assertUnprocessable()->assertJsonValidationErrors('campos.responsaveis_json');
});

it('deve deixar tornar o CPF obrigatório, que não é trava', function () {
    // ARRANGE / ACT / ASSERT — trava é por CHAVE, não por campo
    $usuario = admin();

    $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['cpf' => ['obrigatorio' => true]],
    ])->assertOk();

    expect(app(ReguaDoCadastro::class)->obrigatorio('cpf'))->toBeTrue();
});

it('deve recusar obrigatório e escondido no mesmo campo', function () {
    // ARRANGE
    $usuario = admin();

    // ACT
    $resposta = $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['estado_civil' => ['obrigatorio' => true, 'desabilitado' => true]],
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('campos.estado_civil');
    expect(CampoCadastro::query()->count())->toBe(0);
});

it('deve recusar a combinação impossível formada pelo PADRÃO, não só pelo payload', function () {
    // ARRANGE — `necessidade` já é obrigatória por padrão; esconder sem afrouxar produz
    // a combinação sem que ela apareça na requisição
    $usuario = admin();

    // ACT
    $resposta = $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['necessidade' => ['desabilitado' => true]],
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('campos.necessidade');
});

it('deve aceitar esconder o campo quando o payload afrouxa junto', function () {
    // ARRANGE / ACT — é o que a tela manda: o estado inteiro do campo
    $usuario = admin();

    $resposta = $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['necessidade' => ['obrigatorio' => false, 'desabilitado' => true]],
    ]);

    // ASSERT
    $resposta->assertOk();
    expect(app(ReguaDoCadastro::class)->desabilitado('necessidade'))->toBeTrue();
});

it('deve recusar campo fora do catálogo', function () {
    // ARRANGE
    $usuario = admin();

    // ACT
    $resposta = $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['campo_inventado' => ['obrigatorio' => true]],
    ]);

    // ASSERT — e a mensagem não devolve o texto que o cliente mandou
    $resposta->assertUnprocessable()->assertJsonValidationErrors('campos');
    expect($resposta->json('errors')['campos'][0])->not->toContain('campo_inventado');
});

it('deve recusar chave fora das que têm efeito', function () {
    // ARRANGE
    $usuario = admin();

    // ACT / ASSERT — `rapido` existe no schema, mas ainda não faz nada
    $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['sexo' => ['rapido' => true]],
    ])->assertUnprocessable()->assertJsonValidationErrors('campos.sexo');
});

it('deve recusar formulário que não existe', function () {
    // ARRANGE / ACT / ASSERT — a rota nem casa
    $usuario = admin();

    $this->actingAs($usuario)->getJson('/api/campos-cadastro/formulario_inventado')->assertNotFound();
});

it('deve auditar a escrita da régua', function () {
    // ARRANGE
    $usuario = admin();

    // ACT
    $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['sexo' => ['obrigatorio' => false]],
    ])->assertOk();

    // ASSERT
    $registro = Auditoria::where('entidade', 'campos_cadastro')->firstOrFail();
    expect($registro->usuario_id)->toBe($usuario->id)
        ->and($registro->diff_json['depois']['campo'])->toBe('sexo');
});

it('NÃO deve auditar escrita que não muda nada', function () {
    // ARRANGE
    $usuario = admin();
    $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['sexo' => ['obrigatorio' => false]],
    ])->assertOk();
    $antes = Auditoria::where('entidade', 'campos_cadastro')->count();

    // ACT
    $this->actingAs($usuario)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['sexo' => ['obrigatorio' => false]],
    ])->assertOk();

    // ASSERT
    expect(Auditoria::where('entidade', 'campos_cadastro')->count())->toBe($antes);
});

it('deve dizer quantas fichas ficariam incompletas com a régua proposta', function () {
    // ARRANGE — três fichas: uma completa, duas sem cidade
    $usuario = admin();
    Paciente::factory()->create([
        'nascimento' => now()->subYears(8)->toDateString(),
        'necessidade' => 'sem',
        'sexo' => 'feminino',
        'endereco_json' => ['cidade' => 'Lages'],
    ]);
    Paciente::factory()->count(2)->create([
        'nascimento' => now()->subYears(8)->toDateString(),
        'necessidade' => 'sem',
        'sexo' => 'masculino',
        'endereco_json' => ['bairro' => 'Centro'],
    ]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/campos-cadastro/paciente/previa', [
        'campos' => ['endereco_cidade' => ['obrigatorio' => true]],
    ]);

    // ASSERT — e nenhuma ficha foi tocada: a prévia é leitura
    $resposta->assertOk()->assertJson(['total' => 3, 'incompletos' => 2]);
    expect(CampoCadastro::query()->count())->toBe(0);
});

it('deve contar zero quando a proposta AFROUXA a régua', function () {
    // ARRANGE — ficha com nascimento (o campo é travado desde o parecer SEC-RC-01: sem ele
    // a guarda do menor não roda, então a clínica não pode afrouxá-lo nem simular isso),
    // faltando só o que ela PODE afrouxar
    $usuario = admin();
    Paciente::factory()->create([
        'nascimento' => now()->subYears(9)->toDateString(), 'necessidade' => null, 'sexo' => null,
    ]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/campos-cadastro/paciente/previa', [
        'campos' => [
            'necessidade' => ['obrigatorio' => false],
            'sexo' => ['obrigatorio' => false],
        ],
    ]);

    // ASSERT — sobram `nome` e `nascimento` obrigatórios, e a ficha tem os dois
    $resposta->assertOk()->assertJson(['total' => 1, 'incompletos' => 0]);
});

it('NÃO deve deixar nem SIMULAR o afrouxamento do nascimento', function () {
    // ARRANGE — a prévia usa a mesma FormRequest da escrita, então a trava vale nos dois
    // caminhos: não dá para descobrir o impacto de um afrouxamento que não se pode fazer
    $usuario = admin();

    // ACT / ASSERT
    $this->actingAs($usuario)->postJson('/api/campos-cadastro/paciente/previa', [
        'campos' => ['nascimento' => ['obrigatorio' => false]],
    ])->assertUnprocessable()->assertJsonValidationErrors('campos.nascimento');
});

it('deve tratar `null` na proposta como VOLTA AO PADRÃO, não como omissão', function () {
    // ARRANGE — este é o único caso que separa `array_key_exists` de `??`, e é o que a
    // decisão de desenho existe para defender. O teste anterior usava `false`, onde os dois
    // operadores concordam — trocar o ternário por `??` deixava a suíte verde (achado CR-I7).
    // Clínica com `nascimento` gravado como NÃO obrigatório; a proposta manda `null`.
    $usuario = admin();
    app(ReguaDoCadastro::class)->gravar('necessidade', ['obrigatorio' => false]);
    Paciente::factory()->create([
        'nascimento' => now()->subYears(9)->toDateString(),
        'necessidade' => null,
        'sexo' => 'feminino',
    ]);

    // com a régua gravada, a ficha não é incompleta
    $this->actingAs($usuario)->postJson('/api/campos-cadastro/paciente/previa', [
        'campos' => ['necessidade' => ['obrigatorio' => false]],
    ])->assertJson(['incompletos' => 0]);

    // ACT — `null` = "não opinei" ⇒ vale o PADRÃO do catálogo, que é obrigatório
    $resposta = $this->actingAs($usuario)->postJson('/api/campos-cadastro/paciente/previa', [
        'campos' => ['necessidade' => ['obrigatorio' => null]],
    ]);

    // ASSERT
    $resposta->assertOk()->assertJson(['incompletos' => 1]);
});

it('deve tratar `false` na proposta como opinião, não como omissão', function () {
    // ARRANGE — o bug que o `??` esconderia: `false` é "não é obrigatório", e confundi-lo
    // com "não opinou" faria a prévia cair no padrão do catálogo e contar a ficha como
    // incompleta — a tela prometeria um número e a lista mostraria outro
    $usuario = admin();
    Paciente::factory()->create([
        'nascimento' => now()->subYears(9)->toDateString(), 'necessidade' => null, 'sexo' => 'feminino',
    ]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/campos-cadastro/paciente/previa', [
        'campos' => ['necessidade' => ['obrigatorio' => false]],
    ]);

    // ASSERT
    $resposta->assertOk()->assertJson(['incompletos' => 0]);
});

it('NÃO deve deixar quem não pode gravar a régua ver a prévia', function () {
    // ARRANGE
    admin();
    $recepcao = usuarioCom(['pacientes.ver', 'pacientes.criar'], 'Recepção Fictícia');

    // ACT / ASSERT
    $this->actingAs($recepcao)->postJson('/api/campos-cadastro/paciente/previa', [
        'campos' => ['sexo' => ['obrigatorio' => false]],
    ])->assertForbidden();
});

it('deve contar na prévia só as fichas ATIVAS, como a listagem mostra', function () {
    // ARRANGE — a lista abre filtrada por ativos; contar os arquivados junto faria o aviso
    // prometer um número que a lista não confirma (achado CR-I3, agora com teste)
    $usuario = admin();
    Paciente::factory()->create([
        'nascimento' => now()->subYears(9)->toDateString(),
        'necessidade' => 'sem', 'sexo' => 'feminino', 'ativo' => true,
        'endereco_json' => ['bairro' => 'Centro'],
    ]);
    Paciente::factory()->create([
        'nascimento' => now()->subYears(9)->toDateString(),
        'necessidade' => 'sem', 'sexo' => 'feminino', 'ativo' => false,
        'endereco_json' => ['bairro' => 'Centro'],
    ]);

    // ACT
    $resposta = $this->actingAs($usuario)->postJson('/api/campos-cadastro/paciente/previa', [
        'campos' => ['endereco_cidade' => ['obrigatorio' => true]],
    ]);

    // ASSERT — o inativo não entra em nenhum dos dois números
    $resposta->assertOk()->assertJson(['total' => 1, 'incompletos' => 1]);
});

it('NÃO deve deixar quem configura sem VER paciente usar a prévia', function () {
    // ARRANGE — o eixo NOVO do parecer SEC-RC-03. O teste que já existia cobre o eixo
    // antigo (quem vê paciente e não configura); este cobre o contrário, que é o perfil
    // que a guarda existe para barrar — e níveis de permissão são DADO neste produto,
    // então esse perfil é criável por qualquer clínica.
    admin();
    $configurador = usuarioCom(['configuracoes.ver', 'configuracoes.editar'], 'Configurador Fictício');

    // ACT / ASSERT — a prévia é oráculo de presença sobre a base de MENORES
    $this->actingAs($configurador)->postJson('/api/campos-cadastro/paciente/previa', [
        'campos' => ['sexo' => ['obrigatorio' => true]],
    ])->assertForbidden();

    // ...mas escrever a régua continua permitido a ele
    $this->actingAs($configurador)->putJson('/api/campos-cadastro/paciente', [
        'campos' => ['sexo' => ['obrigatorio' => false]],
    ])->assertOk();
});
