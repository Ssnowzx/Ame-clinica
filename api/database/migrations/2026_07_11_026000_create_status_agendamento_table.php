<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Status de agendamento é CADASTRO da clínica (§6/§13) — nunca enum em código.
// desconta_sessao é a regra de negócio central: decidida pela flag, por status.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('status_agendamento', function (Blueprint $table) {
            $table->id();
            $table->string('nome');
            $table->string('cor', 7);
            $table->string('cor_borda', 7)->nullable();
            $table->boolean('desconta_sessao')->default(false);
            $table->string('tipo', 30)->nullable(); // semântica refinada na change da agenda
            $table->unsignedSmallInteger('ordem')->default(0);
            $table->timestamps();

            $table->unique(['nome']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('status_agendamento');
    }
};
