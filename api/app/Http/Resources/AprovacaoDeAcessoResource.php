<?php

namespace App\Http\Resources;

use App\Models\AprovacaoDeAcesso;
use App\Models\NivelPermissao;
use App\Models\Usuario;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\AprovacoesDeAcesso;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Pendência do maker-checker — leitura sob `niveis_permissao.ver` (a página de
 * administração). Expõe o payload PROPOSTO (nomes de permissões/nível/chave — o
 * mesmo que a tela de Níveis já mostra, SEC-SD-09) e os rótulos resolvidos;
 * nunca mais que isso.
 *
 * @mixin AprovacaoDeAcesso
 */
class AprovacaoDeAcessoResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'tipo' => $this->tipo,
            'alvo' => $this->rotuloDoAlvo(),
            'payload' => $this->payloadComRotulos(),
            'solicitante' => $this->solicitante?->only(['id', 'nome']),
            'status' => $this->status,
            'decidido_por' => $this->decididoPor?->only(['id', 'nome']),
            // decidido_em já é PAREDE (gravado com agoraNaClinica); created_at é
            // UTC do framework — só ele converte na exibição (§13)
            'decidido_em' => $this->decidido_em?->format('Y-m-d H:i'),
            'criado_em' => $this->created_at
                ?->timezone(app(ConfiguracaoService::class)->get('clinica.timezone'))
                ->format('Y-m-d H:i'),
            // a régua do decisor para QUEM LÊ (change `trava-de-usuarios-e-niveis`): a tela só oferece
            // "Aprovar" a quem passaria nela. A listagem já calculou em lote; os caminhos de item único
            // (202 da criação, resposta da decisão) calculam aqui. Só na pendente
            'voce_pode_aprovar' => $this->getAttribute('voce_pode_aprovar') ?? ($this->status === 'pendente'
                && $request->user() !== null
                && app(AprovacoesDeAcesso::class)->decisorCabe($this->resource, $request->user())),
        ];
    }

    /** O payload proposto + o rótulo resolvido do nível (a tela não exibe id cru). */
    private function payloadComRotulos(): array
    {
        $payload = $this->payload_json;

        if ($this->tipo === 'atribuir_nivel') {
            // o índice pré-resolve em LOTE (CR M1); o find é o fallback dos caminhos
            // de item único (202 da criação, resposta da decisão)
            $payload['nivel_proposto'] = $this->getAttribute('nivel_proposto_nome')
                ?? NivelPermissao::find((int) ($payload['nivel_permissao_id'] ?? 0))?->name;
        }

        return $payload;
    }

    /** @return array{id: int, rotulo: string} */
    private function rotuloDoAlvo(): array
    {
        $rotulo = $this->getAttribute('rotulo_do_alvo') ?? match ($this->tipo) {
            'editar_nivel' => NivelPermissao::find($this->alvo_id)?->name,
            'atribuir_nivel' => Usuario::find($this->alvo_id)?->nome,
            'configurar_seguranca' => $this->alvo_chave,
            default => null,
        };

        return [
            'id' => (int) $this->alvo_id,
            'rotulo' => $rotulo ?? '—',
        ];
    }
}
