<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Tipos de pagamento (§9) — DADO da clínica (Dinheiro, PIX, Boleto…), nunca enum.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tipos_pagamento', function (Blueprint $table) {
            $table->id();
            $table->string('nome', 60);
            $table->timestamps();

            $table->unique(['nome']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tipos_pagamento');
    }
};
