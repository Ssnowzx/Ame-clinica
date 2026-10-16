<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Pendência do maker-checker de acesso (AP-13 · SEC-SD). O `payload_json` é
 * whitelist FECHADA por tipo (SEC-SD-09) — o que entra é decidido no boundary,
 * nunca aqui. Status e decisão são server-set: NADA é fillable além do que o
 * fluxo de criação grava explicitamente.
 */
class AprovacaoDeAcesso extends Model
{
    use Auditavel;

    public const TIPOS = ['editar_nivel', 'atribuir_nivel', 'configurar_seguranca'];

    public const STATUS = ['pendente', 'aprovada', 'recusada', 'cancelada'];

    protected $table = 'aprovacoes_de_acesso';

    /** Tudo server-set no fluxo (tipo/alvo/payload/solicitante) — mass assignment zero. */
    protected $fillable = [];

    protected function casts(): array
    {
        return [
            'payload_json' => 'array',
            'decidido_em' => 'datetime:Y-m-d H:i',
        ];
    }

    public function solicitante(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'solicitante_id');
    }

    public function decididoPor(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'decidido_por_id');
    }
}
