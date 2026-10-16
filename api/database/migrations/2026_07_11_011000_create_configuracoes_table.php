<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Parametrização da clínica (§13): o banco guarda SÓ overrides; o catálogo de
// chaves/tipos/defaults vive em código (CatalogoConfiguracoes — design D5).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('configuracoes', function (Blueprint $table) {
            $table->id();
            $table->string('chave');
            $table->text('valor');
            $table->timestamps();

            $table->unique(['chave']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('configuracoes');
    }
};
