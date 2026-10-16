<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A linha do DRE de cada categoria e subcategoria (change `dre-gerencial`, D1/D2): a ESCOLHA é dado
 * da clínica; a escada é código (`EscadaDoDre`). Nulo = o padrão da natureza — nenhuma categoria
 * fica fora do DRE, e por isso não há backfill.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('categorias', function (Blueprint $table) {
            $table->string('linha_dre', 40)->nullable()->after('tipo');
        });
        Schema::table('subcategorias', function (Blueprint $table) {
            $table->string('linha_dre', 40)->nullable()->after('codigo_contabil');
        });
    }

    public function down(): void
    {
        Schema::table('subcategorias', function (Blueprint $table) {
            $table->dropColumn('linha_dre');
        });
        Schema::table('categorias', function (Blueprint $table) {
            $table->dropColumn('linha_dre');
        });
    }
};
