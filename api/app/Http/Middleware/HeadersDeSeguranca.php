<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Piso de headers de segurança em TODA resposta (change endurecimento-de-rede).
 *
 * Registrado GLOBAL (não só no grupo `api`): assim `/up`, `/sanctum/csrf-cookie` e as
 * respostas de erro fora do grupo também saem endurecidas. A CSP `default-src 'none'`
 * é segura numa API JSON (não serve HTML/scripts próprios) e não quebra o healthcheck.
 */
class HeadersDeSeguranca
{
    /**
     * A API é JSON: nenhuma origem de conteúdo é legítima, e a resposta nunca é
     * enquadrada, embutida como formulário ou usada como base de URL.
     */
    private const CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

    private const HSTS = 'max-age=31536000; includeSubDomains';

    public function handle(Request $request, Closure $next): Response
    {
        $resposta = $next($request);

        $resposta->headers->set('X-Content-Type-Options', 'nosniff');
        $resposta->headers->set('X-Frame-Options', 'DENY');
        $resposta->headers->set('Referrer-Policy', 'no-referrer');
        $resposta->headers->set('X-Permitted-Cross-Domain-Policies', 'none');
        $resposta->headers->set('Cross-Origin-Resource-Policy', 'same-origin');
        $resposta->headers->set('Content-Security-Policy', self::CSP);

        // TRAVA DUPLA: HSTS só sob deploy HTTPS habilitado E conexão segura.
        // isSecure() enxerga o TLS do proxy via X-Forwarded-Proto (trustProxies + PROTO).
        // Sem uma das duas, jamais emite — protege o dev em http://localhost.
        if (config('seguranca.hsts') === true && $request->isSecure()) {
            $resposta->headers->set('Strict-Transport-Security', self::HSTS);
        }

        return $resposta;
    }
}
