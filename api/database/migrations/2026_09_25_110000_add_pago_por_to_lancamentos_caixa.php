<?php

use App\Support\Financeiro\AutorDaBaixaPelaAuditoria;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Quem deu a baixa (change `fechamento-de-caixa`, D1/D2): o fechamento de caixa é uma pergunta
 * POR PESSOA, e até aqui só a auditoria sabia o autor do pagamento.
 *
 * O backfill (`AutorDaBaixaPelaAuditoria`) copia o autor da trilha do próprio
 * lançamento; sem autor, fica nulo. Um só UPDATE por SQL, sem carregar modelos.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('lancamentos_caixa', function (Blueprint $table) {
            $table->foreignId('pago_por_id')->nullable()->after('pago_em')->constrained('usuarios')->nullOnDelete();
            $table->index(['pago_em', 'pago_por_id'], 'lancamentos_caixa_fechamento_idx');
        });

        AutorDaBaixaPelaAuditoria::preencher();
    }

    public function down(): void
    {
        Schema::table('lancamentos_caixa', function (Blueprint $table) {
            $table->dropIndex('lancamentos_caixa_fechamento_idx');
            $table->dropConstrainedForeignId('pago_por_id');
        });
    }
};
