<?php

namespace App\Support\Financeiro;

use App\Models\LancamentoCaixa;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Auth;

/**
 * O lançamento de FUNCIONÁRIO (salário, adiantamento, pró-labore) só existe para quem tem
 * `funcionarios.ver` (change `financeiro-sem-faturamento-total`): a recepção lança e dá baixa sem
 * ver a folha.
 *
 * Porta a porta, e NÃO escopo global no MODEL (D1): o escopo é posto na consulta de cada porta que
 * opera lançamentos (`withGlobalScope` no builder, abaixo). Os agregados de quem tem `fluxo_caixa.ver` — extrato,
 * painel do dinheiro, relatórios do caixa — continuam somando TODOS os lançamentos, senão um nível
 * com o total e sem a folha veria um caixa que não fecha. Escondido responde `404`, igual a um id
 * que não existe (D2).
 */
final class LancamentosVisiveis
{
    /**
     * @param  Builder<LancamentoCaixa>  $consulta
     * @return Builder<LancamentoCaixa>
     */
    public static function filtrar(Builder $consulta): Builder
    {
        if (self::veAFolha()) {
            return $consulta;
        }

        // como ESCOPO, não `where` solto: o Eloquent agrupa os `where` do chamador antes de aplicá-lo,
        // e um `orWhere` encadeado depois não abre a folha (SEC-FIN2-03). Lançamento sem
        // interessado é visível: `<>` sozinho descartaria o NULL
        return $consulta->withGlobalScope(self::class, fn (Builder $q) => $q->where(fn (Builder $nivel) => $nivel
            ->whereNull('lancamentos_caixa.interessado_tipo')
            ->orWhere('lancamentos_caixa.interessado_tipo', '<>', 'funcionario')));
    }

    public static function encontrar(int $id): LancamentoCaixa
    {
        return self::filtrar(LancamentoCaixa::query())->findOrFail($id);
    }

    /** Quem pode ver (e portanto lançar) o dinheiro de funcionário. */
    public static function veAFolha(): bool
    {
        return Auth::user()?->can('funcionarios.ver') === true;
    }
}
