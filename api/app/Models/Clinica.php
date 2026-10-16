<?php

namespace App\Models;

use App\Observers\ClinicaObserver;
use Database\Factories\ClinicaFactory;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use LogicException;

/**
 * A clínica — a identidade do sistema, numa linha SÓ (tabela `clinica`).
 *
 * O sistema atende uma clínica: não há escopo por clínica nas outras tabelas, e esta linha
 * guarda o que é dela como um todo (nome, logo, endereço público do auto-cadastro). Criá-la
 * dispara o `ClinicaObserver`, que semeia os defaults (nível Administrador, status de
 * agendamento, catálogo do caixa). Uma segunda linha é recusada no `creating`.
 *
 * `cadastro_online_slug` fica FORA do mass assignment de propósito (mesma decisão do
 * `logo_path`): o endereço público é server-set — gerado e rotacionado por um caminho
 * próprio, sob `configuracoes.editar` —, nunca um campo que um payload possa escolher.
 */
#[ObservedBy(ClinicaObserver::class)]
class Clinica extends Model
{
    /** @use HasFactory<ClinicaFactory> */
    use HasFactory;

    protected $table = 'clinica';

    protected $fillable = [
        'nome',
        'ativo',
    ];

    protected static function booted(): void
    {
        static::creating(function (): void {
            if (static::query()->exists()) {
                throw new LogicException('A clínica já existe: o sistema guarda uma linha só em `clinica`.');
            }
        });
    }

    /**
     * A clínica do sistema (a única linha).
     *
     * @throws ModelNotFoundException se ainda não foi criada
     *                                (rode o `ClinicaSeeder`)
     */
    public static function atual(): self
    {
        return static::query()->orderBy('id')->firstOrFail();
    }

    protected function casts(): array
    {
        return [
            'ativo' => 'boolean',
            // logo (identidade-da-clinica): server-set pelo ClinicaLogoController —
            // logo_path/logo_atualizado_em ficam FORA de $fillable de propósito
            'logo_atualizado_em' => 'datetime',
        ];
    }
}
