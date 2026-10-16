<?php

namespace App\Console\Commands;

use App\Models\ContatoNormalizado;
use App\Models\Paciente;
use App\Support\Mensageria\TelefoneE164;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;

/**
 * Os telefones que a regra do `+` mudou de país (gate r1 da change telefone-estrangeiro).
 *
 * Antes, o `+` não valia nada: `+ 11 98765-4321` era um celular de São Paulo e `+49 99123-4567`, um
 * de Santa Catarina. Agora o `+` diz o país, e esses viram EUA e Alemanha. A regra não volta atrás —
 * o `+` é explícito —, mas o cadastro antigo pode ter `+` digitado à toa, e é o lembrete daquela
 * família que deixaria de chegar. Este comando aponta onde olhar.
 *
 * SÓ LEITURA, e a saída não leva número nem nome: o dono roda na produção e cola o resultado na
 * conversa (LGPD — dados de menores). Vai o paciente, o campo e o país que a regra nova
 * escolhe; o resto a recepção vê na ficha.
 *
 *     php artisan telefones:conferir-mais
 */
class TelefonesConferirMais extends Command
{
    /**
     * Os códigos de país de 1 e 2 dígitos da UIT (E.164), todos. Os códigos não são prefixo uns dos
     * outros: o que não começa por um destes tem 3 dígitos.
     */
    private const PAISES = [
        '1' => 'EUA, Canadá e Caribe', '7' => 'Rússia e Cazaquistão',
        '20' => 'Egito', '27' => 'África do Sul', '30' => 'Grécia', '31' => 'Países Baixos',
        '32' => 'Bélgica', '33' => 'França', '34' => 'Espanha', '36' => 'Hungria', '39' => 'Itália',
        '40' => 'Romênia', '41' => 'Suíça', '43' => 'Áustria', '44' => 'Reino Unido', '45' => 'Dinamarca',
        '46' => 'Suécia', '47' => 'Noruega', '48' => 'Polônia', '49' => 'Alemanha', '51' => 'Peru',
        '52' => 'México', '53' => 'Cuba', '54' => 'Argentina', '55' => 'Brasil', '56' => 'Chile',
        '57' => 'Colômbia', '58' => 'Venezuela', '60' => 'Malásia', '61' => 'Austrália',
        '62' => 'Indonésia', '63' => 'Filipinas', '64' => 'Nova Zelândia', '65' => 'Singapura',
        '66' => 'Tailândia', '81' => 'Japão', '82' => 'Coreia do Sul', '84' => 'Vietnã', '86' => 'China',
        '90' => 'Turquia', '91' => 'Índia', '92' => 'Paquistão', '93' => 'Afeganistão',
        '94' => 'Sri Lanka', '95' => 'Mianmar', '98' => 'Irã',
    ];

    protected $signature = 'telefones:conferir-mais';

    protected $description = 'Lista, sem número nem nome, os telefones com + que a regra antiga lia como brasileiros';

    public function handle(): int
    {
        $achados = [];

        Paciente::query()
            ->select(['id', 'contatos_json', 'responsaveis_json'])
            ->chunkById(500, function (Collection $pacientes) use (&$achados): void {
                foreach ($pacientes as $paciente) {
                    array_push($achados, ...$this->achadosDe($paciente));
                }
            });

        foreach ($achados as $achado) {
            $this->line(sprintf('paciente %d · %s · %s', ...$achado));
        }

        if ($achados === []) {
            $this->line('Nenhum telefone com + mudou de país.');
        }

        $this->line(sprintf(
            'Total: %d telefone(s) em %d paciente(s).',
            count($achados),
            count(array_unique(array_column($achados, 0))),
        ));

        return self::SUCCESS;
    }

    /**
     * Uma linha por telefone que mudou de país: [paciente, campo, país].
     *
     * @return list<array{int, string, string}>
     */
    private function achadosDe(Paciente $paciente): array
    {
        $contatos = collect((array) ($paciente->contatos_json ?? []))
            ->filter(fn ($contato): bool => is_array($contato) && in_array($contato['tipo'] ?? null, ContatoNormalizado::TIPOS_TELEFONICOS, true))
            ->map(fn (array $contato): array => ['contato', $contato['valor'] ?? null]);
        $responsaveis = collect((array) ($paciente->responsaveis_json ?? []))
            ->filter(fn ($responsavel): bool => is_array($responsavel))
            ->map(fn (array $responsavel): array => ['responsável', $responsavel['telefone'] ?? null]);

        $achados = [];

        foreach ($contatos->concat($responsaveis) as [$campo, $valor]) {
            $pais = is_string($valor) ? $this->paisQueMudou($valor) : null;

            if ($pais !== null) {
                $achados[] = [(int) $paciente->id, $campo, $pais];
            }
        }

        return $achados;
    }

    /**
     * O país da regra nova, quando ela e a antiga dão números DIFERENTES e as duas dão número — o caso
     * ambíguo. A antiga não via o `+`: lia só os dígitos como brasileiros. O `+55`, o sem `+` e o
     * estrangeiro que a antiga recusava dão a mesma resposta (ou nenhuma) e ficam de fora.
     */
    private function paisQueMudou(string $valor): ?string
    {
        $nova = TelefoneE164::normalizar($valor);
        // os dígitos sem o `+` caem na régua brasileira: é exatamente o que a regra antiga fazia
        $antiga = TelefoneE164::normalizar(preg_replace('/\D+/', '', $valor));

        if ($nova === null || $antiga === null || $nova === $antiga) {
            return null;
        }

        $digitos = substr($nova, 1);

        foreach ([1, 2] as $tamanho) {
            $codigo = substr($digitos, 0, $tamanho);

            if (isset(self::PAISES[$codigo])) {
                return '+'.$codigo.' '.self::PAISES[$codigo];
            }
        }

        return '+'.substr($digitos, 0, 3);
    }
}
