<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class StatusAgendamento extends Model
{
    use Auditavel;

    protected $table = 'status_agendamento';

    protected $fillable = ['nome', 'cor', 'cor_borda', 'desconta_sessao', 'ocupa_horario', 'marca_falta', 'marca_reserva', 'em_aberto', 'aplicavel_em_lote', 'tipo', 'ordem'];

    protected function casts(): array
    {
        return [
            'desconta_sessao' => 'boolean',
            'ocupa_horario' => 'boolean',
            // falta é FLAG, nunca nome (T-not-07 — etapa 8)
            'marca_falta' => 'boolean',
            // reserva também (mensageria-whatsapp): o lembrete automático precisa saber o
            // que é compromisso provisório, e o nome do status é da clínica
            'marca_reserva' => 'boolean',
            // baixa em lote por status (D2): quem ENTRA no alcance ("ainda sem desfecho") e quem
            // é OFERECIDO como alvo — dado da clínica, com invariantes na GuardaDasFlagsDeDesfecho
            'em_aberto' => 'boolean',
            'aplicavel_em_lote' => 'boolean',
            'ordem' => 'integer',
        ];
    }

    /**
     * O status INICIAL da clínica (menor ordem, tie-break por id) — definição
     * única usada pela criação de agendamentos e pelo encadeamento (CR-06).
     */
    public static function inicialId(): ?int
    {
        return static::query()->orderBy('ordem')->orderBy('id')->value('id');
    }

    /**
     * Status de sessão MARCADA: ocupa o horário e não é reserva — o molde do lembrete. Regra única
     * da resposta ao lembrete e do card (change `lembrete-com-botoes-de-resposta`, CRB-10).
     */
    public function ehSessaoMarcada(): bool
    {
        return (bool) $this->ocupa_horario && ! (bool) $this->marca_reserva;
    }

    /** A mesma regra de `ehSessaoMarcada`, para consulta. */
    public function scopeDeSessaoMarcada(Builder $status): Builder
    {
        return $status->where('ocupa_horario', true)->where('marca_reserva', false);
    }

    /**
     * Status que FINALIZA a sessão: desconta, é sessão MARCADA (segura o horário e não é reserva) e não
     * é falta (change evolucao-finaliza-a-sessao, D3). Regra única da validação da chave
     * `evolucoes.status_ao_salvar`, da lista que a tela oferece e da releitura na hora de aplicar — e a
     * mesma do aviso da tela, que lê `sessao_marcada` (gate CR-EVO-R2-08). "Não Compareceu" desconta e
     * segura o horário, mas salvar a evolução não pode marcar a criança como ausente.
     */
    public function scopeQueFinalizaASessao(Builder $status): Builder
    {
        return $status->where('desconta_sessao', true)->deSessaoMarcada()->where('marca_falta', false);
    }
}
