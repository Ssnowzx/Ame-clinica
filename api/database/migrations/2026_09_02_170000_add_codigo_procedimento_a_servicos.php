<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * O código do procedimento na tabela da OPERADORA entra na tabela de serviços
 * (change codigo-do-procedimento-no-servico).
 *
 * Aditiva e nullable: o Particular não tem código, e serviço já cadastrado continua
 * válido — nada é reescrito (não há como separar com segurança "50000470 – Sessão" de
 * um nome que por acaso comece com número).
 *
 * NÃO é `codigo_operadora`: `convenios.codigo_operadora` já existe e significa o código
 * da CLÍNICA junto à operadora. Duas colunas homônimas com sentidos opostos só cobrariam
 * o preço no dia da integração.
 *
 * Sem índice e sem unicidade (design D3): o mesmo código pode aparecer em dois serviços
 * do mesmo convênio (durações ou pacotes do mesmo procedimento base); o que continua
 * único é o NOME do procedimento.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('servicos', function (Blueprint $table): void {
            $table->string('codigo_procedimento', 40)->nullable()->after('procedimento');
        });
    }

    public function down(): void
    {
        Schema::table('servicos', function (Blueprint $table): void {
            $table->dropColumn('codigo_procedimento');
        });
    }
};
