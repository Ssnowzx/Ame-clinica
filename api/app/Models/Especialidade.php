<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Database\Factories\EspecialidadeFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Especialidade extends Model
{
    /** @use HasFactory<EspecialidadeFactory> */
    use Auditavel, HasFactory;

    protected $table = 'especialidades';

    protected $fillable = [
        'nome',
        'tempo_sessao',
        'cor',
        'exige_termo',
        'oculta_agendamento_online',
    ];

    protected function casts(): array
    {
        return [
            'tempo_sessao' => 'integer',
            'exige_termo' => 'boolean',
            'oculta_agendamento_online' => 'boolean',
        ];
    }
}
