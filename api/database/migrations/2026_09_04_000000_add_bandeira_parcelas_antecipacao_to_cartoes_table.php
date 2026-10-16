<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Amplia o CADASTRO do cartão (change bandeira-e-parcelas-do-cartao) — continua dormente
// (T-fin-03): nenhum cálculo lê estas colunas ainda.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cartoes', function (Blueprint $table) {
            $table->string('bandeira', 30)->nullable()->after('tipo');
            $table->json('pct_parcelas')->nullable()->after('pct_a_vista');
            $table->boolean('antecipacao_credito')->default(false)->after('liquidar_auto');
        });
    }

    public function down(): void
    {
        Schema::table('cartoes', function (Blueprint $table) {
            $table->dropColumn(['bandeira', 'pct_parcelas', 'antecipacao_credito']);
        });
    }
};
