<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Database\Factories\ProfissionalFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Profissional extends Model
{
    /** @use HasFactory<ProfissionalFactory> */
    use Auditavel, HasFactory;

    protected $table = 'profissionais';

    protected $fillable = [
        'nome',
        'conselho',
        'uf_conselho',
        'num_conselho',
        'cbos_id',
        'obs',
        'ativo',
        // quantos atendimentos sustenta no MESMO intervalo (change atendimento-em-grupo):
        // é o teto do eixo profissional do conflito, dado do cadastro e não regra em código
        'atendimentos_simultaneos',
        // se as famílias recebem o lembrete e a confirmação automáticos (change
        // mensagens-automaticas-por-profissional): lido na hora do envio, nunca copiado para o agendamento
        'mensagens_automaticas',
    ];

    /**
     * Default do MODELO, espelhando o do banco (change atendimento-em-grupo): sem ele o
     * profissional recém-criado volta da API com o campo `null` — o valor existe na linha, mas
     * não na instância que serializa a resposta.
     *
     * @var array<string, mixed>
     */
    protected $attributes = ['atendimentos_simultaneos' => 1, 'mensagens_automaticas' => true];

    /** caminho server-set da foto (foto-do-profissional): interno, nunca em JSON — sai só `foto_versao` */
    protected $hidden = ['foto_path'];

    protected function casts(): array
    {
        return [
            'ativo' => 'boolean',
            'atendimentos_simultaneos' => 'integer',
            'mensagens_automaticas' => 'boolean',
            // versão de cache-bust da foto (foto-do-profissional) — server-set
            'foto_atualizado_em' => 'datetime',
        ];
    }

    public function especialidades(): BelongsToMany
    {
        return $this->belongsToMany(Especialidade::class, 'profissional_especialidade');
    }

    /**
     * Horários de atendimento por dia (change horarios-por-dia-do-profissional). N linhas
     * por dia = turno partido. Ordenado por dia/início para a serialização e a grade.
     * SEM linhas = atende todos os dias na janela padrão da clínica (retrocompat).
     */
    public function horarios(): HasMany
    {
        return $this->hasMany(ProfissionalHorario::class)->orderBy('dia_semana')->orderBy('inicio');
    }

    /**
     * O mapa de horários como a API o expõe: `{ "<dia 1..7>": [ {inicio, fim}, ... ] }`,
     * em "HH:MM". Vazio (`[]`) quando o profissional não tem horários (todos os dias).
     *
     * @return array<string, list<array{inicio: string, fim: string}>>
     */
    public function mapaDeHorarios(): array
    {
        $mapa = [];
        foreach ($this->horarios as $horario) {
            $mapa[(string) $horario->dia_semana][] = [
                'inicio' => substr((string) $horario->inicio, 0, 5),
                'fim' => substr((string) $horario->fim, 0, 5),
            ];
        }

        return $mapa;
    }

    public function cbos(): BelongsTo
    {
        return $this->belongsTo(Cbos::class);
    }
}
