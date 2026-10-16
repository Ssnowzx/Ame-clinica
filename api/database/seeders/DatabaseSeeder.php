<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

/**
 * Seed de desenvolvimento — dados 100% fictícios (LGPD).
 * (Sem WithoutModelEvents: o ClinicaObserver precisa rodar para criar o Administrador.)
 */
class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            CatalogoPermissoesSeeder::class,
            ClinicaSeeder::class,
            UsuarioAdminSeeder::class,
            CbosSeeder::class,
            StatusAgendamentoSeeder::class,
        ]);
    }
}
