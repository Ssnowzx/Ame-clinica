<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Auditoria;
use App\Models\Clinica;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Tratamento;

/**
 * A CARGA DA VIRADA (change importacao-da-virada) — o comando `virada:importar` sob o
 * contrato do parecer pré-código (SEC-IV-04..14). Fixtures 100% FICTÍCIAS (LGPD).
 */

/** Escreve os CSVs preparados (fictícios) numa pasta temporária e devolve o caminho. */
function pastaDaVirada(?array $cadastro = null, ?array $pacotes = null): string
{
    $pasta = sys_get_temp_dir().'/virada-teste-'.uniqid();
    mkdir("{$pasta}/preparado", 0777, true);

    $cadastro ??= [
        ['Criança Fictícia Alfa', '(49) 90000-0001', 'alfa@ficticio.test', '52998224725',
            'Convênio Teste', 'Plano X', 'MAT001'],
    ];
    $pacotes ??= [
        ['Criança Fictícia Alfa', 'Terapia Fictícia', 'Convênio Teste', 'Prof Fictício',
            '10', '6', '4', '10/01/2026', 'Terapia Origem', 'Convênio Teste', 'Prof Origem'],
    ];

    $escrever = function (string $arquivo, array $cabecalho, array $linhas) use ($pasta): void {
        $f = fopen("{$pasta}/preparado/{$arquivo}", 'w');
        fputcsv($f, $cabecalho, ',', '"', '');
        foreach ($linhas as $linha) {
            fputcsv($f, $linha, ',', '"', '');
        }
        fclose($f);
    };
    $escrever('cadastro.csv',
        ['nome', 'telefone', 'email', 'cpf', 'convenio', 'plano', 'matricula'], $cadastro);
    $escrever('pacotes.csv',
        ['paciente', 'especialidade_destino', 'convenio_destino', 'profissional_destino',
            'total', 'realizadas', 'saldo', 'ultima_sessao', 'especialidade', 'convenio',
            'profissional'], $pacotes);

    return $pasta;
}

/** Os catálogos que a clínica de go-live teria (criados pela tela, antes da carga). */
function catalogosDaVirada(): void
{
    Convenio::create(['nome' => 'Convênio Teste']);
    Especialidade::factory()->create(['nome' => 'Terapia Fictícia']);
    Profissional::factory()->create(['nome' => 'Prof Fictício']);
}

it('deve rodar em dry-run por padrão: NADA grava e o aceite nasce em arquivo', function () {
    // ARRANGE
    admin();
    catalogosDaVirada();
    $pasta = pastaDaVirada();

    // ACT
    $this->artisan('virada:importar', ['--pasta' => $pasta])
        ->assertExitCode(0);

    // ASSERT — zero escrita; relatório nominal em ARQUIVO (SEC-IV-08), sem CPF
    expect(Paciente::count())->toBe(0);
    expect(Tratamento::count())->toBe(0);
    $aceite = file_get_contents("{$pasta}/preparado/aceite.md");
    expect($aceite)->toContain('Criança Fictícia Alfa');
    expect($aceite)->not->toContain('52998224725');
});

it('deve criar no --executar o estado pós-virada mínimo, com marcador e trilha de console', function () {
    // ARRANGE
    $adminDaClinica = admin();
    catalogosDaVirada();
    $pasta = pastaDaVirada(pacotes: [
        ['Criança Fictícia Alfa', 'Terapia Fictícia', 'Convênio Teste', 'Prof Fictício',
            '10', '6', '4', '10/01/2026', 'Terapia Origem', 'Convênio Teste', 'Prof Origem'],
        // 2º pacote de OUTRO convênio de origem: matrícula NÃO casa (SEC-IV-14)
        ['Criança Fictícia Alfa', 'Terapia Fictícia', 'Convênio Teste', 'Prof Fictício',
            '30', '10', '20', '12/01/2026', 'Terapia Origem', 'Outro Convênio', 'Prof Origem'],
    ]);
    $nome = Clinica::atual()->nome;

    // ACT
    $this->artisan('virada:importar', ['--pasta' => $pasta, '--executar' => true])
        ->expectsQuestion('Digite o NOME da clínica para confirmar a gravação', $nome)
        ->assertExitCode(0);

    // ASSERT — paciente MÍNIMO: sexo/nascimento nulos (a carga não inventa dado),
    // contatos na estrutura do balcão, CPF em 11 dígitos, marcador presente
    $paciente = Paciente::firstOrFail();
    expect($paciente->nome)->toBe('Criança Fictícia Alfa');
    expect($paciente->sexo)->toBeNull();
    expect($paciente->nascimento)->toBeNull();
    expect($paciente->cpf)->toBe('52998224725');
    expect($paciente->contatos_json)->toBe([
        ['tipo' => 'celular', 'valor' => '(49) 90000-0001'],
        ['tipo' => 'email', 'valor' => 'alfa@ficticio.test'],
    ]);
    expect($paciente->importado_clinicaagil_em)->not->toBeNull();

    // o pacote 6/10 entra com saldo 4 (o exemplo literal da clínica) e matrícula casada
    $tratamentos = Tratamento::orderBy('sessoes_total')->get();
    expect($tratamentos)->toHaveCount(2);
    expect($tratamentos[0]->sessoes_total)->toBe(10);
    expect($tratamentos[0]->sessoes_realizadas)->toBe(6);
    expect($tratamentos[0]->matricula)->toBe('MAT001');
    expect($tratamentos[1]->matricula)->toBeNull(); // convênio de origem não casa
    expect($tratamentos[0]->importado_clinicaagil_em)->not->toBeNull();
    // UM timestamp para a corrida inteira (SEC-IV-11)
    expect((string) $tratamentos[0]->importado_clinicaagil_em)
        ->toBe((string) $paciente->importado_clinicaagil_em);

    // trilha: evento `criou` com atribuição de CONSOLE (usuario_id nulo — spec auditoria)
    $trilha = Auditoria::where('entidade', 'pacientes')->where('acao', 'criou')->first();
    expect($trilha)->not->toBeNull();
    expect($trilha->usuario_id)->toBeNull();

    // NADA de histórico nasce (SEC-IV-13)
    expect(Agendamento::count())->toBe(0);
    expect(Atendimento::count())->toBe(0);
    expect(LancamentoCaixa::count())->toBe(0);
});

it('deve abortar sem gravar quando a confirmação digitada não confere', function () {
    // ARRANGE — SEC-IV-04
    admin();
    catalogosDaVirada();
    $pasta = pastaDaVirada();

    // ACT + ASSERT
    $this->artisan('virada:importar', ['--pasta' => $pasta, '--executar' => true])
        ->expectsQuestion('Digite o NOME da clínica para confirmar a gravação', 'Nome Errado')
        ->assertExitCode(1);

    expect(Paciente::count())->toBe(0);
});

it('deve reprovar o lote INTEIRO quando uma linha viola invariante — e nada nasce', function () {
    // ARRANGE — a 2ª linha não tem saldo válido (realizadas >= total); a 1ª é perfeita.
    // Tudo-ou-nada: a validação vem ANTES de qualquer escrita (SEC-IV-05/09).
    admin();
    catalogosDaVirada();
    $pasta = pastaDaVirada(
        cadastro: [
            ['Criança Fictícia Alfa', '(49) 90000-0001', '', '', 'Convênio Teste', '', ''],
            ['Criança Fictícia Beta', '(49) 90000-0002', '', '', 'Convênio Teste', '', ''],
        ],
        pacotes: [
            ['Criança Fictícia Alfa', 'Terapia Fictícia', 'Convênio Teste', 'Prof Fictício',
                '10', '6', '4', '10/01/2026', 'T', 'Convênio Teste', 'P'],
            ['Criança Fictícia Beta', 'Terapia Fictícia', 'Convênio Teste', 'Prof Fictício',
                '10', '10', '0', '10/01/2026', 'T', 'Convênio Teste', 'P'],
        ],
    );

    // ACT + ASSERT — o erro cita a LINHA, nunca o conteúdo (SEC-IV-08)
    $this->artisan('virada:importar', ['--pasta' => $pasta, '--executar' => true])
        ->expectsOutputToContain('pacotes.csv linha 3: total/realizadas sem saldo válido')
        ->assertExitCode(1);

    expect(Paciente::count())->toBe(0);
    expect(Tratamento::count())->toBe(0);
});

it('deve ser idempotente: re-rodar cria zero e conta os já existentes', function () {
    // ARRANGE — SEC-IV-06
    admin();
    catalogosDaVirada();
    $pasta = pastaDaVirada();
    $nome = Clinica::atual()->nome;
    $rodar = fn () => $this->artisan('virada:importar',
        ['--pasta' => $pasta, '--executar' => true])
        ->expectsQuestion('Digite o NOME da clínica para confirmar a gravação', $nome)
        ->assertExitCode(0);

    // ACT
    $rodar();
    $rodar();

    // ASSERT — nada duplicou
    expect(Paciente::count())->toBe(1);
    expect(Tratamento::count())->toBe(1);
});

it('deve RETER a colisão com paciente nascido no sistema, junto com os pacotes dela', function () {
    // ARRANGE — SEC-IV-07: homônima criada NO sistema (sem marcador) antes da carga
    admin();
    catalogosDaVirada();
    Paciente::create([
        'nome' => 'Criança Fictícia Alfa',
        'sexo' => 'feminino',
        'contatos_json' => [], 'responsaveis_json' => [], 'consentimentos_json' => [],
    ]);
    $pasta = pastaDaVirada();
    $nome = Clinica::atual()->nome;

    // ACT — a carga segue (colisão é retenção, não erro), mas NADA da linha entra
    $this->artisan('virada:importar', ['--pasta' => $pasta, '--executar' => true])
        ->expectsQuestion('Digite o NOME da clínica para confirmar a gravação', $nome)
        ->assertExitCode(0);

    // ASSERT — nem paciente duplicado, nem pacote colado na criança errada
    expect(Paciente::count())->toBe(1);
    expect(Paciente::first()->importado_clinicaagil_em)->toBeNull();
    expect(Tratamento::count())->toBe(0);
});

it('deve recusar re-rodar quando a base já foi OPERADA depois da carga (NOVO-03/B1)', function () {
    // ARRANGE — carga executa; a clínica ATENDE (o consumo move sessoes_realizadas).
    // Re-rodar com os CSVs velhos re-criaria o pacote com números antigos — a sessão
    // cobrada duas vezes que o 3º formulário proibiu. A guarda recusa e manda ao runbook.
    admin();
    catalogosDaVirada();
    $pasta = pastaDaVirada();
    $nome = Clinica::atual()->nome;
    $this->artisan('virada:importar', ['--pasta' => $pasta, '--executar' => true])
        ->expectsQuestion('Digite o NOME da clínica para confirmar a gravação', $nome)
        ->assertExitCode(0);

    // a clínica OPEROU (consumo de sessão) minutos depois — update via query builder
    // com updated_at explícito: a precisão de segundo do DATETIME esconderia uma
    // edição no MESMO segundo do create (caso irreal na virada)
    $tratamento = Tratamento::firstOrFail();
    Tratamento::whereKey($tratamento->id)->update([
        'sessoes_realizadas' => $tratamento->sessoes_realizadas + 1,
        'updated_at' => now()->addMinutes(5),
    ]);

    // ACT + ASSERT — recusa ANTES de qualquer leitura de CSV, e nada muda
    $this->artisan('virada:importar', ['--pasta' => $pasta, '--executar' => true])
        ->expectsOutputToContain('A base já foi operada depois da carga')
        ->assertExitCode(1);

    expect(Tratamento::count())->toBe(1);
    expect(Paciente::count())->toBe(1);
});

it('deve desfazer TUDO e suprimir dados quando a transação estoura no meio (NOVO-01)', function () {
    // ARRANGE — uma exceção NÃO-antecipada dentro da transação: o catch sanitizado não
    // pode re-lançar (QueryException estamparia SQL com nome/CPF no console e no log).
    admin();
    catalogosDaVirada();
    $pasta = pastaDaVirada();
    $nome = Clinica::atual()->nome;
    Tratamento::creating(function (): void {
        throw new RuntimeException('estouro fictício no meio da gravação');
    });

    // ACT
    $comando = $this->artisan('virada:importar', ['--pasta' => $pasta, '--executar' => true])
        ->expectsQuestion('Digite o NOME da clínica para confirmar a gravação', $nome)
        ->expectsOutputToContain('Transação desfeita — NADA foi gravado')
        ->doesntExpectOutputToContain('Criança Fictícia Alfa')
        ->assertExitCode(1);

    // ASSERT — rollback REAL: o paciente já tinha sido inserido e sumiu junto
    expect(Paciente::count())->toBe(0);
    expect(Tratamento::count())->toBe(0);
});

it('deve marcar cadastro_incompleto na listagem quando o sexo veio nulo da carga (I6)', function () {
    // ARRANGE — a regra nova do derivado (PREP-03) precisa de prova executável
    $adminDaClinica = admin();
    catalogosDaVirada();
    $pasta = pastaDaVirada();
    $nome = Clinica::atual()->nome;
    $this->artisan('virada:importar', ['--pasta' => $pasta, '--executar' => true])
        ->expectsQuestion('Digite o NOME da clínica para confirmar a gravação', $nome)
        ->assertExitCode(0);

    // ACT + ASSERT
    $lista = $this->actingAs($adminDaClinica)->getJson('/api/pacientes')->assertOk();
    expect($lista->json('data.0.cadastro_incompleto'))->toBeTrue();
});

it('deve reprovar nome normalizado duplicado no próprio arquivo (I1/SEC-IV-09)', function () {
    // ARRANGE — CSV editado à mão com a MESMA criança duas vezes (acento diferente):
    // sem a guarda, os pacotes das duas linhas grudariam no mesmo registro
    admin();
    catalogosDaVirada();
    $pasta = pastaDaVirada(cadastro: [
        ['Criança Fictícia Alfa', '(49) 90000-0001', '', '', 'Convênio Teste', '', ''],
        ['CRIANCA FICTICIA ALFA', '(49) 90000-0009', '', '', 'Convênio Teste', '', ''],
    ], pacotes: []);

    // ACT + ASSERT
    $this->artisan('virada:importar', ['--pasta' => $pasta, '--executar' => true])
        ->expectsOutputToContain('cadastro.csv linha 3: nome normalizado duplicado')
        ->assertExitCode(1);

    expect(Paciente::count())->toBe(0);
});

it('deve recusar CPF duplicado antes de qualquer escrita (SEC-IV-10)', function () {
    // ARRANGE — duas crianças diferentes com o MESMO CPF no arquivo
    admin();
    catalogosDaVirada();
    $pasta = pastaDaVirada(cadastro: [
        ['Criança Fictícia Alfa', '(49) 90000-0001', '', '52998224725', 'Convênio Teste', '', ''],
        ['Criança Fictícia Beta', '(49) 90000-0002', '', '52998224725', 'Convênio Teste', '', ''],
    ], pacotes: []);

    // ACT + ASSERT
    $this->artisan('virada:importar', ['--pasta' => $pasta, '--executar' => true])
        ->expectsOutputToContain('cadastro.csv linha 3: cpf duplicado no arquivo')
        ->assertExitCode(1);

    expect(Paciente::count())->toBe(0);
});
