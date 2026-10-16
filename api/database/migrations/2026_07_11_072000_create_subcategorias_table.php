<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Subcategorias (§9) — codigo_contabil p/ exportação ao contador.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subcategorias', function (Blueprint $table) {
            $table->id();
            $table->foreignId('categoria_id')->constrained('categorias')->restrictOnDelete();
            $table->string('nome', 100);
            $table->string('codigo_contabil', 30)->nullable();
            $table->timestamps();

            $table->unique(['categoria_id', 'nome']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('subcategorias');
    }
};
