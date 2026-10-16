<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A fila do auto-cadastro público (change `cadastro-online-do-paciente`).
 *
 * **Esta tabela é o ENVIO, não um paciente pela metade.** A distinção governa o desenho inteiro:
 * o envio é o registro do que a família mandou, e não se edita. Quem se corrige é o cadastro
 * criado no aceite, que nasce sob todas as guardas do cadastro interno.
 *
 * Nome próprio de propósito (design D8): já existe `POST /api/pacientes/pre-cadastro`, e ela
 * significa o OPOSTO — a recepção criando o paciente na hora, pelo balcão, com o mínimo. Duas
 * coisas com o mesmo nome e sentidos invertidos é o erro que esta casa já pagou caro uma vez.
 *
 * O payload é CIFRADO em repouso (parecer pré-código, condição 4): a existência de um envio já
 * diz que aquela criança busca tratamento nesta clínica, e isso é dado referente à saúde por
 * inferência (art. 11). O piso é o que a anamnese já estabeleceu aqui.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('envios_de_cadastro', function (Blueprint $table) {
            $table->id();

            /*
             * O conteúdo do envio, cifrado pelo cast do model. `text` e não `json`: o valor
             * gravado é o texto da cifra, e uma coluna `json` recusaria — o banco valida o
             * formato e o que chega ali não é JSON até ser decifrado.
             *
             * NULO depois do expurgo: a linha sobrevive sem o conteúdo, para a fila não mentir
             * sobre o próprio histórico.
             */
            $table->text('payload')->nullable();

            /*
             * O IP de quem enviou — o único fio forense contra abuso, e dado pessoal como
             * qualquer outro: morre JUNTO com o conteúdo, no mesmo prazo (parecer §4-g).
             */
            $table->string('ip', 45)->nullable();

            $table->timestamp('enviado_em');

            // `pendente` → a fila; `aceito`/`descartado` → conferido, sai da fila e não volta
            $table->string('situacao', 20)->default('pendente')->index();
            $table->string('motivo_descarte', 500)->nullable();

            // quem conferiu, e quando. Nulo enquanto pendente.
            $table->foreignId('conferido_por')->nullable()->constrained('usuarios')->nullOnDelete();
            $table->timestamp('conferido_em')->nullable();

            // o paciente que o aceite gerou — a ponte que responde "de onde veio esta ficha?"
            $table->foreignId('paciente_id')->nullable()->constrained('pacientes')->nullOnDelete();

            // marca do expurgo por retenção: é ela que distingue "conteúdo apagado por prazo"
            // de "envio que chegou vazio" (parecer §4-f)
            $table->timestamp('expurgado_em')->nullable();

            $table->timestamps();

            // a fila lê os pendentes, do mais antigo para o mais novo
            $table->index(['situacao', 'enviado_em']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('envios_de_cadastro');
    }
};
