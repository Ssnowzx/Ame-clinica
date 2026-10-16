<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * O convênio VIGENTE da criança passa a viver no cadastro (change
 * convenio-no-cadastro-do-paciente, D1).
 *
 * Ele já existia — só que espremido no `tratamento`. A planilha da virada traz
 * `convênio · plano · matrícula` no nível da PESSOA, e como não havia onde gravar,
 * `ViradaImportar` empurrava a matrícula para o pacote sob a trava SEC-IV-14
 * ("matrícula só quando o convênio do pacote casa com o do cadastro") — descartando
 * carteirinha em silêncio sempre que a família trocara de plano depois da compra.
 *
 * `tratamentos.convenio_id`/`matricula` CONTINUAM, e mudam de papel: passam a ser o
 * registro do que valia quando o pacote foi vendido. Não é duplicação — é valor atual
 * contra valor no momento do fato, como preço de cadastro contra preço em nota.
 *
 * Aditiva, tudo nullable: criança particular não tem plano nem carteirinha, e
 * "Particular" é um convênio como outro (flag na própria tabela `convenios`).
 * Fronteira §14 intacta: dado cadastral, nenhuma esteira de guia/TISS/faturamento.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pacientes', function (Blueprint $table) {
            /*
             * `restrictOnDelete` como nas tabelas de serviços e de regras: convênio
             * referenciado não some por engano. `nullOnDelete` apagaria o vínculo da
             * criança em silêncio — e é justamente o apagamento silencioso que esta
             * change existe para acabar.
             */
            $table->foreignId('convenio_id')->nullable()->after('cpf')
                ->constrained('convenios')->restrictOnDelete();
            // texto livre no v1 (D4): modelar planos por convênio é estrutura da esteira,
            // e a esteira é do gestao_de_convenios (§14)
            $table->string('plano')->nullable()->after('convenio_id');
            // identificador do MENOR junto à operadora — mesma classe do CPF. Fica em
            // `$auditExclude`, fora de listagem e fora de query string (D5)
            $table->string('carteirinha')->nullable()->after('plano');
            $table->date('carteirinha_validade')->nullable()->after('carteirinha');
            // "quais crianças são deste convênio" (o relatório da renovação de contrato) usa
            // o índice que a própria FK cria em `convenio_id`
        });

        $this->preencherDoHistorico();
    }

    public function down(): void
    {
        Schema::table('pacientes', function (Blueprint $table) {
            $table->dropForeign(['convenio_id']);
            $table->dropColumn(['convenio_id', 'plano', 'carteirinha', 'carteirinha_validade']);
        });
    }

    /**
     * Backfill DERIVADO, e só quando não há ambiguidade (D8).
     *
     * A base já tem centenas de crianças com tratamento. Deixar o cadastro de todas vazio
     * joga na recepção o trabalho manual que esta change existe para evitar.
     *
     * Mas só preenche quando **todos** os tratamentos não-finalizados do paciente apontam
     * para o MESMO convênio. Divergindo, fica vazio: adivinhar qual é o principal é
     * exatamente o erro que a trava SEC-IV-14 evitava.
     *
     * Rejeitado — "pegar o do tratamento mais recente": recente não é principal. A criança
     * que abriu um pacote particular avulso sobre um tratamento Unimed de um ano teria o
     * cadastro trocado por causa do avulso.
     *
     * `finalizado` fica de fora: pacote encerrado é histórico, não vínculo vigente. Os
     * `parado` entram — tratamento suspenso ainda é relação corrente, e incluí-los só
     * AUMENTA a chance de ambiguidade, que é a direção segura.
     *
     * Idempotente: escreve só onde está nulo, então rodar de novo não sobrescreve o que a
     * clínica já corrigiu à mão.
     *
     * **PÚBLICO de propósito.** Backfill que ninguém consegue exercitar é palpite com cara
     * de migration: ele decide o convênio de centenas de crianças e roda uma vez só, longe
     * de qualquer olho. O teste carrega este arquivo e chama o método direto — a migration
     * continua autocontida (não depende de classe da aplicação, que some numa refatoração e
     * quebra instalação nova), e a regra fica provável por mutação.
     */
    public function preencherDoHistorico(): void
    {
        $candidatos = DB::table('tratamentos')
            ->selectRaw('paciente_id')
            ->selectRaw('MIN(convenio_id) as convenio_id')
            // COUNT(DISTINCT) ignora NULL: matrícula ausente num dos pacotes do MESMO
            // convênio não impede o aproveitamento da que existe
            ->selectRaw('MIN(matricula) as matricula')
            ->selectRaw('COUNT(DISTINCT matricula) as matriculas')
            ->where('status', '<>', 'finalizado')
            ->whereNotNull('convenio_id')
            ->groupBy('paciente_id')
            ->havingRaw('COUNT(DISTINCT convenio_id) = 1')
            ->get();

        foreach ($candidatos as $candidato) {
            DB::table('pacientes')
                ->where('id', $candidato->paciente_id)
                ->whereNull('convenio_id')
                ->update([
                    'convenio_id' => $candidato->convenio_id,
                    // uma só matrícula distinta ⇒ ela é do convênio único. Mais de uma
                    // (mesmo convênio, números diferentes) ⇒ nada é inventado
                    'carteirinha' => (int) $candidato->matriculas === 1 ? $candidato->matricula : null,
                ]);
        }
    }
};
