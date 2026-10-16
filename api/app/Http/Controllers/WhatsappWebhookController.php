<?php

namespace App\Http\Controllers;

use App\Support\Mensageria\ConexaoDoWebhook;
use App\Support\Mensageria\RecepcaoDeMensagens;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * A porta pública por onde a Meta entrega (change mensageria-whatsapp, D4).
 *
 * É a primeira rota do produto FORA do `auth:sanctum`, e a única. A autenticação dela é a
 * assinatura HMAC (middleware `AssinaturaDoWebhook`), não sessão.
 *
 * A resposta do `POST` é sempre 200 depois da assinatura válida — inclusive para evento que
 * não gera nada (status, notificação de conta). Devolver erro a evento legítimo faria a Meta
 * reenfileirar para sempre um payload que nunca vai produzir efeito.
 */
class WhatsappWebhookController extends Controller
{
    /**
     * Handshake de verificação: a Meta chama uma vez, na configuração, e espera o desafio
     * de volta em TEXTO PURO. JSON aqui reprova a verificação no painel dela.
     */
    public function verificar(Request $request): Response
    {
        $modo = (string) $request->query('hub_mode', '');
        $token = (string) $request->query('hub_verify_token', '');
        $desafio = (string) $request->query('hub_challenge', '');

        // o desafio é REFLETIDO na resposta: mesmo com `text/plain` + `nosniff` + CSP
        // `default-src 'none'`, reflexão sem forma validada no domínio da clínica é
        // superfície gratuita (SEC-WA-13). A Meta manda alfanumérico curto.
        $desafioValido = $desafio !== '' && strlen($desafio) <= 64 && ctype_alnum($desafio);

        if ($modo !== 'subscribe' || ! $desafioValido || ConexaoDoWebhook::porVerifyToken($token) === null) {
            abort(403);
        }

        return response($desafio, 200, ['Content-Type' => 'text/plain']);
    }

    public function receber(Request $request, RecepcaoDeMensagens $recepcao): Response
    {
        // a assinatura já foi conferida sobre os bytes crus pelo middleware; aqui o JSON
        // decodificado é seguro de usar
        $recepcao->processar((array) $request->json()->all(), $request->getContent());

        return response()->noContent(200);
    }
}
