<?php

namespace Database\Factories;

use App\Models\Profissional;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Dados 100% fictícios (LGPD).
 *
 * @extends Factory<Profissional>
 */
class ProfissionalFactory extends Factory
{
    protected $model = Profissional::class;

    public function definition(): array
    {
        // Sem horários por padrão = atende todos os dias na janela padrão da clínica
        // (retrocompat). Testes que precisam de horários criam linhas de ProfissionalHorario.
        return [
            'nome' => fake()->name(),
            'ativo' => true,
        ];
    }

    /**
     * Profissional com horários por dia (turno partido opcional). Cria as linhas de
     * `profissional_horarios` após o profissional existir.
     *
     * @param  array<int, list<array{inicio: string, fim: string}>>  $porDia  dia ISO → intervalos
     */
    public function comHorarios(array $porDia): static
    {
        return $this->afterCreating(function (Profissional $profissional) use ($porDia): void {
            foreach ($porDia as $dia => $intervalos) {
                foreach ($intervalos as $intervalo) {
                    $profissional->horarios()->create([
                        'dia_semana' => (int) $dia,
                        'inicio' => $intervalo['inicio'],
                        'fim' => $intervalo['fim'],
                    ]);
                }
            }
        });
    }
}
