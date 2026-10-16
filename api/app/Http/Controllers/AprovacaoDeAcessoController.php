<?php

namespace App\Http\Controllers;

use App\Http\Resources\AprovacaoDeAcessoResource;
use App\Models\AprovacaoDeAcesso;
use App\Models\NivelPermissao;
use App\Models\Usuario;
use App\Support\Rbac\AprovacoesDeAcesso;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * Pendências do maker-checker (AP-13). Ordem das defesas (SEC-SD-03): a permissão
 * é do middleware (403 antes de tudo); o `{id}` inexistente responde 404;
 * status/maker≠checker/revalidação vivem no serviço, DENTRO da
 * transação serializada pela âncora. Decidir pendência existente independe do
 * valor atual da flag (o gate é da criação).
 */
class AprovacaoDeAcessoController extends Controller
{
    public function __construct(private readonly AprovacoesDeAcesso $aprovacoes) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $filtros = $request->validate([
            'status' => ['sometimes', Rule::in(AprovacaoDeAcesso::STATUS)],
        ]);

        $pendencias = AprovacaoDeAcesso::query()
            ->with(['solicitante:id,nome', 'decididoPor:id,nome'])
            ->when($filtros['status'] ?? null, fn ($consulta, $status) => $consulta->where('status', $status))
            ->orderByRaw("status = 'pendente' desc")
            ->orderByDesc('id')
            ->limit(100)
            ->get();

        // rótulos em LOTE (CR M1): resolver por linha na Resource seria N+1 na listagem
        $idsDeNiveis = $pendencias
            ->flatMap(fn (AprovacaoDeAcesso $pendencia): array => match ($pendencia->tipo) {
                'editar_nivel' => [(int) $pendencia->alvo_id],
                'atribuir_nivel' => [(int) ($pendencia->payload_json['nivel_permissao_id'] ?? 0)],
                default => [],
            })
            ->filter()
            ->unique();
        $nomesDeNiveis = NivelPermissao::whereIn('id', $idsDeNiveis)->pluck('name', 'id');
        $nomesDeUsuarios = Usuario::whereIn('id', $pendencias->where('tipo', 'atribuir_nivel')->pluck('alvo_id')->unique())
            ->pluck('nome', 'id');

        $pendencias->each(function (AprovacaoDeAcesso $pendencia) use ($nomesDeNiveis, $nomesDeUsuarios): void {
            $pendencia->setAttribute('rotulo_do_alvo', match ($pendencia->tipo) {
                'editar_nivel' => $nomesDeNiveis[$pendencia->alvo_id] ?? null,
                'atribuir_nivel' => $nomesDeUsuarios[$pendencia->alvo_id] ?? null,
                default => $pendencia->alvo_chave,
            });
            if ($pendencia->tipo === 'atribuir_nivel') {
                $pendencia->setAttribute(
                    'nivel_proposto_nome',
                    $nomesDeNiveis[(int) ($pendencia->payload_json['nivel_permissao_id'] ?? 0)] ?? null,
                );
            }
        });

        // quem lê pode aprovar? Em LOTE, como os rótulos (CR-TRV-18)
        $aprova = $this->aprovacoes->quaisODecisorAprova($pendencias, $request->user());
        $pendencias->each(fn (AprovacaoDeAcesso $pendencia) => $pendencia->setAttribute('voce_pode_aprovar', $aprova[$pendencia->id] ?? false));

        return AprovacaoDeAcessoResource::collection($pendencias);
    }

    public function aprovar(Request $request, int $id): JsonResponse
    {
        $aprovacao = $this->aprovacoes->aprovar($this->resolver($id), $request->user());

        return response()->json(new AprovacaoDeAcessoResource($aprovacao));
    }

    public function recusar(Request $request, int $id): JsonResponse
    {
        $aprovacao = $this->aprovacoes->recusar($this->resolver($id), $request->user());

        return response()->json(new AprovacaoDeAcessoResource($aprovacao));
    }

    public function cancelar(Request $request, int $id): JsonResponse
    {
        $aprovacao = $this->aprovacoes->cancelar($this->resolver($id), $request->user());

        return response()->json(new AprovacaoDeAcessoResource($aprovacao));
    }

    private function resolver(int $id): AprovacaoDeAcesso
    {
        return AprovacaoDeAcesso::query()->findOrFail($id);
    }
}
