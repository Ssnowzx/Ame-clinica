<?php

namespace Database\Seeders;

use App\Models\Paciente;
use App\Models\Usuario;
use App\Support\Configuracoes\ConfiguracaoService;
use Database\Seeders\Apresentacao\Catalogos;
use Database\Seeders\Apresentacao\Comunicacao;
use Database\Seeders\Apresentacao\Contexto;
use Database\Seeders\Apresentacao\Elenco;
use Database\Seeders\Apresentacao\Financeiro;
use Database\Seeders\Apresentacao\Pacientes;
use Database\Seeders\Apresentacao\Sessoes;
use Database\Seeders\Apresentacao\Trilha;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * A base de APRESENTAÇÃO comercial da "Ame Clínica" — dados 100% inventados (LGPD: nomes
 * sorteados de listas comuns, nenhum dado de paciente real).
 *
 * A `DemoSeeder` mostra os fluxos com uma semana de agenda; esta mostra o produto INTEIRO
 * para outra clínica: 12 meses de histórico, para que todo gráfico, indicador e relatório
 * tenha série, comparação e sazonalidade — agenda, pacotes, evoluções, financeiro com DRE,
 * convênios com ciclo fechado, lembretes, WhatsApp, mural e trilha de auditoria.
 *
 * Roda só em banco LIMPO (recriar é mais honesto que mesclar com outra demo):
 *
 *     php artisan migrate:fresh --seed
 *     php artisan db:seed --class=ApresentacaoSeeder
 *
 * Login: admin@clinica-exemplo.com.br / senha-de-dev-123 (e os demais usuários da equipe,
 * mesma senha — ver README).
 */
class ApresentacaoSeeder extends Seeder
{
    public function __construct(private readonly int $meses = 12) {}

    public function run(): void
    {
        if (app()->isProduction() && ! config('app.demo')) {
            throw new \RuntimeException('ApresentacaoSeeder não roda em produção (só com APP_DEMO=true).');
        }

        // um ano de agenda em memória (~12 mil sessões com datas) passa dos 128 MB do CLI
        ini_set('memory_limit', '1G');

        if (Paciente::query()->exists()) {
            throw new \RuntimeException('A base já tem pacientes. Rode `php artisan migrate:fresh --seed` antes da apresentação.');
        }

        $primeiroIdDaSemeadura = (int) DB::table('auditoria')->max('id') + 1;
        $admin = Usuario::where('email', 'admin@clinica-exemplo.com.br')->firstOrFail();
        $ctx = new Contexto((int) $admin->id, app(ConfiguracaoService::class)->get('clinica.timezone'), $this->meses);
        $elenco = new Elenco($ctx);

        (new Catalogos($ctx))->semear();
        (new Pacientes($ctx, $elenco))->semear();
        (new Sessoes($ctx))->semear();
        (new Financeiro($ctx))->semear();
        (new Comunicacao($ctx, $elenco))->semear();
        (new Trilha($ctx))->semear($primeiroIdDaSemeadura);

        $this->relatar($ctx);
    }

    private function relatar(Contexto $ctx): void
    {
        $contar = fn (string $tabela) => DB::table($tabela)->count();
        $this->command?->info(Elenco::CLINICA." pronta — histórico de {$ctx->inicio->toDateString()} a {$ctx->fimDaAgenda->toDateString()}:");
        $this->command?->info("  {$contar('pacientes')} pacientes · {$contar('profissionais')} profissionais · {$contar('tratamentos')} pacotes · {$contar('lista_espera')} na fila");
        $this->command?->info("  {$contar('agendamentos')} agendamentos · {$contar('atendimentos')} atendimentos · {$contar('evolucoes')} evoluções");
        $this->command?->info("  {$contar('lancamentos_caixa')} lançamentos · {$contar('lembretes_enviados')} lembretes · {$contar('auditoria')} registros na trilha");
    }
}
