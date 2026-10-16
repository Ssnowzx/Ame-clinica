<?php

namespace App\Support\Financeiro;

use App\Models\LancamentoCaixa;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Support\Rbac\EscopoDoProfissional;

/**
 * QUEM pode apontar o dinheiro para um tratamento — a régua ÚNICA do vínculo, usada pelo PUT de
 * um lançamento (`LancamentoCaixaRequest::authorize()`) e pelo lote (`vincular-tratamentos`).
 * Veio do `LancamentoCaixaRequest` (change `recebido-por-profissional`) para o lote não copiar a
 * regra (change `vincular-pagamentos-ao-tratamento`, D3).
 *
 * Mexer no vínculo (reenviar o mesmo valor NÃO é mexer) pede:
 * - no lançamento PAGO, `lancamentos.pagar` (SEC-RPP-03): trocar o vínculo move dinheiro já
 *   recebido entre profissionais;
 * - posse, pelo eixo AGENDA, do tratamento de ORIGEM e do de DESTINO — a régua do faturamento.
 *   Tratamento inexistente vira dono `null`, e o escopado leva o MESMO 403 do alheio (SEC-RPP-05).
 */
final class AutorizacaoDoVinculo
{
    public function __construct(private readonly EscopoDoProfissional $escopos) {}

    public function assegurar(?Usuario $usuario, ?LancamentoCaixa $atual, ?int $novo): void
    {
        $antigo = $atual?->tratamento_id;
        if ($novo === $antigo) {
            return;
        }

        abort_if(
            $atual?->pago_em !== null && $usuario?->can('lancamentos.pagar') !== true,
            403,
            'Trocar o tratamento de um lançamento pago exige a permissão de dar baixa.',
        );

        $escopo = $this->escopos->agenda($usuario);
        foreach (array_filter([$antigo, $novo], fn (?int $tratamentoId): bool => $tratamentoId !== null) as $tratamentoId) {
            $dono = Tratamento::whereKey($tratamentoId)->value('profissional_id');
            $escopo->assegurarPosse($dono === null ? null : (int) $dono);
        }
    }
}
