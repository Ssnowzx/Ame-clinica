<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A mensagem recebida diz o que é (change `conversa-legivel`, design D1).
 *
 * `tipo_original` é o `type` que a Meta entregou (`reaction`, `sticker`, `unsupported`…). Antes ele
 * era jogado fora no `default` do mapeamento, e cinco mensagens de 29/09 ficaram "não suportadas"
 * sem ninguém conseguir dizer o que eram. Não é dado pessoal: é o nome do formato.
 *
 * `detalhes_json` guarda o que precisa de estrutura e não é texto para ler — hoje, as coordenadas
 * da localização. Coordenada é endereço de família: a coluna é cifrada pelo model, fica fora da
 * trilha e é apagada no expurgo junto com o corpo.
 *
 * Aditiva. Sem backfill: o tipo antigo se perdeu.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('mensagens', function (Blueprint $table): void {
            $table->string('tipo_original', 40)->nullable()->after('tipo');
            $table->text('detalhes_json')->nullable()->after('variaveis_json');
        });
    }

    public function down(): void
    {
        Schema::table('mensagens', function (Blueprint $table): void {
            $table->dropColumn(['tipo_original', 'detalhes_json']);
        });
    }
};
