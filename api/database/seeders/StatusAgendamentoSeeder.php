<?php

namespace Database\Seeders;

use App\Support\Agenda\StatusAgendamentoDefaults;
use Illuminate\Database\Seeder;

/**
 * Retroativo: garante os status default numa clínica criada ANTES desta change
 * (a clínica nova já os recebe via ClinicaObserver). Idempotente.
 */
class StatusAgendamentoSeeder extends Seeder
{
    public function run(): void
    {
        StatusAgendamentoDefaults::criar();
    }
}
