<?php

use App\Models\Paciente;
use App\Models\Usuario;
use Illuminate\Support\Facades\Hash;

it('deve recusar em produção sem APP_DEMO', function () {
    // ARRANGE
    app()->detectEnvironment(fn () => 'production');
    config(['app.demo' => false]);

    // ACT + ASSERT
    $this->artisan('demo:popular', ['--senha' => 'senha-forte-123'])
        ->expectsOutputToContain('APP_DEMO=true')
        ->assertFailed();
    expect(Paciente::query()->exists())->toBeFalse();
});

it('deve exigir senha forte em produção com APP_DEMO', function () {
    // ARRANGE
    app()->detectEnvironment(fn () => 'production');
    config(['app.demo' => true]);

    // ACT + ASSERT
    $this->artisan('demo:popular', ['--senha' => 'curta'])
        ->expectsOutputToContain('--senha')
        ->assertFailed();
    expect(Paciente::query()->exists())->toBeFalse();
});

it('deve recusar base que já tem pacientes', function () {
    // ARRANGE
    Paciente::factory()->create();

    // ACT + ASSERT
    $this->artisan('demo:popular')
        ->expectsOutputToContain('base vazia')
        ->assertFailed();
});

it('deve popular a base vazia e aplicar a senha informada a todos os usuários', function () {
    // ARRANGE
    app()->detectEnvironment(fn () => 'production');
    config(['app.demo' => true]);

    // ACT
    $this->artisan('demo:popular', ['--senha' => 'senha-da-demo-2026', '--meses' => 1])
        ->assertSuccessful();

    // ASSERT
    $admin = Usuario::where('email', 'admin@clinica-exemplo.com.br')->firstOrFail();
    expect(Paciente::query()->count())->toBeGreaterThan(50)
        ->and(Hash::check('senha-da-demo-2026', $admin->senha_hash))->toBeTrue()
        ->and(Usuario::query()->get()->every(fn (Usuario $u) => Hash::check('senha-da-demo-2026', $u->senha_hash)))->toBeTrue();
});
