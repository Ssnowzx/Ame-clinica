<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Carbon\Carbon;
use Database\Factories\AgendamentoFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Agendamento extends Model
{
    /** @use HasFactory<AgendamentoFactory> */
    use Auditavel, HasFactory;

    public const TIPOS = ['atendimento', 'bloqueio'];

    protected $table = 'agendamentos';

    /** obs pode carregar contexto clínico digitado livremente — fora do diff. */
    protected array $auditExclude = ['obs'];

    /** recorrencia_grupo_id é atribuído pelo serviço de série, nunca pelo payload. */
    protected $fillable = [
        'tipo',
        'paciente_id',
        'profissional_id',
        'especialidade_id',
        'tratamento_id',
        'sala_id',
        'equipamento_id',
        'medico_id',
        'status_id',
        'inicio',
        'fim',
        'origem',
        'is_reposicao',
        'reposicao_de_id',
        'obs',
        // marcador do lembrete automático (mensageria-whatsapp): decisão de AGENDA, e por
        // isso `agenda.editar` basta — não exige permissão do módulo de mensagens
        'lembrete_whatsapp',
    ];

    protected function casts(): array
    {
        return [
            'inicio' => 'datetime:Y-m-d H:i',
            'fim' => 'datetime:Y-m-d H:i',
            'is_reposicao' => 'boolean',
            'lembrete_whatsapp' => 'boolean',
            // marcador de consumo (D2/T-ate-13): server-set, fora de $fillable
            'sessao_consumida_em' => 'datetime:Y-m-d H:i',
        ];
    }

    /** Derivada (agenda D1) — nunca coluna. */
    protected function duracaoMinutos(): Attribute
    {
        return Attribute::get(fn (): int => (int) $this->inicio->diffInMinutes($this->fim));
    }

    /**
     * O que JÁ CONTA como acontecido para a assiduidade (change agendamentos-na-ficha, D5):
     * o que já começou, **ou** o de HOJE cujo desfecho já foi lançado — sessão consumida ou
     * status de falta. Presença registrada é fato consumado: esperar o relógio fazia a taxa
     * do dia divergir do que a clínica acabou de lançar (relato da clínica, 2026-09-08).
     *
     * O limite é o AMANHÃ 00:00 da parede da clínica, derivado do próprio `$agora` — assim a
     * regra mora num lugar só e um desfecho lançado por engano para a semana que vem não
     * entra na assiduidade de hoje. `<` contra a meia-noite seguinte inclui o agendamento das
     * 23:59, que um `<= 23:59` deixaria de fora por segundos.
     *
     * FONTE ÚNICA: a assiduidade da ficha e o `ContadorDeFaltasConsecutivas` leem daqui —
     * dois números da mesma coisa não podem discordar. O comparecimento recente do painel da
     * agenda NÃO usa este escopo: lá o mini-histórico é passado por definição.
     *
     * @param  string  $agora  parede da clínica (`Y-m-d H:i`)
     */
    public function scopeJaContabilizavel(Builder $query, string $agora): void
    {
        $limiteDoDia = Carbon::parse($agora)->addDay()->startOfDay()->format('Y-m-d H:i');

        $query->where(function (Builder $janela) use ($agora, $limiteDoDia): void {
            $janela->where('inicio', '<', $agora)
                ->orWhere(function (Builder $hoje) use ($limiteDoDia): void {
                    $hoje->where('inicio', '<', $limiteDoDia)
                        ->where(function (Builder $desfecho): void {
                            $desfecho->whereNotNull('sessao_consumida_em')
                                ->orWhereHas('status', fn (Builder $s) => $s->where('marca_falta', true));
                        });
                });
        });
    }

    public function paciente(): BelongsTo
    {
        return $this->belongsTo(Paciente::class);
    }

    public function profissional(): BelongsTo
    {
        return $this->belongsTo(Profissional::class);
    }

    public function especialidade(): BelongsTo
    {
        return $this->belongsTo(Especialidade::class);
    }

    public function tratamento(): BelongsTo
    {
        return $this->belongsTo(Tratamento::class);
    }

    public function sala(): BelongsTo
    {
        return $this->belongsTo(Sala::class);
    }

    public function equipamento(): BelongsTo
    {
        return $this->belongsTo(Equipamento::class);
    }

    public function medico(): BelongsTo
    {
        return $this->belongsTo(Medico::class);
    }

    public function status(): BelongsTo
    {
        return $this->belongsTo(StatusAgendamento::class, 'status_id');
    }

    public function original(): BelongsTo
    {
        return $this->belongsTo(self::class, 'reposicao_de_id');
    }

    public function atendimento(): HasOne
    {
        return $this->hasOne(Atendimento::class);
    }

    /** Os lembretes que o disparo registrou para este agendamento — e a resposta da família a cada um. */
    public function lembretesEnviados(): HasMany
    {
        return $this->hasMany(LembreteEnviado::class);
    }
}
