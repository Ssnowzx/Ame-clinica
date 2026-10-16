<?php

namespace Database\Factories;

use App\Models\Agendamento;
use App\Models\Atendimento;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Dados 100% fictícios (LGPD). O agendamento criado
 * pela factory é futuro — testes que dependem de data passada sobrescrevem.
 *
 * @extends Factory<Atendimento>
 */
class AtendimentoFactory extends Factory
{
    protected $model = Atendimento::class;

    public function definition(): array
    {
        return [
            'agendamento_id' => Agendamento::factory(),
            // parede da clínica (fuso default do catálogo), nunca UTC do PHP
            'finalizado_em' => now('America/Sao_Paulo')->subHour()->format('Y-m-d H:i'),
            'observacoes' => null,
        ];
    }
}
