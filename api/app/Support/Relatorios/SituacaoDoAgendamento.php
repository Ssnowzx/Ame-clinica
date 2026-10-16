<?php

namespace App\Support\Relatorios;

use Illuminate\Database\Eloquent\Builder;

/**
 * A SITUAÇÃO de um agendamento pelas FLAGS do status — nunca pelo nome (§13: status é DADO).
 *
 * Um lugar só para os três relatórios que dependem dela (`atendimentos`, `evolucoes`,
 * `lista-de-presenca`): a régua de "realizado" espelha a de `ProdutividadeDoMes` — desconta
 * a sessão E não é falta. O status padrão "Não Compareceu" carrega as duas flags (a clínica
 * cobra a sessão perdida), e classificar só pelo `desconta_sessao` contaria toda falta
 * cobrada como atendimento realizado — e como evolução pendente para sempre.
 *
 * Tudo por `whereHas('status')`: a relação resolve o status sem join
 * e sem coluna do model sobrescrita.
 */
final class SituacaoDoAgendamento
{
    /**
     * REALIZADO: o status atual desconta a sessão e não marca falta.
     *
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  Builder<TModel>  $consulta  consulta sobre `agendamentos`
     * @return Builder<TModel>
     */
    public static function realizados(Builder $consulta): Builder
    {
        return $consulta->whereHas('status', fn (Builder $status) => $status
            ->where('desconta_sessao', true)
            ->where('marca_falta', false));
    }

    /**
     * MARCADO (o que entra numa lista de presença): o status ocupa o horário OU desconta a
     * sessão — o desmarcado, que devolveu o horário e não cobra, fica fora.
     *
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  Builder<TModel>  $consulta  consulta sobre `agendamentos`
     * @return Builder<TModel>
     */
    public static function marcados(Builder $consulta): Builder
    {
        return $consulta->whereHas('status', fn (Builder $status) => $status
            ->where(fn (Builder $q) => $q
                ->where('ocupa_horario', true)
                ->orWhere('desconta_sessao', true)));
    }
}
