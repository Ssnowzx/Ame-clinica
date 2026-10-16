<?php

use App\Models\CampoCadastro;
use App\Models\EnvioDeCadastro;
use App\Models\Paciente;
use App\Support\Auditoria\OrigemDaOperacao;
use App\Support\CadastroOnline\LinkPublico;
use Illuminate\Support\Facades\DB;

/*
 * `clinicaComLinkLigado()` e `comoEmProducao()` moram em `tests/Pest.php`, e não neste arquivo nem
 * no vizinho: helper definido dentro de um `*Test.php` só existe quando a suíte inteira roda —
 * rodar o arquivo sozinho quebra, e sob execução em paralelo os arquivos caem em processos
 * diferentes e quebram também. É o gatilho `TEST-HELPER-CROSS-FILE`, e ele mordeu aqui.
 */

/**
 * O ENVIO público — a primeira escrita do produto sem sessão (change
 * `cadastro-online-do-paciente`, passo 8).
 *
 * O pior caso desta porta, por desenho, é lixo numa fila que um humano descarta. O que ela **não**
 * pode fazer é deixar dado errado entrar na base, e não pode contar nada para fora.
 */
it('deve gravar um ENVIO pendente, e nenhum paciente', function () {
    // ARRANGE — um envio público que criasse paciente poria dado não conferido dentro da base,
    // com CPF disputando unicidade e homônimo entrando em silêncio
    $slug = clinicaComLinkLigado();
    $pacientesAntes = Paciente::count();

    // ACT
    $resposta = $this->postJson("/api/publico/cadastro/{$slug}", envioValido());

    // ASSERT
    $resposta->assertCreated();
    expect(Paciente::count())->toBe($pacientesAntes)
        ->and(EnvioDeCadastro::count())->toBe(1);

    $envio = EnvioDeCadastro::first();
    expect($envio->situacao)->toBe('pendente')
        ->and($envio->payload['nome'])->toBe('Criança Fictícia do Envio')
        ->and($envio->ip)->not->toBeNull();
});

it('deve exigir responsável para MENOR e dispensar para maior de idade', function () {
    // ARRANGE — é regra legal (LGPD art. 14), não preferência de clínica
    $slug = clinicaComLinkLigado();

    // ACT + ASSERT — menor sem responsável: recusado, e nada persistido
    $this->postJson("/api/publico/cadastro/{$slug}", envioValido(['responsaveis_json' => []]))
        ->assertUnprocessable()
        ->assertJsonValidationErrors('responsaveis_json');
    expect(EnvioDeCadastro::count())->toBe(0);

    // ACT + ASSERT — maior de idade sem responsável: aceito
    $this->postJson("/api/publico/cadastro/{$slug}", envioValido([
        'nascimento' => '1980-03-15',
        'responsaveis_json' => [],
    ]))->assertCreated();
});

it('NÃO deve deixar a régua afrouxada alcançar a guarda do menor', function () {
    // ARRANGE — a clínica afrouxa tudo o que a régua deixa afrouxar; a exigência legal continua
    $slug = clinicaComLinkLigado();
    CampoCadastro::create([
        'formulario' => 'paciente',
        'campo' => 'responsaveis_json',
        'obrigatorio' => false,
    ]);

    // ACT
    $resposta = $this->postJson("/api/publico/cadastro/{$slug}", envioValido(['responsaveis_json' => []]));

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('responsaveis_json');
    expect(EnvioDeCadastro::count())->toBe(0);
});

it('deve responder IGUAL para CPF já cadastrado e para CPF inédito', function () {
    // ARRANGE — no cadastro interno, recusar por CPF repetido é serviço à recepção. Aqui seria um
    // verificador de clientela: com uma lista de CPFs, qualquer um descobriria quais crianças se
    // tratam nesta clínica — dado de saúde por inferência (art. 11)
    $slug = clinicaComLinkLigado();
    $jaCadastrada = Paciente::factory()->create([
        'cpf' => '39053344705',
        'nome' => 'Criança Fictícia Já Cadastrada',
    ]);

    // ACT
    $comCpfRepetido = $this->postJson("/api/publico/cadastro/{$slug}", envioValido([
        'cpf' => $jaCadastrada->cpf,
        'nome' => $jaCadastrada->nome,
    ]));
    $comCpfInedito = $this->postJson("/api/publico/cadastro/{$slug}", envioValido(['cpf' => '52998224725']));

    // ASSERT — mesmo código, mesmo corpo, e os DOIS viraram envio
    expect($comCpfRepetido->status())->toBe($comCpfInedito->status())
        ->and($comCpfRepetido->getContent())->toBe($comCpfInedito->getContent())
        ->and(EnvioDeCadastro::count())->toBe(2);
});

it('NÃO deve consultar a tabela de pacientes na rota pública', function () {
    // ARRANGE — é o que sustenta a promessa de indistinguibilidade: não há trabalho extra a medir
    // porque não há trabalho extra. A promessa sem esta guarda seria hipótese
    $slug = clinicaComLinkLigado();
    Paciente::factory()->create(['cpf' => '39053344705']);

    $tabelas = [];
    DB::listen(function ($consulta) use (&$tabelas): void {
        $tabelas[] = $consulta->sql;
    });

    // ACT
    $this->postJson("/api/publico/cadastro/{$slug}", envioValido(['cpf' => '39053344705']))->assertCreated();

    // ASSERT
    $tocouPacientes = collect($tabelas)->contains(fn (string $sql): bool => str_contains($sql, '`pacientes`'));
    expect($tocouPacientes)->toBeFalse();
});

it('deve gravar SÓ o que a validação aprovou', function () {
    // ARRANGE — `validated()` já descartaria a chave desconhecida, e descartar não é recusar
    // quando o payload inteiro vai ser gravado e lido por um humano na fila
    $slug = clinicaComLinkLigado();

    // ACT
    $resposta = $this->postJson("/api/publico/cadastro/{$slug}", envioValido([
        'campo_inventado' => 'lixo',
        'outro_lixo' => ['a' => 'b'],
    ]));

    // ASSERT — chave desconhecida é ignorada pela validação, e não chega ao envio gravado
    $resposta->assertCreated();
    $payload = EnvioDeCadastro::first()->payload;
    expect($payload)->not->toHaveKey('campo_inventado')
        ->and($payload)->not->toHaveKey('outro_lixo')
        ->and($payload)->toHaveKey('nome');
});

it('deve RECUSAR consentimento, situação e identificadores vindos de fora', function () {
    // ARRANGE — consentimento de menor forjado por texto vindo da internet seria prova legal
    // fabricada; e a clínica vem do ENDEREÇO, nunca do corpo
    $slug = clinicaComLinkLigado();

    // ACT + ASSERT
    foreach ([
        ['consentimentos_json' => [['responsavel' => 'Falsária Fictícia']]],
        ['ativo' => true],
        ['id' => 1],
    ] as $hostil) {
        $this->postJson("/api/publico/cadastro/{$slug}", envioValido($hostil))->assertUnprocessable();
    }

    expect(EnvioDeCadastro::count())->toBe(0);
});

it('deve RECUSAR campo que a clínica tirou do formulário público', function () {
    // ARRANGE — é o caso "a régua mudou entre carregar e enviar": o formulário aberto há uma hora
    // pode ser recusado, e é correto que seja. O que não pode é a chave entrar em silêncio
    $slug = clinicaComLinkLigado();
    CampoCadastro::create(['formulario' => 'paciente', 'campo' => 'profissao', 'online' => false]);

    // ACT
    $resposta = $this->postJson("/api/publico/cadastro/{$slug}", envioValido(['profissao' => 'Professora']));

    // ASSERT — e a mensagem fala com uma FAMÍLIA, não com um integrador
    $resposta->assertUnprocessable()->assertJsonValidationErrors('profissao');
    expect($resposta->json('errors.profissao.0'))->toContain('Atualize a página');
    expect(EnvioDeCadastro::count())->toBe(0);
});

it('deve RECUSAR texto com inversão de escrita ou caractere de controle', function () {
    // ARRANGE — um nome com inversão mostra ao humano da fila uma coisa e grava outra, e quem
    // clica "aceitar" aceita o que não leu (ameaça A9)
    $slug = clinicaComLinkLigado();

    // ACT + ASSERT
    foreach (["Criança \u{202E}aicítciF", "Criança\u{0000}Fictícia", "Criança\u{200F}Fictícia"] as $hostil) {
        $this->postJson("/api/publico/cadastro/{$slug}", envioValido(['nome' => $hostil]))
            ->assertUnprocessable();
    }

    // e o par de controle: acento, cedilha e hífen são texto normal e passam
    $this->postJson("/api/publico/cadastro/{$slug}", envioValido(['nome' => 'Ana-Luíza Conceição']))
        ->assertCreated();
});

it('deve RECUSAR corpo grande demais', function () {
    // ARRANGE — os tetos por campo não somam: cem campos no máximo de cada um produzem um corpo
    // que ninguém dimensionou, e ele seria gravado cifrado numa fila que um humano vai abrir.
    //
    // O corpo abaixo passa em TODO teto por campo — nenhuma chave conhecida é grande, e são 40
    // chaves, abaixo do teto de 50. Quem o recusa só pode ser o teto do corpo. A versão anterior
    // deste teste mandava `obs` com 70 000 caracteres, que o `max:2000` do campo já recusava:
    // ele passava sem nunca exercitar a guarda, e a mutação sobrevivia (gate, CO-07/SEC-CO-36)
    $slug = clinicaComLinkLigado();
    $volumoso = [];

    for ($i = 0; $i < 30; $i++) {
        $volumoso["campo_desconhecido_{$i}"] = str_repeat('a', 3000);
    }

    // ACT
    $resposta = $this->postJson("/api/publico/cadastro/{$slug}", envioValido($volumoso));

    // ASSERT — recusado PELO TETO DO CORPO, e não por um `max` de campo
    $resposta->assertUnprocessable();
    expect($resposta->json('errors.dados.0'))->toContain('grande demais')
        ->and(EnvioDeCadastro::count())->toBe(0);
});

it('deve RECUSAR sub-chave que o formulário não pede', function () {
    // ARRANGE — o boundary interno já recusava; este descartava em silêncio, e o docblock desta
    // classe afirmava que recusava. Nada persistia, mas dois boundaries com regras diferentes
    // para o mesmo dado é a divergência que a fonte única existe para impedir (gate, CO-11)
    $slug = clinicaComLinkLigado();

    // só as duas listas: os campos de endereço não são `online` no padrão do catálogo, então o
    // `missing` da régua já os recusa — testá-los aqui passaria pela razão errada
    foreach ([
        ['responsaveis_json' => [['nome' => 'Adulto Fictício', 'parentesco' => 'Mãe', 'contrabando' => 'x']]],
        ['contatos_json' => [['tipo' => 'celular', 'valor' => '48999998888', 'injetado' => 'x']]],
    ] as $torto) {
        // ACT + ASSERT
        $this->postJson("/api/publico/cadastro/{$slug}", envioValido($torto))->assertUnprocessable();
    }

    expect(EnvioDeCadastro::count())->toBe(0);
});

it('deve ACEITAR o formulário com as chaves que ele pede', function () {
    // ARRANGE — o par de controle: sem ele, "recusa a chave estranha" seria satisfeito por
    // recusar todo endereço e todo contato
    $slug = clinicaComLinkLigado();

    // ACT + ASSERT
    $this->postJson("/api/publico/cadastro/{$slug}", envioValido([
        'contatos_json' => [['tipo' => 'celular', 'valor' => '48999998888']],
    ]))->assertCreated();
});

it('deve RECUSAR campos demais, mesmo que o corpo caiba', function () {
    // ARRANGE — o outro eixo do mesmo teto, e ele não tinha teste nenhum: 60 chaves minúsculas
    // somam menos de 2 KB e passariam pelo teto do corpo
    $slug = clinicaComLinkLigado();
    $muitas = [];

    for ($i = 0; $i < 60; $i++) {
        $muitas["campo_desconhecido_{$i}"] = 'x';
    }

    // ACT
    $resposta = $this->postJson("/api/publico/cadastro/{$slug}", envioValido($muitas));

    // ASSERT
    $resposta->assertUnprocessable();
    expect($resposta->json('errors.dados.0'))->toContain('campos demais')
        ->and(EnvioDeCadastro::count())->toBe(0);
});

it('NÃO deve elevar nada por credencial — token válido responde como anônimo', function () {
    // ARRANGE — aceitar credencial numa rota pública criaria dois comportamentos para o mesmo
    // endereço, e o da recepcionista logada seria o mais perigoso dos dois
    $slug = clinicaComLinkLigado();
    $recepcionista = admin();

    // ACT
    $doAnonimo = $this->postJson("/api/publico/cadastro/{$slug}", envioValido());
    $daLogada = $this->actingAs($recepcionista)->postJson("/api/publico/cadastro/{$slug}", envioValido());

    // ASSERT — mesma resposta...
    expect($daLogada->status())->toBe($doAnonimo->status())
        ->and($daLogada->getContent())->toBe($doAnonimo->getContent());

    // ...e a mesma trilha: os dois envios são de origem EXTERNA, nenhum é da recepcionista
    $autorias = DB::table('auditoria')->where('entidade', 'envios_de_cadastro')->get();
    expect($autorias)->toHaveCount(2);
    foreach ($autorias as $linha) {
        expect($linha->autor_tipo)->toBe(OrigemDaOperacao::EXTERNA)
            ->and($linha->usuario_id)->toBeNull();
    }
});

it('deve recusar o ENVIO para link desligado antes de olhar o payload', function () {
    // ARRANGE — invertido, um endereço desligado responderia 422 de campo, e o 422 contaria "esta
    // clínica existe e a régua dela exige exatamente estes campos" (SEC-CO-17)
    comoEmProducao();
    admin();
    $slugDesligado = app(LinkPublico::class)->rotacionar();

    // ACT — payload propositalmente torto: sem nome, com campo inventado
    $comPayloadTorto = $this->postJson("/api/publico/cadastro/{$slugDesligado}", ['lixo' => 'sim']);
    $inexistente = $this->postJson('/api/publico/cadastro/naoexisteaqui99', ['lixo' => 'sim']);

    // ASSERT — a resposta é a de endereço indisponível, não um 422 de campo
    $comPayloadTorto->assertNotFound();
    expect($comPayloadTorto->getContent())->toBe($inexistente->getContent());
});

it('deve aceitar o envio com telefone que não recebe WhatsApp — o aviso é da tela', function () {
    // ARRANGE — change telefone-que-chega-no-whatsapp: a família vê o aviso e pode enviar mesmo assim
    $slug = clinicaComLinkLigado();

    // ACT
    $resposta = $this->postJson("/api/publico/cadastro/{$slug}", envioValido([
        'contatos_json' => [['tipo' => 'celular', 'valor' => '(49) 49912-3456']],
    ]));

    // ASSERT
    $resposta->assertCreated();
    expect(EnvioDeCadastro::firstOrFail()->payload['contatos_json'][0]['valor'])->toBe('(49) 49912-3456');
});
