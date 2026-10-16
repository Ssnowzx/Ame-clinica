<?php

namespace App\Http\Middleware;

use App\Support\Mensageria\ConexaoDoWebhook;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * A autenticação da rota pública de webhook (change mensageria-whatsapp, D4).
 *
 * Esta rota não tem sessão: quem chama é a Meta. A credencial dela é a **assinatura**
 * `X-Hub-Signature-256`, um HMAC do corpo com o App Secret da conexão.
 *
 * DOIS DETALHES QUE FAZEM A DIFERENÇA ENTRE FUNCIONAR E NÃO FUNCIONAR:
 *
 * 1. A assinatura é dos **BYTES CRUS RECEBIDOS**. Conferi-la sobre o JSON re-serializado
 *    reprova entrega legítima — a ordem das chaves e o escape de unicode mudam no
 *    `json_encode`, e o HMAC muda junto. É o erro clássico desta integração.
 * 2. `hash_equals`, nunca `===`: comparação de string sai no primeiro byte diferente, e o
 *    tempo de resposta vira um oráculo para forjar a assinatura byte a byte.
 *
 * A resposta a QUALQUER falha é a mesma 403 — número desconhecido e assinatura inválida
 * são indistinguíveis. Diferenciá-las transformaria o webhook num oráculo de existência:
 * bastaria variar o Phone Number ID com lixo não assinado para mapear quais clínicas este
 * sistema atende.
 *
 * Nada é persistido antes daqui.
 */
class AssinaturaDoWebhook
{
    public const ATRIBUTO_CONEXAO = 'conexao_whatsapp';

    /**
     * Teto do corpo. O payload real da Meta é da ordem de dezenas de KB; o throttle limita
     * REQUISIÇÕES, não bytes, e sem teto o `json_decode` acontece antes de qualquer
     * autenticação (SEC-WA-05).
     */
    private const CORPO_MAXIMO_BYTES = 262144;

    public function handle(Request $request, Closure $next): Response
    {
        $corpoCru = $request->getContent();

        if (strlen($corpoCru) > self::CORPO_MAXIMO_BYTES) {
            $this->recusar($request, 'corpo_grande_demais', strlen($corpoCru));
            abort(413);
        }

        if (! $request->isJson()) {
            $this->recusar($request, 'content_type_invalido', strlen($corpoCru));
            abort(403);
        }

        $conexao = ConexaoDoWebhook::porPayload($corpoCru);

        if ($conexao === null) {
            $this->recusar($request, 'numero_desconhecido', strlen($corpoCru));
            abort(403);
        }

        $recebida = (string) $request->header('X-Hub-Signature-256', '');
        $esperada = 'sha256='.hash_hmac('sha256', $corpoCru, (string) $conexao->app_secret);

        if ($recebida === '' || ! hash_equals($esperada, $recebida)) {
            $this->recusar($request, $recebida === '' ? 'sem_assinatura' : 'assinatura_invalida', strlen($corpoCru));
            abort(403);
        }

        // a partir daqui a cadeia inteira sabe de qual conexão é o evento
        $request->attributes->set(self::ATRIBUTO_CONEXAO, $conexao);

        return $next($request);
    }

    /**
     * A recusa deixa rastro (SEC-WA-04) — a própria spec manda registrar a ocorrência.
     *
     * Sem isto a rota é CEGA nos dois sentidos: tentativa de forja não aparece em lugar
     * nenhum, e — o caso operacional — um proxy que reescreva o corpo derruba 100% das
     * entregas legítimas em silêncio (a assinatura é dos bytes crus), e a clínica só
     * descobre pelo painel da Meta, se olhar.
     *
     * Whitelist ESTRITA: nunca o corpo (traz o texto da família e o telefone), nunca a
     * assinatura recebida, e o `phone_number_id` HASHEADO — serve para correlacionar
     * entregas sem virar registro de qual clínica atende qual número.
     */
    private function recusar(Request $request, string $motivo, int $bytes): void
    {
        Log::channel('seguranca')->warning('webhook_whatsapp.recusado', [
            'motivo' => $motivo,
            'ip' => $request->ip(),
            'bytes' => $bytes,
            'numero' => substr(hash('sha256', (string) $request->header('X-Hub-Phone-Number-Id', '')), 0, 12),
        ]);
    }
}
