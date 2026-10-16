<?php

namespace App\Http\Resources;

use App\Models\Clinica;
use App\Models\Usuario;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * nivel_permissao_id é COMPUTADO do pivot do Spatie — a coluna da spec §5 não
 * existe fisicamente (design D3, desvio registrado).
 *
 * @mixin Usuario
 */
class UsuarioResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'nome' => $this->nome,
            'email' => $this->email,
            'acesso_mobile' => $this->acesso_mobile,
            'ativo' => $this->ativo,
            'profissional_id' => $this->profissional_id,
            'nivel_permissao_id' => $this->roles->first()?->id,
            'nivel_permissao' => $this->roles->first()?->name,
            'permissoes' => $this->getAllPermissions()->pluck('name')->sort()->values(),
            // token da concorrência otimista (If-Match): o formulário de edição hidrata
            // DESTA leitura — sem o campo, todo PUT saía com If-Match vazio e morria em
            // 428 (USUARIOS-EDIT-428; contratos-de-front exige expor nas leituras que
            // hidratam edição, e a lista leva o token da linha — C8)
            'updated_at' => $this->updated_at,
            'marca' => $this->marca(),
            // versão de cache-bust da foto de perfil (foto-de-perfil-do-usuario) — o
            // front monta /api/me/avatar?v={versao}; nulo quando não há foto (mostra o ícone)
            'avatar_versao' => $this->avatar_atualizado_em?->format('YmdHis'),
        ];
    }

    /**
     * A identidade visual da clínica (identidade-da-clinica): viaja no /me porque o
     * shell é de TODO autenticado — exigir configuracoes.ver aqui deixaria a marca
     * invisível para a recepção (spec: "MUST NOT exigir configuracoes.ver").
     *
     * @return array{nome: string, identidade: string, fonte: string, tema: string, logo_versao: string|null}
     */
    private function marca(): array
    {
        $configuracoes = app(ConfiguracaoService::class);

        return [
            'nome' => (string) $configuracoes->get('clinica.nome'),
            'identidade' => (string) $configuracoes->get('clinica.identidade'),
            'fonte' => (string) $configuracoes->get('clinica.fonte_do_nome'),
            'tema' => (string) $configuracoes->get('clinica.tema'),
            'logo_versao' => Clinica::atual()->logo_atualizado_em?->format('YmdHis'),
        ];
    }
}
