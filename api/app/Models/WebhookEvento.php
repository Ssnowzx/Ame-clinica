<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Rastro do evento recebido no webhook (change mensageria-whatsapp, D3).
 *
 * SEM `Auditavel` e SEM corpo do payload: o evento traz o texto da mensagem e o telefone
 * da família — guardá-lo cru seria uma segunda cópia do dado de menor, fora de toda a
 * proteção construída para a primeira. Aqui fica só o hash, que serve para reconhecer
 * reentrega e para responder "a Meta mandou?" sem depender de log rotacionado.
 */
class WebhookEvento extends Model
{
    protected $table = 'webhook_eventos';

    public $timestamps = false;

    protected $fillable = ['payload_hash', 'tipo', 'recebido_em'];

    protected function casts(): array
    {
        return ['recebido_em' => 'datetime'];
    }
}
