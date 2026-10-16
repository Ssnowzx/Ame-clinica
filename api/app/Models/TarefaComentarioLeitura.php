<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Carimbo de leitura por tarefa+usuário (design D7). Sem Auditavel de propósito:
 * carimbo de leitura é ruído na trilha, não mutação de dado da clínica.
 */
class TarefaComentarioLeitura extends Model
{
    protected $table = 'tarefa_comentario_leituras';

    protected $fillable = ['tarefa_id', 'usuario_id', 'lido_em'];

    protected function casts(): array
    {
        return ['lido_em' => 'datetime'];
    }
}
