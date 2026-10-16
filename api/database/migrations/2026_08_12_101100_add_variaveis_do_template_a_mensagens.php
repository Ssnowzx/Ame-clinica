<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * O que foi preenchido no template fica NA MENSAGEM (change mensageria-whatsapp).
 *
 * Antes, as variáveis e o idioma viviam só na carga do Job — memória de um processo. Duas
 * consequências, ambas encontradas no gate de code review:
 *
 * 1. **Reenviar perdia o conteúdo.** "Tentar novamente" numa mensagem de template
 *    reenfileirava sem as variáveis; o Job caía no ramo de TEXTO e a família recebia a
 *    prévia como mensagem comum — ou nada, quando o corpo era nulo.
 * 2. **O idioma era chutado.** O Job hardcodava `pt_BR`, e um template aprovado como `pt`
 *    volta da Meta como "template não existe nesta tradução" — erro permanente, nenhum
 *    lembrete sai, e a tela diz que o template não existe justamente para um template que a
 *    pessoa vê aprovado na lista.
 *
 * A prévia (`corpo`) não serve para reconstruir: ela é o texto JÁ substituído, e não há como
 * separar o que era molde do que era valor.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('mensagens', function (Blueprint $table): void {
            // `text`, não `json`: o conteúdo é CIFRADO em repouso (as variáveis do lembrete
            // carregam o nome da criança), e o CHECK de JSON do MariaDB recusa ciphertext.
            // Não se perde nada: a coluna nunca é consultada por caminho JSON.
            $table->text('variaveis_json')->nullable()->after('template_nome');
            $table->string('template_idioma', 10)->nullable()->after('template_nome');
        });
    }

    public function down(): void
    {
        Schema::table('mensagens', function (Blueprint $table): void {
            $table->dropColumn(['variaveis_json', 'template_idioma']);
        });
    }
};
