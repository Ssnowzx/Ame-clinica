<?php

namespace App\Http\Middleware;

use App\Support\Auditoria\OrigemDaOperacao;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * O que faz uma rota ser **pública humana** (change `cadastro-online-do-paciente`).
 *
 * A casa já tinha uma espécie de rota pública: a de integração assinada (o webhook da Meta), que
 * é pública no endereço e autenticada no corpo, por HMAC. Esta é outra espécie: aberta a pessoas
 * **sem nenhum segredo compartilhado** — quem chega é uma família com um link.
 *
 * As três coisas que este middleware garante são estruturais de propósito, e não convenção que um
 * controller possa esquecer:
 *
 * 1. **A operação é de origem EXTERNA.** É o que faz a trilha registrar "veio de fora" em vez de
 *    atribuir o envio ao usuário que por acaso tenha sessão aberta no mesmo navegador — o caso que
 *    o parecer pré-código mediu (ameaça A5): a recepcionista com o sistema aberto que abre o link
 *    público manda o cookie junto, e sem isto o envio da família sairia como ato dela, para sempre.
 * 2. **A resposta não é guardável.** Proxy que guardasse a resposta e a servisse a outra pessoa é o
 *    vazamento mais bobo possível, e a resposta carrega a marca da clínica.
 * 3. **A página não é indexável.** O identificador público está na URL: um buscador que o publique
 *    acaba com a opacidade que o desenho inteiro depende.
 *
 * O que ele **não** faz, e é igualmente importante: não autentica, não resolve sessão e não decide
 * nada sobre o conteúdo. A rota é pública — quem a protege é o balde de throttle, a fila de
 * conferência e a resposta cega, não uma credencial que não existe.
 */
class RotaPublicaHumana
{
    public function handle(Request $request, Closure $next): Response
    {
        try {
            $this->recusarEscritaDeOutraOrigem($request);

            app(OrigemDaOperacao::class)->marcarExterna();

            $resposta = $next($request);
        } catch (HttpExceptionInterface $recusa) {
            /*
             * A recusa da guarda de origem SAI COM OS MESMOS CABEÇALHOS.
             *
             * Ela é lançada antes do `$next()`, então escapava das três linhas abaixo — e o
             * docblock chama essas três garantias de "estruturais". Uma resposta desta rota que
             * saísse guardável ou indexável seria a exceção que o desenho não admite, mesmo sendo
             * um 403 (rodada dirigida, SEC-CO-48).
             */
            // JSON, e com os cabeçalhos da própria exceção: todo o resto desta família de rotas
            // responde JSON, e trocar o envelope só nesta recusa é divergência de contrato
            $resposta = response()->json(
                ['message' => $recusa->getMessage()],
                $recusa->getStatusCode(),
                $recusa->getHeaders(),
            );
        }

        $resposta->headers->set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        $resposta->headers->set('Pragma', 'no-cache');
        $resposta->headers->set('X-Robots-Tag', 'noindex, nofollow, noarchive');

        return $resposta;
    }

    /**
     * ESCRITA vinda de outra origem é recusada aqui, não pelo CORS.
     *
     * O CORS omite `Access-Control-Allow-Origin` e com isso impede o site hostil de **ler** a
     * resposta. Ele não impede de **escrever**: um POST "simples" — `x-www-form-urlencoded`, sem
     * cabeçalho customizado — não dispara preflight, e o navegador o manda assim mesmo. Medido no
     * gate: `Origin: https://site-hostil.example` gravava na fila com 201 (SEC-CO-35 / CO-02).
     *
     * O que o CSRF do Sanctum faz nas rotas com sessão, esta guarda faz aqui — e é preciso fazê-la
     * na mão porque a rota pública não tem sessão, logo não tem token.
     *
     * O `Origin` é posto pelo NAVEGADOR, nunca pela página: quem chega sem ele não é um navegador
     * seguindo um formulário de terceiro. Por isso ausência não é recusa — recusar sem `Origin`
     * derrubaria o `curl` da conferência de produção e qualquer cliente que não seja navegador,
     * sem fechar nada.
     */
    private function recusarEscritaDeOutraOrigem(Request $request): void
    {
        if ($request->isMethodSafe()) {
            return;
        }

        $origem = $request->headers->get('Origin');

        if ($origem === null || $origem === '') {
            return;
        }

        /*
         * TRÊS fontes, e a redundância é deliberada:
         *
         * - a lista do CORS, que o deploy declara;
         * - `app.url`, que é o endereço canônico do sistema;
         * - o host da própria requisição.
         *
         * A terceira sozinha não bastaria: atrás do proxy da VPS ela depende de `TRUSTED_PROXIES`
         * estar certo, e se ele resolver `http://localhost` em vez do domínio da clínica, o
         * formulário LEGÍTIMO passa a ser recusado com 403 — a guarda derrubaria justamente quem
         * ela existe para deixar passar.
         */
        $permitidas = array_map(
            static fn (string $url): string => rtrim($url, '/'),
            array_filter([
                ...(array) config('cors.allowed_origins', []),
                (string) config('app.url'),
                $request->getSchemeAndHttpHost(),
            ])
        );

        abort_unless(in_array(rtrim($origem, '/'), $permitidas, true), 403, 'Origem não permitida.');
    }
}
