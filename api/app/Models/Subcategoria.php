<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Subcategoria extends Model
{
    use Auditavel;

    protected $table = 'subcategorias';

    protected $fillable = ['categoria_id', 'nome', 'codigo_contabil'];

    public function categoria(): BelongsTo
    {
        return $this->belongsTo(Categoria::class);
    }
}
