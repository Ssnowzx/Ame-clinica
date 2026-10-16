<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Convenio extends Model
{
    use Auditavel;

    protected $table = 'convenios';

    protected $fillable = [
        'nome',
        'registro_ans',
        'codigo_operadora',
        'versao_tiss',
        'guia_sequencial',
        'alerta_agend_mesmo_dia',
        'flags_tiss_json',
        // validade do PEDIDO MÉDICO em meses (limites-e-pedidos, D4): dado por operadora
        // (Unimed 6 · SC Saúde 3); sem valor, nenhum vencimento de pedido é derivado
        'pedido_validade_meses',
        // calendário do CICLO DE FATURAMENTO (fechamento-de-ciclo, D1): dado por
        // operadora (Unimed dia 15 · SC Saúde último dia). Sem ele o convênio não tem
        // ciclo — e, com fechamento aberto, ele não muda mais (SEC-FC-18)
        'ciclo_dia_corte',
        'ciclo_tipo_corte',
        'particular', // fronteira §14 como DADO (T-fin-17): decide o destino do faturamento
        'ativo',
    ];

    protected function casts(): array
    {
        return [
            'guia_sequencial' => 'boolean',
            'alerta_agend_mesmo_dia' => 'boolean',
            'flags_tiss_json' => 'array',
            'pedido_validade_meses' => 'integer',
            'ciclo_dia_corte' => 'integer',
            'particular' => 'boolean',
            'ativo' => 'boolean',
        ];
    }

    public function servicos(): HasMany
    {
        return $this->hasMany(Servico::class);
    }

    public function regrasLimite(): HasMany
    {
        return $this->hasMany(RegraLimiteConvenio::class);
    }

    /** Fechamentos do ciclo de faturamento — append-only (D2/SEC-FC-02). */
    public function fechamentosCiclo(): HasMany
    {
        return $this->hasMany(FechamentoCiclo::class);
    }
}
