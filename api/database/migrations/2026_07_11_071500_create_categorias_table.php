<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Categorias do caixa (§9) com natureza receita|despesa.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categorias', function (Blueprint $table) {
            $table->id();
            $table->string('nome', 100);
            $table->string('tipo', 10); // receita|despesa
            $table->timestamps();

            $table->unique(['nome', 'tipo']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('categorias');
    }
};
