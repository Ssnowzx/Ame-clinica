<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Projeção pesquisável do telefone do paciente em E.164 (change mensageria-whatsapp, D6).
 *
 * SEM `Auditavel` de propósito: é dado DERIVADO de `pacientes.contatos_json`, e o cadastro
 * já é auditado. Auditar a projeção encheria a trilha de telefones de menores — repetindo
 * em claro justamente o que o `auditExclude` de `Paciente` mascara.
 *
 * SEM `timestamps`: linha derivada não tem história própria; ela é reconstruída.
 */
class ContatoNormalizado extends Model
{
    /** Tipos de contato do cadastro que são telefone (há também `email`). */
    public const TIPOS_TELEFONICOS = ['telefone', 'celular', 'whatsapp'];

    protected $table = 'contatos_normalizados';

    public $timestamps = false;

    protected $fillable = ['paciente_id', 'e164', 'tipo'];

    public function paciente(): BelongsTo
    {
        return $this->belongsTo(Paciente::class);
    }
}
