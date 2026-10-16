<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LancamentoCaixa extends Model
{
    use Auditavel;

    public const TIPOS = ['receita', 'despesa'];

    public const INTERESSADOS = ['paciente', 'fornecedor', 'funcionario'];

    protected $table = 'lancamentos_caixa';

    /** Texto livre potencialmente sensível — fora do diff; o DINHEIRO fica em claro (parecer §1.3). */
    protected array $auditExclude = ['obs'];

    /**
     * pago_em (T-fin-07), grupo_parcelamento/parcela/parcelas_total (T-fin-10) e
     * agendamento_id/tratamento_id são SERVER-SET — fora do mass assignment. O
     * `tratamento_id` do lançamento MANUAL entra pelo payload, mas é o serviço que o grava,
     * depois de conferir o dono (change `recebido-por-profissional`): nada de vínculo por
     * mass-assignment, e o do faturamento pela agenda continua intocável.
     */
    protected $fillable = [
        'tipo', 'competencia', 'vencimento', 'interessado_tipo', 'interessado_id',
        'categoria_id', 'subcategoria_id', 'valor', 'juros', 'multa', 'desconto',
        'tipo_pagamento_id', 'conta_id', 'contabil', 'documento', 'obs',
    ];

    protected function casts(): array
    {
        return [
            'competencia' => 'date:Y-m-d',
            'vencimento' => 'date:Y-m-d',
            'valor' => 'decimal:2',
            'juros' => 'decimal:2',
            'multa' => 'decimal:2',
            'desconto' => 'decimal:2',
            'contabil' => 'boolean',
            'pago_em' => 'datetime:Y-m-d H:i',
        ];
    }

    /**
     * O líquido SEM sinal em SQL — valor + juros + multa − desconto —, para os relatórios que
     * somam cada natureza na sua coluna (a receber × a pagar, recebido × pago; change
     * `relatorios-do-caixa`). É a base do `LIQUIDO_COM_SINAL_SQL` abaixo: uma fórmula só.
     */
    public const LIQUIDO_SQL = '(lancamentos_caixa.valor + lancamentos_caixa.juros + lancamentos_caixa.multa - lancamentos_caixa.desconto)';

    /**
     * O líquido COM SINAL em SQL — receita soma, despesa subtrai —, para somar no banco em
     * decimal (lição CR-04). Mora junto do `liquido()` abaixo de propósito: é a mesma fórmula
     * nas duas línguas, e duas cópias espalhadas é o jeito de uma delas esquecer o juro. Usado
     * pelo `extrato-do-paciente`, pelo `recebido-por-profissional` e pelos relatórios do caixa.
     */
    public const LIQUIDO_COM_SINAL_SQL = "(CASE WHEN lancamentos_caixa.tipo = 'despesa' THEN -1 ELSE 1 END)"
        .' * '.self::LIQUIDO_SQL;

    /** Líquido derivado (T-fin-06): valor + juros + multa − desconto, em decimal. */
    protected function liquido(): Attribute
    {
        return Attribute::get(fn (): string => bcadd(
            bcsub(bcadd($this->valor, $this->juros, 2), $this->desconto, 2),
            $this->multa,
            2
        ));
    }

    public function categoria(): BelongsTo
    {
        return $this->belongsTo(Categoria::class);
    }

    public function subcategoria(): BelongsTo
    {
        return $this->belongsTo(Subcategoria::class);
    }

    public function tipoPagamento(): BelongsTo
    {
        return $this->belongsTo(TipoPagamento::class, 'tipo_pagamento_id');
    }

    public function conta(): BelongsTo
    {
        return $this->belongsTo(Conta::class);
    }

    public function agendamento(): BelongsTo
    {
        return $this->belongsTo(Agendamento::class);
    }

    public function tratamento(): BelongsTo
    {
        return $this->belongsTo(Tratamento::class);
    }
}
