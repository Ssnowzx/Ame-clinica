<?php

namespace App\Console\Commands;

use App\Support\Financeiro\CatalogoPadrao;
use Illuminate\Console\Command;

/**
 * Aplica a semente do catálogo financeiro à clínica.
 *
 * A criação da clínica já semeia o catálogo; este comando cobre a base que ficou sem conta,
 * forma de pagamento nem categoria. Idempotente: rodar de novo não duplica nada.
 */
class FinanceiroCatalogoPadrao extends Command
{
    protected $signature = 'financeiro:catalogo-padrao';

    protected $description = 'Cria a conta, as formas de pagamento e as categorias padrão da clínica';

    public function handle(CatalogoPadrao $catalogo): int
    {
        $criados = $catalogo->aplicar();

        $this->info(sprintf(
            'Catálogo padrão da clínica: %d conta(s), %d forma(s) de pagamento e %d categoria(s) criada(s).',
            $criados['contas'],
            $criados['tipos_pagamento'],
            $criados['categorias'],
        ));

        return self::SUCCESS;
    }
}
