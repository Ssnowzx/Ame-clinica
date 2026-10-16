<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Servico extends Model
{
    use Auditavel;

    protected $table = 'servicos';

    protected $fillable = ['procedimento', 'codigo_procedimento', 'valor'];

    protected function casts(): array
    {
        return [
            'valor' => 'decimal:2',
        ];
    }

    public function convenio(): BelongsTo
    {
        return $this->belongsTo(Convenio::class);
    }
}
