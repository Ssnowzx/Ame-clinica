<?php

namespace App\Support\Tarefas;

use App\Models\Tarefa;
use App\Models\TarefaComentario;
use App\Models\TarefaNotificacao;
use Illuminate\Support\Facades\Auth;

/**
 * Fan-out dos eventos direcionados do mural (change alertas-do-mural).
 *
 * Dedup na GRAVAÇÃO, não na leitura (design D3): o autor de uma ação NUNCA é
 * notificado da própria ação; quem foi mencionado num comentário não recebe
 * também o evento `comentario` (a menção já conta no bloco do sino — evento
 * duplicado é ruído); reposicionar dentro da MESMA coluna não é evento.
 * Roda dentro da transação da mutação (design D2) — ou o dado e o aviso
 * existem juntos, ou nenhum existe.
 */
class EventosDoMural
{
    /**
     * Usuários ADICIONADOS aos responsáveis por outra pessoa.
     *
     * @param  list<int>  $adicionados
     */
    public function atribuicao(Tarefa $tarefa, array $adicionados): void
    {
        $this->gravar($tarefa, 'atribuicao', $adicionados);
    }

    /**
     * Demanda aberta assumida: avisa o CRIADOR (spec tarefas). `dados.assumida`
     * distingue "assumiu sua demanda" de "atribuiu você" na tela.
     */
    public function demandaAssumida(Tarefa $tarefa): void
    {
        $this->gravar($tarefa, 'atribuicao', [$tarefa->criado_por], ['assumida' => true]);
    }

    /** Mudança de coluna: avisa criador + responsáveis (exceto o autor da ação). */
    public function mudancaDeColuna(Tarefa $tarefa, string $de, string $para): void
    {
        $this->gravar($tarefa, 'status', $this->envolvidos($tarefa), ['de' => $de, 'para' => $para]);
    }

    /**
     * Comentário novo: avisa criador + responsáveis, exceto o autor e os
     * MENCIONADOS nele (estes já ganham a menção não lida).
     *
     * @param  list<int>  $mencionados
     */
    public function comentario(Tarefa $tarefa, TarefaComentario $comentario, array $mencionados): void
    {
        $destinatarios = array_values(array_diff($this->envolvidos($tarefa), $mencionados));
        $this->gravar($tarefa, 'comentario', $destinatarios, ['comentario_id' => $comentario->id]);
    }

    /** @return list<int> criador + responsáveis, sem duplicata */
    private function envolvidos(Tarefa $tarefa): array
    {
        $ids = $tarefa->responsaveis()->pluck('usuarios.id')->push($tarefa->criado_por);

        return $ids->filter()->unique()->values()->all();
    }

    /**
     * @param  list<int>  $destinatarios
     * @param  array<string, mixed>|null  $dados
     */
    private function gravar(Tarefa $tarefa, string $tipo, array $destinatarios, ?array $dados = null): void
    {
        $autor = (int) Auth::id();

        foreach (array_unique($destinatarios) as $usuarioId) {
            // cast ANTES de comparar: a regra `integer` do Laravel aceita
            // numeric-string ("7" chega string do validated()) e a comparação
            // estrita deixaria o autor se auto-notificar (I1)
            if ($usuarioId === null || (int) $usuarioId === $autor) {
                continue;
            }

            TarefaNotificacao::create([
                'tarefa_id' => $tarefa->id,
                'usuario_id' => $usuarioId,
                'autor_id' => $autor,
                'tipo' => $tipo,
                'dados' => $dados,
            ]);
        }
    }
}
