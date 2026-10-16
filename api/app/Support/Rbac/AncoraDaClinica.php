<?php

namespace App\Support\Rbac;

use App\Models\Clinica;
use Illuminate\Support\Facades\DB;

/**
 * Âncora de serialização das mutações de ACESSO (SEC-SD-01).
 *
 * O lock "nas linhas contadas" com `exceto` trava conjuntos DISJUNTOS quando dois
 * admins se rebaixam mutuamente (A trava {B}, B trava {A} — zero contenção, e a
 * corrida commita para zero admins). A serialização determinística vem de UMA
 * linha comum: a da própria clínica (a linha única de `clinica`), travada como
 * PRIMEIRA instrução da transação em TODO caminho que muda acesso (3 boundaries
 * diretos, aplicação de aprovação, cancelamento) — INCONDICIONAL às flags (a corrida
 * existe com tudo desligado).
 *
 * Ordem canônica de locks (registrada aqui, cumprida por todos):
 *   âncora-da-clínica → linha-da-pendência → linhas-alvo.
 *
 * Com a âncora adquirida ANTES de qualquer leitura da transação, o read view do
 * InnoDB nasce depois do commit do concorrente — a contagem de admins enxerga o
 * estado pós-primeira mutação (provado por corrida real na suíte Concorrencia).
 */
class AncoraDaClinica
{
    /**
     * Roda `$mutacao` numa transação serializada pela âncora da clínica.
     *
     * @template TRetorno
     *
     * @param  callable(): TRetorno  $mutacao
     * @return TRetorno
     */
    public function serializado(callable $mutacao): mixed
    {
        return DB::transaction(function () use ($mutacao) {
            // a linha é única: travar "a primeira" é travar a clínica — sem `whereKey`,
            // a âncora não depende de saber o id de antemão
            Clinica::query()->orderBy('id')->lockForUpdate()->first();

            return $mutacao();
        });
    }
}
