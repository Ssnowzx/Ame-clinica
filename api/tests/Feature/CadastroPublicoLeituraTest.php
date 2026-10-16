<?php

use App\Models\Configuracao;
use App\Support\CadastroOnline\LinkPublico;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * A rota pública de LEITURA do auto-cadastro (change `cadastro-online-do-paciente`, passo 7).
 *
 * Ela ainda não escreve nada — e mesmo assim é a superfície mais delicada da change, porque é a
 * primeira coisa que um estranho consegue pedir ao sistema. As duas regras que governam tudo aqui:
 * **ela não conta o que existe** e **ela devolve marca e campos, e nada mais**.
 */
it('deve servir o formulário pela régua da clínica, sem sessão nenhuma', function () {
    // ARRANGE
    $slug = clinicaComLinkLigado();

    // ACT
    $resposta = $this->getJson("/api/publico/cadastro/{$slug}");

    // ASSERT — os campos que a régua marca como `online`, com rótulo e seção do servidor
    $resposta->assertOk();
    $campos = collect($resposta->json('campos'))->keyBy('campo');
    expect($campos)->toHaveKey('nome')
        ->and($campos)->toHaveKey('nascimento')
        ->and($campos['nome']['obrigatorio'])->toBeTrue()
        ->and($campos['nome']['rotulo'])->toBe('Nome')
        ->and($campos['responsaveis_json']['lista'])->toBeTrue()
        // e o que a régua deixa fora do público não aparece
        ->and($campos)->not->toHaveKey('necessidade')
        ->and($campos)->not->toHaveKey('convenio_id');
});

it('NÃO deve entregar nada da clínica além da marca', function () {
    // ARRANGE — a página que estranhos abrem não é uma janela para o cadastro da clínica
    $slug = clinicaComLinkLigado('Centro Fictício Exemplo');
    Configuracao::create(['chave' => 'financeiro.desconto_maximo_pct', 'valor' => 50]);

    // ACT
    $resposta = $this->getJson("/api/publico/cadastro/{$slug}")->assertOk();

    // ASSERT — só marca, seções e campos
    expect(array_keys($resposta->json()))->toEqualCanonicalizing(['clinica', 'secoes', 'campos']);
    expect(array_keys($resposta->json('clinica')))
        ->toEqualCanonicalizing(['nome', 'identidade', 'fonte_do_nome', 'tema']);

    // o nome sai (é a marca), e nada mais da clínica sai junto. `semVazamento` e não
    // `not->toContain` sobre o corpo cru: `json_encode` escapa acento, e um `toContain('Fictício')`
    // sobre o corpo NUNCA falharia — é a armadilha que esta suíte já documentou uma vez
    expect($resposta->json('clinica.nome'))->toBe('Centro Fictício Exemplo');
    semVazamento($resposta->json(), 'desconto_maximo');
    semVazamento($resposta->json(), 'timezone');
    semVazamento($resposta->json(), 'cadastro_online_slug');
});

it('deve responder IGUAL para endereço inexistente, clínica inativa e link desligado', function () {
    // ARRANGE — diferenciá-los diria a um varredor quais clínicas usam o produto, e a existência
    // de uma clínica de neurodesenvolvimento numa cidade pequena não é dado neutro
    comoEmProducao();
    $slug = clinicaComLinkLigado();

    // o par de controle: o ligado responde outra coisa, senão o teste passaria num sistema
    // que simplesmente recusa tudo
    $this->getJson("/api/publico/cadastro/{$slug}")->assertOk();

    // ACT — inexistente; a clínica INATIVA; e, reativada, com o link DESLIGADO
    $inexistente = $this->getJson('/api/publico/cadastro/naoexisteaqui99');
    clinica()->forceFill(['ativo' => false])->save();
    $daInativa = $this->getJson("/api/publico/cadastro/{$slug}");
    clinica()->forceFill(['ativo' => true])->save();
    app(ConfiguracaoService::class)->set('cadastro_online.ativo', false);
    $desligado = $this->getJson("/api/publico/cadastro/{$slug}");

    // ASSERT — mesmo código, mesmo corpo
    foreach ([$inexistente, $daInativa, $desligado] as $resposta) {
        $resposta->assertNotFound();
    }
    expect($daInativa->getContent())->toBe($inexistente->getContent())
        ->and($desligado->getContent())->toBe($inexistente->getContent());
});

it('deve recusar endereço VAZIO ou NULO antes de consultar o banco (ameaça A12)', function () {
    // ARRANGE — é o achado que a mutação obrigou a testar direito. No Eloquent,
    // `where('coluna', null)` vira `IS NULL`, e a coluna nasce nula: sem a guarda, resolver com
    // nulo devolveria a clínica — e com ela a régua e a marca.
    //
    // A primeira versão deste teste batia na ROTA com formas inválidas, e passava com a guarda
    // removida: nenhuma daquelas formas resolveria clínica nenhuma de qualquer jeito. Quem
    // exercita o risco é a chamada direta ao resolvedor, que é como um chamador futuro o usaria.
    // O cenário que abre o furo, e ele não é raro: uma clínica que LIGOU o cadastro pelo link e
    // ainda não gerou o endereço. Ela fica com a coluna nula e a configuração ligada — e é
    // exatamente com ela que o `IS NULL` casaria. (A primeira versão deste arranjo só tinha
    // clínicas com o link desligado, e o teste passava com a guarda removida: a recusa vinha do
    // link desligado, não da guarda.)
    admin();
    Configuracao::create(['chave' => 'cadastro_online.ativo', 'valor' => true]);
    $link = app(LinkPublico::class);

    // ACT + ASSERT
    foreach ([null, '', '   '] as $vazio) {
        expect(fn () => $link->resolver($vazio))
            ->toThrow(HttpException::class);
    }

    // e pela rota, as formas fora do formato também não abrem nada
    foreach (['abc', 'MAIUSCULA1234567', 'com-traco-12345', str_repeat('b', 40)] as $forma) {
        $this->getJson("/api/publico/cadastro/{$forma}")->assertNotFound();
    }
});

it('deve servir a logo sem sessão, e escondê-la igual quando o link não vale', function () {
    // ARRANGE — se o formulário é cego mas a rota da logo responde 404 para inexistente e 200
    // para desligado, o oráculo apenas mudou de porta
    comoEmProducao();
    Storage::fake('local');
    $slug = clinicaComLinkLigado();
    Storage::disk('local')->put('clinica/logo.png', 'conteudo-ficticio-da-logo');
    clinica()->forceFill(['logo_path' => 'clinica/logo.png'])->save();

    // ACT
    $comLogo = $this->get("/api/publico/cadastro/{$slug}/logo");

    // ASSERT
    $comLogo->assertOk();
    /*
     * O que esta asserção prova, e o que ela NÃO prova.
     *
     * Prova: a resposta SAI sem cache. Não prova nada sobre o header que o controller manda — o
     * `RotaPublicaHumana` o sobrescreve na volta, então os dois valores possíveis chegam aqui
     * iguais. Devolver ao controller o defeito histórico (`private, max-age=3600`) mantinha este
     * arquivo verde nas duas versões da asserção (medido na rodada 4, CR4-05).
     *
     * Quem guarda a garantia de saída é `RotaPublicaHumanaTest`: apagar a linha do middleware o
     * derruba. O header do controller fica como defesa em profundidade — se a rota sair do grupo
     * público um dia, ele sozinho ainda manda `no-store`.
     */
    expect($comLogo->headers->get('Content-Type'))->toBe('image/png')
        ->and($comLogo->headers->get('Cache-Control'))->toContain('no-store');

    // ...e a de endereço inexistente responde igual à de clínica SEM logo
    clinica()->forceFill(['logo_path' => null])->save();
    $daSemLogo = $this->getJson("/api/publico/cadastro/{$slug}/logo");
    $inexistente = $this->getJson('/api/publico/cadastro/naoexisteaqui99/logo');
    $daSemLogo->assertNotFound();
    expect($daSemLogo->getContent())->toBe($inexistente->getContent());
});

it('deve gerar endereço opaco e não sequencial, e rotacionar derruba o anterior', function () {
    // ARRANGE — o link é ligado ANTES das rotações de propósito. Escrever a configuração direto no
    // model (como o arranjo faz) não passa pelo serviço que invalida a memoização por requisição,
    // e no processo de teste os serviços atravessam as chamadas: uma leitura anterior deixaria o
    // valor velho grudado. Em produção quem escreve é a tela, pelo serviço, que invalida.
    $usuario = admin();
    Configuracao::create(['chave' => 'cadastro_online.ativo', 'valor' => true]);

    // ACT
    $primeiro = $this->actingAs($usuario)->postJson('/api/cadastro-online/link/rotacionar')->assertOk();
    $slugAntigo = $primeiro->json('slug');
    $segundo = $this->actingAs($usuario)->postJson('/api/cadastro-online/link/rotacionar')->assertOk();
    $slugNovo = $segundo->json('slug');

    // ASSERT — opaco: nem o id da clínica, nem incremento
    expect($slugAntigo)->toMatch('/^[a-z0-9]{16}$/')
        ->and($slugNovo)->not->toBe($slugAntigo)
        ->and($slugAntigo)->not->toContain((string) clinica()->id);

    // e o antigo deixa de abrir — na mesma resposta de link desligado
    $this->getJson("/api/publico/cadastro/{$slugAntigo}")->assertNotFound();
    $this->getJson("/api/publico/cadastro/{$slugNovo}")->assertOk();
});

it('NÃO deve deixar o endereço aparecer na trilha de auditoria', function () {
    // ARRANGE — a trilha é legível por quem tem `auditoria.ver`; gravar o endereço ali o
    // entregaria pela porta que existe para vigiar o sistema (design D5)
    $usuario = admin();

    // ACT
    $slug = $this->actingAs($usuario)->postJson('/api/cadastro-online/link/rotacionar')->json('slug');

    // ASSERT — a trilha diz que houve rotação, e não para qual valor
    $linhas = DB::table('auditoria')->where('entidade', 'clinica')->get();
    expect($linhas)->toHaveCount(1)
        ->and($linhas[0]->acao)->toBe('gerou_link_de_cadastro')
        ->and(json_encode($linhas[0]->diff_json))->not->toContain($slug);
});

it('NÃO deve deixar quem não configura a clínica TROCAR o endereço — LER, quem cadastra pode', function () {
    // ARRANGE — gerar e rotacionar é parametrização da clínica, não operação de cadastro; LER o
    // endereço é da recepção, que é quem o manda à família (change link-do-cadastro-na-recepcao)
    admin();
    $recepcao = usuarioCom(['pacientes.ver', 'pacientes.criar'], 'Recepção Fictícia');
    $soLeFichas = usuarioCom(['pacientes.ver'], 'Só Lê Fichas Fictício');

    // ACT + ASSERT
    $this->actingAs($recepcao)->getJson('/api/cadastro-online/link')->assertOk();
    $this->actingAs($recepcao)->postJson('/api/cadastro-online/link/rotacionar')->assertForbidden();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($soLeFichas)->getJson('/api/cadastro-online/link')->assertForbidden();
});

it('deve entregar o tema da clínica na marca pública', function (string $tema) {
    // ARRANGE — a família reconhece a clínica também pela cor (changes tema-da-clinica e tema-xclinicas)
    $slug = clinicaComLinkLigado('Centro Fictício do Tema');
    Configuracao::create(['chave' => 'clinica.tema', 'valor' => $tema]);

    // ACT
    $resposta = $this->getJson("/api/publico/cadastro/{$slug}");

    // ASSERT
    $resposta->assertOk()->assertJsonPath('clinica.tema', $tema);
})->with(['menta', 'xclinicas']);
