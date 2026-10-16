<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Anamnese extends Model
{
    use Auditavel;

    protected $table = 'anamneses';

    /** Respostas de saúde do menor — cifradas em repouso e fora do diff (T-ate-11). */
    protected array $auditExclude = ['respostas_json'];

    /**
     * paciente_id vem da rota; preenchida_em é SEMPRE do servidor (T-ate-12) —
     * ambos fora do mass assignment.
     */
    protected $fillable = ['modelo_id', 'respostas_json'];

    protected function casts(): array
    {
        return [
            'respostas_json' => 'encrypted:array',
            'preenchida_em' => 'datetime:Y-m-d H:i',
        ];
    }

    public function paciente(): BelongsTo
    {
        return $this->belongsTo(Paciente::class);
    }

    public function modelo(): BelongsTo
    {
        return $this->belongsTo(AnamneseModelo::class, 'modelo_id');
    }
}
