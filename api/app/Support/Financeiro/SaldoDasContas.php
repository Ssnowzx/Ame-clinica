<?php

namespace App\Support\Financeiro;

use App\Models\Conta;
use App\Models\LancamentoCaixa;
use App\Models\Transferencia;
use Illuminate\Support\Collection;

/**
 * O saldo de cada conta no FIM de um dia (change `saldo-das-contas`): a abertura, mais as receitas
 * pagas, menos as despesas pagas (líquido, por `pago_em`), mais as transferências que entram,
 * menos as que saem (por `data`). Só conta o que é do dia da abertura em diante (D1): o que veio
 * antes já está dentro do valor de abertura.
 *
 * Três consultas, qualquer que seja o número de contas, com a soma no BANCO e a montagem em
 * `bcmath` (D2) — somar em PHP linha a linha é um ano de caixa na memória, e somar em float é o
 * que inventou R$ 17,00 nesta casa.
 */
class SaldoDasContas
{
    /** O corte da abertura, por conta: `NULL` = sem data, tudo entra. */
    private const DEPOIS_DA_ABERTURA = '(contas.saldo_inicial_em IS NULL OR %s >= contas.saldo_inicial_em)';

    /**
     * @return Collection<int, array{conta: Conta, saldo: string}> por `conta_id`, todas as contas da clínica
     */
    public function noFimDe(string $dia): Collection
    {
        $contas = Conta::query()->orderBy('nome')->get();
        $movimento = $this->movimentoAte($dia);

        return $contas->mapWithKeys(fn (Conta $conta): array => [$conta->id => [
            'conta' => $conta,
            'saldo' => bcadd((string) $conta->saldo_inicial, $movimento[$conta->id] ?? '0.00', 2),
        ]]);
    }

    /**
     * O quanto cada conta movimentou do dia da abertura até o fim de `$dia`, com sinal.
     *
     * @return array<int, string>
     */
    private function movimentoAte(string $dia): array
    {
        $movimento = [];
        $somar = function (int $contaId, string $valor) use (&$movimento): void {
            $movimento[$contaId] = bcadd($movimento[$contaId] ?? '0.00', $valor, 2);
        };

        LancamentoCaixa::query()
            ->join('contas', fn ($j) => $j->on('contas.id', '=', 'lancamentos_caixa.conta_id'))
            ->whereNotNull('lancamentos_caixa.pago_em')
            ->where('lancamentos_caixa.pago_em', '<=', "{$dia} 23:59:59")
            ->whereRaw(sprintf(self::DEPOIS_DA_ABERTURA, 'lancamentos_caixa.pago_em'))
            ->groupBy('lancamentos_caixa.conta_id')
            ->selectRaw('lancamentos_caixa.conta_id as conta_id, SUM('.LancamentoCaixa::LIQUIDO_COM_SINAL_SQL.') as total')
            ->get()
            ->each(fn ($linha) => $somar((int) $linha->conta_id, (string) $linha->total));

        // a transferência mexe nas DUAS pontas: sai da origem, entra no destino — cada ponta com
        // o corte de abertura da SUA conta
        foreach (['conta_destino_id' => '', 'conta_origem_id' => '-'] as $ponta => $sinal) {
            Transferencia::query()
                ->join('contas', fn ($j) => $j->on('contas.id', '=', "transferencias.{$ponta}"))
                ->where('transferencias.data', '<=', $dia)
                ->whereRaw(sprintf(self::DEPOIS_DA_ABERTURA, 'transferencias.data'))
                ->groupBy("transferencias.{$ponta}")
                ->selectRaw("transferencias.{$ponta} as conta_id, SUM(transferencias.valor) as total")
                ->get()
                ->each(fn ($linha) => $somar((int) $linha->conta_id, $sinal.$linha->total));
        }

        return $movimento;
    }

    /**
     * O efeito de UM movimento do extrato no saldo — da conta filtrada, ou da clínica inteira
     * (`$contaId` nulo). Respeita o corte de abertura de cada conta tocada: o movimento anterior à
     * abertura dela aparece no extrato, mas não mexe no saldo (já está dentro da abertura).
     *
     * @param  array<int, Conta>  $contas  por id
     * @param  list<array{conta_id: int, valor: string}>  $pontas  valor com sinal, por conta tocada
     */
    public static function efeito(array $pontas, string $dia, array $contas, ?int $contaId): string
    {
        $efeito = '0.00';
        foreach ($pontas as $ponta) {
            if ($contaId !== null && $ponta['conta_id'] !== $contaId) {
                continue;
            }
            $abertura = $contas[$ponta['conta_id']]->saldo_inicial_em ?? null;
            if ($abertura !== null && $dia < $abertura->format('Y-m-d')) {
                continue;
            }
            $efeito = bcadd($efeito, $ponta['valor'], 2);
        }

        return $efeito;
    }
}
