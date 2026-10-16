<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Catálogo GLOBAL de ocupações (CBO oficial — dado público), semeado pelo
// CbosSeeder (design D2 de cadastros-base).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cbos', function (Blueprint $table) {
            $table->id();
            $table->string('codigo', 10)->unique();
            $table->string('nome');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cbos');
    }
};
