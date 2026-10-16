<?php

use App\Models\Auditoria;
use App\Models\Paciente;
use App\Support\Auditoria\OrigemDaOperacao;
use Illuminate\Support\Facades\Route;

/**
 * QUEM agiu, segundo a trilha — as três origens (change `cadastro-online-do-paciente`).
 *
 * Até aqui a trilha tinha duas, e uma delas era implícita: `usuario_id` preenchido queria dizer
 * "um usuário", e `usuario_id` nulo queria dizer "o sistema, fora de requisição". A change abre a
 * terceira — alguém sem sessão, por uma porta pública — e ela não cabe em nenhuma das duas: cairia
 * no mesmo nulo e ficaria indistinguível de uma rotina agendada.
 *
 * O teste que mais importa aqui é o último. O parecer pré-código (ameaça A5) mediu o caso que
 * ninguém tinha imaginado: a recepcionista com o sistema aberto que abre o link público no mesmo
 * navegador manda o cookie junto, a requisição vira autenticada, e o envio da família sairia
 * carimbado como ato DELA — numa tabela que não tem rota de escrita nem `updated_at`, ou seja,
 * para sempre.
 */
function ultimaTrilhaDe(string $entidade): Auditoria
{
    return Auditoria::where('entidade', $entidade)->latest('id')->firstOrFail();
}

it('deve registrar como USUÁRIO o que um usuário faz pela API', function () {
    // ARRANGE
    $usuario = admin();

    // ACT — o caminho real: requisição autenticada criando paciente
    $this->actingAs($usuario)->postJson('/api/pacientes', [
        'nome' => 'Criança Fictícia da Trilha',
        'nascimento' => '2018-04-10',
        'sexo' => 'feminino',
        'necessidade' => 'necessidades_especiais',
        'responsaveis_json' => [['nome' => 'Responsável Fictícia', 'parentesco' => 'Mãe']],
        'contatos_json' => [],
        'consentimentos_json' => [],
    ])->assertCreated();

    // ASSERT
    $trilha = ultimaTrilhaDe('pacientes');
    expect($trilha->autor_tipo)->toBe(OrigemDaOperacao::USUARIO)
        ->and($trilha->usuario_id)->toBe($usuario->id);
});

it('deve registrar como SISTEMA o que acontece fora de requisição', function () {
    // ARRANGE — é o caso da rotina agendada e do comando de console
    admin();

    // ACT
    Paciente::factory()->create();

    // ASSERT
    $trilha = ultimaTrilhaDe('pacientes');
    expect($trilha->autor_tipo)->toBe(OrigemDaOperacao::SISTEMA)
        ->and($trilha->usuario_id)->toBeNull();
});

it('deve registrar como EXTERNA a operação marcada, e NÃO roubar a autoria da sessão aberta', function () {
    // ARRANGE — a recepcionista logada, e o link público aberto no mesmo navegador: a requisição
    // chega autenticada, `Auth::id()` devolve o id dela, e sem esta regra o envio da família
    // sairia como ato dela (ameaça A5 do parecer pré-código).
    //
    // A ROTA DE VERDADE IMPORTA, e este teste já nasceu errado uma vez: com `actingAs` sozinho
    // não há rota ligada, `$temRota` é falso, e a decisão nunca chega a comparar sessão com
    // origem — o teste passava com o defeito presente. Aqui a rota é registrada de propósito,
    // com o mesmo formato do grupo público que a change vai criar: sem sessão declarada, mas
    // alcançável por quem tem o cookie.
    $recepcionista = admin();
    Route::post('/api/_teste/envio-externo', function () {
        app(OrigemDaOperacao::class)->marcarExterna();
        Paciente::factory()->create();

        return response()->json(['ok' => true], 201);
    });

    // ACT — a requisição chega COM a sessão da recepcionista
    $this->actingAs($recepcionista)->postJson('/api/_teste/envio-externo')->assertCreated();

    // ASSERT — origem externa, e nenhum usuário apontado, apesar da sessão viva
    $trilha = ultimaTrilhaDe('pacientes');
    expect(auth()->id())->not->toBeNull() // a sessão ESTAVA lá: é isso que torna o teste válido
        ->and($trilha->autor_tipo)->toBe(OrigemDaOperacao::EXTERNA)
        ->and($trilha->usuario_id)->toBeNull();
});

it('deve distinguir as três origens entre si na mesma trilha', function () {
    // ARRANGE — é o cenário literal da spec: a trilha mistura um envio público e um comando
    // agendado, e os dois têm de ser distinguíveis
    $usuario = admin();

    // ACT — a de SISTEMA vem primeiro de propósito: neste arcabouço, depois de uma chamada HTTP a
    // rota continua ligada ao teste e a sessão do `actingAs` também, então "fora de requisição"
    // deixa de ser alcançável dentro do mesmo teste. Em produção não há esse acoplamento — um
    // comando de console nunca teve rota. A ordem aqui é o que torna o cenário reproduzível.
    Paciente::factory()->create();
    $this->actingAs($usuario)->postJson('/api/pacientes', [
        'nome' => 'Criança Fictícia Um',
        'nascimento' => '2017-02-02',
        'sexo' => 'masculino',
        'necessidade' => 'necessidades_especiais',
        'responsaveis_json' => [['nome' => 'Responsável Fictício', 'parentesco' => 'Pai']],
        'contatos_json' => [],
        'consentimentos_json' => [],
    ])->assertCreated();
    app(OrigemDaOperacao::class)->marcarExterna();
    Paciente::factory()->create();

    // ASSERT — três linhas, três tipos, nenhum repetido
    $tipos = Auditoria::where('entidade', 'pacientes')->orderBy('id')->pluck('autor_tipo')->all();
    expect($tipos)->toBe([
        OrigemDaOperacao::SISTEMA,
        OrigemDaOperacao::USUARIO,
        OrigemDaOperacao::EXTERNA,
    ]);
});

it('deve mostrar na API um nome próprio para cada origem, sem inventar usuário', function () {
    // ARRANGE — a tela lê `autor`; sem nome próprio, a origem externa apareceria como "Sistema"
    // e a trilha mentiria por omissão exatamente onde a spec exige clareza
    $usuario = admin();
    Paciente::factory()->create();                      // sistema
    app(OrigemDaOperacao::class)->marcarExterna();
    Paciente::factory()->create();                      // externa

    // ACT
    $linhas = collect(
        $this->actingAs($usuario)->getJson('/api/auditoria?entidade=pacientes')->assertOk()->json('data')
    )->keyBy('autor_tipo');

    // ASSERT
    expect($linhas[OrigemDaOperacao::SISTEMA]['autor'])->toBe('Sistema')
        ->and($linhas[OrigemDaOperacao::EXTERNA]['autor'])->toBe('Formulário público')
        // e o nome do autor externo não é o de ninguém do sistema
        ->and($linhas[OrigemDaOperacao::EXTERNA]['autor'])->not->toBe($usuario->nome);
});
