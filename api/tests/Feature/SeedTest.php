<?php

use App\Models\Agendamento;
use App\Models\Clinica;
use App\Models\Usuario;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\DemoSeeder;

it('deve semear o banco de desenvolvimento com admin funcional', function () {
    // ACT — exatamente o caminho do README (migrate --seed)
    $this->seed(DatabaseSeeder::class);

    // ASSERT
    $admin = Usuario::where('email', 'admin@clinica-exemplo.com.br')->firstOrFail();

    expect($admin->hasRole('Administrador'))->toBeTrue()
        ->and($admin->getAllPermissions()->count())->toBeGreaterThan(0);
});

it('deve poder semear duas vezes sem duplicar nada', function () {
    // ARRANGE
    $this->seed(DatabaseSeeder::class);

    // ACT — idempotência
    $this->seed(DatabaseSeeder::class);

    // ASSERT
    expect(Clinica::query()->count())->toBe(1)
        ->and(Usuario::where('email', 'admin@clinica-exemplo.com.br')->count())->toBe(1);
});

it('deve registrar atendimento para toda sessão finalizada da demo', function () {
    // ARRANGE — a demo completa (o DemoSeeder exige a clínica do DatabaseSeeder)
    $this->seed(DatabaseSeeder::class);

    // ACT
    $this->seed(DemoSeeder::class);

    // ASSERT — a régua canônica da produção: sessão que ACONTECEU (status que desconta
    // sem marcar falta) tem linha em `atendimentos`; falta consome saldo mas não é sessão
    $sessoesFinalizadas = Agendamento::where('tipo', 'atendimento')->whereHas(
        'status',
        fn ($q) => $q->where('desconta_sessao', true)->where('marca_falta', false),
    );
    $faltas = Agendamento::where('tipo', 'atendimento')
        ->whereHas('status', fn ($q) => $q->where('marca_falta', true));

    expect($sessoesFinalizadas->count())->toBeGreaterThan(0)
        ->and((clone $sessoesFinalizadas)->whereDoesntHave('atendimento')->count())->toBe(0)
        ->and($faltas->whereHas('atendimento')->count())->toBe(0);
});
