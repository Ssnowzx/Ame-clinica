<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Equipamento extends Model
{
    use Auditavel;

    protected $table = 'equipamentos';

    protected $fillable = ['nome', 'especialidade_id', 'quantidade_total'];

    protected function casts(): array
    {
        return [
            'quantidade_total' => 'integer',
        ];
    }

    public function especialidade(): BelongsTo
    {
        return $this->belongsTo(Especialidade::class);
    }
}
