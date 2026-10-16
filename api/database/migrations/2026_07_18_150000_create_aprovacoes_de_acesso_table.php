<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Pendências do maker-checker de acesso (change segregacao-de-deveres, AP-13).
// FKs de usuário em RESTRICT: a pendência é história de decisão administrativa —
// apagar o usuário não pode apagar quem pediu/decidiu (lição do gate de anexos).
// `ativa_uk` é coluna GERADA única (SEC-SD-07): "1 pendência ativa por alvo" por
// construção do banco — NULL quando decidida (MySQL trata NULLs como distintos),
// imune à corrida de dois POSTs simultâneos que um SELECT…FOR UPDATE em conjunto
// vazio não serializa (gap lock não é garantia).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aprovacoes_de_acesso', function (Blueprint $table) {
            $table->id();
            $table->string('tipo', 30);
            $table->unsignedBigInteger('alvo_id')->default(0);
            $table->string('alvo_chave', 100)->nullable();
            $table->json('payload_json');
            $table->foreignId('solicitante_id')->constrained('usuarios')->restrictOnDelete();
            $table->string('status', 20)->default('pendente');
            $table->foreignId('decidido_por_id')->nullable()
                ->constrained('usuarios')->restrictOnDelete();
            $table->dateTime('decidido_em')->nullable();
            $table->string('ativa_uk', 200)->nullable()->storedAs(
                "case when status = 'pendente' "
                ."then concat(tipo, '|', alvo_id, '|', coalesce(alvo_chave, '')) "
                .'else null end',
            )->unique();
            $table->timestamps();

            $table->index(['status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aprovacoes_de_acesso');
    }
};
