<?php

namespace Database\Seeders;

use App\Models\Usuario;
use Illuminate\Database\Seeder;

/**
 * Admin de DESENVOLVIMENTO da clínica — dados fictícios (LGPD).
 * Login local: admin@clinica-exemplo.com.br / senha-de-dev-123 (trocar em qualquer
 * ambiente que não seja a máquina do dev — ver README).
 */
class UsuarioAdminSeeder extends Seeder
{
    public function run(): void
    {
        $admin = Usuario::firstOrCreate(
            ['email' => 'admin@clinica-exemplo.com.br'],
            [
                'nome' => 'Admin Exemplo',
                'senha_hash' => 'senha-de-dev-123',
                'ativo' => true,
            ],
        );

        $admin->syncRoles(['Administrador']);
    }
}
