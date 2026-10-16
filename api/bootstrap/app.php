<?php

use App\Http\Middleware\HeadersDeSeguranca;
use App\Http\Middleware\ResolveLinkPublico;
use App\Http\Middleware\RotaPublicaHumana;
use App\Http\Middleware\VerificaUsuarioAtivo;
use App\Support\Mensageria\DisparoDeLembretes;
use App\Support\Rede\ProxiesConfiaveis;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Spatie\Permission\Middleware\PermissionMiddleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        /*
         * ROTAS PÚBLICAS HUMANAS, registradas FORA do grupo `api` (change
         * `cadastro-online-do-paciente`). O prefixo continua `api/` para o front falar com um
         * endereço só e para o proxy ter uma regra só — o que muda é a PILHA: sem `statefulApi()`,
         * logo sem sessão e sem CSRF, e sem o `throttle:api` das rotas autenticadas.
         *
         * É estrutural de propósito. Um `withoutMiddleware()` por rota daria o mesmo efeito hoje e
         * dependeria de alguém lembrar amanhã; aqui a rota nova nasce stateless porque não há como
         * ela nascer de outro jeito.
         */
        then: function (): void {
            Route::prefix('api')->group(base_path('routes/publico.php'));
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Confiança de proxy env-driven (SEC-ER-04): SÓ o reverse proxy conhecido.
        // `*` FALHA a boot dentro do parse. PROTO habilita isSecure() atrás do TLS do
        // proxy (→ HSTS + cookie Secure). Vazio (local-first) = nenhum: o IP já é real.
        //
        // NÃO troque `env()` por `config()` aqui: este closure roda no afterResolving do
        // HttpKernel, ANTES do bootstrap — o container 'config' sequer está registrado, e
        // `config()` lança BindingResolutionException. Medido em 2026-08-20, não deduzido.
        //
        // A contrapartida é dura e vale para produção: nesse instante o Dotenv também não
        // rodou, então `env()` enxerga SOMENTE variável REAL de processo. TRUSTED_PROXIES
        // escrito apenas no arquivo `.env` é lido como NULL e a lista sai vazia — com ou
        // sem `config:cache`, que é irrelevante aqui. Na VPS ela precisa vir do
        // `environment:` do compose. Sem isso a auditoria grava o IP do proxy, não o de
        // quem operou, e o HSTS nunca é emitido (isSecure() fica falso).
        $middleware->trustProxies(
            at: ProxiesConfiaveis::parse(env('TRUSTED_PROXIES')),
            headers: Request::HEADER_X_FORWARDED_FOR
                | Request::HEADER_X_FORWARDED_HOST
                | Request::HEADER_X_FORWARDED_PORT
                | Request::HEADER_X_FORWARDED_PROTO,
        );

        // Sanctum SPA: requests da origem stateful (localhost:5173) usam sessão+CSRF
        $middleware->statefulApi();

        // Piso de headers de segurança em TODA resposta (GLOBAL, depois do statefulApi):
        // no grupo `api` só, `/up`/csrf-cookie/erros fora do grupo sairiam sem headers.
        $middleware->append(HeadersDeSeguranca::class);

        // SEC-ER-01: throttle por IP nas superfícies NÃO-autenticadas do grupo `web`
        // (`/` e o `/sanctum/csrf-cookie` do Sanctum). Sem isto, um laço no csrf-cookie
        // persiste uma sessão por hit (SESSION_DRIVER=database) e infla a tabela `sessions`.
        $middleware->web(append: ['throttle:60,1']);

        // Pilha de proteção das rotas de domínio (ordem importa — design, armadilha 5):
        // sessão/stateful → auth:sanctum → throttle:api → ativo → permission
        $middleware->alias([
            'ativo' => VerificaUsuarioAtivo::class,
            'permission' => PermissionMiddleware::class,
            // o que faz uma rota ser pública humana: origem externa na trilha, resposta não
            // guardável, não indexável (change cadastro-online-do-paciente)
            'publico' => RotaPublicaHumana::class,
            // resolve a clínica pelo endereço ANTES da validação (SEC-CO-17): dentro do
            // controller, a FormRequest rodaria primeiro e o 422 viraria oráculo
            'link-publico' => ResolveLinkPublico::class,
        ]);

        // API pura: guest nunca é redirecionado para rota "login" (inexistente) —
        // sem isto, 401 sem Accept: application/json virava 500 (auditoria, achado F1)
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withSchedule(function (Schedule $schedule): void {
        // PRIMEIRA rotina agendada do produto (change mensageria-whatsapp). Exige
        // `schedule:run` no cron do VPS — sem ele, nada disto acontece e o silêncio é
        // total (consta do runbook).
        //
        // 08:00 no fuso da clínica: o lembrete do dia seguinte sai numa hora em que a
        // família ainda pode responder e a recepção ainda pode remarcar. De madrugada
        // ele chegaria como notificação perdida no meio da noite.
        //
        // `withoutOverlapping`: se um disparo demorar (rede da Meta instável), o do dia
        // seguinte NÃO começa por cima. A idempotência do banco já impede duplicata, mas
        // dois processos disputando a mesma fila é desperdício.
        $schedule->command('lembretes:enviar')
            ->dailyAt(sprintf('%02d:00', DisparoDeLembretes::HORA_DO_DISPARO))
            ->timezone('America/Sao_Paulo')
            ->withoutOverlapping();

        // a repescagem (change `repescagem-do-lembrete`): a sessão marcada depois das 08:00 para
        // o dia que o disparo já cobriu. Roda TODA hora, sem janela aqui: a janela é da clínica,
        // no fuso da clínica — um `between()` usaria o fuso do servidor
        // A trava expira em 55 min: sem prazo ela dura 24 h, e um `schedule:run` morto no meio
        // calaria todas as voltas do dia (CR-RP-09)
        $schedule->command('lembretes:enviar --repescagem')
            ->hourly()
            ->withoutOverlapping(55);

        // expurgo da retenção (§12): de madrugada, quando ninguém está usando
        $schedule->command('mensagens:expurgar')
            ->dailyAt('03:30')
            ->timezone('America/Sao_Paulo')
            ->withoutOverlapping();

        // expurgo do auto-cadastro público (change cadastro-online-do-paciente): o envio que
        // ninguém conferiu perde o conteúdo e o IP no prazo da clínica. Agendado desde a
        // primeira versão, e ANTES de a porta coletar — porta que coleta sem expurgo é acúmulo
        // de dado de menor desde o dia 1. Meia hora depois do outro para não disputarem o banco.
        $schedule->command('cadastro-online:expurgar')
            ->dailyAt('04:00')
            ->timezone('America/Sao_Paulo')
            ->withoutOverlapping();
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // rotas de API sempre respondem JSON, mesmo sem Accept: application/json —
        // sem isto, 401 vira redirect para rota "login" inexistente → 500 com página
        // de debug (auditoria de segurança, achado F1)
        $exceptions->shouldRenderJsonWhen(
            fn ($request) => $request->is('api/*') || $request->expectsJson()
        );
    })->create();
