<?php

namespace App\Support\Financeiro;

use App\Models\Categoria;
use App\Models\Conta;
use App\Models\TipoPagamento;
use Illuminate\Support\Facades\DB;

/**
 * Semente do catálogo do dinheiro da clínica (change cadastros-financeiros-tela).
 *
 * Todo lançamento exige conta + categoria + forma de pagamento, e nenhum deles nascia
 * com a clínica: a clínica abria o financeiro, encontrava três seletores vazios e não
 * tinha por onde começar (relato da clínica em 2026-09-02). Aqui está o mínimo para
 * lançar no primeiro dia.
 *
 * É SEMENTE, não regra (§13): os nomes são o ponto de partida que a clínica renomeia,
 * desativa ou apaga pela tela de Cadastros. Por isso `firstOrCreate` por NOME — aplicar
 * de novo não duplica, e também não ressuscita o que a clínica apagou de propósito
 * (o nome apagado volta só se o comando for aplicado outra vez, por decisão de quem o roda).
 */
class CatalogoPadrao
{
    /** A conta onde o dinheiro da recepção entra por padrão. */
    public const CONTA = 'Caixa';

    /** As formas de pagamento que a clínica usa no balcão. */
    public const TIPOS_PAGAMENTO = [
        'Dinheiro',
        'PIX',
        'Cartão de crédito',
        'Cartão de débito',
        'Transferência',
    ];

    /** Uma de cada natureza: sem as duas, metade do caixa não tem onde ser classificada. */
    public const CATEGORIAS = [
        ['nome' => 'Atendimentos', 'tipo' => 'receita'],
        ['nome' => 'Despesas da clínica', 'tipo' => 'despesa'],
    ];

    /**
     * Aplica o catálogo padrão à clínica.
     *
     * @return array{contas: int, tipos_pagamento: int, categorias: int} o que foi criado agora
     */
    public function aplicar(): array
    {
        // tudo ou nada: uma falha no meio deixaria a clínica com catálogo pela metade.
        // NÃO serializa execuções simultâneas — `firstOrCreate` não é atômico, e duas
        // passadas ao mesmo tempo ainda estouram no índice único; o que a transação dá
        // é o rollback limpo (nada de catálogo pela metade). Rodar de novo resolve.
        return DB::transaction(function (): array {
            $criados = ['contas' => 0, 'tipos_pagamento' => 0, 'categorias' => 0];

            if (Conta::firstOrCreate(['nome' => self::CONTA])->wasRecentlyCreated) {
                $criados['contas']++;
            }

            foreach (self::TIPOS_PAGAMENTO as $nome) {
                if (TipoPagamento::firstOrCreate(['nome' => $nome])->wasRecentlyCreated) {
                    $criados['tipos_pagamento']++;
                }
            }

            foreach (self::CATEGORIAS as $categoria) {
                if (Categoria::firstOrCreate($categoria)->wasRecentlyCreated) {
                    $criados['categorias']++;
                }
            }

            return $criados;
        });
    }
}
