<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Desativação vale imediatamente: usuário com sessão viva e ativo=false é
 * barrado em toda request, não só no próximo login (parecer T-auth-06).
 */
class VerificaUsuarioAtivo
{
    public function handle(Request $request, Closure $next): Response
    {
        $usuario = $request->user();

        if ($usuario !== null && ! $usuario->ativo) {
            auth('web')->logout();
            $request->session()->invalidate();

            abort(401, 'Usuário desativado.');
        }

        return $next($request);
    }
}
