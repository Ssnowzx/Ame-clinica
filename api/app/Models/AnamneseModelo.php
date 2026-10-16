<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AnamneseModelo extends Model
{
    use Auditavel;

    protected $table = 'anamnese_modelos';

    protected $fillable = ['titulo', 'especialidade_id', 'campos_json', 'ativo'];

    protected function casts(): array
    {
        return [
            'campos_json' => 'array',
            'ativo' => 'boolean',
        ];
    }

    public function especialidade(): BelongsTo
    {
        return $this->belongsTo(Especialidade::class);
    }
}
