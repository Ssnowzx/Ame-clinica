<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Fronteira §14 como DADO (T-fin-17): a flag por convênio decide se o
// faturamento clínico cai no caixa operacional (Particular) ou segue a esteira
// de convênios. Default false = fail-closed; nada existente muda.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('convenios', function (Blueprint $table) {
            $table->boolean('particular')->default(false)->after('flags_tiss_json');
        });
    }

    public function down(): void
    {
        Schema::table('convenios', function (Blueprint $table) {
            $table->dropColumn('particular');
        });
    }
};
