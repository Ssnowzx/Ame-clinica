<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Transferencia extends Model
{
    use Auditavel;

    protected $table = 'transferencias';

    protected $fillable = ['conta_origem_id', 'conta_destino_id', 'valor', 'data', 'obs'];

    protected function casts(): array
    {
        return [
            'valor' => 'decimal:2',
            'data' => 'date:Y-m-d',
        ];
    }

    public function contaOrigem(): BelongsTo
    {
        return $this->belongsTo(Conta::class, 'conta_origem_id');
    }

    public function contaDestino(): BelongsTo
    {
        return $this->belongsTo(Conta::class, 'conta_destino_id');
    }
}
