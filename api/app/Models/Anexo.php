<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Anexo do paciente — documento de MENOR, potencialmente laudo (art. 11).
 *
 * `nome` e `caminho` MASCARADOS na trilha (SEC-AX-04): o nome de arquivo é
 * texto livre que pode codificar diagnóstico ("laudo-tea.pdf"), e
 * `auditoria.ver` não é confiável com art. 11 (precedente SEC-APS). O ciclo de
 * vida fica identificável por id/paciente/mime/tamanho/autor.
 *
 * Soft-delete (SEC-AX-08): excluir esconde (lista e download), nunca destrói —
 * laudo é prontuário com retenção obrigatória (PR-11).
 */
class Anexo extends Model
{
    use Auditavel, SoftDeletes;

    protected $table = 'anexos';

    /** `paciente_id`, `criado_por` e `caminho` são server-set — fora do mass assignment. */
    protected $fillable = ['nome', 'mime', 'tamanho'];

    protected array $auditExclude = ['nome', 'caminho'];

    public function paciente(): BelongsTo
    {
        return $this->belongsTo(Paciente::class);
    }

    public function criadoPor(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'criado_por');
    }
}
