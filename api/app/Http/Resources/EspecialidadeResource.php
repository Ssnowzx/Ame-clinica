<?php

namespace App\Http\Resources;

use App\Models\Especialidade;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Especialidade
 */
class EspecialidadeResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'nome' => $this->nome,
            'tempo_sessao' => $this->tempo_sessao,
            'cor' => $this->cor,
            'exige_termo' => $this->exige_termo,
            'oculta_agendamento_online' => $this->oculta_agendamento_online,
            'updated_at' => $this->updated_at, // token da concorrência otimista (If-Match)
        ];
    }
}
