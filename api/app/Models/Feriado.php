<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Feriado extends Model
{
    use Auditavel, HasFactory;

    protected $table = 'feriados';

    protected $fillable = ['nome', 'data', 'recorrente', 'ativo'];

    protected function casts(): array
    {
        return [
            'data' => 'date:Y-m-d',
            'recorrente' => 'boolean',
            'ativo' => 'boolean',
        ];
    }
}
