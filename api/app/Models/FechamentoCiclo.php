<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Fechamento de um período do ciclo de faturamento de um convênio (D2).
 *
 * **Append-only (SEC-FC-02):** a linha nasce fechada e só recebe a MARCA da reabertura.
 * Nenhum caminho limpa `reaberto_em` nem apaga a linha — re-fechar o mesmo período cria
 * uma linha NOVA, e é a coluna gerada `chave_ativa` (unique só entre linhas abertas) que
 * deixa isso acontecer sem colisão.
 *
 * **§14 (SEC-FC-19):** protocolo, lote e valor faturado NÃO moram aqui. O fechamento é
 * registro interno de "esta produção já foi enviada", não a esteira de convênios.
 *
 * Sem `$fillable` de propósito: TODOS os campos são server-set. Período vem validado
 * contra o calendário do convênio; atores e timestamps vêm do servidor; o motivo da
 * reabertura vem do `ReaberturaDeCicloRequest`. Mass assignment aqui só criaria porta
 * para um fechamento com autoria escolhida pelo cliente.
 */
class FechamentoCiclo extends Model
{
    use Auditavel;

    protected $table = 'fechamentos_ciclo';

    protected $guarded = ['id', 'chave_ativa'];

    protected function casts(): array
    {
        return [
            'periodo_inicio' => 'date:Y-m-d',
            'periodo_fim' => 'date:Y-m-d',
            'fechado_em' => 'datetime:Y-m-d H:i',
            'reaberto_em' => 'datetime:Y-m-d H:i',
        ];
    }

    public function convenio(): BelongsTo
    {
        return $this->belongsTo(Convenio::class);
    }

    public function fechadoPor(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'fechado_por');
    }

    public function reabertoPor(): BelongsTo
    {
        return $this->belongsTo(Usuario::class, 'reaberto_por');
    }

    /** O período está congelado enquanto a linha não foi reaberta. */
    public function estaAberto(): bool
    {
        return $this->reaberto_em === null;
    }
}
