<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Quem da clínica confirmou a sessão (change `confirmacao-pela-clinica`, design D1).
 *
 * A família confirmou por telefone ou mensagem, e a recepção registra. `resposta` continua
 * `confirmou` — a faixa, o sino e a resposta automática não mudam —, e a ORIGEM vira coluna em vez
 * de ser derivada de `resposta_mensagem_id`: o "Manter a sessão" guarda o toque de desmarque como
 * evidência e mesmo assim é confirmação da clínica. Nulo = a família confirmou pelo botão.
 *
 * Aditiva: quem grava é sempre o usuário autenticado. `restrictOnDelete` (gate r1, SEC-CC-05): com `nullOnDelete`, apagar o usuário
 * faria a confirmação dele dizer "pela família" — uma atribuição falsa. Usuário não se apaga, desativa.
 *
 * Sem backfill: as confirmações antigas do "Manter" seguem dizendo "pela família", e quem manteve
 * continua na trilha.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('lembretes_enviados', function (Blueprint $table): void {
            $table->foreignId('confirmado_por')->nullable()->after('ultimo_toque_em')
                ->constrained('usuarios')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('lembretes_enviados', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('confirmado_por');
        });
    }
};
