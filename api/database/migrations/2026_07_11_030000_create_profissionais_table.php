<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Profissional EXECUTANTE (≠ médico solicitante — §5 correção 2). Janela de
// atendimento alimenta a grade da agenda (§6).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('profissionais', function (Blueprint $table) {
            $table->id();
            $table->string('nome');
            $table->string('conselho', 20)->nullable();
            $table->string('uf_conselho', 2)->nullable();
            $table->string('num_conselho', 20)->nullable();
            $table->foreignId('cbos_id')->nullable()->constrained('cbos')->restrictOnDelete();
            $table->time('janela_inicio')->nullable();
            $table->time('janela_fim')->nullable();
            $table->text('obs')->nullable();
            $table->boolean('ativo')->default(true);
            $table->timestamps();

            // NULLs são distintos no unique — vários profissionais sem conselho convivem
            $table->unique(['conselho', 'uf_conselho', 'num_conselho']);
        });

        Schema::create('profissional_especialidade', function (Blueprint $table) {
            $table->id();
            $table->foreignId('profissional_id')->constrained('profissionais')->cascadeOnDelete();
            // restrict: especialidade vinculada a profissional não pode ser excluída (spec)
            $table->foreignId('especialidade_id')->constrained('especialidades')->restrictOnDelete();

            $table->unique(['profissional_id', 'especialidade_id'], 'prof_esp_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('profissional_especialidade');
        Schema::dropIfExists('profissionais');
    }
};
