<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Comunicado interno BROADCAST da clínica — diff em claro deliberado (parecer
 * §1.4: todos já leem; a trilha prova quem comunicou o quê). Comunicado NÃO é
 * lugar de dado de paciente (diretriz LGPD — a trilha em claro é a compensação).
 */
class Informativo extends Model
{
    use Auditavel;

    protected $table = 'informativos';

    /** criado_por é server-set (usuário autenticado) — fora do mass assignment. */
    protected $fillable = ['titulo', 'corpo', 'publicado'];

    protected function casts(): array
    {
        return ['publicado' => 'boolean'];
    }

    public function criadoPor(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'criado_por');
    }
}
