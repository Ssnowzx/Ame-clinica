<?php

namespace Tests\Support;

use Illuminate\Database\Eloquent\Model;

class ItemTeste extends Model
{
    protected $table = 'itens_teste';

    protected $fillable = ['nome'];
}
