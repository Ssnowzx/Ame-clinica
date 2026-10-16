<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Trilha de auditoria (§12 — base com dados de menores). Imutável via API;
// escrita apenas pelo trait Auditavel/RegistroDeAuditoria.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('auditoria', function (Blueprint $table) {
            $table->id();
            $table->foreignId('usuario_id')->nullable()->constrained('usuarios')->nullOnDelete();
            $table->string('entidade');
            $table->unsignedBigInteger('entidade_id');
            $table->string('acao');
            $table->json('diff_json');
            $table->string('ip', 45)->nullable();
            $table->timestamp('criado_em');

            $table->index(['entidade', 'entidade_id']);
            $table->index(['criado_em']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('auditoria');
    }
};
