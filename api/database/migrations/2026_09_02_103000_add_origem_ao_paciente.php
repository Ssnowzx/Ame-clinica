<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * De onde veio esta ficha (change `cadastro-online-do-paciente`).
 *
 * Paciente criado pelo aceite de um envio público carrega a marca de que **veio de fora**. Não é
 * rótulo de tela: existe para que, meses depois, dê para responder "quem digitou isto?" sem
 * depender da memória de ninguém — a família digitou, e uma pessoa da clínica conferiu.
 *
 * A origem MUST NOT mudar regra nenhuma do paciente: ele é paciente pleno, com as mesmas guardas,
 * o mesmo escopo por vínculo (D11) e a mesma minimização de dado de menor. E não sai em nenhuma
 * superfície pública.
 *
 * Nasce NULA: o cadastro interno continua sem origem, e é assim que se distingue um do outro.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pacientes', function (Blueprint $table) {
            // só a origem externa é registrada; o cadastro de balcão é o caso comum e fica nulo
            $table->foreignId('envio_de_cadastro_id')->nullable()->after('ativo')
                ->constrained('envios_de_cadastro')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('pacientes', function (Blueprint $table) {
            $table->dropConstrainedForeignId('envio_de_cadastro_id');
        });
    }
};
