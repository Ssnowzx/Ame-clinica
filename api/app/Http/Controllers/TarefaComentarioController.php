<?php

namespace App\Http\Controllers;

use App\Http\Requests\TarefaComentarioRequest;
use App\Models\Tarefa;
use App\Models\TarefaComentario;
use App\Models\TarefaComentarioLeitura;
use App\Models\Usuario;
use App\Support\Http\ConcorrenciaOtimista;
use App\Support\Tarefas\EventosDoMural;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

/**
 * Comentários do mural. Editar é SÓ do autor (403 mesmo com tarefas.excluir —
 * reescrever fala alheia é falsificação); excluir é do autor ou moderação
 * (`tarefas.excluir`). GET carimba a leitura do usuário (design D7) — é o efeito
 * que faz "não lido" funcionar sem clique extra (trade-off aceito no design).
 */
class TarefaComentarioController extends Controller
{
    public function __construct(private readonly EventosDoMural $eventos) {}

    public function index(int $tarefaId): JsonResponse
    {
        $tarefa = Tarefa::findOrFail($tarefaId);

        $comentarios = $tarefa->comentarios()
            ->with(['autor:id,nome', 'mencionados:usuarios.id,nome'])
            ->orderBy('created_at')->orderBy('id')
            ->get();

        $this->carimbarLeitura($tarefa->id);

        return response()->json($comentarios);
    }

    public function store(TarefaComentarioRequest $request, int $tarefaId): JsonResponse
    {
        $tarefa = Tarefa::findOrFail($tarefaId);

        // transação: comentário, menções e eventos existem juntos ou nenhum
        // existe (alertas-do-mural, design D2)
        $comentario = DB::transaction(function () use ($request, $tarefa): TarefaComentario {
            $comentario = new TarefaComentario(['corpo' => $request->validated('corpo')]);
            $comentario->tarefa_id = $tarefa->id;
            $comentario->autor_id = Auth::id(); // server-set
            $comentario->save();

            $mencionados = $this->sincronizarMencoes($comentario, $request->validated('mencoes') ?? []);

            // mencionado fica de fora do fan-out — a menção já conta no sino
            $this->eventos->comentario($tarefa, $comentario, $mencionados);

            return $comentario;
        });

        // quem escreveu já leu até aqui — sem isto o próprio comentário
        // contaria como "não lido" para o autor
        $this->carimbarLeitura($tarefa->id);

        return response()->json($comentario->load(['autor:id,nome', 'mencionados:usuarios.id,nome']), 201);
    }

    public function update(TarefaComentarioRequest $request, int $id): JsonResponse
    {
        $comentario = TarefaComentario::findOrFail($id);
        if ($comentario->autor_id !== Auth::id()) {
            abort(403, 'Só o autor pode editar o próprio comentário.');
        }
        ConcorrenciaOtimista::assegurar($comentario, $request);

        $comentario->update(['corpo' => $request->validated('corpo')]);
        if ($request->has('mencoes')) {
            $this->sincronizarMencoes($comentario, $request->validated('mencoes') ?? []);
        }

        return response()->json($comentario->refresh()->load(['autor:id,nome', 'mencionados:usuarios.id,nome']));
    }

    public function destroy(int $id): Response
    {
        $comentario = TarefaComentario::findOrFail($id);
        $ehAutor = $comentario->autor_id === Auth::id();
        if (! $ehAutor && ! Auth::user()->can('tarefas.excluir')) {
            abort(403, 'Excluir comentário de terceiro exige a permissão de exclusão do mural.');
        }

        $comentario->delete(); // auditado

        return response()->noContent();
    }

    /**
     * Menções REVALIDADAS na gravação: ativo, sem auto-menção; id
     * estranho é descartado em silêncio (spec tarefas).
     *
     * @param  list<int>  $ids
     * @return list<int> os ids efetivamente mencionados
     */
    private function sincronizarMencoes(TarefaComentario $comentario, array $ids): array
    {
        $validos = Usuario::where('ativo', true)
            ->whereIn('id', collect($ids)->unique())
            ->where('id', '!=', $comentario->autor_id)
            ->pluck('id');

        $comentario->mencionados()->sync($validos->all());

        return $validos->all();
    }

    private function carimbarLeitura(int $tarefaId): void
    {
        // upsert atômico no banco: dois GETs simultâneos do MESMO usuário (duas
        // abas) não podem virar 500 de chave duplicada (CR-KB-09)
        TarefaComentarioLeitura::upsert(
            [[
                'tarefa_id' => $tarefaId,
                'usuario_id' => Auth::id(),
                'lido_em' => now(),
            ]],
            ['tarefa_id', 'usuario_id'],
            ['lido_em']
        );
    }
}
