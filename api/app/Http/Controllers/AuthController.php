<?php

namespace App\Http\Controllers;

use App\Http\Requests\LoginRequest;
use App\Http\Resources\UsuarioResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    /**
     * Mensagem única para email inexistente, senha errada e usuário inativo —
     * nunca revelar qual caso ocorreu (parecer T-auth-02, abuse case 4).
     */
    private const CREDENCIAIS_INVALIDAS = 'Credenciais inválidas.';

    public function login(LoginRequest $request): JsonResponse
    {
        $dados = $request->validated();

        // guard web EXPLÍCITO: o default do processo pode ter virado "sanctum"
        // (Auth::shouldUse em request autenticada anterior — testes/Octane)
        $autenticou = Auth::guard('web')->attempt([
            'email' => $dados['email'],
            'ativo' => true,
            'password' => $dados['senha'],
        ]);

        if (! $autenticou) {
            throw ValidationException::withMessages([
                'email' => self::CREDENCIAIS_INVALIDAS,
            ]);
        }

        // impede fixação de sessão: id novo após autenticar (parecer T-auth-03)
        $request->session()->regenerate();

        return response()->json(new UsuarioResource($request->user()));
    }

    public function logout(Request $request): Response
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->noContent();
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(new UsuarioResource($request->user()));
    }
}
