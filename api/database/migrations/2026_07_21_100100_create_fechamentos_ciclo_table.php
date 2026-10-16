<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Fechamentos de ciclo de faturamento (change fechamento-de-ciclo, D2): o FECHADO é
 * dado, o ABERTO é ausência. Um período está fechado quando existe linha com
 * `reaberto_em IS NULL` que o contém.
 *
 * **Append-only (SEC-FC-02):** reabrir MARCA a linha (`reaberto_por/em/motivo`); re-fechar
 * o mesmo período cria linha NOVA. Nenhuma rota faz UPDATE que limpe `reaberto_em`, nem
 * DELETE — a trilha precisa sobreviver ao "fecha, reabre, fecha de novo".
 *
 * **Unicidade só entre linhas ABERTAS (SEC-FC-03):** com unique simples em
 * (convênio, início) o SEGUNDO fechamento do mesmo período morria em 1062 — ou
 * seja, a unique matava exatamente o fluxo que o D2 promete. A coluna GERADA
 * `chave_ativa` vale `periodo_inicio` enquanto a linha está aberta e NULL depois de
 * reaberta; como NULL não colide com NULL no índice do MariaDB, o histórico de linhas
 * reabertas convive, e só pode existir UM fechamento aberto por (convênio,
 * início). Mesma técnica de `regras_limite_convenio.especialidade_chave`.
 *
 * **§14 intacta (SEC-FC-19):** esta tabela NÃO guarda protocolo, lote nem valor faturado.
 * O fechamento é registro INTERNO de "esta produção já foi enviada"; a esteira de
 * guias/TISS/faturamento de convênio segue fora do produto.
 *
 * A não-sobreposição PARCIAL de intervalos nenhum índice pega — é guarda de boundary,
 * verificada dentro da transação que segura o lock da linha do convênio (D8/SEC-FC-11).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fechamentos_ciclo', function (Blueprint $table) {
            $table->id();
            // restrict: convênio com produção congelada não some por engano — o mesmo
            // backstop da tabela de serviços e das regras de limite
            $table->foreignId('convenio_id')->constrained('convenios')->restrictOnDelete();
            // fronteiras PERSISTIDAS (SEC-FC-17): a guarda decide por este intervalo,
            // jamais re-derivando do calendário atual — trocar o dia de corte não move
            // as fronteiras de um período já fechado
            $table->date('periodo_inicio');
            $table->date('periodo_fim');
            // restrict nos dois atores: a trilha do fechamento/reabertura não perde o
            // responsável (precedente aprovacoes_de_acesso)
            $table->foreignId('fechado_por')->constrained('usuarios')->restrictOnDelete();
            $table->timestamp('fechado_em');
            $table->foreignId('reaberto_por')->nullable()->constrained('usuarios')->restrictOnDelete();
            $table->timestamp('reaberto_em')->nullable();
            // SEC-FC-06: teto de 500 chars no boundary e na coluna; nunca entra em
            // payload de atendimento/lançamento/evolução
            $table->string('motivo_reabertura', 500)->nullable();
            // SEC-FC-03 — ver docblock: só as linhas ABERTAS entram na unicidade
            $table->date('chave_ativa')->nullable()
                ->storedAs('if(`reaberto_em` is null, `periodo_inicio`, null)');
            $table->timestamps();

            $table->unique(
                ['convenio_id', 'chave_ativa'],
                'fechamentos_ciclo_abertos_unicos'
            );
            // a consulta da guarda (3.x) e da não-sobreposição: por convênio,
            // filtrando pela janela — índice desenhado para ESSE shape
            $table->index(
                ['convenio_id', 'periodo_inicio', 'periodo_fim'],
                'fechamentos_ciclo_janela'
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fechamentos_ciclo');
    }
};
