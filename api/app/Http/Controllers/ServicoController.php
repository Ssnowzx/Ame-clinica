<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\ServicoRequest;
use App\Models\Convenio;
use App\Models\Servico;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/**
 * Tabela de serviços é agregado do convênio (design D4): rotas aninhadas, e o
 * convênio da URL inexistente → 404 (abuse 6).
 */
class ServicoController extends Controller
{
    use ProtegeExclusaoEmUso;

    private const CAMPOS = ['id', 'convenio_id', 'procedimento', 'codigo_procedimento', 'valor',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    public function index(int $convenioId): JsonResponse
    {
        $convenio = Convenio::findOrFail($convenioId);

        return response()->json(
            $convenio->servicos()->orderBy('procedimento')->get(self::CAMPOS)
        );
    }

    public function store(ServicoRequest $request, int $convenioId): JsonResponse
    {
        $convenio = Convenio::findOrFail($convenioId);

        $servico = new Servico($request->validated());
        $servico->convenio_id = $convenio->id;
        $servico->save();

        return response()->json($servico->only(self::CAMPOS), 201);
    }

    public function update(ServicoRequest $request, int $convenioId, int $id): JsonResponse
    {
        $convenio = Convenio::findOrFail($convenioId);
        $servico = $convenio->servicos()->findOrFail($id);
        ConcorrenciaOtimista::assegurar($servico, $request);
        $servico->update($request->validated());

        return response()->json($servico->only(self::CAMPOS));
    }

    public function destroy(int $convenioId, int $id): Response
    {
        $convenio = Convenio::findOrFail($convenioId);

        // era o ÚNICO destroy de catálogo sem esta proteção: `tratamentos.servico_id`
        // é FK restrita, então excluir serviço em uso estourava 500 em vez de recusar
        // com 422. Esta change é a primeira a expor o botão (parecer SEC-CA-02).
        $this->excluirProtegido(
            $convenio->servicos()->findOrFail($id),
            'servico',
            'Este serviço está vinculado a tratamentos e não pode ser excluído.'
        );

        return response()->noContent();
    }
}
