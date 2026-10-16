<?php

namespace App\Console\Commands;

use App\Models\Conversa;
use App\Models\Mensagem;
use App\Models\WebhookEvento;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Expurgo da retenção (change mensageria-whatsapp, D10).
 *
 * Apaga o CONTEÚDO (corpo e arquivo) das mensagens além de `mensagens.retencao_dias`,
 * PRESERVANDO a linha do tempo: data, direção, tipo e status ficam. O histórico operacional
 * ("houve contato em 12/03, respondido pela Ana") sobrevive; o teor, não.
 *
 * Guardar conversa de menor indefinidamente é acúmulo sem finalidade — o oposto da
 * minimização que a §12 exige. `expurgada_em` distingue "mensagem sem texto" de "texto
 * apagado": sem ela, a thread antiga pareceria corrompida em vez de minimizada.
 */
class ExpurgarMensagens extends Command
{
    protected $signature = 'mensagens:expurgar';

    protected $description = 'Apaga o conteúdo das mensagens além da retenção configurada';

    public function handle(ConfiguracaoService $configuracoes): int
    {
        $disco = Storage::disk((string) config('mensageria.disco_midia'));
        $total = 0;

        $corte = now()->subDays((int) $configuracoes->get('mensagens.retencao_dias'));

        Mensagem::query()
            ->whereNull('expurgada_em')
            ->where('created_at', '<', $corte)
            ->with('midia')
            ->chunkById(500, function ($mensagens) use ($disco, &$total): void {
                foreach ($mensagens as $mensagem) {
                    if ($mensagem->midia?->caminho !== null) {
                        $disco->delete($mensagem->midia->caminho);
                        $mensagem->midia->forceFill(['caminho' => null, 'sha256' => null])->save();
                    }

                    $mensagem->avancarEntrega(function (Mensagem $alvo): void {
                        $alvo->corpo = null;
                        // as variáveis do modelo são conteúdo: levam o nome da criança, o
                        // horário e o profissional (SEC-AV-17) — a retenção alcança elas também
                        $alvo->variaveis_json = null;
                        // as coordenadas da localização são endereço de família (conversa-legivel)
                        $alvo->detalhes_json = null;
                        $alvo->expurgada_em = now();
                    });

                    $total++;
                }
            });

        // o rastro de eventos é DIAGNÓSTICO, não histórico: vida curta própria
        WebhookEvento::query()
            ->where('recebido_em', '<', now()->subDays((int) config('mensageria.retencao_eventos_dias')))
            ->delete();

        // A CONVERSA também é dado pessoal: `telefone_e164` e `nome_perfil` identificam
        // diretamente a família de um menor. Minimizar só as mensagens deixaria o
        // identificador vivo para sempre — acúmulo sem finalidade, que é o oposto da
        // §12 (SEC-WA-18). Conversa cujo conteúdo TODO já foi expurgado perde o nome de
        // perfil e o vínculo; o telefone permanece porque é a CHAVE da conversa (sem
        // ele, uma mensagem futura da mesma família criaria uma linha órfã ao lado).
        //
        // O vínculo com a criança também é identificador (change avisar-no-whatsapp-abre-a-conversa,
        // gate r1, SEC-WA-02): a conversa só de SAÍDA (a família nunca respondeu) não tem nome de
        // perfil, e antes escapava com o vínculo para sempre.
        $anonimizadas = Conversa::query()
            ->whereNotNull('ultima_mensagem_em')
            ->where('ultima_mensagem_em', '<', $corte)
            ->where(fn ($q) => $q->whereNotNull('nome_perfil')->orWhereNotNull('paciente_id'))
            ->whereDoesntHave('mensagens', fn ($q) => $q->whereNull('expurgada_em'))
            ->update(['nome_perfil' => null, 'paciente_id' => null]);

        // A conversa que NUNCA teve mensagem (aberta pelo "Avisar no WhatsApp" e não usada) só
        // guarda "esta criança, este telefone": além da retenção, sai. Ficam a que pediu para não
        // receber lembretes (apagá-la apagaria o pedido da família) e a que a recepção mexeu dentro da
        // retenção — vinculou ou arquivou (gate r2, SEC-WA-04). O `whereDoesntHave` é a trava do
        // histórico: `mensagens.conversa_id` apaga em cascata, e sem ele o expurgo levaria as
        // mensagens junto (gate r2, CR-WA-10).
        $vazias = Conversa::query()
            ->where('created_at', '<', $corte)
            ->where('updated_at', '<', $corte)
            ->where('sem_lembretes', false)
            ->whereDoesntHave('mensagens')
            ->delete();

        $this->info("Expurgo: {$total} mensagem(ns) minimizada(s), {$anonimizadas} conversa(s) anonimizada(s), {$vazias} conversa(s) vazia(s) apagada(s).");

        return self::SUCCESS;
    }
}
