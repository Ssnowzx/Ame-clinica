<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Conversa de WhatsApp com uma família (change mensageria-whatsapp).
 *
 * `telefone_e164` e `nome_perfil` MASCARADOS na trilha: o telefone é identificador direto
 * da família de um menor, e o nome de perfil é texto que a pessoa escolheu (não raro o nome
 * da criança). Vale aqui o mesmo raciocínio do parecer SEC-APS — `auditoria.ver` não é
 * confiável com dado do art. 11.
 *
 * `telefone_e164` e `paciente_id` ficam FORA do `$fillable`: o telefone vem do webhook
 * (normalizado pelo servidor) e o vínculo é decisão do serviço de correspondência — nunca
 * um id que o cliente escolhe, que seria ler a conversa de outra criança.
 */
class Conversa extends Model
{
    use Auditavel;

    /** Janela de atendimento da Meta: 24h desde a última mensagem RECEBIDA. */
    public const JANELA_HORAS = 24;

    protected $table = 'conversas';

    protected $fillable = ['nome_perfil', 'sem_lembretes'];

    /** @var list<string> */
    protected array $auditExclude = ['telefone_e164', 'nome_perfil'];

    protected function casts(): array
    {
        return [
            'janela_expira_em' => 'datetime',
            'ultima_mensagem_em' => 'datetime',
            'arquivada_em' => 'datetime',
            'sem_lembretes' => 'boolean',
        ];
    }

    public function paciente(): BelongsTo
    {
        return $this->belongsTo(Paciente::class);
    }

    public function mensagens(): HasMany
    {
        return $this->hasMany(Mensagem::class);
    }

    /**
     * A janela está aberta? Regra do canal, respondida com dado nosso — perguntar à Meta
     * custaria uma requisição e uma falha de rede a mais em cada envio (design D5).
     */
    public function janelaAberta(?Carbon $agora = null): bool
    {
        return $this->janela_expira_em !== null
            && $this->janela_expira_em->isAfter($agora ?? now());
    }
}
