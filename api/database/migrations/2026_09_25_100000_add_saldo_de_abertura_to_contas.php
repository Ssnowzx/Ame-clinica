<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Saldo de abertura da conta (change `saldo-das-contas`, D1): quanto havia nela no início de
 * `saldo_inicial_em`. O saldo parte dali; o que foi pago ou transferido antes desse dia já está
 * dentro do valor. Sem data, a abertura é zero e tudo entra — as contas atuais nascem assim,
 * iguais ao que o Fluxo já mostra.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('contas', function (Blueprint $table) {
            $table->decimal('saldo_inicial', 12, 2)->default(0)->after('codigo_contabil');
            $table->date('saldo_inicial_em')->nullable()->after('saldo_inicial');
        });
    }

    public function down(): void
    {
        Schema::table('contas', function (Blueprint $table) {
            $table->dropColumn(['saldo_inicial', 'saldo_inicial_em']);
        });
    }
};
