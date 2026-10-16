<?php

namespace App\Jobs;

use App\Models\MensagemMidia;
use App\Support\Mensageria\ErroDeEnvio;
use App\Support\Mensageria\FabricaDeCliente;
use App\Support\Mensageria\GravadorDeMidia;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Baixa a mídia de uma mensagem recebida (change mensageria-whatsapp).
 *
 * É assíncrono por necessidade, não por elegância: a Meta espera resposta rápida do webhook
 * e considera falha a entrega que demora — segurar a requisição baixando um PDF de 8 MB faria
 * a Meta reenfileirar o evento inteiro, e a conversa duplicaria na cara da recepção.
 */
class BaixarMidiaJob implements ShouldQueue
{
    use Queueable;

    public function __construct(
        private readonly int $midiaId,
    ) {}

    public function handle(FabricaDeCliente $fabrica, GravadorDeMidia $gravador): void
    {
        $registro = MensagemMidia::query()->find($this->midiaId);

        // mensagem apagada pela retenção antes de o worker chegar aqui: nada a fazer
        if ($registro === null || $registro->wa_media_id === null || $registro->caminho !== null) {
            return;
        }

        try {
            $gravador->gravar($registro, $fabrica->paraClinica()->baixarMidia($registro->wa_media_id));
        } catch (ErroDeEnvio $erro) {
            if ($erro->permanente) {
                // a URL da mídia expira em minutos; passou disso, não adianta insistir —
                // a mensagem fica na thread dizendo que veio um arquivo que não chegou
                $registro->mensagem->forceFill([
                    'erro_motivo' => 'Não foi possível baixar a mídia: '.$erro->getMessage(),
                ])->save();

                return;
            }

            throw $erro;
        }
    }

    public function tries(): int
    {
        return (int) config('mensageria.tentativas');
    }

    /** @return list<int> */
    public function backoff(): array
    {
        return (array) config('mensageria.backoff');
    }
}
