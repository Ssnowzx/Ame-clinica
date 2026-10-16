<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('especialidades', function (Blueprint $table) {
            $table->id();
            $table->string('nome');
            $table->unsignedSmallInteger('tempo_sessao'); // minutos; herdado pela agenda (§6)
            $table->string('cor', 7); // #RRGGBB — marcador fino no card (§2)
            $table->boolean('exige_termo')->default(false); // consentimento LGPD
            $table->boolean('oculta_agendamento_online')->default(false); // dormente (fase 3)
            $table->timestamps();

            $table->unique(['nome']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('especialidades');
    }
};
