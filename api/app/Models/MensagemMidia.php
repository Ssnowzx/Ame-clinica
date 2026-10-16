<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Mídia recebida ou enviada numa conversa (change mensageria-whatsapp).
 *
 * `caminho` MASCARADO na trilha pelo mesmo motivo dos `anexos` (SEC-AX-04): nome de arquivo
 * é texto livre que codifica diagnóstico. O ciclo de vida fica identificável por id, mensagem,
 * mime e tamanho — que é o que uma auditoria precisa.
 *
 * Tudo é server-set: caminho, tamanho, hash e mime saem da validação por CONTEÚDO, nunca do
 * que o cliente declarou.
 */
class MensagemMidia extends Model
{
    use Auditavel;

    protected $table = 'mensagem_midias';

    protected $fillable = [];

    /** @var list<string> */
    protected array $auditExclude = ['caminho'];

    public function mensagem(): BelongsTo
    {
        return $this->belongsTo(Mensagem::class);
    }
}
