<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Tabela EXCLUSIVA de teste (carregada só em runningUnitTests — AppServiceProvider):
// alvo neutro para testar a auditoria sem acoplar em um model de domínio.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('itens_teste', function (Blueprint $table) {
            $table->id();
            $table->string('nome')->unique();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('itens_teste');
    }
};
