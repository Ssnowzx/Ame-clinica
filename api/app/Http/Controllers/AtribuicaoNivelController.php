<?php

namespace App\Http\Controllers;

use App\Http\Resources\AprovacaoDeAcessoResource;
use App\Http\Resources\UsuarioResource;
use App\Models\NivelPermissao;
use App\Models\Usuario;
use App\Support\Rbac\AncoraDaClinica;
use App\Support\Rbac\AprovacoesDeAcesso;
use App\Support\Rbac\MutacoesDeAcesso;
use App\Support\Rbac\SemEscalada;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AtribuicaoNivelController extends Controller
{
    public function __construct(
        private readonly MutacoesDeAcesso $mutacoes,
        private readonly AprovacoesDeAcesso $aprovacoes,
        private readonly SemEscalada $semEscalada,
        private readonly AncoraDaClinica $ancora,
    ) {}

    /**
     * Atribui exatamente UM nível ao usuário (design D3: syncRoles substitui o anterior).
     * Usuário ou nível inexistente responde 404 (parecer T-rbac-02).
     */
    public function atualizar(Request $request, int $usuarioId): JsonResponse
    {
        $dados = $request->validate([
            'nivel_permissao_id' => ['required', 'integer'],
        ]);

        $usuario = Usuario::findOrFail($usuarioId);

        $nivel = NivelPermissao::findOrFail($dados['nivel_permissao_id']);

        // ninguém promove nem rebaixa com acesso que não tem (change `trava-de-usuarios-e-niveis`)
        $regua = fn () => $this->semEscalada->assegurarAtribuicao($request->user(), $usuario, $nivel);

        // maker-checker (AP-13): com a dupla ligada, a atribuição vira pendência (202) — e quem não
        // passa na régua nem abre o pedido
        if ($this->aprovacoes->duplaLigada()) {
            $regua();
            $aprovacao = $this->aprovacoes->abrir('atribuir_nivel', $usuario->id, null, [
                'nivel_permissao_id' => $nivel->id,
            ], $request->user());

            return (new AprovacaoDeAcessoResource($aprovacao))->response()->setStatusCode(202);
        }

        // direto: a régua e a aplicação na MESMA transação ancorada (CR-TRV-07); a aplicação se
        // ancora de novo por dentro, o que no mesmo pedido é só um savepoint
        $this->ancora->serializado(function () use ($regua, $usuario, $nivel): void {
            $regua();
            $this->mutacoes->aplicarAtribuicao($usuario, $nivel);
        });

        return response()->json(new UsuarioResource($usuario));
    }
}
