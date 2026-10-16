<?php

namespace App\Http\Controllers;

use App\Http\Requests\RegraLimiteConvenioRequest;
use App\Models\Convenio;
use App\Models\RegraLimiteConvenio;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/**
 * Regras de limite são agregado do convênio (limites-e-pedidos, D1) — mesmo
 * padrão da tabela de serviços (SEC-LP-07): rotas aninhadas, pai
 * resolvido por findOrFail (id inexistente → 404), filho SEMPRE pela
 * relação do pai. Leitura sob convenios.ver; escrita sob convenios.editar.
 */
class RegraLimiteConvenioController extends Controller
{
    private const CAMPOS = ['id', 'convenio_id', 'especialidade_id', 'periodo', 'limite', 'acao',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    public function index(int $convenioId): JsonResponse
    {
        $convenio = Convenio::findOrFail($convenioId);

        return response()->json(
            $convenio->regrasLimite()->with('especialidade:id,nome')
                ->orderBy('id')->get()
                ->map(fn (RegraLimiteConvenio $regra) => $this->serializar($regra))
        );
    }

    public function store(RegraLimiteConvenioRequest $request, int $convenioId): JsonResponse
    {
        $convenio = Convenio::findOrFail($convenioId);

        $regra = new RegraLimiteConvenio($request->validated());
        $regra->convenio_id = $convenio->id;
        $regra->save();

        return response()->json($this->serializar($regra->load('especialidade:id,nome')), 201);
    }

    public function update(RegraLimiteConvenioRequest $request, int $convenioId, int $id): JsonResponse
    {
        $convenio = Convenio::findOrFail($convenioId);
        $regra = $convenio->regrasLimite()->findOrFail($id);
        ConcorrenciaOtimista::assegurar($regra, $request);
        $regra->update($request->validated());

        return response()->json($this->serializar($regra->load('especialidade:id,nome')));
    }

    public function destroy(int $convenioId, int $id): Response
    {
        $convenio = Convenio::findOrFail($convenioId);
        // nada referencia a regra (dado de parametrização): exclusão direta, auditada
        $convenio->regrasLimite()->findOrFail($id)->delete();

        return response()->noContent();
    }

    /** Payload da regra: escalares + especialidade {id, nome} (null = todas). */
    private function serializar(RegraLimiteConvenio $regra): array
    {
        return [
            ...collect($regra->attributesToArray())->only(self::CAMPOS)->all(),
            'especialidade' => $regra->especialidade?->only(['id', 'nome']),
        ];
    }
}
