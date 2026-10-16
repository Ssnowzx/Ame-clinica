<?php

namespace App\Console\Commands;

use App\Support\CamposCadastro\CatalogoCamposCadastro as Catalogo;
use Illuminate\Console\Command;

/**
 * Emite os TETOS de cada campo do cadastro, como o formulário os recebe.
 *
 * Existe para a guarda de contrato do web (`web/src/test/tetos.contrato.test.ts`). A primeira
 * versão daquela guarda lia o `FormaDoCampo.php` com REGEX, e o code review a atravessou por
 * dois caminhos: um campo que trocasse `'string'` por outra coisa (o servidor passaria a mandar
 * `null` e a regex continuaria lendo o número) e os tetos dos SUBCAMPOS, que ela nem olhava —
 * que é exatamente a classe do defeito descoberto à mão nesta mesma change, quando o `email` do
 * responsável apareceu sem `string` e portanto sem teto.
 *
 * A saída: os dois lados passam a usar o MESMO predicado. Aqui roda `Catalogo::tamanho()` e
 * `::tamanhosDosItens()` — as funções de produção —, e o web compara com o resultado delas em
 * vez de reimplementá-las.
 *
 * Para regerar depois de mexer em `FormaDoCampo`:
 *
 *     cd api && php artisan campos:tetos --json > ../web/src/test/tetos-da-api.json
 */
class CamposCadastroTetos extends Command
{
    protected $signature = 'campos:tetos {--json : Emite os tetos como JSON, para a guarda de contrato do web}';

    protected $description = 'Lista o teto de caracteres de cada campo do cadastro de paciente';

    public function handle(): int
    {
        $tetos = [];

        foreach (array_keys(Catalogo::todos()) as $campo) {
            $tetos[] = [
                'campo' => $campo,
                'tamanho' => Catalogo::tamanho($campo),
                'tamanhos_dos_itens' => Catalogo::tamanhosDosItens($campo),
            ];
        }

        if ($this->option('json')) {
            $this->line((string) json_encode(['campos' => $tetos], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

            return self::SUCCESS;
        }

        $this->table(
            ['campo', 'tamanho', 'subcampos'],
            array_map(
                fn (array $linha): array => [
                    $linha['campo'],
                    $linha['tamanho'] ?? '—',
                    $linha['tamanhos_dos_itens'] === [] ? '—' : (string) json_encode($linha['tamanhos_dos_itens']),
                ],
                $tetos,
            ),
        );

        return self::SUCCESS;
    }
}
