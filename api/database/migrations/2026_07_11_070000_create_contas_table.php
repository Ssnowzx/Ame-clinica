<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Contas/caixas da clínica (§9). codigo_contabil serve a exportação ao contador.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contas', function (Blueprint $table) {
            $table->id();
            $table->string('nome');
            $table->string('codigo_contabil', 30)->nullable();
            $table->boolean('ativo')->default(true);
            $table->timestamps();

            $table->unique(['nome']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contas');
    }
};
