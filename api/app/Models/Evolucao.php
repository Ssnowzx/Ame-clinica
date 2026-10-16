<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Evolucao extends Model
{
    use Auditavel;

    protected $table = 'evolucoes';

    /** O registro clínico do menor — cifrado em repouso e fora do diff (T-ate-05). */
    protected array $auditExclude = ['conteudo'];

    /**
     * atendimento_id vem da rota; preenchida_em é SEMPRE do servidor (T-ate-07) —
     * ambos fora do mass assignment.
     */
    protected $fillable = ['profissional_id', 'responsavel_tecnico_id', 'conteudo'];

    protected function casts(): array
    {
        return [
            'conteudo' => 'encrypted',
            'preenchida_em' => 'datetime:Y-m-d H:i',
        ];
    }

    public function atendimento(): BelongsTo
    {
        return $this->belongsTo(Atendimento::class);
    }

    public function profissional(): BelongsTo
    {
        return $this->belongsTo(Profissional::class);
    }

    public function responsavelTecnico(): BelongsTo
    {
        return $this->belongsTo(Profissional::class, 'responsavel_tecnico_id');
    }
}
