<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\ContaRequest;
use App\Http\Requests\SaldoDeAberturaRequest;
use App\Models\Conta;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Financeiro\SaldoDasContas;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class ContaController extends Controller
{
    use ProtegeExclusaoEmUso;

    public function index(): JsonResponse
    {
        return response()->json(Conta::orderBy('nome')->get());
    }

    public function store(ContaRequest $request): JsonResponse
    {
        return response()->json(Conta::create($request->validated())->refresh(), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(Conta::findOrFail($id));
    }

    public function update(ContaRequest $request, int $id): JsonResponse
    {
        $conta = Conta::findOrFail($id);
        ConcorrenciaOtimista::assegurar($conta, $request);
        $conta->update($request->validated());

        return response()->json($conta->refresh());
    }

    /**
     * `GET /contas/saldos?em=` — o saldo de cada conta no FIM do dia (padrão: hoje no fuso da
     * clínica) e o total, sob `fluxo_caixa.ver` (change `saldo-das-contas`). A conta inativa só
     * aparece com saldo diferente de zero: inativar não some com o dinheiro (D6).
     */
    public function saldos(Request $request, SaldoDasContas $saldos, ConfiguracaoService $configuracoes): JsonResponse
    {
        $dados = $request->validate(['em' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:1900-01-01']]);
        $em = $dados['em'] ?? now($configuracoes->get('clinica.timezone'))->toDateString();

        $linhas = $saldos->noFimDe($em)
            ->filter(fn (array $linha): bool => $linha['conta']->ativo || bccomp($linha['saldo'], '0', 2) !== 0)
            ->values();

        return response()->json([
            'em' => $em,
            'contas' => $linhas->map(fn (array $linha): array => [
                'id' => $linha['conta']->id,
                'nome' => $linha['conta']->nome,
                'ativo' => $linha['conta']->ativo,
                'saldo' => $linha['saldo'],
                'saldo_inicial' => (string) $linha['conta']->saldo_inicial,
                'saldo_inicial_em' => $linha['conta']->saldo_inicial_em?->format('Y-m-d'),
                'updated_at' => $linha['conta']->updated_at,
            ]),
            'total' => $linhas->reduce(fn (string $soma, array $linha): string => bcadd($soma, $linha['saldo'], 2), '0.00'),
        ]);
    }

    /**
     * `PUT /contas/{id}/saldo-de-abertura` — `contas.editar` E `fluxo_caixa.ver` (D5): quem edita a
     * conta sem ver o caixa não mexe no número que não pode ver. Auditado (Auditavel) e com
     * concorrência otimista, como o resto da casa.
     */
    public function definirAbertura(SaldoDeAberturaRequest $request, int $id): JsonResponse
    {
        $conta = Conta::findOrFail($id);
        ConcorrenciaOtimista::assegurar($conta, $request);
        // fora do `$fillable` de propósito: a abertura só muda por esta rota
        $conta->forceFill($request->validated())->save();
        $conta->refresh();

        return response()->json([
            'id' => $conta->id,
            'saldo_inicial' => (string) $conta->saldo_inicial,
            'saldo_inicial_em' => $conta->saldo_inicial_em?->format('Y-m-d'),
            'updated_at' => $conta->updated_at,
        ]);
    }

    public function destroy(int $id): Response
    {
        // extrato histórico não quebra (T-fin-04): FK restrict → 422
        $this->excluirProtegido(
            Conta::findOrFail($id),
            'conta',
            'Esta conta é referenciada por lançamentos, cartões ou transferências e não pode ser excluída.'
        );

        return response()->noContent();
    }
}
