<?php

namespace Database\Seeders;

use App\Models\Cbos;
use Illuminate\Database\Seeder;

/**
 * Subconjunto clínico do catálogo CBO oficial (dado público — não é dado
 * pessoal). Idempotente; a clínica pode complementar via API.
 */
class CbosSeeder extends Seeder
{
    private const OCUPACOES = [
        '225112' => 'Médico neurologista',
        '225124' => 'Médico pediatra',
        '225133' => 'Médico psiquiatra',
        '251510' => 'Psicólogo clínico',
        '223605' => 'Fisioterapeuta geral',
        '223810' => 'Fonoaudiólogo',
        '223710' => 'Nutricionista',
        '223905' => 'Terapeuta ocupacional',
    ];

    public function run(): void
    {
        foreach (self::OCUPACOES as $codigo => $nome) {
            Cbos::firstOrCreate(['codigo' => $codigo], ['nome' => $nome]);
        }
    }
}
