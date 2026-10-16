<?php

namespace App\Console\Commands;

use App\Models\ContatoNormalizado;
use App\Support\Mensageria\TelefoneE164;
use Illuminate\Console\Command;

/**
 * Emite a tabela de casos do telefone, classificada pela função de PRODUÇÃO
 * (change telefone-que-chega-no-whatsapp, D1).
 *
 * Existe para a guarda de contrato do web (`web/src/lib/telefone-whatsapp.contrato.test.ts`): o
 * campo de telefone diz "WhatsApp: +55 …" ou "este número não recebe WhatsApp" sem perguntar ao
 * servidor, e essa cópia da regra só é segura se concordar com `TelefoneE164::classificar()` em
 * todos os casos daqui. Os casos são as bordas da regra e os formatos que a clínica digitou errado
 * em 02/10 — com dígitos INVENTADOS.
 *
 * Para regerar depois de mexer em `TelefoneE164`:
 *
 *     cd api && php artisan telefones:casos --json > ../web/src/test/telefones-da-api.json
 */
class TelefonesCasos extends Command
{
    /** @var list<string> */
    private const ENTRADAS = [
        // máscara, espaço e DDI
        '(11) 98765-4321',
        '11987654321',
        '5511987654321',
        '+55 11 98765-4321',
        ' 11 9 8765 4321 ',
        '+55 (49) 99123-4567',
        // fixo e celular de antes do nono dígito
        '(11) 3333-4444',
        '551133334444',
        '(49) 3222-1234',
        '(49) 2222-1234',
        '(49) 5222-1234',
        '(49) 6123-4567',
        '(11) 8765-4321',
        '554981234567',
        // o DDD 55 (RS) não é DDI
        '5533334444',
        '55987654321',
        '5555987654321',
        // o que não chega: formatos digitados errado em 02/10
        '55 49912-3456',
        '(55) 49912-3456',
        '(49) 49912-3456',
        '49 99912-34567',
        '44 7712-345678',
        '(49) 9123-456',
        // outras bordas
        '98765-4321',
        '3333-4444',
        '(01) 98765-4321',
        '(10) 98765-4321',
        '(11) 88765-4321',
        '(11) 1333-4444',
        '(11) 0333-4444',
        '005511987654321',
        '55 11 98765-43210',
        'não tenho',
        'whatsapp 49 99123-4567',
        '',
        '   ',
        // de fora do país, só com o `+` (change telefone-estrangeiro): Reino Unido na faixa de ficção
        // da Ofcom, EUA na 555-01xx
        '+44 7700 900123',
        ' +44 7700 900123 ',
        '+351 912 345 678',
        '+1 202 555 0101',
        '+44 7700 9',
        '+44 770 090',
        '+44 7700 900123 456',
        '+44 7700 900123 4567',
        '+44 7700',
        '447700900123',
        '+0 44 7700 900123',
        // copiado do WhatsApp: marcas invisíveis de direção de texto em volta (gate r1)
        "\u{202A}+44 7700 900123\u{202C}",
        " \u{2066}+351 912 345 678\u{2069}",
        "\u{202A}(11) 98765-4321\u{202C}",
        // o `+55` continua na régua brasileira
        '+55 49912-3456',
        '+55 11 3333-4444',
    ];

    protected $signature = 'telefones:casos {--json : Emite os casos como JSON, para a guarda de contrato do web}';

    protected $description = 'Classifica a tabela de casos de telefone pela regra do servidor';

    public function handle(): int
    {
        $casos = array_map(
            fn (string $entrada): array => ['entrada' => $entrada, ...TelefoneE164::classificar($entrada)],
            self::ENTRADAS,
        );

        if ($this->option('json')) {
            // os tipos de contato que são telefone vão junto: a tela só avisa nesses, e a lista dela é
            // cópia desta (gate r1, CR-TEL-10)
            $this->line((string) json_encode(
                ['tipos_telefonicos' => ContatoNormalizado::TIPOS_TELEFONICOS, 'casos' => $casos],
                JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE,
            ));

            return self::SUCCESS;
        }

        $this->table(
            ['entrada', 'forma', 'tipo'],
            array_map(fn (array $caso): array => [$caso['entrada'], $caso['forma'] ?? '—', $caso['tipo'] ?? '—'], $casos),
        );

        return self::SUCCESS;
    }
}
