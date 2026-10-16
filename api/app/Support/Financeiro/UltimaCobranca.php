<?php

namespace App\Support\Financeiro;

use App\Models\Auditoria;
use App\Models\LancamentoCaixa;
use App\Support\Configuracoes\ConfiguracaoService;

/**
 * A última cobrança aberta de um lançamento — quando e por quem (change `cobranca-pelo-whatsapp`).
 * Lida pelo `show` do lançamento e pela rota da cobrança; mora em `Support` (CR-API2-05) para um
 * controller não chamar outro.
 */
final class UltimaCobranca
{
    /** @return array{em: string, por: string|null}|null */
    public static function de(LancamentoCaixa $lancamento): ?array
    {
        $registro = Auditoria::query()
            ->where('entidade', 'lancamentos_caixa')->where('entidade_id', $lancamento->id)->where('acao', 'cobrou')
            ->with('usuario:id,nome')
            ->latest('id')->first();

        return $registro === null ? null : [
            'em' => $registro->criado_em->timezone(app(ConfiguracaoService::class)->get('clinica.timezone'))->format('Y-m-d H:i'),
            'por' => $registro->usuario?->nome,
        ];
    }
}
