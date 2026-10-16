<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Cadastro DORMENTE no v1 (T-fin-03) — a engine de recebíveis é fase 2.
 *
 * `bandeira`, `pct_parcelas` e `antecipacao_credito` (change `bandeira-e-parcelas-do-cartao`)
 * seguem o mesmo regime de `pct_a_vista`/`dias_recebimento`: são DADO que a clínica guarda,
 * sem nenhum cálculo que os leia hoje.
 */
class Cartao extends Model
{
    use Auditavel;

    public const TIPOS = ['credito', 'debito'];

    /** Catálogo GLOBAL e fechado (as operadoras existem fora da clínica) — não é cadastro. */
    public const BANDEIRAS = ['visa', 'mastercard', 'elo', 'hipercard', 'amex', 'banescard', 'outra'];

    /** As chaves válidas de `pct_parcelas` — "12" significa "12x ou mais". */
    public const PARCELAS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

    protected $table = 'cartoes';

    protected $fillable = [
        'nome', 'tipo', 'bandeira', 'pct_a_vista', 'pct_parcelas', 'dias_recebimento',
        'conta_id', 'liquidar_auto', 'antecipacao_credito',
    ];

    protected function casts(): array
    {
        return [
            'pct_a_vista' => 'decimal:2',
            'pct_parcelas' => 'array',
            'dias_recebimento' => 'integer',
            'liquidar_auto' => 'boolean',
            'antecipacao_credito' => 'boolean',
        ];
    }

    public function conta(): BelongsTo
    {
        return $this->belongsTo(Conta::class);
    }
}
