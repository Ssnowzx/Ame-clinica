<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Credencial do WhatsApp Cloud API da clínica (change mensageria-whatsapp, D1).
 *
 * A credencial NÃO mora em `configuracoes` e a razão é demonstrável: `App\Models\Configuracao`
 * usa o trait `Auditavel`, que grava o valor CRU no diff — o Access Token entraria em claro na
 * trilha, legível por quem tem `auditoria.ver`. Aqui os três segredos ficam com cast `encrypted`,
 * fora do `$fillable` e no `$auditExclude` do model.
 *
 * `phone_number_id` é o ÚNICO campo em claro por necessidade estrutural: o webhook chega sem
 * sessão, e é por ele que se confere que o evento é desta conexão — por isso é `unique` e
 * indexado.
 *
 * Uma linha só: "trocar o número" é substituir a conexão inteira. Credencial
 * meio trocada (token novo com phone_number_id velho) é a origem silenciosa de "manda e não
 * chega".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('whatsapp_conexoes', function (Blueprint $table): void {
            $table->id();

            // identificadores públicos da Meta — em claro de propósito (roteamento do webhook)
            $table->string('phone_number_id', 40);
            $table->string('waba_id', 40);
            $table->string('numero_exibicao', 30)->nullable();

            // segredos: texto porque o ciframento do Laravel expande muito além do original
            $table->text('access_token');
            $table->text('app_secret');
            $table->text('verify_token');

            // nao_conectado | conectado | invalido — string validada na app (Rule::in),
            // nunca ENUM de banco: mudar o domínio é validação, não ALTER TABLE
            $table->string('estado', 20)->default('nao_conectado');
            $table->timestamp('ultimo_teste_em')->nullable();
            $table->text('ultimo_erro')->nullable();
            $table->timestamps();

            $table->unique('phone_number_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('whatsapp_conexoes');
    }
};
