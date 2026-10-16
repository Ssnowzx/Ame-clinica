<?php

namespace Database\Factories;

use App\Models\Usuario;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Dados 100% fictícios (LGPD) — nunca derivados de pessoas reais.
 *
 * @extends Factory<Usuario>
 */
class UsuarioFactory extends Factory
{
    protected $model = Usuario::class;

    public function definition(): array
    {
        return [
            'nome' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'senha_hash' => 'senha-de-teste-123', // o cast hashed criptografa ao atribuir
            'acesso_mobile' => false,
            'ativo' => true,
        ];
    }

    public function inativo(): static
    {
        return $this->state(['ativo' => false]);
    }
}
