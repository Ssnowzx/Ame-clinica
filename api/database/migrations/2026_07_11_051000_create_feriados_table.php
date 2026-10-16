<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('feriados', function (Blueprint $table) {
            $table->id();
            $table->string('nome');
            $table->date('data');
            $table->boolean('recorrente')->default(false); // anual (mesma data todo ano)
            $table->boolean('ativo')->default(true);
            $table->timestamps();

            $table->unique(['data', 'nome']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feriados');
    }
};
