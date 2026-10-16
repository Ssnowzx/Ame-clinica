<?php

namespace App\Http\Controllers;

use App\Http\Requests\TarefaRequest;
use App\Models\Tarefa;
use App\Models\TarefaNotificacao;
use App\Models\Usuario;
use App\Support\Http\ConcorrenciaOtimista;
use App\Support\Tarefas\MuralDeTarefas;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

/**
 * Mural de tarefas da equipe (change kanban-da-equipe). Quadro colaborativo do
 * CLÍNICA: listagem plana (o front agrupa por coluna), posições sempre do
 * servidor (design D4). Sem dado de paciente aqui — LGPD por minimização.
 */
class TarefaController extends Controller
{
    public function __construct(private readonly MuralDeTarefas $mural) {}

    public function index(Request $request): JsonResponse
    {
        $filtros = $request->validate(['arquivadas' => ['sometimes', 'boolean']]);
        $arquivadas = (bool) ($filtros['arquivadas'] ?? false);

        $tarefas = $this->comContadores(Tarefa::query())
            ->when($arquivadas, fn ($q) => $q->whereNotNull('arquivada_em'))
            ->when(! $arquivadas, fn ($q) => $q->whereNull('arquivada_em'))
            ->orderBy('coluna')->orderBy('posicao')->orderBy('id')
            ->get();

        return response()->json($tarefas);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(
            $this->comContadores(Tarefa::query())->findOrFail($id)
        );
    }

    public function store(TarefaRequest $request): JsonResponse
    {
        $tarefa = $this->mural->criar(
            $request->safe()->except('responsaveis'),
            $request->validated('responsaveis') ?? []
        );

        return response()->json($this->recarregar($tarefa->id), 201);
    }

    public function update(TarefaRequest $request, int $id): JsonResponse
    {
        $tarefa = Tarefa::findOrFail($id);
        ConcorrenciaOtimista::assegurar($tarefa, $request);

        // null = chave ausente (preserva); [] LIMPA — correção consciente do
        // original, que ignorava a lista vazia em silêncio (spec tarefas)
        $responsaveis = $request->has('responsaveis')
            ? ($request->validated('responsaveis') ?? [])
            : null;

        $this->mural->atualizar($tarefa, $request->safe()->except('responsaveis'), $responsaveis);

        return response()->json($this->recarregar($id));
    }

    /** Lote {id, coluna, posicao}[] — atômico; id inexistente → 422 e nada muda. */
    public function ordem(Request $request): Response
    {
        $dados = $request->validate([
            'itens' => ['required', 'array', 'min:1', 'max:500'],
            'itens.*.id' => ['required', 'integer'],
            'itens.*.coluna' => ['required', 'string', Rule::in(Tarefa::COLUNAS)],
            // teto: sem ele, um inteiro válido acima do unsignedInteger da coluna
            // viraria 500 de SQL em vez de 422 (SEC-KB-03); o reindex reescreve
            // denso de qualquer forma
            'itens.*.posicao' => ['required', 'integer', 'min:0', 'max:1000000'],
        ]);

        $this->mural->reordenar($dados['itens']);

        return response()->noContent();
    }

    public function assumir(int $id): JsonResponse
    {
        $tarefa = Tarefa::findOrFail($id);
        /** @var Usuario $usuario */
        $usuario = Auth::user();
        $this->mural->assumir($tarefa, $usuario);

        return response()->json($this->recarregar($id));
    }

    public function arquivar(int $id): JsonResponse
    {
        $tarefa = Tarefa::findOrFail($id);
        $this->mural->arquivar($tarefa);

        return response()->json($tarefa->refresh());
    }

    public function desarquivar(int $id): JsonResponse
    {
        $tarefa = Tarefa::findOrFail($id);
        $this->mural->desarquivar($tarefa);

        return response()->json($this->recarregar($id));
    }

    public function destroy(int $id): Response
    {
        Tarefa::findOrFail($id)->delete(); // auditado; dependentes caem por FK

        return response()->noContent();
    }

    /**
     * Marca como lidos os eventos do PRÓPRIO usuário naquela tarefa — o gesto
     * natural de abrir o modal/deep-link (alertas-do-mural, design D5).
     * Idempotente: a segunda chamada atualiza zero linhas e segue 204.
     */
    public function lerEventos(int $id): Response
    {
        $tarefa = Tarefa::findOrFail($id);

        TarefaNotificacao::where('tarefa_id', $tarefa->id)
            ->where('usuario_id', Auth::id())
            ->whereNull('lida_em')
            ->update(['lida_em' => now()]);

        return response()->noContent();
    }

    /** "Marcar todas como lidas" do bloco do sino — só as do próprio usuário. */
    public function lerTodosEventos(): Response
    {
        TarefaNotificacao::where('usuario_id', Auth::id())
            ->whereNull('lida_em')
            ->update(['lida_em' => now()]);

        return response()->noContent();
    }

    /**
     * Participantes do mural: payload MÍNIMO (id, nome) dos usuários ATIVOS da
     * clínica — fonte da multi-seleção de responsáveis e do autocomplete de
     * menções. Leitura de GESTÃO continua atrás de `usuarios.ver` (spec).
     */
    public function usuarios(): JsonResponse
    {
        return response()->json(
            Usuario::where('ativo', true)
                ->orderBy('nome')
                ->get(['id', 'nome'])
        );
    }

    /** Eager loads + contadores que TODO payload de tarefa carrega (spec). */
    private function comContadores($query)
    {
        $usuarioId = Auth::id();

        return $query
            ->with('responsaveis:usuarios.id,nome')
            ->withCount([
                'comentarios',
                // não lidos POR USUÁRIO: posteriores ao carimbo de leitura dele
                // (sem carimbo, tudo conta) — design D7
                'comentarios as comentarios_nao_lidos_count' => function ($q) use ($usuarioId) {
                    $q->whereRaw(
                        'tarefa_comentarios.created_at > COALESCE((
                            SELECT l.lido_em FROM tarefa_comentario_leituras l
                            WHERE l.tarefa_id = tarefa_comentarios.tarefa_id
                              AND l.usuario_id = ?
                        ), ?)',
                        [$usuarioId, '1970-01-01 00:00:00']
                    );
                },
            ]);
    }

    private function recarregar(int $id): Tarefa
    {
        return $this->comContadores(Tarefa::query())->findOrFail($id);
    }
}
