<?php

namespace App\Http\Resources;

use App\Models\NivelPermissao;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Fachada da spec sobre a role do Spatie (design D3): a API fala
 * "nível de permissão", a tabela é `roles`.
 *
 * @mixin NivelPermissao
 */
class NivelPermissaoResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'nome' => $this->name,
            'permissoes' => $this->permissions->pluck('name')->sort()->values(),
            'usuarios_count' => $this->whenCounted('users'),
            'updated_at' => $this->updated_at, // token da concorrência otimista (If-Match)
        ];
    }
}
