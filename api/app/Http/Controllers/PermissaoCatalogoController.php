<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Spatie\Permission\Models\Permission;

class PermissaoCatalogoController extends Controller
{
    /** Catálogo global "modulo.acao" — somente leitura via API (parecer T-rbac-04). */
    public function index(): JsonResponse
    {
        return response()->json([
            'permissoes' => Permission::orderBy('name')->pluck('name'),
        ]);
    }
}
