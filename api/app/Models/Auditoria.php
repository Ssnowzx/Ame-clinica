<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Registro de auditoria — SOMENTE LEITURA fora do RegistroDeAuditoria (§12).
 * Nunca recebe o trait Auditavel (não audita a si mesma) nem rotas de escrita.
 *
 * `lote_id` (uuid, nulo fora de lote — D11 de `baixa-em-lote-por-status`): a chave que liga as
 * linhas gravadas pela mesma operação em lote (agendamentos, tratamentos e a linha-mãe no
 * profissional). Quem preenche é a fonte única, a partir de `ContextoDoLote`; linhas anteriores
 * à coluna ficam nulas para sempre.
 */
class Auditoria extends Model
{
    public const UPDATED_AT = null;

    public const CREATED_AT = 'criado_em';

    protected $table = 'auditoria';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'diff_json' => 'array',
            'criado_em' => 'datetime',
        ];
    }

    /**
     * Autor da movimentação — preenchido SÓ quando `autor_tipo` é `usuario`. Nas outras duas
     * origens (sistema e externa) não existe usuário a apontar, e a API traduz cada uma pelo
     * seu nome. Ver `OrigemDaOperacao`.
     */
    public function usuario(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'usuario_id');
    }
}
