<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Um intervalo de atendimento do profissional num dia da semana (change
 * horarios-por-dia-do-profissional). N linhas por (profissional, dia) permitem turno
 * partido. `dia_semana` é ISO 1=segunda…7=domingo. Sem linhas para um profissional =
 * atende todos os dias na janela padrão da clínica (retrocompat).
 */
class ProfissionalHorario extends Model
{
    protected $table = 'profissional_horarios';

    protected $fillable = ['profissional_id', 'dia_semana', 'inicio', 'fim'];

    protected function casts(): array
    {
        return [
            'dia_semana' => 'integer',
        ];
    }

    public function profissional(): BelongsTo
    {
        return $this->belongsTo(Profissional::class);
    }
}
