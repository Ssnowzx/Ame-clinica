<?php

namespace App\Http\Controllers;

use App\Http\Requests\FaturamentoRequest;
use App\Models\Agendamento;
use App\Support\Financeiro\FaturamentoService;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Http\JsonResponse;

/**
 * Faturamento do atendimento consumido (§9/D3). Permissão: lancamentos.criar —
 * a rota mora no recurso da agenda, a permissão é do DINHEIRO (parecer §3).
 */
class FaturamentoController extends Controller
{
    public function __construct(
        private readonly FaturamentoService $servico,
        private readonly EscopoDoProfissional $escopos,
    ) {}

    public function store(FaturamentoRequest $request, int $agendamentoId): JsonResponse
    {
        // D11 (SEC-VP-13/P3): o escopado não fatura a sessão de outro profissional. O faturamento
        // pende do agendamento (eixo agenda) — posse pelo profissional_id do agendamento.
        $this->escopos->agenda(request()->user())
            ->assegurarPosse(Agendamento::whereKey($agendamentoId)->value('profissional_id'));

        $lancamento = $this->servico->faturar($agendamentoId, $request->validated());

        return response()->json([
            ...$lancamento->attributesToArray(),
            'liquido' => $lancamento->liquido,
        ], 201);
    }
}
