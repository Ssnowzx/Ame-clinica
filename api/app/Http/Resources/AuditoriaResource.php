<?php

namespace App\Http\Resources;

use App\Models\Auditoria;
use App\Support\Auditoria\OrigemDaOperacao;
use App\Support\Auditoria\ResolvedorDeValores;
use App\Support\Auditoria\RotulosDeAuditoria;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Forma da linha da trilha na API. Expõe o NOME do autor e as alterações com RÓTULO humano por
 * campo — a chave crua e o valor sensível (já mascarado) nunca saem (spec auditoria).
 *
 * São TRÊS autores possíveis, e a distinção é da spec: o usuário (pelo nome), o sistema (rotina
 * agendada, console) e a **origem externa** — alguém sem sessão, por uma porta pública. O `tipo`
 * sai junto do nome para a tela poder filtrar e destacar sem reconhecer texto.
 *
 * @mixin Auditoria
 */
class AuditoriaResource extends JsonResource
{
    /** Fuso da clínica (§13); o controller o injeta uma vez para toda a página. */
    private string $fuso = 'UTC';

    /** Resolvedor de valores (só para agendamentos); nulo ⇒ valor cru. */
    private ?ResolvedorDeValores $resolvedor = null;

    public function comFuso(string $fuso): static
    {
        $this->fuso = $fuso;

        return $this;
    }

    public function comResolvedor(?ResolvedorDeValores $resolvedor): static
    {
        $this->resolvedor = $resolvedor;

        return $this;
    }

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'entidade' => $this->entidade,
            'entidade_id' => $this->entidade_id,
            'acao' => $this->acao,
            // nulo fora de lote (D11): a tela agrupa/filtra pelo id, nunca pelo texto da ação
            'lote_id' => $this->lote_id,
            'autor' => OrigemDaOperacao::rotulo($this->autor_tipo, $this->usuario?->nome),
            'autor_tipo' => $this->autor_tipo,
            // `criado_em` é o CREATED_AT gravado com `now()` em UTC. A trilha se lê
            // na PAREDE da clínica: converter o instante para o fuso da clínica e emitir
            // "Y-m-d H:i:s" (espaço, sem T/Z) — o que o front recorta sem `new Date()`.
            // Emitir o Carbon cru sairia ISO/UTC e o front perderia a hora inteira.
            'criado_em' => $this->criado_em->copy()->timezone($this->fuso)->format('Y-m-d H:i:s'),
            'alteracoes' => RotulosDeAuditoria::alteracoes($this->entidade, $this->diff_json, $this->resolvedor),
        ];
    }
}
