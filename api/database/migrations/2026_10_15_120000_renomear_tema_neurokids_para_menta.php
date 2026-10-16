<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Change tema-menta: o tema verde-água e rosa deixa de levar o nome de uma clínica. "NeuroKids" é o
 * nome da clínica que pediu o tema, e a lista de opções de `clinica.tema` não deve carregar a marca
 * de nenhuma cliente.
 *
 * O valor gravado `neurokids` vira `menta` numa escrita só: o visual não muda (é o
 * mesmo bloco de CSS, renomeado), e a clínica que o usava não percebe diferença depois do deploy.
 *
 * Pela tabela (`DB::table`), e não pelo model. Sem trilha de auditoria por linha, de propósito — é uma renomeação de valor
 * do catálogo, não uma decisão de alguém da clínica (a decisão foi do dono do produto, na change).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('configuracoes')
            ->where('chave', 'clinica.tema')
            ->where('valor', 'neurokids')
            ->update(['valor' => 'menta', 'updated_at' => now()]);
    }

    public function down(): void
    {
        DB::table('configuracoes')
            ->where('chave', 'clinica.tema')
            ->where('valor', 'menta')
            ->update(['valor' => 'neurokids', 'updated_at' => now()]);
    }
};
