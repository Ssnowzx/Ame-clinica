<?php

use App\Support\Agenda\DisponibilidadeLegada;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Horários de atendimento por dia com múltiplos intervalos
 * (change horarios-por-dia-do-profissional). Substitui a janela única
 * (`janela_inicio`/`janela_fim`, só visual) e os dias (`dias_atendimento_json`) por uma
 * TABELA FILHA — a própria nota da migration de `dias_atendimento_json` pediu isto ("no
 * dia do horário-por-dia, migra para tabela filha"): intervalo estruturado é schema, não
 * escalar em JSON.
 *
 * Backfill preserva o comportamento atual: para cada dia atendido (todos os 7 se
 * `dias_atendimento_json` era null), UMA linha `[janela ?? janela padrão da clínica]`.
 * Profissional SEM janela E SEM dias fica SEM linhas = todos os dias na janela padrão
 * (retrocompat — zero linhas substitui o antigo "null = janela cheia").
 */
return new class extends Migration
{
    /** Defaults do catálogo (CatalogoConfiguracoes) quando a clínica não tem override. */
    private const PADRAO_INICIO = '08:00';

    private const PADRAO_FIM = '19:00';

    public function up(): void
    {
        Schema::create('profissional_horarios', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('profissional_id')->constrained('profissionais')->cascadeOnDelete();
            $table->unsignedTinyInteger('dia_semana'); // ISO 1=segunda…7=domingo
            $table->time('inicio');
            $table->time('fim');
            $table->timestamps();

            // backstop de início duplicado exato no mesmo dia (M1) — a SOBREPOSIÇÃO fica no
            // request (MariaDB não tem exclusion constraint). O unique cobre o prefixo
            // `profissional_id` das leituras.
            $table->unique(['profissional_id', 'dia_semana', 'inicio'], 'prof_hor_unico');
        });

        // constraint-first (§13, "o que o banco pode impor, o banco impõe"): invariantes
        // INTRA-linha garantidas no banco, não só no request — seeder, migration e código futuro
        // escrevem cru. Primeiro CHECK do projeto (MariaDB 10.2+).
        DB::statement('ALTER TABLE profissional_horarios ADD CONSTRAINT chk_ph_intervalo CHECK (inicio < fim)');
        DB::statement('ALTER TABLE profissional_horarios ADD CONSTRAINT chk_ph_dia CHECK (dia_semana BETWEEN 1 AND 7)');

        $this->backfill();

        Schema::table('profissionais', function (Blueprint $table): void {
            $table->dropColumn(['janela_inicio', 'janela_fim', 'dias_atendimento_json']);
        });
    }

    /**
     * Converte cada profissional para linhas de `profissional_horarios`, preservando o
     * comportamento de hoje. Roda em `DB::table` (sem eventos de model): a migration não
     * depende dos casts do Eloquent nem dispara auditoria. A REGRA de conversão por profissional
     * vive em `DisponibilidadeLegada::paraLinhas` (pura, testada em `DisponibilidadeLegadaTest`).
     */
    private function backfill(): void
    {
        // janela padrão da clínica: override em `configuracoes`, senão o default do catálogo
        $padraoInicio = self::PADRAO_INICIO;
        $padraoFim = self::PADRAO_FIM;
        DB::table('configuracoes')
            ->whereIn('chave', ['agenda.janela_padrao_inicio', 'agenda.janela_padrao_fim'])
            ->get()
            ->each(function ($cfg) use (&$padraoInicio, &$padraoFim): void {
                if ($cfg->chave === 'agenda.janela_padrao_inicio') {
                    $padraoInicio = $cfg->valor;
                } else {
                    $padraoFim = $cfg->valor;
                }
            });

        $agora = now();
        $linhas = [];

        foreach (DB::table('profissionais')->get() as $profissional) {
            $conversao = DisponibilidadeLegada::paraLinhas(
                $profissional->janela_inicio,
                $profissional->janela_fim,
                $profissional->dias_atendimento_json,
                $padraoInicio,
                $padraoFim,
            );

            foreach ($conversao as $linha) {
                $linhas[] = [
                    'profissional_id' => $profissional->id,
                    'dia_semana' => $linha['dia_semana'],
                    'inicio' => $linha['inicio'],
                    'fim' => $linha['fim'],
                    'created_at' => $agora,
                    'updated_at' => $agora,
                ];
            }
        }

        foreach (array_chunk($linhas, 500) as $chunk) {
            DB::table('profissional_horarios')->insert($chunk);
        }
    }

    public function down(): void
    {
        Schema::table('profissionais', function (Blueprint $table): void {
            $table->time('janela_inicio')->nullable();
            $table->time('janela_fim')->nullable();
            $table->json('dias_atendimento_json')->nullable();
        });

        Schema::dropIfExists('profissional_horarios');
    }
};
