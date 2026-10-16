<?php

namespace Database\Factories;

use App\Models\Feriado;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Dados fictícios (LGPD).
 *
 * @extends Factory<Feriado>
 */
class FeriadoFactory extends Factory
{
    protected $model = Feriado::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'nome' => 'Feriado Fictício',
            // na PAREDE da clínica: `now()` do PHP é UTC e, à noite, cai no dia seguinte
            'data' => agoraNaClinica()->addDays(10)->toDateString(),
            'recorrente' => false,
            'ativo' => true,
        ];
    }
}
