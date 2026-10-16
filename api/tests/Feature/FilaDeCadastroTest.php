<?php

use App\Models\EnvioDeCadastro;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Usuario;
use Illuminate\Support\Facades\DB;

/**
 * A fila de conferência (change `cadastro-online-do-paciente`, passo 9).
 *
 * É o outro lado da porta pública, e é o que a torna suportável: nada do que a família envia
 * entra na base sem alguém olhar. O teste que mais importa aqui é o do bloco de candidatos —
 * o parecer pré-código mediu que, sem exigir `pacientes.ver` junto, a fila devolveria **por
 * dentro** exatamente o oráculo que a resposta cega fecha por fora.
 */
function envioNaFila(array $payload = [], array $extras = []): EnvioDeCadastro
{
    $envio = EnvioDeCadastro::create([
        'payload' => [
            'nome' => 'Criança Fictícia Enviada',
            'nascimento' => '2018-03-15',
            'sexo' => 'feminino',
            'responsaveis_json' => [['nome' => 'Responsável Fictícia', 'parentesco' => 'Mãe']],
            ...$payload,
        ],
        'enviado_em' => now(),
    ]);

    if ($extras !== []) {
        $envio->forceFill($extras)->save();
    }

    return $envio->fresh();
}

/** Quem confere e pode ver e criar paciente — o papel que a matriz do go-live prevê. */
function conferente(): Usuario
{
    return usuarioCom(
        ['cadastro_online.conferir', 'pacientes.ver', 'pacientes.criar', 'agenda.ver_todos'],
        'Conferente Fictícia',
    );
}

it('deve listar a fila do mais antigo para o mais novo', function () {
    // ARRANGE — quem esperou mais é quem a clínica atende antes
    admin();
    $antigo = envioNaFila(['nome' => 'Criança Fictícia Antiga']);
    $antigo->forceFill(['enviado_em' => now()->subDays(3)])->save();
    envioNaFila(['nome' => 'Criança Fictícia Nova']);

    // ACT
    $fila = $this->actingAs(conferente())->getJson('/api/cadastro-online/fila')->assertOk();

    // ASSERT
    expect($fila->json('total'))->toBe(2)
        ->and($fila->json('data.0.dados.nome'))->toBe('Criança Fictícia Antiga');
});

it('NÃO deve mostrar os candidatos parecidos a quem não pode ver paciente', function () {
    // ARRANGE — é a ameaça A4 do parecer: sem esta exigência, bastaria enviar pelo formulário
    // público o CPF de quem se suspeita ser paciente e abrir a fila para ler o NOME dela.
    // O oráculo que a resposta cega fecha por fora, reaberto por dentro.
    admin();
    Paciente::factory()->create(['cpf' => '39053344705', 'nome' => 'Criança Fictícia Já Paciente']);
    envioNaFila(['cpf' => '39053344705']);

    $soConfere = usuarioCom(['cadastro_online.conferir'], 'Só confere');

    // ACT
    $fila = $this->actingAs($soConfere)->getJson('/api/cadastro-online/fila')->assertOk();

    // ASSERT — o bloco está AUSENTE, não vazio: lista vazia diria "procurei e não achei",
    // que já é resposta
    expect($fila->json('data.0'))->not->toHaveKey('parecidos');
    semVazamento($fila->json(), 'Já Paciente');
});

it('deve mostrar quem já existe, por CPF e por telefone, a quem PODE ver paciente', function () {
    // ARRANGE — é o oposto do oráculo: aqui quem vê é quem já tem permissão para saber quem é
    // paciente da clínica
    admin();
    $porCpf = Paciente::factory()->create(['cpf' => '39053344705', 'nome' => 'Criança Fictícia do CPF']);
    $porTelefone = Paciente::factory()->create([
        'nome' => 'Criança Fictícia do Telefone',
        'contatos_json' => [['tipo' => 'celular', 'valor' => '48999998888']],
    ]);

    envioNaFila(['cpf' => '39053344705']);
    envioNaFila([
        'nome' => 'Outra Criança Fictícia',
        'contatos_json' => [['tipo' => 'celular', 'valor' => '48999998888']],
    ]);

    // ACT
    $fila = $this->actingAs(conferente())->getJson('/api/cadastro-online/fila')->assertOk();

    // ASSERT
    $linhas = collect($fila->json('data'));
    expect(collect($linhas[0]['parecidos'])->pluck('id'))->toContain($porCpf->id)
        ->and($linhas[0]['parecidos'][0]['coincide_por'])->toBe('cpf')
        ->and(collect($linhas[1]['parecidos'])->pluck('id'))->toContain($porTelefone->id)
        ->and($linhas[1]['parecidos'][0]['coincide_por'])->toBe('telefone');
});

it('deve respeitar o escopo por vínculo nos candidatos parecidos', function () {
    // ARRANGE — um profissional escopado não passa a enxergar a criança de um colega porque ela
    // apareceu ao lado de um envio (parecer, condição 7)
    admin();
    $prof = Profissional::factory()->create();
    $doColega = Paciente::factory()->create(['cpf' => '39053344705', 'nome' => 'Criança Fictícia do Colega']);
    envioNaFila(['cpf' => '39053344705']);

    $escopado = usuarioEscopadoEm($prof, ['cadastro_online.conferir', 'pacientes.ver']);

    // ACT
    $fila = $this->actingAs($escopado)->getJson('/api/cadastro-online/fila')->assertOk();

    // ASSERT — o envio aparece (é da clínica), a criança do colega não
    expect($fila->json('total'))->toBe(1)
        ->and($fila->json('data.0.parecidos'))->toBe([]);
    semVazamento($fila->json(), 'do Colega');
    expect($doColega->fresh())->not->toBeNull();
});

it('NÃO deve deixar quem não confere abrir a fila', function () {
    // ARRANGE — conferir é módulo próprio: `pacientes.ver` não o implica
    admin();
    envioNaFila();
    $recepcao = usuarioCom(['pacientes.ver', 'pacientes.criar'], 'Recepção Fictícia');

    // ACT + ASSERT
    $this->actingAs($recepcao)->getJson('/api/cadastro-online/fila')->assertForbidden();
});

it('NÃO deve deixar ACEITAR quem não pode criar paciente', function () {
    // ARRANGE — aceitar é o primeiro passo de criar paciente; sem esta exigência, `conferir`
    // viraria permissão de criação por porta lateral (parecer, condição 10)
    admin();
    $envio = envioNaFila();
    $semCriar = usuarioCom(['cadastro_online.conferir', 'pacientes.ver'], 'Confere sem criar');

    // ACT + ASSERT
    $this->actingAs($semCriar)->postJson("/api/cadastro-online/fila/{$envio->id}/aceitar")->assertForbidden();
    expect($envio->fresh()->situacao)->toBe('pendente');

    // ...mas DESCARTAR ela pode: recusar não cria nada
    $this->actingAs($semCriar)
        ->postJson("/api/cadastro-online/fila/{$envio->id}/descartar", ['motivo' => 'Duplicado.'])
        ->assertOk();
});

it('deve devolver os dados no ACEITE sem criar paciente — quem cria é o formulário de sempre', function () {
    // ARRANGE — o aceite é o gesto de um humano que olhou; o formulário é onde ele conserta o que
    // a família digitou errado ANTES de a base receber (design D2)
    admin();
    $envio = envioNaFila();
    $pacientesAntes = Paciente::count();

    // ACT
    $resposta = $this->actingAs(conferente())->postJson("/api/cadastro-online/fila/{$envio->id}/aceitar");

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('dados.nome'))->toBe('Criança Fictícia Enviada')
        ->and(Paciente::count())->toBe($pacientesAntes)
        ->and($envio->fresh()->situacao)->toBe('aceito')
        ->and($envio->fresh()->conferido_por)->not->toBeNull();
});

it('NÃO deve conferir duas vezes o mesmo envio', function () {
    // ARRANGE
    admin();
    $envio = envioNaFila();
    $usuario = conferente();

    // ACT
    $this->actingAs($usuario)->postJson("/api/cadastro-online/fila/{$envio->id}/aceitar")->assertOk();
    $segundaVez = $this->actingAs($usuario)->postJson("/api/cadastro-online/fila/{$envio->id}/aceitar");
    $descarteDepois = $this->actingAs($usuario)
        ->postJson("/api/cadastro-online/fila/{$envio->id}/descartar", ['motivo' => 'Mudei de ideia.']);

    // ASSERT
    $segundaVez->assertUnprocessable();
    $descarteDepois->assertUnprocessable();
    expect($envio->fresh()->situacao)->toBe('aceito');
});

it('deve exigir MOTIVO para descartar', function () {
    // ARRANGE — decisão sem razão registrada é decisão que ninguém consegue revisar depois
    admin();
    $envio = envioNaFila();

    // ACT + ASSERT
    $this->actingAs(conferente())
        ->postJson("/api/cadastro-online/fila/{$envio->id}/descartar", [])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('motivo');
    expect($envio->fresh()->situacao)->toBe('pendente');
});

it('deve tirar da fila o que já foi conferido e o que venceu o prazo', function () {
    // ARRANGE
    admin();
    envioNaFila(['nome' => 'Criança Fictícia Pendente']);
    envioNaFila(['nome' => 'Criança Fictícia Aceita'], ['situacao' => 'aceito', 'conferido_em' => now()]);
    envioNaFila(['nome' => 'Criança Fictícia Vencida'], ['expurgado_em' => now()]);

    // ACT
    $fila = $this->actingAs(conferente())->getJson('/api/cadastro-online/fila')->assertOk();

    // ASSERT
    expect($fila->json('total'))->toBe(1)
        ->and($fila->json('data.0.dados.nome'))->toBe('Criança Fictícia Pendente');
});

it('deve registrar a decisão na trilha, com autor, e SEM o conteúdo do envio', function () {
    // ARRANGE — a trilha prova o ciclo de vida sem repetir o dado do menor
    admin();
    $envio = envioNaFila(['cpf' => '39053344705']);
    $usuario = conferente();

    // ACT
    $this->actingAs($usuario)
        ->postJson("/api/cadastro-online/fila/{$envio->id}/descartar", ['motivo' => 'Cadastro em duplicidade.'])
        ->assertOk();

    // ASSERT — a decisão tem dono...
    $decisao = DB::table('auditoria')
        ->where('entidade', 'envios_de_cadastro')
        ->where('acao', 'atualizou')
        ->latest('id')
        ->first();
    expect($decisao->usuario_id)->toBe($usuario->id)
        ->and($decisao->autor_tipo)->toBe('usuario');

    // ...e o conteúdo não se repete em lugar nenhum da trilha
    $trilhaInteira = json_encode(
        DB::table('auditoria')->where('entidade', 'envios_de_cadastro')->pluck('diff_json')->all(),
        JSON_UNESCAPED_UNICODE
    );
    expect($trilhaInteira)->not->toContain('Criança Fictícia Enviada')
        ->and($trilhaInteira)->not->toContain('39053344705')
        // o MOTIVO fica: é registro de decisão da clínica, não dado da família
        ->and($trilhaInteira)->toContain('duplicidade');

    /*
     * E a CHAVE também não aparece — não só o texto em claro.
     *
     * São duas camadas independentes: a cifra da coluna e o `auditExclude` do modelo. Sem esta
     * asserção, só a primeira estava provada: apagar o `auditExclude` deixava o texto CIFRADO na
     * trilha e o teste continuava verde, porque o que ele procurava era o nome legível. No dia em
     * que alguém trocasse o cast, a promessa cairia em silêncio (gate, SEC-CO-39).
     *
     * A chave APARECE — a trilha diz que o campo mudou, que é o que ela existe para provar. O que
     * não pode aparecer é o VALOR: no lugar dele vai a máscara.
     */
    $comPayload = DB::table('auditoria')
        ->where('entidade', 'envios_de_cadastro')
        ->pluck('diff_json')
        ->map(fn ($linha) => json_decode((string) $linha, true))
        ->filter(fn ($diff) => is_array($diff) && (isset($diff['depois']['payload']) || isset($diff['antes']['payload'])));

    expect($comPayload)->not->toBeEmpty();

    foreach ($comPayload as $diff) {
        foreach (['antes', 'depois'] as $lado) {
            foreach (['payload', 'ip'] as $campo) {
                if (array_key_exists($campo, $diff[$lado] ?? [])) {
                    expect($diff[$lado][$campo])->toBe('***');
                }
            }
        }
    }
});

it('NÃO deve deixar o envio pendente aparecer como paciente em lugar nenhum', function () {
    // ARRANGE — enquanto pendente, ele não é paciente para efeito nenhum
    admin();
    envioNaFila(['nome' => 'Criança Fictícia Só Enviada']);
    $usuario = conferente();

    // ACT + ASSERT — busca de paciente, seleção da agenda e indicadores
    $busca = $this->actingAs($usuario)->getJson('/api/pacientes?busca=Só Enviada')->assertOk();
    expect($busca->json('total'))->toBe(0);

    expect(Paciente::count())->toBe(0);
});

it('deve contar a fila no centro de notificações, e sumir sem a permissão', function () {
    // ARRANGE — sem contador, a fila é um formulário que a clínica divulgou e não lê, e o custo
    // disso recai sobre uma família esperando resposta. É o risco que o design nomeia
    admin();
    envioNaFila();
    envioNaFila(['nome' => 'Outra Criança Fictícia']);
    // os dois usuários nascem ANTES da primeira requisição: criar papel depois de uma chamada
    // autenticada esbarra no guard já resolvido pelo Spatie
    $conferente = conferente();
    $semConferir = usuarioCom(['agenda.ver'], 'Sem conferir');

    // ACT
    $comPermissao = $this->actingAs($conferente)->getJson('/api/notificacoes')->assertOk();
    trocarDeUsuario();
    $semPermissao = $this->actingAs($semConferir)->getJson('/api/notificacoes')->assertOk();

    // ASSERT — conta, e NÃO traz o nome da criança: o centro é lista de coisas a fazer
    expect($comPermissao->json('cadastros_recebidos.total'))->toBe(2);
    semVazamento($comPermissao->json(), 'Criança Fictícia Enviada');

    // ...e sem a permissão o bloco fica AUSENTE, nunca zerado — zero seria informação falsa
    expect($semPermissao->json())->not->toHaveKey('cadastros_recebidos');
});

it('deve procurar os parecidos da PÁGINA em duas consultas, não duas por envio', function () {
    // ARRANGE — com 20 envios eram 40 idas ao banco, metade delas varredura completa
    // (`JSON_CONTAINS` não tem índice que sirva). Medido no gate: 106 consultas numa página
    admin();
    Paciente::factory()->create(['cpf' => '39053344705', 'nome' => 'Criança Fictícia do CPF']);

    for ($i = 0; $i < 20; $i++) {
        envioNaFila([
            'nome' => "Criança Fictícia {$i}",
            'cpf' => '39053344705',
            'contatos_json' => [['tipo' => 'celular', 'valor' => '4899999'.str_pad((string) $i, 4, '0', STR_PAD_LEFT)]],
        ]);
    }

    $emPacientes = 0;
    DB::listen(function ($consulta) use (&$emPacientes): void {
        if (str_contains($consulta->sql, 'from `pacientes`')) {
            $emPacientes++;
        }
    });

    // ACT
    $fila = $this->actingAs(conferente())->getJson('/api/cadastro-online/fila')->assertOk();

    // ASSERT — duas consultas para os 20 envios, e o resultado continua certo
    expect($emPacientes)->toBe(2)
        ->and($fila->json('data.0.parecidos.0.coincide_por'))->toBe('cpf')
        ->and($fila->json('data.19.parecidos.0.coincide_por'))->toBe('cpf');
});

it('deve achar a MESMA criança pelos dois telefones dela, em envios diferentes', function () {
    // ARRANGE — a otimização de lote arquivava o paciente sob UM valor só (o `CASE` devolve o
    // primeiro ramo que casa), e o envio que trazia o outro telefone perdia o candidato. É o
    // único eixo pelo qual a fila existe: avisar que a criança já é paciente (CR2-01)
    admin();
    Paciente::factory()->create([
        'nome' => 'Criança Fictícia de Dois Telefones',
        'contatos_json' => [
            ['tipo' => 'celular', 'valor' => '48999991111'],
            ['tipo' => 'celular', 'valor' => '48999992222'],
        ],
    ]);

    envioNaFila(['nome' => 'Envio do Primeiro', 'contatos_json' => [['tipo' => 'celular', 'valor' => '48999991111']]]);
    envioNaFila(['nome' => 'Envio do Segundo', 'contatos_json' => [['tipo' => 'celular', 'valor' => '48999992222']]]);

    // ACT
    $fila = $this->actingAs(conferente())->getJson('/api/cadastro-online/fila')->assertOk();

    // ASSERT — os DOIS envios acham a criança
    expect($fila->json('data.0.parecidos.0.nome'))->toBe('Criança Fictícia de Dois Telefones')
        ->and($fila->json('data.1.parecidos.0.nome'))->toBe('Criança Fictícia de Dois Telefones');
});

it('NÃO deve deixar um telefone ruidoso apagar o parecido de outro envio', function () {
    // ARRANGE — com teto de PÁGINA, um número que muita gente compartilha (a recepção de uma
    // escola, por exemplo) consumia a cota inteira e o envio da duplicata real saía com zero
    // parecidos (CR2-02)
    admin();

    // 25, e não 15: o teto é de 10 POR VALOR, e com dois telefones na página o teto de página
    // seria 20. Com 15 ruidosos o corte não acontecia e o teste passava nas duas versões — foi
    // por essa folga que a regressão do teto de página entrou verde (CR4-01)
    for ($i = 0; $i < 25; $i++) {
        Paciente::factory()->create([
            'nome' => "Criança Fictícia do Barulho {$i}",
            'contatos_json' => [['tipo' => 'celular', 'valor' => '4830000000']],
        ]);
    }

    Paciente::factory()->create([
        'nome' => 'Criança Fictícia Duplicada',
        'contatos_json' => [['tipo' => 'celular', 'valor' => '48999998888']],
    ]);

    envioNaFila(['nome' => 'Envio Ruidoso', 'contatos_json' => [['tipo' => 'celular', 'valor' => '4830000000']]]);
    envioNaFila(['nome' => 'Envio da Duplicata', 'contatos_json' => [['tipo' => 'celular', 'valor' => '48999998888']]]);

    // ACT
    $fila = $this->actingAs(conferente())->getJson('/api/cadastro-online/fila')->assertOk();

    // ASSERT — a duplicata real continua sendo avisada
    expect($fila->json('data.1.parecidos.0.nome'))->toBe('Criança Fictícia Duplicada')
        ->and($fila->json('data.0.parecidos'))->toHaveCount(10);
});

/**
 * RELER O RASCUNHO depois do aceite (rodada dirigida, CR2-06).
 *
 * Aceitar consome o envio. Sem esta porta, um F5 no formulário destruía o preenchimento da
 * família para sempre — e a alternativa (guardar o cadastro da criança no navegador do balcão,
 * que é máquina compartilhada) é justamente o que o contrato do design system proíbe.
 */
it('deve devolver o rascunho de um envio ACEITO que ainda não virou ficha', function () {
    // ARRANGE
    admin();
    $envio = envioNaFila(['nome' => 'Criança Fictícia Aceita']);
    $usuario = conferente();
    $this->actingAs($usuario)->postJson("/api/cadastro-online/fila/{$envio->id}/aceitar")->assertOk();

    // ACT
    $resposta = $this->actingAs($usuario)->getJson("/api/cadastro-online/fila/{$envio->id}/rascunho");

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('dados.nome'))->toBe('Criança Fictícia Aceita');
});

it('NÃO deve devolver rascunho de envio que ainda está NA FILA', function () {
    // ARRANGE — pendente se lê pela fila, com os parecidos e a decisão; esta porta é só a
    // continuação de um aceite interrompido
    admin();
    $envio = envioNaFila();

    // ACT + ASSERT
    $this->actingAs(conferente())
        ->getJson("/api/cadastro-online/fila/{$envio->id}/rascunho")
        ->assertNotFound();
});

it('NÃO deve devolver rascunho de envio que já virou ficha', function () {
    // ARRANGE — conferido que virou paciente se lê pela ficha, com as guardas da ficha
    admin();
    $envio = envioNaFila();
    $usuario = conferente();
    $this->actingAs($usuario)->postJson("/api/cadastro-online/fila/{$envio->id}/aceitar")->assertOk();
    $envio->forceFill(['paciente_id' => Paciente::factory()->create()->id])->save();

    // ACT + ASSERT
    $this->actingAs($usuario)
        ->getJson("/api/cadastro-online/fila/{$envio->id}/rascunho")
        ->assertNotFound();
});

it('NÃO deve deixar reler quem não pode criar paciente', function () {
    // ARRANGE — quem relê está no meio de criar a ficha: as mesmas permissões do aceitar
    $dono = admin();
    $envio = envioNaFila();
    // o envio é levado a `aceito` DIRETO, sem passar pela rota: uma requisição no meio reinicia o
    // cache do registrar de permissões, e o papel criado depois dela quebra
    $envio->forceFill(['situacao' => 'aceito', 'conferido_por' => $dono->id, 'conferido_em' => now()])->save();

    $soConfere = usuarioCom(['cadastro_online.conferir'], 'Só confere o rascunho');

    // ACT + ASSERT
    $this->actingAs($soConfere)
        ->getJson("/api/cadastro-online/fila/{$envio->id}/rascunho")
        ->assertForbidden();
});

it('NÃO deve deixar DOIS telefones ruidosos apagarem o parecido de um terceiro', function () {
    // ARRANGE — o repro anterior tinha UM telefone compartilhado, e a repescagem única o resolvia.
    // Com dois, a repescagem herdava o mesmo teto e o candidato legítimo morria igual: o repro
    // estava consertado, o predicado não (rodada 5). Escola e abrigo na mesma página não é exótico
    admin();

    foreach (['4830000000', '4830001111'] as $ruidoso) {
        for ($i = 0; $i < 30; $i++) {
            Paciente::factory()->create([
                'nome' => "Criança Fictícia do Barulho {$ruidoso} {$i}",
                'contatos_json' => [['tipo' => 'celular', 'valor' => $ruidoso]],
            ]);
        }
    }

    // a duplicata REAL nasce por último: id alto, ela é a primeira a ser cortada pelo teto
    Paciente::factory()->create([
        'nome' => 'Criança Fictícia Duplicada',
        'contatos_json' => [['tipo' => 'celular', 'valor' => '48999998888']],
    ]);

    envioNaFila(['nome' => 'Envio da Escola', 'contatos_json' => [['tipo' => 'celular', 'valor' => '4830000000']]]);
    envioNaFila(['nome' => 'Envio do Abrigo', 'contatos_json' => [['tipo' => 'celular', 'valor' => '4830001111']]]);
    envioNaFila(['nome' => 'Envio da Duplicata', 'contatos_json' => [['tipo' => 'celular', 'valor' => '48999998888']]]);

    // ACT
    $fila = $this->actingAs(conferente())->getJson('/api/cadastro-online/fila')->assertOk();

    // ASSERT — a duplicata real continua sendo avisada
    expect($fila->json('data.2.parecidos.0.nome'))->toBe('Criança Fictícia Duplicada');
});

it('deve LER cada paciente uma vez só, e não uma vez por telefone da página', function () {
    // ARRANGE — contar CONSULTAS não basta: o `unionAll` que estava aqui também era UMA consulta,
    // e lia 49× mais linhas porque varria a tabela uma vez por valor (CR3-06). O que distingue as
    // duas formas é o número de LINHAS lidas, e é isso que esta guarda mede
    admin();

    for ($i = 0; $i < 40; $i++) {
        Paciente::factory()->create([
            'nome' => "Criança Fictícia {$i}",
            'contatos_json' => [['tipo' => 'celular', 'valor' => '4890000'.str_pad((string) $i, 4, '0', STR_PAD_LEFT)]],
        ]);
    }

    // 20 telefones distintos na página: com uma varredura por valor seriam ~20× as linhas
    for ($i = 0; $i < 20; $i++) {
        envioNaFila([
            'nome' => "Envio Fictício {$i}",
            'contatos_json' => [['tipo' => 'celular', 'valor' => '4890000'.str_pad((string) $i, 4, '0', STR_PAD_LEFT)]],
        ]);
    }

    $usuario = conferente();
    $antes = (int) (DB::select("SHOW SESSION STATUS LIKE 'Handler_read_next'")[0]->Value ?? 0);

    // ACT
    $this->actingAs($usuario)->getJson('/api/cadastro-online/fila')->assertOk();

    // ASSERT — o teto é proporcional ao número de PACIENTES, não ao de valores. Com 40 pacientes,
    // uma varredura lê ~40 linhas; uma por valor leria ~800
    // PISO junto com o teto. Só o teto é armadilha: se o otimizador trocar de plano, a varredura
    // passa a contar noutro contador e a guarda vira `expect(ruído)->toBeLessThan(400)` — verde
    // sem medir nada. O piso cai alto e barulhento no dia em que isso acontecer (rodada 5)
    $lidas = (int) (DB::select("SHOW SESSION STATUS LIKE 'Handler_read_next'")[0]->Value ?? 0) - $antes;
    expect($lidas)->toBeGreaterThan(30)
        ->and($lidas)->toBeLessThan(400);
});
