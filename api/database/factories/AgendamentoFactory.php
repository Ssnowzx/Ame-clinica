<?php

namespace Database\Factories;

use App\Models\Agendamento;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\DB;

/**
 * Dados 100% fictícios (LGPD). O profissional criado
 * é vinculado à especialidade (N:M) para satisfazer a regra do §6.
 *
 * @extends Factory<Agendamento>
 */
class AgendamentoFactory extends Factory
{
    protected $model = Agendamento::class;

    public function definition(): array
    {
        $inicio = now()->addDays(fake()->numberBetween(1, 20))
            ->setTime(fake()->numberBetween(8, 17), 0);

        return [
            'tipo' => 'atendimento',
            'paciente_id' => Paciente::factory(),
            // closures: nada é criado quando o teste sobrescreve os campos (gate r1)
            'especialidade_id' => fn () => Especialidade::factory()->create(['tempo_sessao' => 40])->id,
            'profissional_id' => function (array $atributos) {
                $profissional = Profissional::factory()->create();
                DB::table('profissional_especialidade')->insert([
                    'profissional_id' => $profissional->id,
                    'especialidade_id' => $atributos['especialidade_id'],
                ]);

                return $profissional->id;
            },
            'status_id' => fn () => StatusAgendamento::orderBy('ordem')->value('id'),
            'inicio' => $inicio,
            'fim' => $inicio->copy()->addMinutes(40),
        ];
    }
}
