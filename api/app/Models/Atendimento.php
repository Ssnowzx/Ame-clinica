<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Database\Factories\AtendimentoFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Atendimento extends Model
{
    /** @use HasFactory<AtendimentoFactory> */
    use Auditavel, HasFactory;

    protected $table = 'atendimentos';

    /** Texto clínico livre — cifrado em repouso e fora do diff (T-ate-03). */
    protected array $auditExclude = ['observacoes'];

    /** agendamento_id é atribuído pelo controller a partir da rota, nunca do payload. */
    protected $fillable = ['iniciado_em', 'finalizado_em', 'observacoes'];

    protected function casts(): array
    {
        return [
            'iniciado_em' => 'datetime:Y-m-d H:i',
            'finalizado_em' => 'datetime:Y-m-d H:i',
            'observacoes' => 'encrypted',
        ];
    }

    public function agendamento(): BelongsTo
    {
        return $this->belongsTo(Agendamento::class);
    }

    public function evolucao(): HasOne
    {
        return $this->hasOne(Evolucao::class);
    }
}
