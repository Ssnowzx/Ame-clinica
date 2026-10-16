<?php

namespace App\Http\Controllers;

use App\Http\Requests\UsuarioGestaoRequest;
use App\Http\Resources\UsuarioResource;
use App\Models\Usuario;
use App\Support\Http\ConcorrenciaOtimista;
use App\Support\Rbac\AncoraDaClinica;
use App\Support\Rbac\GuardaUltimoAdmin;
use App\Support\Rbac\SemEscalada;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\ValidationException;

/**
 * Gestão de usuários da clínica (design D6): sem DELETE — desativação preserva
 * auditoria/autoria (§12).
 */
class UsuarioController extends Controller
{
    public function __construct(
        private readonly GuardaUltimoAdmin $guardaUltimoAdmin,
        private readonly AncoraDaClinica $ancora,
        private readonly SemEscalada $semEscalada,
    ) {}

    public function index(): AnonymousResourceCollection
    {
        return UsuarioResource::collection(
            Usuario::orderBy('nome')->get()
        );
    }

    public function store(UsuarioGestaoRequest $request): JsonResponse
    {
        $dados = $request->validated();

        $usuario = new Usuario([
            'nome' => $dados['nome'],
            'email' => $dados['email'],
            'senha_hash' => $dados['senha'], // cast hashed criptografa ao atribuir
            'acesso_mobile' => $dados['acesso_mobile'] ?? false,
            'ativo' => $dados['ativo'] ?? true,
            'profissional_id' => $dados['profissional_id'] ?? null,
        ]);
        $usuario->save();

        return response()->json(new UsuarioResource($usuario), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(new UsuarioResource(Usuario::findOrFail($id)));
    }

    public function update(UsuarioGestaoRequest $request, int $id): JsonResponse
    {
        $usuario = Usuario::findOrFail($id);
        ConcorrenciaOtimista::assegurar($usuario, $request);
        $dados = $request->validated();

        // auto-desativação trancaria a clínica (parecer T-usr-03, abuse case 2).
        // boolean() normaliza 0/"0"/false — comparação estrita deixava 0 passar (gate r1)
        $desativando = array_key_exists('ativo', $dados) && ! $request->boolean('ativo');
        if ($desativando && $usuario->id === $request->user()->id) {
            throw ValidationException::withMessages([
                'ativo' => 'Você não pode desativar o próprio usuário.',
            ]);
        }

        if (array_key_exists('senha', $dados)) {
            $dados['senha_hash'] = $dados['senha'];
            unset($dados['senha']);
        }

        // TODA edição sob a âncora (SEC-SD-01), com a régua do acesso de novo DENTRO dela (change
        // `trava-de-usuarios-e-niveis`, CR-TRV-07): a do FormRequest dá a ordem das respostas; esta,
        // a atomicidade — o alvo promovido, ou quem age rebaixado, entre a régua e a gravação
        $this->ancora->serializado(function () use ($request, $usuario, $dados, $desativando): void {
            $this->semEscalada->assegurarEdicaoDeUsuario($request->user(), $usuario, $dados['profissional_id'] ?? null, $request->only(['senha', 'email']));
            if ($desativando) {
                // desativar OUTRO usuário não pode remover o último administrador ativo (gatilho ADM,
                // SEC-ADM-01). Por HTTP, a régua chega antes: só outro administrador desativa um
                // administrador. A guarda fica como defesa em profundidade — ela não depende de a
                // auto-desativação seguir barrada nem de a permissão só vir pelo nível (CR-TRV-03)
                $this->guardaUltimoAdmin->garantirDesativacao($usuario);
            }
            $usuario->update($dados);
        });

        $usuario->unsetRelation('roles')->unsetRelation('permissions');

        return response()->json(new UsuarioResource($usuario));
    }
}
