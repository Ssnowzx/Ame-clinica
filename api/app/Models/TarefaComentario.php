<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * Comentário do mural — texto PURO. autor_id é server-set (usuário autenticado).
 * Editar é só do AUTOR; excluir é do autor ou moderação (`tarefas.excluir`) —
 * apagar abuso é moderação, reescrever fala alheia é falsificação (spec tarefas).
 */
class TarefaComentario extends Model
{
    use Auditavel;

    protected $table = 'tarefa_comentarios';

    protected $fillable = ['corpo'];

    public function tarefa(): BelongsTo
    {
        return $this->belongsTo(Tarefa::class);
    }

    public function autor(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'autor_id');
    }

    public function mencionados(): BelongsToMany
    {
        return $this->belongsToMany(Usuario::class, 'tarefa_mencoes', 'comentario_id', 'usuario_id')
            ->withTimestamps();
    }
}
