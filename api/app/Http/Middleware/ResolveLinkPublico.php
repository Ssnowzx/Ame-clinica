<?php

namespace App\Http\Middleware;

use App\Support\CadastroOnline\LinkPublico;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolve a clínica pelo endereço público **antes de qualquer validação** (change
 * `cadastro-online-do-paciente`).
 *
 * Ser middleware não é organização: é a única forma de garantir a ordem que a spec exige
 * (`SEC-CO-17` — endereço → link ligado → régua → guarda do menor → grava).
 *
 * O Laravel resolve a `FormRequest` do método **antes** de executar o corpo dele. Com a resolução
 * dentro do controller, a validação rodaria primeiro e:
 *
 * - e, o que importa, **um endereço desligado responderia 422 de campo** para um payload torto. O
 *   422 contaria "esta clínica existe, e a régua dela exige exatamente estes campos" — que é
 *   precisamente o oráculo que a resposta cega existe para fechar. A recusa do endereço tem de
 *   vir antes de o payload ser sequer olhado.
 *
 * Numa rota pública não há sessão: é este middleware que confere que o endereço é o da clínica.
 */
class ResolveLinkPublico
{
    public function __construct(private readonly LinkPublico $link) {}

    public function handle(Request $request, Closure $next): Response
    {
        $clinica = $this->link->resolver($request->route('slug'));

        // o controller lê daqui em vez de resolver de novo: uma segunda resolução seria uma
        // segunda consulta e uma segunda chance de as duas divergirem
        $request->attributes->set('clinica_do_link', $clinica);

        return $next($request);
    }
}
