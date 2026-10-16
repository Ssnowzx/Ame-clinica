<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Anexo do lançamento de caixa (change `anexo-no-lancamento`): comprovante do PIX, nota do
 * fornecedor, recibo assinado. O comprovante pode trazer o nome da criança e do responsável: o
 * `caminho` sai da trilha e do payload, e o `nome` do arquivo também (texto livre).
 * Soft-delete: excluir esconde, o arquivo cifrado fica.
 */
class LancamentoAnexo extends Model
{
    use Auditavel, SoftDeletes;

    protected $table = 'lancamento_anexos';

    /** `lancamento_id`, `criado_por` e `caminho` são server-set. */
    protected $fillable = ['nome', 'mime', 'tamanho'];

    protected array $auditExclude = ['nome', 'caminho'];

    public function lancamento(): BelongsTo
    {
        return $this->belongsTo(LancamentoCaixa::class, 'lancamento_id');
    }

    public function criadoPor(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'criado_por');
    }
}
