<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Quantos atendimentos o profissional sustenta no MESMO intervalo (change
 * atendimento-em-grupo, D1).
 *
 * Pedido da clínica (Camille, 2026-09-15): Margarete, Greice e William atendem até 4
 * crianças no mesmo horário. O eixo PROFISSIONAL do conflito (§6) recusava no primeiro
 * ocupante, sem saída — não havia flag, configuração nem exceção.
 *
 * A capacidade é do CADASTRO, não da clínica: uma chave global `bloquear|avisar|permitir`
 * (o molde de `agenda.conflito_paciente`) desligaria a proteção dos vinte e poucos
 * profissionais que atendem um por vez para atender três. "Atende 4 ao mesmo tempo" é
 * atributo de QUEM atende.
 *
 * **Default 1 = o comportamento de hoje, exatamente.** Nenhum profissional muda sem
 * alguém digitar um número maior — é o que torna esta migration segura na produção e o
 * rollback barato (baixar para 1 desfaz sem deploy).
 *
 * `unsignedTinyInteger` porque o boundary limita a faixa em 1..10: o teto existe para
 * que um `40` onde se queria `4` não transforme a guarda em decoração.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('profissionais', function (Blueprint $table) {
            // depois de `obs` porque `janela_inicio`/`janela_fim` já não existem: as janelas
            // viraram a tabela `profissional_horarios` em 2026-07-23. O lugar na TELA (junto dos
            // horários, porque é regra de agenda) não depende da ordem da coluna no banco.
            $table->unsignedTinyInteger('atendimentos_simultaneos')->default(1)->after('obs');
        });
    }

    public function down(): void
    {
        Schema::table('profissionais', function (Blueprint $table) {
            $table->dropColumn('atendimentos_simultaneos');
        });
    }
};
