<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use App\Support\Configuracoes\ConfiguracaoService;
use Database\Factories\TratamentoFactory;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Tratamento extends Model
{
    /** @use HasFactory<TratamentoFactory> */
    use Auditavel, HasFactory;

    public const STATUS = ['andamento', 'parado', 'finalizado'];

    protected $table = 'tratamentos';

    /**
     * Identificadores do menor junto ao convênio — mesma política do cpf
     * (parecer tratamentos §1, T-trat-06): nunca em claro no diff.
     *
     * @var list<string>
     */
    protected array $auditExclude = ['matricula', 'guia'];

    /**
     * sessoes_realizadas FICA FORA de propósito (design D3): o consumo pertence
     * ao atendimento (etapa 6) — payload com o campo é silenciosamente ignorado.
     *
     * `tipo` também fica fora (SEC-TR-17): a coluna tem UM valor ('pacote', o default
     * do banco) e nenhum consumidor. Gravável sem leitor é só superfície.
     */
    protected $fillable = [
        'paciente_id',
        'convenio_id',
        'especialidade_id',
        'profissional_id',
        'servico_id',
        'matricula',
        'guia',
        'sessoes_total',
        'data_inicio',
        'validade_dias',
        // pedido médico como DADO (limites-e-pedidos, D4): emissão + override semanal
        // ("conforme pedido" — Pladisa). Vencimento SEMPRE derivado (pedidoVenceEm()).
        // Auditados EM CLARO como os demais campos (SEC-LP-04): não são identificadores
        // de convênio — $auditExclude permanece ['matricula', 'guia'].
        'pedido_emitido_em',
        'pedido_sessoes_por_semana',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'sessoes_total' => 'integer',
            'sessoes_realizadas' => 'integer',
            'data_inicio' => 'date:Y-m-d',
            'validade_dias' => 'integer',
            'pedido_emitido_em' => 'date:Y-m-d',
            'pedido_sessoes_por_semana' => 'integer',
        ];
    }

    /** Saldo calculado, nunca armazenado (design D2). */
    protected function sessoesSaldo(): Attribute
    {
        return Attribute::get(fn (): int => $this->sessoes_total - $this->sessoes_realizadas);
    }

    /**
     * Vencimento por dias corridos, calculado (design D2); sem âncora, nunca vence.
     * "Hoje" é o dia no fuso da CLÍNICA (§13), e o dia-limite ainda é válido —
     * vencido só quando o limite é ANTERIOR a hoje (gate r1: isPast() vencia um
     * dia antes do contrato).
     */
    protected function vencido(): Attribute
    {
        return Attribute::get(function (): bool {
            if ($this->data_inicio === null || $this->validade_dias === null) {
                return false;
            }

            $limite = $this->data_inicio->copy()->addDays($this->validade_dias)->toDateString();

            return $limite < now($this->fusoDaClinica())->toDateString();
        });
    }

    /**
     * Vencimento do PEDIDO MÉDICO, DERIVADO (limites-e-pedidos, D4): emissão +
     * `pedido_validade_meses` do convênio — nunca coluna (trocar a validade do
     * convênio dessincronizaria um valor gravado). `addMonthsNoOverflow` casa o
     * clamp do DATE_ADD do MariaDB (31/01 + 1 mês = 28/02, nunca 03/03) — a
     * derivação em SQL (bloco do centro) e a em PHP dizem a MESMA data.
     * Sem emissão ou sem validade do convênio → null (nenhum alarme falso).
     */
    public function pedidoVenceEm(): ?string
    {
        if ($this->pedido_emitido_em === null) {
            return null;
        }

        $validadeMeses = $this->convenio?->pedido_validade_meses;
        if ($validadeMeses === null) {
            return null;
        }

        return $this->pedido_emitido_em->copy()
            ->addMonthsNoOverflow((int) $validadeMeses)
            ->toDateString();
    }

    /**
     * Pedido vencido — mesmo contrato do vencimento do tratamento (`vencido()`):
     * o dia-limite ainda é válido; vencido só quando o limite é ANTERIOR a hoje,
     * no fuso da CLÍNICA (§13).
     */
    public function pedidoVencido(): bool
    {
        $venceEm = $this->pedidoVenceEm();

        return $venceEm !== null && $venceEm < now($this->fusoDaClinica())->toDateString();
    }

    private function fusoDaClinica(): string
    {
        return app(ConfiguracaoService::class)->get('clinica.timezone');
    }

    public function paciente(): BelongsTo
    {
        return $this->belongsTo(Paciente::class);
    }

    public function convenio(): BelongsTo
    {
        return $this->belongsTo(Convenio::class);
    }

    public function especialidade(): BelongsTo
    {
        return $this->belongsTo(Especialidade::class);
    }

    public function profissional(): BelongsTo
    {
        return $this->belongsTo(Profissional::class);
    }

    public function servico(): BelongsTo
    {
        return $this->belongsTo(Servico::class);
    }

    /**
     * Lançamentos de caixa amarrados ao pacote (`lancamentos_caixa.tratamento_id`: gravado pelo
     * faturamento e pelo lançamento manual que alguém liga ao pacote — change
     * `recebido-por-profissional`). Existe para o relatório `tratamentos-sem-lancamento`
     * perguntar "este pacote já caiu no caixa?" sem subconsulta crua. Pacote com lançamento não troca de convênio nem é excluído (FK `restrict`).
     */
    public function lancamentos(): HasMany
    {
        return $this->hasMany(LancamentoCaixa::class);
    }
}
