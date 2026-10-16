<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A RÉGUA DO CADASTRO como dado (change campos-do-cadastro-configuraveis, §13).
 *
 * Guarda **só o override**: linha ausente — e coluna `NULL` — significam "usa o padrão do
 * catálogo" (design D2). Por isso a change entra com **zero backfill** e nada
 * muda de comportamento: até alguém configurar, a tabela está vazia e a régua efetiva é a
 * de sempre.
 *
 * `formulario` existe para que tratamento e profissional caibam aqui depois sem tabela
 * nova; só `paciente` é usado agora.
 *
 * `rapido` e `online` nascem SEM USO — são as chaves das changes 3 e 4 da cadeia
 * (cadastro rápido e cadastro online). Criá-las junto é generalidade deliberada: o
 * catálogo já declara as quatro chaves, e schema que contradiz o catálogo convida à
 * divergência. Se as changes forem abandonadas, uma migration as remove.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('campos_cadastro', function (Blueprint $table): void {
            $table->id();
            $table->string('formulario', 30);
            $table->string('campo', 60);

            // NULL ≠ false: `NULL` é "não opinei, use o catálogo"; `false` é a clínica
            // dizendo explicitamente que não. Um boolean NOT NULL apagaria essa diferença
            // e obrigaria a gravar linha para todo campo.
            $table->boolean('obrigatorio')->nullable();
            $table->boolean('desabilitado')->nullable();
            $table->boolean('rapido')->nullable();
            $table->boolean('online')->nullable();

            $table->timestamps();

            // a invariante: uma régua por campo, por formulário
            $table->unique(['formulario', 'campo'], 'regua_unica_por_campo');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('campos_cadastro');
    }
};
