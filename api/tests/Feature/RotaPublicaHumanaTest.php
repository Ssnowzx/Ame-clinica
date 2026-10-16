<?php

use App\Models\EnvioDeCadastro;
use App\Models\Paciente;
use App\Support\Auditoria\OrigemDaOperacao;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

/**
 * O que faz uma rota ser **pública humana** (change `cadastro-online-do-paciente`, passo 6).
 *
 * Toda a proteção existe **antes** da rota que ela protege. Este arquivo prova a pilha, não o
 * auto-cadastro: a rota de saúde do grupo público serve de cobaia, e o formulário virá depois já
 * dentro de um grupo que não tem como nascer errado.
 */
/**
 * Uma rota que responde se a REQUISIÇÃO tem sessão — a pergunta que importa, e que vale em
 * qualquer driver.
 *
 * A primeira versão deste teste contava linhas na tabela `sessions`, e era prova na condição
 * errada: a suíte roda com `SESSION_DRIVER=array`, então a contagem é sempre zero e a asserção
 * não podia falhar nem com a rota nascendo stateful. O driver de produção é banco — é lá que a
 * linha por visitante anônimo apareceria.
 */
function rotaQueRelataSessao(string $uri, array $middleware): void
{
    Route::middleware($middleware)->get($uri, fn (Request $r) => response()->json([
        'tem_sessao' => $r->hasSession(),
    ]));
}

it('NÃO deve abrir sessão — a requisição da família não carrega estado nenhum', function () {
    // ARRANGE — com o driver de banco de produção, uma rota stateful gravaria uma linha por
    // visita: a versão pública e amplificada do problema que o throttle do grupo `web` fechou
    // (ameaça A7 do parecer pré-código).
    //
    // A ROTA É A DE VERDADE, declarada em `routes/publico.php` — e isso é o teste, não detalhe.
    // A primeira versão registrava uma rota no próprio teste com o middleware `publico`, e por
    // isso passava também quando o arquivo inteiro voltava para dentro do grupo `api` (medido por
    // mutação): ela provava o apelido do middleware, e o que precisa ser provado é o GRUPO.
    $daOrigemDoSpa = ['Referer' => 'http://localhost:5173', 'Origin' => 'http://localhost:5173'];

    // ACT — inclusive vindo da origem do SPA, que é o gatilho do `statefulApi()`
    $resposta = $this->withHeaders($daOrigemDoSpa)->getJson('/api/publico/saude');

    // ASSERT
    $resposta->assertOk()->assertJsonPath('tem_sessao', false);
});

it('deve provar o contraste: a rota do grupo `api`, vinda da origem do SPA, TEM sessão', function () {
    // ARRANGE — o PAR DE CONTROLE do teste acima. Sem ele, a asserção "não tem sessão" passaria
    // num sistema onde nada nunca tem sessão, e a separação dos grupos pareceria funcionar sem
    // estar fazendo nada. O `statefulApi()` alcançando `api/*` é correto para o SPA autenticado —
    // e é exatamente o que a rota pública não pode herdar.
    rotaQueRelataSessao('/api/_teste/sessao-autenticada', ['api']);
    $daOrigemDoSpa = ['Referer' => 'http://localhost:5173', 'Origin' => 'http://localhost:5173'];

    // ACT
    $resposta = $this->withHeaders($daOrigemDoSpa)->getJson('/api/_teste/sessao-autenticada');

    // ASSERT
    $resposta->assertOk()->assertJsonPath('tem_sessao', true);
});

it('deve marcar a operação como EXTERNA na trilha, mesmo com sessão aberta no mesmo navegador', function () {
    // ARRANGE — a recepcionista com o sistema aberto que abre o link público manda o cookie
    // junto; sem esta marca, o envio da família sairia como ato dela (ameaça A5)
    $recepcionista = admin();
    Route::middleware(['publico'])->post('/api/publico/_teste/grava', function () {
        Paciente::factory()->create();

        return response()->json(['ok' => true], 201);
    });

    // ACT
    $this->actingAs($recepcionista)->postJson('/api/publico/_teste/grava')->assertCreated();

    // ASSERT
    $trilha = DB::table('auditoria')->where('entidade', 'pacientes')->latest('id')->first();
    expect($trilha->autor_tipo)->toBe(OrigemDaOperacao::EXTERNA)
        ->and($trilha->usuario_id)->toBeNull();
});

it('deve responder sem cache e sem indexação', function () {
    // ARRANGE — proxy guardando a resposta de uma clínica e servindo a outra é o vazamento mais
    // bobo possível; e o identificador público está na URL, então buscador que o publique acaba
    // com a opacidade de que o desenho inteiro depende
    // ACT
    $resposta = $this->getJson('/api/publico/saude')->assertOk();

    // ASSERT
    expect($resposta->headers->get('Cache-Control'))->toContain('no-store')
        ->and($resposta->headers->get('X-Robots-Tag'))->toContain('noindex')
        // e o piso global de segurança continua valendo aqui
        ->and($resposta->headers->get('Referrer-Policy'))->toBe('no-referrer')
        ->and($resposta->headers->get('X-Frame-Options'))->toBe('DENY');
});

it('deve ter balde de throttle PRÓPRIO — a rota pública satura sem derrubar a autenticada', function () {
    // ARRANGE — nenhum dos três baldes (autenticado, webhook, público) pode esfomear os outros
    $usuario = admin();
    $teto = (int) config('seguranca.throttle_publico_ip');

    // ACT — estoura o balde público
    foreach (range(1, $teto) as $ignorado) {
        $this->getJson('/api/publico/saude')->assertOk();
    }
    $estourada = $this->getJson('/api/publico/saude');

    // ASSERT — 429 com `Retry-After`...
    $estourada->assertStatus(429);
    expect($estourada->headers->get('Retry-After'))->not->toBeNull();

    // ...e quem está trabalhando no sistema segue atendido
    $this->actingAs($usuario)->getJson('/api/me')->assertOk();
});

it('deve limitar TAMBÉM por endereço do link — distribuir o ataque não contorna o teto', function () {
    // ARRANGE — é a contrapartida que o parecer exigiu para aceitar subir sem anti-bot: um site
    // hostil usando os próprios visitantes como remetentes faz cada um chegar com IP distinto e
    // dentro da cota individual. O eixo do endereço é o que fecha isso.
    Route::middleware(['publico', 'throttle:cadastro-online'])
        ->get('/api/publico/_teste/{slug}/marca', fn () => response()->json(['ok' => true]));

    $tetoPorEndereco = (int) config('seguranca.throttle_publico_link');

    // ACT — cada requisição de um IP diferente, todas para o MESMO endereço
    $ultima = null;
    foreach (range(1, $tetoPorEndereco + 1) as $n) {
        $ultima = $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.'.($n % 250)])
            ->getJson('/api/publico/_teste/abc123xyz/marca');
    }

    // ASSERT — o teto do endereço segurou, apesar de nenhum IP ter estourado o seu
    $ultima->assertStatus(429);

    // e outro endereço não foi arrastado junto
    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.9'])
        ->getJson('/api/publico/_teste/outro9999/marca')->assertOk();
});

/**
 * ORIGEM CRUZADA — a guarda que o CSRF faria, se houvesse sessão.
 *
 * O CORS impede o site hostil de LER a resposta; não impede de ESCREVER. Um POST "simples"
 * (`x-www-form-urlencoded`, sem cabeçalho customizado) não dispara preflight, e o navegador o
 * manda com os dados do formulário. Medido no gate: gravava 201 na fila da clínica.
 */
it('deve RECUSAR escrita vinda de outra origem', function (): void {
    // ARRANGE
    $slug = clinicaComLinkLigado();
    $antes = EnvioDeCadastro::count();

    // ACT — exatamente a requisição simples que passa por baixo do preflight
    $resposta = $this->call(
        'POST',
        "/api/publico/cadastro/{$slug}",
        envioValido(),
        server: ['HTTP_ORIGIN' => 'https://site-hostil.example', 'CONTENT_TYPE' => 'application/x-www-form-urlencoded']
    );

    // ASSERT — recusada, NADA foi gravado, e a recusa sai com os MESMOS cabeçalhos do resto da
    // rota: ela é lançada antes do resto do middleware e escapava das três garantias que o
    // docblock chama de estruturais
    expect($resposta->getStatusCode())->toBe(403)
        ->and(EnvioDeCadastro::count())->toBe($antes)
        ->and($resposta->headers->get('Cache-Control'))->toContain('no-store')
        ->and($resposta->headers->get('X-Robots-Tag'))->toContain('noindex')
        // JSON, como o 404 e o 429 desta mesma família: envelope diferente só nesta recusa é
        // divergência de contrato para quem consome a rota
        ->and($resposta->headers->get('Content-Type'))->toContain('application/json')
        ->and(json_decode((string) $resposta->getContent(), true))->toHaveKey('message');
});

it('deve aceitar a escrita da origem CANÔNICA do sistema, não só a do host da requisição', function (): void {
    // ARRANGE — atrás do proxy da VPS, o host da requisição depende de `TRUSTED_PROXIES` estar
    // certo; se ele resolvesse errado, a guarda recusaria o formulário legítimo com 403. Por isso
    // a lista tem três fontes, e este teste cobre a que só existe por causa do proxy
    config(['app.url' => 'https://clinica.fictícia.example', 'cors.allowed_origins' => []]);
    $slug = clinicaComLinkLigado();

    // ACT
    $resposta = $this->call(
        'POST',
        "/api/publico/cadastro/{$slug}",
        envioValido(),
        server: ['HTTP_ORIGIN' => 'https://clinica.fictícia.example', 'CONTENT_TYPE' => 'application/x-www-form-urlencoded']
    );

    // ASSERT
    expect($resposta->getStatusCode())->toBe(201);
});

it('deve ACEITAR escrita da própria origem', function (): void {
    // ARRANGE — o par de controle: sem ele, "recusa a origem estranha" seria satisfeito por
    // recusar toda escrita com `Origin`, e o próprio formulário da clínica pararia de funcionar
    $slug = clinicaComLinkLigado();

    // ACT
    $resposta = $this->call(
        'POST',
        "/api/publico/cadastro/{$slug}",
        envioValido(),
        server: ['HTTP_ORIGIN' => config('app.url'), 'CONTENT_TYPE' => 'application/x-www-form-urlencoded']
    );

    // ASSERT
    expect($resposta->getStatusCode())->toBe(201);
});

it('NÃO deve recusar quem chega SEM Origin', function (): void {
    // ARRANGE — o `Origin` é posto pelo navegador; quem chega sem ele não é um navegador seguindo
    // formulário de terceiro. Recusar aqui derrubaria a conferência de produção por `curl` sem
    // fechar nada
    $slug = clinicaComLinkLigado();

    // ACT + ASSERT
    $this->postJson("/api/publico/cadastro/{$slug}", envioValido())->assertCreated();
});

it('NÃO deve recusar a LEITURA vinda de outra origem', function (): void {
    // ARRANGE — ler o formulário de outra origem é inofensivo: o CORS já impede o site hostil de
    // ver a resposta, e recusar aqui só quebraria um front hospedado à parte
    $slug = clinicaComLinkLigado();

    // ACT + ASSERT
    $this->get("/api/publico/cadastro/{$slug}", ['Origin' => 'https://site-hostil.example'])
        ->assertOk();
});
