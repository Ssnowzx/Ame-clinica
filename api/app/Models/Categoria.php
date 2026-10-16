<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Categoria extends Model
{
    use Auditavel;

    public const TIPOS = ['receita', 'despesa'];

    protected $table = 'categorias';

    protected $fillable = ['nome', 'tipo'];

    public function subcategorias(): HasMany
    {
        return $this->hasMany(Subcategoria::class);
    }
}
