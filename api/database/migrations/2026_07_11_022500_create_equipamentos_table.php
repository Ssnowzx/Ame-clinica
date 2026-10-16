<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('equipamentos', function (Blueprint $table) {
            $table->id();
            $table->string('nome');
            // restrict: especialidade vinculada a equipamento não pode ser excluída (spec)
            $table->foreignId('especialidade_id')->nullable()
                ->constrained('especialidades')->restrictOnDelete();
            $table->unsignedSmallInteger('quantidade_total'); // disponibilidade da agenda (§6)
            $table->timestamps();

            $table->unique(['nome']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('equipamentos');
    }
};
