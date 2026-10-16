<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\ConvenioRequest;
use App\Models\Convenio;
use App\Support\Ciclos\FechamentoDeCiclo;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class ConvenioController extends Controller
{
    use ProtegeExclusaoEmUso;

    /**
     * `particular` VOLTA à leitura (gate CR-CA-01/SEC-CA-09): ele decide o destino
     * do dinheiro (`FaturamentoService`), e a tela que não o enxerga não tem como
     * preservá-lo — o cadastro de convênios apagava a flag a cada edição.
     */
    private const CAMPOS = [
        'id', 'nome', 'registro_ans', 'codigo_operadora', 'versao_tiss',
        'guia_sequencial', 'alerta_agend_mesmo_dia', 'flags_tiss_json',
        'pedido_validade_meses', // validade do pedido médico (limites-e-pedidos, D4)
        // calendário do ciclo de faturamento (fechamento-de-ciclo, D1)
        'ciclo_dia_corte', 'ciclo_tipo_corte',
        'particular', 'ativo',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    public function index(): JsonResponse
    {
        return response()->json(
            Convenio::withCount('servicos')->orderBy('nome')->get()
                ->map(fn (Convenio $convenio) => $convenio->only([...self::CAMPOS, 'servicos_count']))
        );
    }

    public function store(ConvenioRequest $request): JsonResponse
    {
        $convenio = Convenio::create($request->validated());

        return response()->json($convenio->only(self::CAMPOS), 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(Convenio::findOrFail($id)->only(self::CAMPOS));
    }

    public function update(ConvenioRequest $request, int $id): JsonResponse
    {
        $convenio = Convenio::findOrFail($id);
        ConcorrenciaOtimista::assegurar($convenio, $request);
        // SEC-FC-18, e nesta POSIÇÃO de propósito (ordem de gates SEC-FC-08:
        // findOrFail → concorrência → ciclo): a cerca do ciclo é a última a falar, para
        // que id inexistente continue 404 e token velho continue 409 — nunca um 422
        // que confirme a existência do convênio ou o estado do seu faturamento.
        // Sob o MESMO lock do convênio que fechar/reabrir tomam: entre checar
        // "tem fechamento aberto?" e gravar cabia um fechamento comitado por outra
        // sessão, e o cadastro terminaria com calendário novo e ciclo aberto. Não
        // destrava nada (a guarda decide por intervalo persistido — SEC-FC-17), mas é
        // inconsistência de cadastro que a ordem de locks da casa já sabe evitar.
        $atualizado = FechamentoDeCiclo::comLockDoConvenio(
            $convenio->id,
            function (Convenio $travado) use ($request): Convenio {
                FechamentoDeCiclo::assegurarCalendarioMutavel($travado, $request->validated());
                $travado->update($request->validated());

                return $travado;
            },
        );

        return response()->json($atualizado->only(self::CAMPOS));
    }

    public function destroy(int $id): Response
    {
        $this->excluirProtegido(
            Convenio::findOrFail($id),
            'convenio',
            // fechamentos_ciclo também é restrictOnDelete: apagar o convênio levaria
            // junto a trilha de "esta produção já foi enviada" (SEC-FC-02, append-only)
            'Este convênio possui serviços, regras de limite ou ciclos fechados e não pode ser excluído.'
        );

        return response()->noContent();
    }
}
