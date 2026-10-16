<?php

namespace App\Support\Rede;

use InvalidArgumentException;

/**
 * Parse defensivo da lista de proxies confiáveis (SEC-ER-04).
 *
 * O IP do cliente é requisito da trilha de auditoria (a coluna "de onde partiu" da
 * troca de criança). Atrás do reverse proxy do VPS, `request()->ip()` só devolve o IP
 * REAL se o proxy conhecido for confiado — e SÓ ele. Confiar em todos (`*`) deixaria
 * qualquer origem forjar `X-Forwarded-For` e gravar um IP falso na auditoria: por isso
 * `*` FALHA a boot, em vez de virar "confie em quem chamar" (comportamento do Laravel).
 *
 * A leitura de `env('TRUSTED_PROXIES')` mora no `bootstrap/app.php` (o withMiddleware
 * roda ANTES de a config existir — `config()` ali é nulo). Esta classe recebe a string
 * crua e só transforma: fica em `app/`, livre de `env()`, e é unit-testável sem boot.
 */
final class ProxiesConfiaveis
{
    /**
     * @return list<string> IPs/faixas confiadas; `[]` quando não há proxy (local-first)
     *
     * @throws InvalidArgumentException quando a lista contém o coringa `*`/`**`
     */
    public static function parse(?string $bruto): array
    {
        $bruto = trim((string) $bruto);

        if ($bruto === '') {
            // vazio = nenhum proxy confiado; NUNCA `['']` (que Symfony trataria como IP)
            return [];
        }

        $itens = array_values(array_filter(
            array_map(trim(...), explode(',', $bruto)),
            static fn (string $item): bool => $item !== '',
        ));

        foreach ($itens as $item) {
            if ($item === '*' || $item === '**') {
                throw new InvalidArgumentException(
                    'TRUSTED_PROXIES não pode conter "*": confiar em todos os proxies permite '
                    .'forjar X-Forwarded-For e gravar um IP falso na auditoria. Liste o IP/faixa '
                    .'EXATA do reverse proxy, ou deixe vazio (local-first).'
                );
            }
        }

        return $itens;
    }
}
