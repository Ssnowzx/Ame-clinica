<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Regra de limite de atendimento do convênio (§13 — regra é DADO): especialidade
 * (NULL = todas) × período × limite × ação. Consumida pela guarda de escrita da
 * agenda (GuardaDeLimiteDoConvenio); gerida na página do convênio.
 */
class RegraLimiteConvenio extends Model
{
    use Auditavel;

    public const PERIODOS = ['dia', 'semana', 'mes'];

    public const ACOES = ['bloquear', 'avisar'];

    protected $table = 'regras_limite_convenio';

    /** convenio_id vem da URL aninhada (molde Servico), nunca do payload. */
    protected $fillable = ['especialidade_id', 'periodo', 'limite', 'acao'];

    protected function casts(): array
    {
        return [
            'especialidade_id' => 'integer',
            'limite' => 'integer',
        ];
    }

    public function convenio(): BelongsTo
    {
        return $this->belongsTo(Convenio::class);
    }

    public function especialidade(): BelongsTo
    {
        return $this->belongsTo(Especialidade::class);
    }
}
