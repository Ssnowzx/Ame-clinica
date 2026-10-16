<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Evento direcionado do mural (change alertas-do-mural): "algo aconteceu numa
 * tarefa SUA e você ainda não viu". Todo campo é server-set — nada de mass
 * assignment de fora; o fan-out (EventosDoMural) é o único escritor. Lido
 * marca (`lida_em`), nunca apaga (design D4). SEM Auditavel: a mutação de
 * origem já está na trilha; auditar o aviso duplicaria ruído.
 */
class TarefaNotificacao extends Model
{
    /** Domínio dos tipos — validação da app, nunca ENUM de banco (design D1). */
    public const TIPOS = ['atribuicao', 'status', 'comentario'];

    protected $table = 'tarefa_notificacoes';

    // fillable EXPLÍCITO como os irmãos do mural (SEC-AM-02): lida_em fica de
    // fora — marcada só pelos endpoints de leitura, nunca por mass assignment
    protected $fillable = ['tarefa_id', 'usuario_id', 'autor_id', 'tipo', 'dados'];

    protected function casts(): array
    {
        return [
            'dados' => 'array',
            'lida_em' => 'datetime',
        ];
    }

    public function tarefa(): BelongsTo
    {
        return $this->belongsTo(Tarefa::class);
    }

    public function autor(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'autor_id');
    }

    public function destinatario(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'usuario_id');
    }
}
