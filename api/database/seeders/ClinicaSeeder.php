<?php

namespace Database\Seeders;

use App\Models\Clinica;
use Illuminate\Database\Seeder;

/**
 * A clínica de desenvolvimento (a linha única de `clinica`) — dados fictícios (LGPD).
 */
class ClinicaSeeder extends Seeder
{
    public function run(): void
    {
        // O catálogo financeiro NÃO é semeado aqui. Quando esta linha é criada, o
        // `ClinicaObserver::created` semeia — e quando ela já existe (base já povoada),
        // semear seria ressuscitar o que a clínica apagou de propósito: apagar "PIX" pela
        // tela e um `db:seed` o traria de volta. A spec promete o contrário ("MUST NOT
        // recriar fora de uma aplicação explícita do comando"). Catálogo faltando se
        // resolve pelo comando `php artisan financeiro:catalogo-padrao`.
        if (! Clinica::query()->exists()) {
            Clinica::create(['nome' => 'Clínica Exemplo', 'ativo' => true]);
        }
    }
}
