<?php

namespace Database\Factories;

use App\Models\Paciente;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Dados 100% FICTÍCIOS (LGPD — menores): nunca derivados de pacientes reais.
 *
 * @extends Factory<Paciente>
 */
class PacienteFactory extends Factory
{
    protected $model = Paciente::class;

    public function definition(): array
    {
        return [
            'nome' => 'Paciente Fictício '.fake()->unique()->firstName(),
            'nascimento' => fake()->dateTimeBetween('-12 years', '-3 years')->format('Y-m-d'),
            'sexo' => fake()->randomElement(['feminino', 'masculino']),
            'necessidade' => 'sem',
            'responsaveis_json' => [
                ['nome' => 'Responsável Fictício '.fake()->lastName(), 'parentesco' => 'mãe'],
            ],
            'contatos_json' => [],
            'ativo' => true,
        ];
    }

    public function adulto(): static
    {
        return $this->state([
            'nascimento' => fake()->dateTimeBetween('-60 years', '-20 years')->format('Y-m-d'),
        ]);
    }
}
