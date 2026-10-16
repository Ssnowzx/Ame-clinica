<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Anexos do lançamento de caixa (change `anexo-no-lancamento`): comprovante, nota fiscal, recibo.
 * Tabela PRÓPRIA, não a `anexos` do paciente (D1): documento clínico de menor e comprovante de
 * caixa têm permissão e retenção diferentes, e uma consulta errada atravessaria a fronteira.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lancamento_anexos', function (Blueprint $table) {
            $table->id();
            // restrict (D2): o banco recusa apagar o lançamento com anexo por SQL cru
            $table->foreignId('lancamento_id')->constrained('lancamentos_caixa')->restrictOnDelete();
            $table->string('nome', 200);
            $table->string('mime', 100);
            $table->unsignedBigInteger('tamanho');
            $table->string('caminho', 255)->unique();
            $table->foreignId('criado_por')->nullable()->constrained('usuarios')->nullOnDelete();
            $table->softDeletes();
            $table->timestamps();

        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lancamento_anexos');
    }
};
