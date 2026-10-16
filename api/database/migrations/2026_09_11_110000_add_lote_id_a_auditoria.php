<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A trilha passa a dizer QUAL LOTE gravou a linha (change `baixa-em-lote-por-status`, D11).
 *
 * A baixa em lote por status e o desmarque em lote tocam dezenas de agendamentos (e os
 * tratamentos cujo saldo mudou por causa deles) numa transação só. Sem uma chave comum, a trilha
 * mostra dezenas de `atualizou` soltos e ninguém reconstitui "o que aquele clique fez". A chave é
 * um uuid por execução, gravado pela fonte única (`RegistroDeAuditoria`) a partir do
 * `ContextoDoLote` da requisição — nula em toda escrita fora de lote.
 *
 * **Sem backfill, de propósito:** nenhuma linha anterior pertenceu a um lote reconstituível — o
 * desmarque em lote existia sem gravar id nenhum. Inventar um agora seria a trilha afirmando um
 * vínculo que não foi gravado na hora. As linhas antigas ficam nulas e não aparecem em nenhum
 * filtro por lote (spec auditoria, "Lotes anteriores à mudança não ganham identificador").
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('auditoria', function (Blueprint $table) {
            $table->uuid('lote_id')->nullable()->after('acao');
            $table->index(['lote_id']);
        });
    }

    public function down(): void
    {
        Schema::table('auditoria', function (Blueprint $table) {
            $table->dropIndex(['lote_id']);
            $table->dropColumn('lote_id');
        });
    }
};
