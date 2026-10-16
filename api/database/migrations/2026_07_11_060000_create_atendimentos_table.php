<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Registro de que a sessão OCORREU (§7) — 1:1 com o agendamento, unicidade no
// BANCO (anti-race, parecer T-ate-01). observacoes é dado clínico: cifrada pelo
// cast do model, por isso text (ciphertext > plaintext).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('atendimentos', function (Blueprint $table) {
            $table->id();
            $table->foreignId('agendamento_id')->unique()
                ->constrained('agendamentos')->restrictOnDelete();
            $table->dateTime('iniciado_em')->nullable();
            $table->dateTime('finalizado_em');
            $table->text('observacoes')->nullable();
            $table->timestamps();

            $table->index(['finalizado_em']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('atendimentos');
    }
};
