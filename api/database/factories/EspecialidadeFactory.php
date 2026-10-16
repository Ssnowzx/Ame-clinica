<?php

namespace Database\Factories;

use App\Models\Especialidade;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Dados fictícios (LGPD).
 *
 * @extends Factory<Especialidade>
 */
class EspecialidadeFactory extends Factory
{
    protected $model = Especialidade::class;

    public function definition(): array
    {
        return [
            'nome' => 'Especialidade '.fake()->unique()->word(),
            'tempo_sessao' => 40,
            'cor' => '#4F46E5',
            'exige_termo' => false,
            'oculta_agendamento_online' => false,
        ];
    }
}
