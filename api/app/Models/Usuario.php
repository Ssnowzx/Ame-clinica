<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Database\Factories\UsuarioFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Permission\Traits\HasRoles;

/**
 * Usuário operador da clínica (identidade do sistema).
 */
class Usuario extends Authenticatable
{
    /** @use HasFactory<UsuarioFactory> */
    use Auditavel, HasApiTokens, HasFactory, HasRoles, Notifiable;

    protected $table = 'usuarios';

    protected $fillable = [
        'nome',
        'email',
        'senha_hash',
        'acesso_mobile',
        'ativo',
        'profissional_id', // validado pela UsuarioGestaoRequest
    ];

    protected $hidden = [
        'senha_hash',
        'remember_token',
        // caminho server-set da foto (foto-de-perfil-do-usuario): interno, nunca em JSON —
        // o /me expõe só a `avatar_versao` derivada de avatar_atualizado_em
        'avatar_path',
    ];

    protected function casts(): array
    {
        return [
            'senha_hash' => 'hashed',
            'acesso_mobile' => 'boolean',
            'ativo' => 'boolean',
            // o own-show compara com === int: se o driver um dia stringificar, a
            // comparação falharia FECHADA (dono perderia acesso) — o cast fixa (SEC-FPR-01)
            'profissional_id' => 'integer',
            // versão de cache-bust da foto (foto-de-perfil-do-usuario) — server-set
            'avatar_atualizado_em' => 'datetime',
        ];
    }

    /**
     * A coluna de senha é senha_hash (§5) — sem isto o Auth::attempt procura
     * `password` e o login falha silenciosamente (design, armadilha 5).
     */
    public function getAuthPasswordName(): string
    {
        return 'senha_hash';
    }

    public function profissional(): BelongsTo
    {
        return $this->belongsTo(Profissional::class);
    }
}
