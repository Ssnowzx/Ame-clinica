<?php

namespace App\Support\Financeiro;

use App\Models\LancamentoCaixa;
use App\Support\Clinica\JanelaDasNotificacoes;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Database\Eloquent\Builder;

/**
 * "Lançamentos em atraso" — a regra em UM lugar (change indicadores-profissionais, D4): o não pago
 * cujo vencimento JÁ PASSOU na parede da clínica, dentro da janela do centro de notificações
 * (`JanelaDasNotificacoes`). O bloco do sino e o painel do dinheiro leem daqui, e por isso não
 * discordam sobre o que está atrasado — com uma exceção de propósito: o sino tira o salário de quem
 * não vê a folha, e o painel, que é agregado de `fluxo_caixa.ver`, soma tudo (D1 de
 * `financeiro-sem-faturamento-total`).
 *
 * Vencimento de HOJE ainda não está atrasado (`<` hoje): a conta que vence hoje é "a receber".
 */
final class LancamentosEmAtraso
{
    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly JanelaDasNotificacoes $janela,
    ) {}

    /** @return Builder<LancamentoCaixa> receitas E despesas, do vencimento mais antigo ao mais novo */
    public function consulta(): Builder
    {
        $hoje = now($this->configuracoes->get('clinica.timezone'))->toDateString();

        return LancamentoCaixa::query()
            ->whereNull('pago_em')
            ->where('vencimento', '<', $hoje)
            ->where('vencimento', '>=', $this->janela->piso())
            ->orderBy('vencimento');
    }
}
