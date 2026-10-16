<?php

namespace App\Providers;

use App\Support\Auditoria\ContextoDoLote;
use App\Support\Auditoria\OrigemDaOperacao;
use App\Support\CamposCadastro\ReguaDoCadastro;
use App\Support\Ciclos\GuardaDeCicloFechado;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // a origem da operação vale por REQUISIÇÃO: `scoped`, nunca singleton — num worker de
        // fila o singleton carregaria a marca de uma requisição para a seguinte
        $this->app->scoped(OrigemDaOperacao::class);
        // o lote em curso também vale por REQUISIÇÃO (D11 de `baixa-em-lote-por-status`): a
        // fonte única da trilha lê o id daqui em cada linha; um singleton carimbaria escritas de
        // outra requisição com o lote de uma que já acabou
        $this->app->scoped(ContextoDoLote::class);

        // scoped: uma instância por request/job — o memo nunca vaza entre requests
        $this->app->scoped(ConfiguracaoService::class);
        // A guarda de ciclo é consumida por CINCO boundaries (atendimento, evolução,
        // lançamento, agendamento e tratamento) e memoiza `tratamento → convênio`. Sem
        // `scoped`, cada injeção receberia uma instância nova e o memo do D3 seria memo por
        // classe — numa edição em série, N idas ao banco para reaprender a mesma coisa.
        // `scoped` (e não `singleton`): o memo NÃO pode atravessar requests, senão uma
        // edição de outro request ficaria invisível.
        $this->app->scoped(GuardaDeCicloFechado::class);
        // A régua do cadastro é lida pela FormRequest, pelo controller e pela listagem na
        // MESMA chamada (design D7). `scoped`, nunca `singleton`: um memo que atravessasse
        // requests não enxergaria a régua editada por outro request.
        $this->app->scoped(ReguaDoCadastro::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // JSON plano em toda a API (sem envelope "data") — mesma forma em login/me/recursos
        JsonResource::withoutWrapping();

        // brute force no login: 5 tentativas / 5 min por email+IP (parecer T-auth-01)
        RateLimiter::for('login', function (Request $request) {
            $chave = mb_strtolower((string) $request->input('email')).'|'.$request->ip();

            return Limit::perMinutes(5, 5)->by($chave);
        });

        // Rotas AUTENTICADAS: throttle por usuário (fallback IP), MÉTODO-AWARE com
        // buckets SEPARADOS por prefixo `r:`/`w:` — a invariante central: uma enxurrada
        // de GET (leitura) NUNCA pode esfomear um POST/PUT (mutação: um "Salvar").
        // Tetos de `config('seguranca.*')`, NUNCA `env()` cru: dentro deste closure de
        // runtime `env()` devolve NULL sob `config:cache`. Ordem no grupo (routes/api.php):
        // auth:sanctum → throttle:api → ativo.
        RateLimiter::for('api', function (Request $request) {
            $ehLeitura = $request->isMethodSafe();
            $prefixo = $ehLeitura ? 'r:' : 'w:';
            $identidade = optional($request->user())->id ?: $request->ip();
            $teto = (int) config($ehLeitura ? 'seguranca.throttle_leitura' : 'seguranca.throttle_mutacao');

            return Limit::perMinute($teto)->by($prefixo.$identidade);
        });

        // Webhook da Meta (mensageria-whatsapp): balde PRÓPRIO, por IP — a rota não tem
        // usuário. Separado dos baldes `r:`/`w:` de propósito: a Meta entregando em rajada
        // (ela agrupa eventos) não pode consumir a cota de quem está usando o sistema, e
        // uma enxurrada de uso não pode fazer o sistema recusar mensagem de família.
        /*
         * ROTA PÚBLICA HUMANA (change cadastro-online-do-paciente): o TERCEIRO balde, e ele é
         * independente dos outros dois de propósito — enxurrada no cadastro não pode esfomear
         * quem está trabalhando, nem a entrega da Meta, e o inverso também vale (FA-07).
         *
         * DOIS EIXOS, e o segundo é a contrapartida que o parecer pré-código exigiu para aceitar
         * subir sem anti-bot (D7-a): só por IP, a barreira se contorna distribuindo — um site
         * hostil usando os próprios visitantes como remetentes faz cada um deles chegar com IP
         * distinto e dentro da cota. O teto por ENDEREÇO fecha isso: a clínica tem um limite
         * de quanto o formulário dela aceita por minuto, venha de onde vier.
         *
         * O eixo usa o identificador PÚBLICO da URL, sem consultar o banco: resolver o endereço
         * antes do throttle daria ao atacante uma consulta ao banco por requisição — exatamente o
         * que o balde existe para evitar.
         */
        RateLimiter::for('cadastro-online', function (Request $request) {
            $porIp = Limit::perMinute((int) config('seguranca.throttle_publico_ip'))
                ->by('co:ip:'.$request->ip());

            $slug = (string) $request->route('slug');

            return $slug === ''
                ? [$porIp]
                : [$porIp, Limit::perMinute((int) config('seguranca.throttle_publico_link'))->by('co:t:'.$slug)];
        });

        // o painel do profissional (SEC-PP-03): balde PRÓPRIO por usuário, além do `api` do grupo — a
        // rota é a leitura mais cara do produto, e o teto geral de leitura não a segura
        RateLimiter::for('painel-do-profissional', function (Request $request) {
            return Limit::perMinute((int) config('seguranca.throttle_painel_profissional'))
                ->by('pp:'.(optional($request->user())->id ?: $request->ip()));
        });

        RateLimiter::for('webhook', function (Request $request) {
            return Limit::perMinute((int) config('mensageria.throttle_webhook'))->by('wh:'.$request->ip());
        });

        if ($this->app->runningUnitTests()) {
            // tabelas exclusivas de teste (ex.: itens_teste, usada para testar a tenancy
            // sem acoplar em um model de domínio) — nunca entram no schema de produção
            $this->loadMigrationsFrom(base_path('tests/database/migrations'));
        }
    }
}
