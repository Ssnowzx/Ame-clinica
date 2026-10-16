<?php

use App\Http\Controllers\Publico\CadastroPublicoController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
 * ROTAS PÚBLICAS HUMANAS (change `cadastro-online-do-paciente`).
 *
 * Este arquivo existe separado de `api.php` por uma razão estrutural, e não organizacional: as
 * rotas daqui são registradas **fora do grupo `api`**, e por isso não herdam `statefulApi()` — a
 * pilha de sessão que o Sanctum prega em `api/*` quando a requisição vem da origem do SPA.
 *
 * Sem essa separação, medido pelo parecer pré-código (ameaças A5 e A7):
 *  - cada carregamento do formulário por um visitante anônimo gravaria uma linha em `sessions`
 *    (o driver é banco) — a versão pública e amplificada do problema que o `throttle:60,1` do
 *    grupo `web` fechou;
 *  - e a requisição da família feita no navegador da recepcionista chegaria autenticada.
 *
 * Deixar isso a cargo de um `withoutMiddleware()` por rota seria confiar em alguém lembrar. Aqui,
 * uma rota nova nasce stateless porque **não há como ela nascer de outro jeito**.
 *
 * Todas passam por `RotaPublicaHumana` (origem externa na trilha, resposta não guardável, não
 * indexável) e pelo balde de throttle próprio.
 */

Route::middleware(['publico', 'throttle:cadastro-online'])
    ->prefix('publico')
    ->group(function (): void {
        /*
         * Cobaia declarada da PILHA, e não do produto: ela relata se a requisição chegou com
         * sessão. É o que permite provar, com a rota de verdade deste arquivo, que o grupo nasce
         * stateless — um teste que registrasse a própria rota provaria só o apelido do middleware,
         * e passaria com o arquivo inteiro de volta dentro do grupo `api`.
         *
         */
        Route::get('/saude', fn (Request $requisicao) => response()->json([
            'status' => 'ok',
            'tem_sessao' => $requisicao->hasSession(),
        ]));

        /*
         * AUTO-CADASTRO PÚBLICO. O `{slug}` é o identificador opaco da clínica, e é dele que o
         * balde de throttle tira o eixo por endereço — por isso o nome do parâmetro importa: mudá-lo
         * derrubaria o teto por clínica em silêncio.
         */
        Route::middleware('link-publico')->group(function (): void {
            Route::get('/cadastro/{slug}', [CadastroPublicoController::class, 'formulario']);
            Route::get('/cadastro/{slug}/logo', [CadastroPublicoController::class, 'logo']);
            Route::post('/cadastro/{slug}', [CadastroPublicoController::class, 'enviar']);
        });
    });
