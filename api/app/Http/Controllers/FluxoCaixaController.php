<?php

namespace App\Http\Controllers;

use App\Models\Conta;
use App\Models\LancamentoCaixa;
use App\Models\Transferencia;
use App\Support\Financeiro\NomesDosInteressados;
use App\Support\Financeiro\SaldoDasContas;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Extrato por período/conta em REGIME DE CAIXA (design D6): lançamentos pagos
 * (pago_em) + transferências (data). Transferência NUNCA entra nos totais de
 * receita/despesa (T-fin-19). Payload mínimo — sem obs, interessado
 * {tipo, id, nome} via whitelist (T-fin-21).
 */
class FluxoCaixaController extends Controller
{
    private const JANELA_MAXIMA_DIAS = 366; // T-fin-20

    /** Teto de linhas do extrato (gate r1, CR-04): result set nunca é ilimitado. */
    private const MAX_MOVIMENTOS = 2000;

    public function index(Request $request, SaldoDasContas $saldos): JsonResponse
    {
        $filtros = $request->validate([
            'de' => ['required', 'date_format:Y-m-d'],
            'ate' => ['required', 'date_format:Y-m-d', 'after_or_equal:de'],
            'conta_id' => ['sometimes', 'integer'],
        ]);

        $de = Carbon::createFromFormat('Y-m-d', $filtros['de']);
        $ate = Carbon::createFromFormat('Y-m-d', $filtros['ate']);
        if ($de->diffInDays($ate) > self::JANELA_MAXIMA_DIAS) {
            return response()->json([
                'message' => 'Janela máxima de '.self::JANELA_MAXIMA_DIAS.' dias.',
                'errors' => ['ate' => ['Janela máxima de '.self::JANELA_MAXIMA_DIAS.' dias.']],
            ], 422);
        }

        $contaId = $filtros['conta_id'] ?? null; // inexistente → inerte (vazio)

        $consultaPagos = LancamentoCaixa::query()
            ->whereBetween('pago_em', [$filtros['de'].' 00:00:00', $filtros['ate'].' 23:59:59'])
            ->when($contaId !== null, fn ($q) => $q->where('conta_id', $contaId));

        if ($consultaPagos->count() > self::MAX_MOVIMENTOS) {
            return response()->json([
                'message' => 'Período com movimentos demais — refine o intervalo ou a conta.',
                'errors' => ['ate' => ['Período com movimentos demais — refine o intervalo ou a conta.']],
            ], 422);
        }

        $pagos = $consultaPagos->orderBy('pago_em')->get();

        $transferencias = Transferencia::query()
            ->whereBetween('data', [$filtros['de'], $filtros['ate']])
            ->when($contaId !== null, fn ($q) => $q->where(
                fn ($sub) => $sub->where('conta_origem_id', $contaId)
                    ->orWhere('conta_destino_id', $contaId)
            ))
            ->orderBy('data')
            ->get();

        // somas em decimal — dinheiro nunca em float (D1)
        $entradas = '0.00';
        $saidas = '0.00';
        $nomes = NomesDosInteressados::de($pagos);
        $movimentos = $pagos->map(function (LancamentoCaixa $lancamento) use (&$entradas, &$saidas, $nomes): array {
            if ($lancamento->tipo === 'receita') {
                $entradas = bcadd($entradas, $lancamento->liquido, 2);
            } else {
                $saidas = bcadd($saidas, $lancamento->liquido, 2);
            }

            return [
                'movimento' => $lancamento->tipo,
                'lancamento_id' => $lancamento->id,
                'conta_id' => $lancamento->conta_id,
                'categoria_id' => $lancamento->categoria_id,
                'valor_liquido' => $lancamento->liquido,
                'pago_em' => $lancamento->pago_em->format('Y-m-d H:i'),
                'interessado' => $lancamento->interessado_tipo === null ? null : [
                    'tipo' => $lancamento->interessado_tipo,
                    'id' => $lancamento->interessado_id,
                    'nome' => $nomes[$lancamento->interessado_tipo.'#'.$lancamento->interessado_id] ?? null,
                ],
            ];
        });

        $totalTransferido = '0.00';
        $movimentosTransferencia = $transferencias->map(function (Transferencia $transferencia) use (&$totalTransferido): array {
            $totalTransferido = bcadd($totalTransferido, (string) $transferencia->valor, 2);

            return [
                'movimento' => 'transferencia',
                'transferencia_id' => $transferencia->id,
                'conta_origem_id' => $transferencia->conta_origem_id,
                'conta_destino_id' => $transferencia->conta_destino_id,
                'valor' => (string) $transferencia->valor,
                'data' => $transferencia->data->format('Y-m-d'),
            ];
        });

        // saldo anterior e saldo corrido (change `saldo-das-contas`, D3): o servidor ordena e
        // acumula — a tela só desenha. Sem conta, é o saldo da clínica: a transferência entre
        // duas contas soma zero
        $saldoNoFimDaVespera = $saldos->noFimDe($de->copy()->subDay()->toDateString());
        $saldoAnterior = $contaId !== null
            ? ($saldoNoFimDaVespera[$contaId]['saldo'] ?? '0.00')
            : $saldoNoFimDaVespera->reduce(fn (string $soma, array $linha): string => bcadd($soma, $linha['saldo'], 2), '0.00');
        $contas = $saldoNoFimDaVespera->map(fn (array $linha): Conta => $linha['conta'])->all();

        $cronologicos = collect([
            ...$pagos->map(fn (LancamentoCaixa $l, int $i): array => [
                'chave' => [$l->pago_em->format('Y-m-d H:i'), 1, $l->id],
                'dia' => $l->pago_em->format('Y-m-d'),
                'pontas' => [['conta_id' => $l->conta_id, 'valor' => $l->tipo === 'despesa' ? bcmul($l->liquido, '-1', 2) : $l->liquido]],
                'linha' => $movimentos[$i],
            ]),
            // a transferência tem DIA, sem hora: vale 00:00, antes dos pagamentos do dia (D4)
            ...$transferencias->map(fn (Transferencia $t, int $i): array => [
                'chave' => [$t->data->format('Y-m-d').' 00:00', 0, $t->id],
                'dia' => $t->data->format('Y-m-d'),
                'pontas' => [
                    ['conta_id' => $t->conta_origem_id, 'valor' => bcmul((string) $t->valor, '-1', 2)],
                    ['conta_id' => $t->conta_destino_id, 'valor' => (string) $t->valor],
                ],
                'linha' => $movimentosTransferencia[$i],
            ]),
        ])->sort(fn (array $a, array $b): int => $a['chave'] <=> $b['chave'])->values();

        $saldo = $saldoAnterior;
        $comSaldo = $cronologicos->map(function (array $movimento) use (&$saldo, $contas, $contaId): array {
            $saldo = bcadd($saldo, SaldoDasContas::efeito($movimento['pontas'], $movimento['dia'], $contas, $contaId), 2);

            return [...$movimento['linha'], 'saldo' => $saldo];
        });

        return response()->json([
            'de' => $filtros['de'],
            'ate' => $filtros['ate'],
            'conta_id' => $contaId,
            'saldo_anterior' => $saldoAnterior,
            'movimentos' => $comSaldo->all(),
            'totais' => [
                'entradas' => $entradas,
                'saidas' => $saidas,
                'saldo_do_periodo' => bcsub($entradas, $saidas, 2),
                'transferido' => $totalTransferido, // fora de entradas/saídas (T-fin-19)
            ],
        ]);
    }
}
