<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Código CBO (catálogo global oficial — dado público, sem
 * Auditavel; design D2 de cadastros-base).
 */
class Cbos extends Model
{
    protected $table = 'cbos';

    protected $fillable = ['codigo', 'nome'];
}
