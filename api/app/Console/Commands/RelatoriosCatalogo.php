<?php

namespace App\Console\Commands;

use App\Support\Relatorios\CatalogoDeRelatorios;
use Illuminate\Console\Command;

/**
 * Exporta o índice do catálogo de relatórios — o MESMO de `GET /api/relatorios`.
 *
 * Existe para a guarda de contrato web × API (change `area-de-relatorios`, task 1.7): o
 * `--json` é gravado em `web/src/lib/relatorios/catalogo-da-api.json`, e o teste do web
 * confere que todo slug do catálogo dele existe aqui com as mesmas permissões. Sem dado de
 * negócio: o catálogo é do produto, não da clínica.
 */
class RelatoriosCatalogo extends Command
{
    protected $signature = 'relatorios:catalogo {--json : Emite o índice como JSON (o mesmo de GET /api/relatorios)}';

    protected $description = 'Lista os relatórios do catálogo com suas permissões e eixo';

    public function handle(CatalogoDeRelatorios $catalogo): int
    {
        $indice = $catalogo->indice();

        if ($this->option('json')) {
            $this->line((string) json_encode(
                ['relatorios' => $indice],
                JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
            ));

            return self::SUCCESS;
        }

        $this->table(
            ['slug', 'título', 'permissões', 'eixo', 'nome da criança'],
            array_map(fn (array $r): array => [
                $r['slug'],
                $r['titulo'],
                implode(' + ', $r['permissoes']),
                $r['eixo'] ?? '—',
                $r['expoe_nome'] ? 'sim' : 'não',
            ], $indice),
        );

        return self::SUCCESS;
    }
}
