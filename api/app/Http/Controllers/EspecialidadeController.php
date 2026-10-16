<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\EspecialidadeRequest;
use App\Http\Resources\EspecialidadeResource;
use App\Models\Especialidade;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

class EspecialidadeController extends Controller
{
    use ProtegeExclusaoEmUso;

    public function index(): AnonymousResourceCollection
    {
        return EspecialidadeResource::collection(
            Especialidade::orderBy('nome')->get()
        );
    }

    public function store(EspecialidadeRequest $request): JsonResponse
    {
        $especialidade = Especialidade::create($request->validated());

        return response()->json(new EspecialidadeResource($especialidade), 201);
    }

    public function show(int $id): EspecialidadeResource
    {
        return new EspecialidadeResource(Especialidade::findOrFail($id));
    }

    public function update(EspecialidadeRequest $request, int $id): EspecialidadeResource
    {
        $especialidade = Especialidade::findOrFail($id);
        ConcorrenciaOtimista::assegurar($especialidade, $request);
        $especialidade->update($request->validated());

        return new EspecialidadeResource($especialidade);
    }

    public function destroy(int $id): Response
    {
        $this->excluirProtegido(
            Especialidade::findOrFail($id),
            'especialidade',
            'Esta especialidade está vinculada a outros cadastros e não pode ser excluída.'
        );

        return response()->noContent();
    }
}
