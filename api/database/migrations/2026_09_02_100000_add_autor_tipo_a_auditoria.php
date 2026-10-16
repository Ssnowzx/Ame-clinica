<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A trilha passa a dizer QUE TIPO de autor agiu (change `cadastro-online-do-paciente`,
 * parecer pré-código condição 5).
 *
 * Hoje o autor da trilha é `usuario_id`, e o nulo significa uma coisa só: "operação de sistema,
 * fora de requisição" — é o que a API traduz para "Sistema". A change abre a primeira porta em
 * que alguém que **não é usuário do sistema** escreve: a família preenchendo o auto-cadastro. Sem
 * uma terceira categoria, esse envio cairia no mesmo nulo e ficaria indistinguível de um comando
 * agendado — a trilha mentiria por omissão sobre quem agiu.
 *
 * **Por que ANTES da rota, e não junto com ela:** trilha é imutável por desenho (sem rotas de
 * escrita, sem `updated_at`). A primeira linha gravada errada não se conserta depois — e "depois"
 * seria exatamente o registro do primeiro envio público que a clínica receber.
 *
 * O backfill é honesto e não inventa nada: o que já tem usuário é `usuario`, o que não tem é
 * `sistema`. Nenhuma linha existente pode ser `externo`, porque até hoje não havia porta externa.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('auditoria', function (Blueprint $table) {
            // sem default no schema: quem escreve é a fonte única (`RegistroDeAuditoria`), e um
            // default deixaria uma escrita futura que esquecesse o campo passar em silêncio
            $table->string('autor_tipo', 20)->nullable()->after('usuario_id');
        });

        DB::table('auditoria')->whereNull('autor_tipo')->update([
            'autor_tipo' => DB::raw("case when usuario_id is null then 'sistema' else 'usuario' end"),
        ]);

        Schema::table('auditoria', function (Blueprint $table) {
            $table->string('autor_tipo', 20)->nullable(false)->change();
            // a fila da auditoria filtra por autor; sem índice, "só o que veio de fora" varre
            $table->index(['autor_tipo']);
        });
    }

    public function down(): void
    {
        Schema::table('auditoria', function (Blueprint $table) {
            $table->dropIndex(['autor_tipo']);
            $table->dropColumn('autor_tipo');
        });
    }
};
