<?php

namespace Database\Factories;

use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Tratamento;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Dados 100% fictícios (LGPD); as FKs são criadas junto.
 *
 * @extends Factory<Tratamento>
 */
class TratamentoFactory extends Factory
{
    protected $model = Tratamento::class;

    public function definition(): array
    {
        return [
            'paciente_id' => Paciente::factory(),
            'convenio_id' => fn () => Convenio::create(['nome' => 'Convênio '.fake()->unique()->word()])->id,
            'especialidade_id' => Especialidade::factory(),
            'profissional_id' => Profissional::factory(),
            // `tipo` não entra: não é `fillable` (SEC-TR-17), então a factory o
            // descartaria em silêncio. O default do banco grava 'pacote'.
            'sessoes_total' => 10,
            'status' => 'andamento',
        ];
    }
}
