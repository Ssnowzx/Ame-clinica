<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * Mensagem de uma conversa (change mensageria-whatsapp).
 *
 * `corpo` MASCARADO na trilha: conversa de clínica infantil é texto livre onde cabe
 * diagnóstico, e o mascaramento vale para QUALQUER leitura da trilha, em qualquer permissão
 * (spec auditoria). A trilha prova o ciclo de vida — houve mensagem, nesta conversa, deste
 * tipo, enviada por esta pessoa, nesta hora — sem repetir o teor.
 *
 * ESCALA DE STATUS: `enviada → entregue → lida` é uma ORDEM, e o avanço só sobe. A Meta
 * entrega eventos fora de ordem (um `enviada` atrasado chegando depois de `lida` é normal),
 * e comparar por "o último que chegou" rebaixaria o estado. Ver `posicaoDoStatus()`.
 *
 * Praticamente tudo é server-set: o cliente escolhe o texto e o tipo; direção, ids da Meta,
 * status, autoria e carimbos são do servidor.
 */
class Mensagem extends Model
{
    use Auditavel;

    public const DIRECAO_RECEBIDA = 'recebida';

    public const DIRECAO_ENVIADA = 'enviada';

    /** `reacao`, `figurinha`, `localizacao` e `contato` são só de chegada (change conversa-legivel, D1). */
    public const TIPOS = [
        'texto', 'imagem', 'audio', 'documento', 'video', 'template', 'botao',
        'reacao', 'figurinha', 'localizacao', 'contato', 'nao_suportado',
    ];

    /**
     * Postos da escala de entrega. `recebida` e `falhou` são terminais fora da escala:
     * não competem com ela, por isso ficam de fora do ranking.
     */
    private const ESCALA = ['pendente' => 0, 'enviada' => 1, 'entregue' => 2, 'lida' => 3];

    protected $table = 'mensagens';

    protected $fillable = ['corpo', 'tipo'];

    /**
     * `variaveis_json` entra junto com o corpo: as variáveis do lembrete carregam o NOME
     * da criança e o horário da sessão dela — mascarar a prévia e deixar o insumo em claro
     * seria a mesma exposição por outra coluna. `detalhes_json` pelo mesmo motivo: leva as
     * coordenadas que a família mandou, e coordenada é endereço.
     *
     * @var list<string>
     */
    protected array $auditExclude = ['corpo', 'variaveis_json', 'detalhes_json'];

    protected function casts(): array
    {
        return [
            'automatica' => 'boolean',
            // CIFRADO em repouso (SEC-WA-01): o produto já exige isso do texto livre
            // clínico (`Evolucao.conteudo`, `Atendimento.observacoes`) e da mídia desta
            // mesma conversa. O corpo é onde a família escreve o diagnóstico da criança —
            // deixá-lo em claro era a única assimetria. Custo zero: `corpo` não aparece em
            // nenhum `where`/`like`/`order` do sistema (a busca é por telefone e nome).
            'corpo' => 'encrypted',
            'variaveis_json' => 'encrypted:array',
            'detalhes_json' => 'encrypted:array',
            'recebida_em' => 'datetime',
            'enviada_em' => 'datetime',
            'entregue_em' => 'datetime',
            'lida_em' => 'datetime',
            'expurgada_em' => 'datetime',
        ];
    }

    public function conversa(): BelongsTo
    {
        return $this->belongsTo(Conversa::class);
    }

    public function enviadaPor(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'enviada_por');
    }

    public function midia(): HasOne
    {
        return $this->hasOne(MensagemMidia::class);
    }

    /**
     * O link do mapa da localização recebida, montado AQUI a partir de dois números — nunca de
     * texto da família, que não vira link em lugar nenhum da tela. Coordenada fora da faixa (ou
     * ausente, ou apagada pelo expurgo) não tem link.
     */
    public function mapaUrl(): ?string
    {
        $detalhes = $this->detalhes_json;

        if ($this->tipo !== 'localizacao' || ! is_array($detalhes)) {
            return null;
        }

        $latitude = $detalhes['latitude'] ?? null;
        $longitude = $detalhes['longitude'] ?? null;

        if (! is_int($latitude) && ! is_float($latitude)) {
            return null;
        }

        if (! is_int($longitude) && ! is_float($longitude)) {
            return null;
        }

        if (abs($latitude) > 90 || abs($longitude) > 180) {
            return null;
        }

        // `%F` e não `%s`: um float pequeno em string vira `1.0E-5`, e a vírgula decimal de um
        // locale pt-BR quebraria a consulta — `%F` é sempre ponto e sempre decimal
        return sprintf('https://www.google.com/maps/search/?api=1&query=%.6F,%.6F', $latitude, $longitude);
    }

    /**
     * Posto do status na escala de entrega, ou null se ele não pertence a ela.
     * Usado para decidir se um evento da Meta AVANÇA o estado ou é um atrasado a ignorar.
     */
    public static function posicaoDoStatus(string $status): ?int
    {
        return self::ESCALA[$status] ?? null;
    }

    /**
     * Grava uma mudança de ENTREGA (status e carimbos) sem passar pela trilha.
     *
     * Progresso de entrega é fato de MÁQUINA, não alteração de uma pessoa: cada mensagem
     * enviada renderia até três registros de auditoria (`enviada`→`entregue`→`lida`) que
     * ninguém audita e que afogam, no volume, as escritas que importam — quem falou com a
     * família, quem conectou o canal. O fato não se perde: ele vive nas colunas
     * `enviada_em`/`entregue_em`/`lida_em` da própria mensagem, que é onde se lê.
     *
     * A CRIAÇÃO da mensagem continua auditada (spec auditoria) — é ela que prova o evento.
     */
    public function avancarEntrega(callable $mutacao): void
    {
        static::withoutEvents(function () use ($mutacao): void {
            $mutacao($this);
            $this->save();
        });
    }
}
