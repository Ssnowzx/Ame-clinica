<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Anexos do paciente (change anexos-do-paciente) — documento de MENOR,
// potencialmente laudo (art. 11). O `caminho` é derivado de UUID (nada do
// cliente); o conteúdo vive CIFRADO no disco privado (SEC-AX-02). Soft-delete:
// laudo é prontuário com retenção (PR-11) — some da UI, nunca do disco
// (SEC-AX-08); a purga pós-retenção é processo governado futuro.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('anexos', function (Blueprint $table) {
            $table->id();
            // restrict como TODAS as FKs de paciente da base: o banco RECUSA hard-delete
            // de paciente com registro clínico (a retenção do anexo não pode ter porta
            // de destruição via SQL cru — CR bloqueante r1)
            $table->foreignId('paciente_id')->constrained('pacientes')->restrictOnDelete();
            $table->string('nome', 200);
            $table->string('mime', 100);
            $table->unsignedBigInteger('tamanho');
            $table->string('caminho', 255)->unique();
            $table->foreignId('criado_por')->nullable()
                ->constrained('usuarios')->nullOnDelete();
            $table->softDeletes();
            $table->timestamps();

        });
    }

    public function down(): void
    {
        Schema::dropIfExists('anexos');
    }
};
