<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// PACIENTES — dados de MENORES (LGPD art. 14, §12/§16): sem exclusão física
// (desativação preserva a trilha); CPF mascarado no diff de auditoria (design D5);
// JSONs tipados validados na FormRequest (design D6).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pacientes', function (Blueprint $table) {
            $table->id();
            $table->string('nome');
            $table->string('nome_social')->nullable();
            $table->date('nascimento');
            $table->string('sexo', 20);
            $table->string('cpf', 11)->nullable();
            $table->json('responsaveis_json');
            $table->json('endereco_json')->nullable();
            $table->json('contatos_json')->nullable();
            $table->string('indicacao')->nullable();
            $table->string('necessidade', 30);
            $table->string('estado_civil', 20)->nullable();
            $table->string('profissao')->nullable();
            $table->text('obs')->nullable();
            $table->json('consentimentos_json')->nullable();
            $table->boolean('ativo')->default(true);
            $table->timestamps();

            $table->unique(['cpf']); // NULLs convivem; CPF informado é único
            $table->index(['nome']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pacientes');
    }
};
