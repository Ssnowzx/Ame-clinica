<?php

namespace App\Console\Commands;

use App\Models\Paciente;
use App\Models\Usuario;
use Database\Seeders\ApresentacaoSeeder;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Schema;

/**
 * Popula uma base VAZIA com a apresentação comercial (12 meses de dados 100% fictícios),
 * para o cliente testar o sistema. Em produção só roda com APP_DEMO=true, e então exige
 * `--senha`: a senha de desenvolvimento do seeder nunca fica valendo num endereço público.
 *
 * Datas ancoradas em hoje — para "renovar" a demo, recrie a base e rode de novo.
 */
class DemoPopular extends Command
{
    protected $signature = 'demo:popular
        {--senha= : Senha de todos os usuários da demo (obrigatória em produção, mínimo 10 caracteres)}
        {--meses=12 : Meses de histórico}';

    protected $description = 'Popula a base vazia com a demonstração da Ame Clínica (dados fictícios)';

    public function handle(): int
    {
        if ($this->laravel->isProduction() && ! config('app.demo')) {
            $this->error('Em produção, a demo só roda com APP_DEMO=true.');

            return self::FAILURE;
        }

        $senha = (string) $this->option('senha');
        if ($this->laravel->isProduction() && mb_strlen($senha) < 10) {
            $this->error('Em produção, informe --senha com pelo menos 10 caracteres.');

            return self::FAILURE;
        }

        if (! Schema::hasTable('pacientes')) {
            $this->error('Rode as migrations antes (php artisan migrate --force).');

            return self::FAILURE;
        }

        if (Paciente::query()->exists()) {
            $this->error('A base já tem pacientes. A demo só roda em base vazia.');

            return self::FAILURE;
        }

        $this->call('db:seed', ['--class' => DatabaseSeeder::class, '--force' => true]);
        $apresentacao = new ApresentacaoSeeder(max(1, (int) $this->option('meses')));
        $apresentacao->setContainer($this->laravel)->setCommand($this);
        $apresentacao->__invoke();

        if ($senha !== '') {
            Usuario::query()->each(fn (Usuario $usuario) => $usuario->update(['senha_hash' => $senha]));
            $this->info('Senha de todos os usuários da demo atualizada.');
        }

        $this->info('Demo pronta. Login: admin@clinica-exemplo.com.br');

        return self::SUCCESS;
    }
}
