<?php

namespace App\Http\Controllers;

use App\Http\Requests\NivelPermissaoRequest;
use App\Http\Resources\AprovacaoDeAcessoResource;
use App\Http\Resources\NivelPermissaoResource;
use App\Models\NivelPermissao;
use App\Support\Http\ConcorrenciaOtimista;
use App\Support\Rbac\AncoraDaClinica;
use App\Support\Rbac\AprovacoesDeAcesso;
use App\Support\Rbac\MutacoesDeAcesso;
use App\Support\Rbac\SemEscalada;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;
use Spatie\Permission\PermissionRegistrar;

class NivelPermissaoController extends Controller
{
    public function __construct(
        private readonly MutacoesDeAcesso $mutacoes,
        private readonly AprovacoesDeAcesso $aprovacoes,
        private readonly AncoraDaClinica $ancora,
        private readonly SemEscalada $semEscalada,
    ) {}

    public function index(): AnonymousResourceCollection
    {
        $niveis = NivelPermissao::query()
            ->with('permissions')
            ->withCount('users')
            ->orderBy('name')
            ->get();

        return NivelPermissaoResource::collection($niveis);
    }

    public function store(NivelPermissaoRequest $request): JsonResponse
    {
        // criar é INERTE (SEC-SD-04: acesso efetivo só muda em atribuir ∪ editar) —
        // direto mesmo com aprovação dupla; a segregação vale desde o nascimento
        $nivel = $this->mutacoes->aplicarCriacaoDeNivel($request->validated());

        return (new NivelPermissaoResource($nivel->load('permissions')))
            ->response()
            ->setStatusCode(201);
    }

    public function show(int $id): NivelPermissaoResource
    {
        $nivel = NivelPermissao::query()
            ->with('permissions')
            ->withCount('users')
            ->findOrFail($id);

        return new NivelPermissaoResource($nivel);
    }

    public function update(NivelPermissaoRequest $request, int $id): NivelPermissaoResource|JsonResponse
    {
        $nivel = NivelPermissao::findOrFail($id);
        // versão antes das invariantes de domínio (guarda do último admin) — SEC-OCC-02
        ConcorrenciaOtimista::assegurar($nivel, $request);
        $dados = $request->validated();

        // maker-checker (AP-13): com a dupla ligada, a edição NÃO aplica — vira
        // pendência com a versão-base do nível (SEC-SD-02) e responde 202
        if ($this->aprovacoes->duplaLigada()) {
            $aprovacao = $this->aprovacoes->abrir('editar_nivel', $nivel->id, null, [
                'nome' => $dados['nome'],
                'permissoes' => $dados['permissoes'],
                'base_versao' => $nivel->updated_at?->format('Y-m-d H:i:s') ?? '',
            ], $request->user());

            return (new AprovacaoDeAcessoResource($aprovacao))->response()->setStatusCode(202);
        }

        // a régua de novo, na MESMA transação ancorada da aplicação (change `trava-de-usuarios-e-niveis`,
        // CR-TRV-07): a do FormRequest dá a ordem das respostas; esta, a atomicidade
        $this->ancora->serializado(function () use ($request, $nivel, $dados): void {
            $this->semEscalada->assegurarNivel($request->user(), $dados['permissoes'], $nivel);
            $this->mutacoes->aplicarEdicaoDeNivel($nivel, $dados);
        });

        return new NivelPermissaoResource($nivel->load('permissions'));
    }

    public function destroy(int $id): Response
    {
        $nivel = NivelPermissao::findOrFail($id);

        // ANCORADO (SD-N1): o "sem usuários = inerte" só é verdade sob a âncora — sem
        // ela, excluir em corrida com uma atribuição ancorada faria o cascade da pivot
        // apagar a atribuição recém-commitada (podendo zerar a administração)
        $this->ancora->serializado(function () use ($nivel): void {
            if ($nivel->users()->exists()) {
                throw ValidationException::withMessages([
                    'nivel_permissao' => 'Este nível está atribuído a usuários e não pode ser excluído.',
                ]);
            }

            $nivel->delete();
        });
        $this->invalidarCacheDePermissoes();

        return response()->noContent();
    }

    private function invalidarCacheDePermissoes(): void
    {
        // o Spatie guarda as permissões em cache (design, armadilha 3)
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
}
