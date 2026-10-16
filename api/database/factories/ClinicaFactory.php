<?php

namespace Database\Factories;

use App\Models\Clinica;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Dados 100% fictícios (LGPD) — nunca derivados de clínicas ou pessoas reais.
 *
 * A tabela guarda UMA linha: a factory serve para criar a clínica de um banco vazio (testes,
 * seeders). Uma segunda criação é recusada pelo model.
 *
 * @extends Factory<Clinica>
 */
class ClinicaFactory extends Factory
{
    protected $model = Clinica::class;

    public function definition(): array
    {
        return [
            'nome' => 'Clínica '.fake()->company(),
            'ativo' => true,
        ];
    }
}
