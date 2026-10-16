<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Medico extends Model
{
    use Auditavel;

    protected $table = 'medicos';

    protected $fillable = [
        'nome',
        'conselho',
        'uf_conselho',
        'num_conselho',
        'cbos_id',
        'codigos_operadora_json',
    ];

    protected function casts(): array
    {
        return [
            'codigos_operadora_json' => 'array',
        ];
    }

    public function cbos(): BelongsTo
    {
        return $this->belongsTo(Cbos::class);
    }
}
