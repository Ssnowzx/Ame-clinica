<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;

class Sala extends Model
{
    use Auditavel;

    protected $table = 'salas';

    protected $fillable = ['nome', 'capacidade', 'ativo'];

    /** Default do MODELO, espelhando o do banco — ver `Profissional::$attributes`. */
    protected $attributes = ['capacidade' => 1];

    protected function casts(): array
    {
        return [
            'ativo' => 'boolean',
            // quantos agendamentos sobrepostos a sala aceita (change atendimento-em-grupo)
            'capacidade' => 'integer',
        ];
    }
}
