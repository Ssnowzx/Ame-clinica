<?php

namespace App\Support\Tarefas;

use App\Models\Tarefa;
use App\Models\Usuario;
use App\Support\Auditoria\RegistroDeAuditoria;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

/**
 * Regras do quadro (change kanban-da-equipe, design D2/D4):
 *
 * - POSIÇÃO é densa por coluna e SEMPRE do servidor. Tarefa nova/movida entra no
 *   FIM da coluna (correção consciente do original, onde toda tarefa nascia
 *   empatada em 0).
 * - Reindexação de `posicao` roda por query builder DE PROPÓSITO: posição é
 *   LAYOUT do quadro, não dado auditável — via Eloquent, um arrasto geraria uma
 *   linha de trilha por cartão reindexado (ruído que enterra o que importa) e
 *   tocaria `updated_at` de cartões alheios, invalidando o If-Match de quem
 *   está com o modal aberto. Mudança de COLUNA, que é dado (carimba
 *   `concluida_em`), vai por Eloquent e cai na trilha do Auditavel.
 * - Sync de responsáveis é pivot (não dispara evento de model) → auditado
 *   EXPLICITAMENTE aqui, no molde de MutacoesDeAcesso (T-rbac-01).
 */
class MuralDeTarefas
{
    public function __construct(private EventosDoMural $eventos) {}

    /** @param  list<int>  $responsaveis */
    public function criar(array $dados, array $responsaveis): Tarefa
    {
        return DB::transaction(function () use ($dados, $responsaveis): Tarefa {
            $tarefa = new Tarefa($dados);
            $tarefa->coluna = $dados['coluna'] ?? 'a_fazer';
            $tarefa->posicao = $this->fimDaColuna($tarefa->coluna);
            $tarefa->criado_por = Auth::id();
            if ($tarefa->coluna === 'concluida') {
                $tarefa->concluida_em = now();
            }
            $tarefa->save();

            if ($responsaveis !== []) {
                $this->sincronizarResponsaveis($tarefa, $responsaveis);
            }

            return $tarefa;
        });
    }

    /** @param  list<int>|null  $responsaveis  null = chave ausente (preserva); [] LIMPA */
    public function atualizar(Tarefa $tarefa, array $dados, ?array $responsaveis): Tarefa
    {
        // arquivada não está no quadro: editar (inclusive coluna) quebraria o
        // invariante "arquivada ⇒ concluida" (CR-KB-07) — desarquive antes
        if ($tarefa->arquivada_em !== null) {
            abort(422, 'Tarefa arquivada não se edita. Desarquive primeiro.');
        }

        return DB::transaction(function () use ($tarefa, $dados, $responsaveis): Tarefa {
            $colunaAnterior = $tarefa->coluna;
            if (array_key_exists('coluna', $dados) && $dados['coluna'] !== $tarefa->coluna) {
                $this->carimbarConclusao($tarefa, $dados['coluna']);
                $tarefa->posicao = $this->fimDaColuna($dados['coluna']);
            }
            $tarefa->fill($dados);
            $tarefa->save();

            if ($tarefa->coluna !== $colunaAnterior) {
                // a coluna de ORIGEM também fica densa (D4 — CR-KB-11)
                $this->reindexar($colunaAnterior);
                // avisa quem estava envolvido ANTES do sync de responsáveis —
                // quem entra agora recebe `atribuicao` (alertas-do-mural)
                $this->eventos->mudancaDeColuna($tarefa, $colunaAnterior, $tarefa->coluna);
            }

            if ($responsaveis !== null) {
                $this->sincronizarResponsaveis($tarefa, $responsaveis);
            }

            return $tarefa;
        });
    }

    /**
     * Reordenação em lote: TODOS os ids ou nada muda (422 atômico —
     * correção do original, que ignorava id estranho em silêncio).
     *
     * @param  list<array{id: int, coluna: string, posicao: int}>  $itens
     */
    public function reordenar(array $itens): void
    {
        DB::transaction(function () use ($itens): void {
            $ids = collect($itens)->pluck('id')->unique();
            $tarefas = Tarefa::whereIn('id', $ids)->lockForUpdate()->get()->keyBy('id');

            if ($tarefas->count() !== $ids->count()) {
                abort(422, 'A reordenação inclui tarefa inexistente. Recarregue o quadro.');
            }

            $colunasAfetadas = [];
            foreach ($itens as $item) {
                /** @var Tarefa $tarefa */
                $tarefa = $tarefas[$item['id']];
                if ($tarefa->arquivada_em !== null) {
                    abort(422, 'Tarefa arquivada não participa do quadro.');
                }

                $colunasAfetadas[$item['coluna']] = true;
                $colunasAfetadas[$tarefa->coluna] = true;

                if ($item['coluna'] !== $tarefa->coluna) {
                    // mudança de DADO: Eloquent → Auditavel registra coluna antes/depois
                    $colunaAnterior = $tarefa->coluna;
                    $this->carimbarConclusao($tarefa, $item['coluna']);
                    $tarefa->coluna = $item['coluna'];
                    $tarefa->posicao = $item['posicao'];
                    $tarefa->save();
                    // o arrastar do quadro passa por AQUI, não pelo PATCH — sem
                    // esta linha o caminho principal moveria em silêncio
                    // (alertas-do-mural); mesma coluna não é evento (design D3)
                    $this->eventos->mudancaDeColuna($tarefa, $colunaAnterior, $tarefa->coluna);
                } elseif ($item['posicao'] !== $tarefa->posicao) {
                    // LAYOUT puro: sem trilha e sem tocar updated_at (ver docblock)
                    DB::table('tarefas')->where('id', $tarefa->id)
                        ->update(['posicao' => $item['posicao']]);
                }
            }

            foreach (array_keys($colunasAfetadas) as $coluna) {
                $this->reindexar($coluna);
            }
        });
    }

    /**
     * Assumir é pegar uma DEMANDA ABERTA — não juntar-se a tarefa de colega
     * (quem quer se juntar edita os responsáveis, sob `tarefas.editar`). A
     * guarda roda sob lock da linha: dois "Assumir" simultâneos não viram dois
     * donos em silêncio (SEC-KB-01 / CR-KB-02).
     */
    public function assumir(Tarefa $tarefa, Usuario $usuario): void
    {
        DB::transaction(function () use ($tarefa, $usuario): void {
            $travada = Tarefa::whereKey($tarefa->id)->lockForUpdate()->firstOrFail();

            if ($travada->arquivada_em !== null) {
                abort(422, 'Tarefa arquivada não participa do quadro.');
            }

            $atuais = $travada->responsaveis()->pluck('usuarios.id')->all();
            if (in_array($usuario->id, $atuais, true)) {
                return; // idempotente (spec tarefas)
            }
            if ($atuais !== []) {
                abort(422, 'Esta demanda já foi assumida. Edite os responsáveis para se juntar.');
            }

            $travada->responsaveis()->syncWithoutDetaching([$usuario->id]);
            // a versão If-Match passa a COBRIR a atribuição (CR-KB-02): quem
            // leu antes do assumir leva 409 ao salvar por cima
            $travada->touch();

            RegistroDeAuditoria::registrar($travada, 'atualizou', [
                'antes' => ['responsaveis' => []],
                'depois' => ['responsaveis' => [$usuario->id]],
            ]);

            // o criador fica sabendo que a demanda dele ganhou dono; se ele
            // mesmo assumiu, o dedup do fan-out silencia (alertas-do-mural)
            $this->eventos->demandaAssumida($travada);
        });
    }

    public function arquivar(Tarefa $tarefa): void
    {
        if ($tarefa->coluna !== 'concluida') {
            abort(422, 'Apenas tarefa concluída pode ser arquivada.');
        }

        $tarefa->arquivada_em = now();
        $tarefa->save(); // auditado
    }

    public function desarquivar(Tarefa $tarefa): void
    {
        if ($tarefa->arquivada_em === null) {
            abort(422, 'Esta tarefa não está arquivada.');
        }

        // transação: fora dela o lockForUpdate do fimDaColuna é no-op em
        // autocommit e dois desarquivar concorrentes empatariam posição (CR-KB-06)
        DB::transaction(function () use ($tarefa): void {
            $tarefa->arquivada_em = null;
            $tarefa->posicao = $this->fimDaColuna('concluida');
            $tarefa->save(); // auditado; volta ao fim de "concluida" (spec)
        });
    }

    /** @param  list<int>  $ids */
    public function sincronizarResponsaveis(Tarefa $tarefa, array $ids): void
    {
        $antes = $tarefa->responsaveis()->pluck('usuarios.id')->sort()->values()->all();
        $depois = collect($ids)->unique()->sort()->values()->all();
        if ($antes === $depois) {
            return;
        }

        $tarefa->responsaveis()->sync($depois);
        // sync de pivot NÃO toca tarefas.updated_at — sem o touch, a atribuição
        // ficaria FORA da versão If-Match e uma edição concorrente a apagaria em
        // silêncio passando limpa pela ConcorrenciaOtimista (CR-KB-02)
        $tarefa->touch();

        // pivot não dispara evento de model — trilha explícita (design D2)
        RegistroDeAuditoria::registrar($tarefa, 'atualizou', [
            'antes' => ['responsaveis' => $antes],
            'depois' => ['responsaveis' => $depois],
        ]);

        // só quem ENTROU é avisado; quem saiu não recebe nada e o autor da
        // ação é silenciado pelo dedup (alertas-do-mural, design D3)
        $adicionados = array_values(array_diff($depois, $antes));
        if ($adicionados !== []) {
            $this->eventos->atribuicao($tarefa, $adicionados);
        }
    }

    private function carimbarConclusao(Tarefa $tarefa, string $novaColuna): void
    {
        if ($novaColuna === 'concluida') {
            $tarefa->concluida_em = now();
        } elseif ($tarefa->coluna === 'concluida') {
            $tarefa->concluida_em = null;
        }
    }

    private function fimDaColuna(string $coluna): int
    {
        $max = Tarefa::where('coluna', $coluna)
            ->whereNull('arquivada_em')
            ->lockForUpdate()
            ->max('posicao');

        return $max === null ? 0 : ((int) $max) + 1;
    }

    /** Posições densas 0..n-1, na ordem corrente (posicao, id como desempate). */
    private function reindexar(string $coluna): void
    {
        $ids = Tarefa::where('coluna', $coluna)
            ->whereNull('arquivada_em')
            ->orderBy('posicao')
            ->orderBy('id')
            ->pluck('id');

        foreach ($ids as $indice => $id) {
            DB::table('tarefas')->where('id', $id)
                ->where('posicao', '!=', $indice)
                ->update(['posicao' => $indice]);
        }
    }
}
