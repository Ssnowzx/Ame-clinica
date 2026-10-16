<?php

namespace App\Console\Commands;

use App\Support\Mensageria\DisparoDeLembretes;
use Illuminate\Console\Command;

/**
 * O agendador do lembrete automático (change mensageria-whatsapp).
 *
 * É idempotente por construção (o unique de `lembretes_enviados`): rodar duas vezes no mesmo
 * dia, à mão ou por cron duplicado, não manda nada duas vezes.
 */
class EnviarLembretes extends Command
{
    protected $signature = 'lembretes:enviar
        {--repescagem : a volta de hora em hora depois das 08:00 (change repescagem-do-lembrete)}';

    protected $description = 'Envia os lembretes de agendamento por WhatsApp (rotina diária)';

    public function handle(DisparoDeLembretes $disparo): int
    {
        $resultado = $disparo->executar(repescagem: (bool) $this->option('repescagem'));

        foreach ($resultado['motivos'] as $motivo => $quantos) {
            $this->line("{$quantos} não enviado(s) — {$motivo}");
        }

        $this->info("Lembretes: {$resultado['enviados']} enviado(s), {$resultado['nao_enviados']} não enviado(s).");

        return self::SUCCESS;
    }
}
