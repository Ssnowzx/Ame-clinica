<?php

namespace App\Jobs;

use App\Models\Mensagem;
use App\Models\MensagemMidia;
use App\Models\MensagemTemplate;
use App\Support\Mensageria\ClienteWhatsApp;
use App\Support\Mensageria\ErroDeEnvio;
use App\Support\Mensageria\FabricaDeCliente;
use App\Support\Mensageria\GravadorDeMidia;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * Leva a mensagem até a Meta (change mensageria-whatsapp, D8).
 *
 * Assíncrono porque um "Enviar" não pode ficar preso na rede de um terceiro — e porque a
 * retentativa mora aqui, num lugar só, com backoff e teto (o cliente HTTP não retenta:
 * retentar nas duas camadas multiplica as tentativas e some com o controle do custo).
 *
 * A REGRA DA FALHA: erro permanente (número inválido, template inexistente, credencial
 * recusada) NÃO retenta — vira `falhou` com motivo legível NA THREAD. A mensagem nunca
 * desaparece por ter falhado: silêncio é o pior resultado possível para quem acha que
 * avisou a família.
 */
class EnviarMensagemJob implements ShouldQueue
{
    use Queueable;

    /** @param array<string, mixed> $carga */
    public function __construct(
        private readonly int $mensagemId,
        private readonly array $carga = [],
    ) {}

    public function handle(FabricaDeCliente $fabrica): void
    {
        $mensagem = Mensagem::query()->with('conversa')->find($this->mensagemId);

        // já enviada (retentativa depois de sucesso parcial) ou apagada: nada a fazer
        if ($mensagem === null || $mensagem->status !== 'pendente') {
            return;
        }

        $cliente = $fabrica->paraClinica();
        $destino = (string) $mensagem->conversa->telefone_e164;

        try {
            $waId = match (true) {
                $mensagem->template_nome !== null => $cliente->enviarTemplate(
                    $destino,
                    $mensagem->template_nome,
                    // o idioma sai do template GRAVADO; `pt_BR` chutado faz a Meta recusar
                    // um template que a pessoa vê aprovado na lista (achado do gate)
                    (string) ($this->carga['idioma'] ?? $mensagem->template_idioma ?? 'pt_BR'),
                    (array) ($this->carga['variaveis'] ?? $mensagem->variaveis_json ?? []),
                    // do modelo GRAVADO, como o idioma: o reenvio pela tela chega sem carga e não
                    // pode perder os botões (lembrete-com-botoes-de-resposta)
                    // nome E idioma: a unicidade do modelo é por idioma (CRB-05)
                    MensagemTemplate::query()
                        ->where('nome', $mensagem->template_nome)
                        ->where('idioma', $mensagem->template_idioma)
                        ->first()?->payloadsDosBotoes() ?? [],
                ),
                isset($this->carga['midia_id']) => $this->enviarMidia($cliente, $destino, $mensagem),
                default => $cliente->enviarTexto($destino, (string) $mensagem->corpo),
            };
        } catch (ErroDeEnvio $erro) {
            if ($erro->permanente) {
                $mensagem->avancarEntrega(function (Mensagem $alvo) use ($erro): void {
                    $alvo->status = 'falhou';
                    $alvo->erro_motivo = $erro->getMessage();
                });

                return;
            }

            // temporário: deixa o Job falhar para a fila retentar com backoff
            throw $erro;
        }

        $mensagem->avancarEntrega(function (Mensagem $alvo) use ($waId): void {
            $alvo->wa_message_id = $waId;
            $alvo->status = 'enviada';
            $alvo->enviada_em = now();
        });
    }

    /**
     * Última tentativa esgotada: a mensagem NÃO pode ficar `pendente` para sempre na tela.
     */
    public function failed(?Throwable $erro): void
    {
        Mensagem::query()->find($this->mensagemId)?->avancarEntrega(
            function (Mensagem $alvo) use ($erro): void {
                if ($alvo->status !== 'pendente') {
                    return;
                }

                $alvo->status = 'falhou';
                $alvo->erro_motivo = 'Não foi possível enviar depois de várias tentativas: '
                    .($erro?->getMessage() ?? 'canal indisponível').'.';
            }
        );
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

    private function enviarMidia(ClienteWhatsApp $cliente, string $destino, Mensagem $mensagem): string
    {
        $midia = MensagemMidia::query()->find($this->carga['midia_id']);
        $conteudo = $midia !== null ? app(GravadorDeMidia::class)->ler($midia) : null;

        if ($midia === null || $conteudo === null) {
            throw ErroDeEnvio::permanente('O arquivo desta mensagem não está mais disponível.');
        }

        // conteúdo EM CLARO: em repouso ele fica cifrado, e mandar o ciphertext para a Meta
        // entregaria à família um arquivo corrompido
        return $cliente->enviarMidia(
            $destino,
            $conteudo,
            basename((string) $midia->caminho),
            (string) $midia->mime,
            $mensagem->corpo,
        );
    }
}
