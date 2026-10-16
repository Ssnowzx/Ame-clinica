<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;

class TipoPagamento extends Model
{
    use Auditavel;

    protected $table = 'tipos_pagamento';

    protected $fillable = ['nome'];
}
