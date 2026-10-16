<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Tarefa do mural da equipe (change kanban-da-equipe). SEM vínculo com paciente
 * por decisão LGPD (design/proposta): o mural é operacional — dado clínico tem
 * lugar próprio. posicao/concluida_em/arquivada_em/criado_por são server-set
 * (fora do mass assignment); o sync de responsáveis é auditado explicitamente
 * no service (pivot não dispara evento de model — design D2).
 */
class Tarefa extends Model
{
    use Auditavel;

    /** Domínio das colunas FIXAS de v1 (ferramenta interna ≠ regra clínica §13). */
    public const COLUNAS = ['a_fazer', 'em_andamento', 'aguardando', 'concluida'];

    public const PRIORIDADES = ['baixa', 'media', 'alta', 'urgente'];

    protected $table = 'tarefas';

    protected $fillable = ['titulo', 'descricao', 'coluna', 'prioridade', 'prazo', 'etiquetas'];

    protected function casts(): array
    {
        return [
            'prazo' => 'date:Y-m-d',
            'concluida_em' => 'datetime',
            'arquivada_em' => 'datetime',
        ];
    }

    public function responsaveis(): BelongsToMany
    {
        return $this->belongsToMany(Usuario::class, 'tarefa_responsaveis')->withTimestamps();
    }

    public function comentarios(): HasMany
    {
        return $this->hasMany(TarefaComentario::class);
    }

    public function leituras(): HasMany
    {
        return $this->hasMany(TarefaComentarioLeitura::class);
    }

    public function criadoPor(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'criado_por');
    }
}
