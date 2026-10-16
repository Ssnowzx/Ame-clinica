<?php

namespace App\Http\Controllers;

use App\Models\Cbos;
use App\Support\Auditoria\RegistroDeAuditoria;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Catálogo GLOBAL de CBOS (design D2): leitura autenticada; APENAS criação
 * (sem PUT/DELETE — parecer T-cb-01: mutação de registro global compartilhado
 * é tampering sem dono).
 */
class CbosController extends Controller
{
    public function index(): JsonResponse
    {
        // array nu, como toda lista da API (consistência apontada no gate r1)
        return response()->json(Cbos::orderBy('codigo')->get(['id', 'codigo', 'nome']));
    }

    public function store(Request $request): JsonResponse
    {
        $dados = $request->validate([
            'codigo' => ['required', 'digits:6', 'unique:cbos,codigo'],
            'nome' => ['required', 'string', 'max:120'],
        ]);

        $cbos = Cbos::create($dados);

        // catálogo global não usa Auditavel; auditar a criação com o autor (T-cb-02)
        RegistroDeAuditoria::registrar($cbos, 'criou', ['depois' => $dados]);

        return response()->json($cbos->only(['id', 'codigo', 'nome']), 201);
    }
}
