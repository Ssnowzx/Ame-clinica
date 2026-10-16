<?php

namespace App\Support\Agenda;

/**
 * Conversão da disponibilidade LEGADA do profissional (janela única `janela_inicio`/`janela_fim`
 * + `dias_atendimento_json`) nas linhas de `profissional_horarios` (change
 * horarios-por-dia-do-profissional). Lógica PURA, extraída do backfill da migration para ter rede
 * de teste sobre os ramos — a migration transforma dado real uma única vez.
 *
 * Regra de retrocompat: nada configurado (nem janela nem dias válidos) = SEM linhas = todos os
 * dias na janela padrão da clínica. `dias_atendimento_json = '[]'` — INALCANÇÁVEL pela validação
 * antiga (`min:1`) — cai como "sem dias" e é tratado como não-configurado, nunca como "atende em
 * nenhum dia" (o modelo novo não representa isso; "não escalar" é `ativo=false`).
 */
final class DisponibilidadeLegada
{
    /**
     * @return list<array{dia_semana: int, inicio: string, fim: string}>
     */
    public static function paraLinhas(
        ?string $janelaInicio,
        ?string $janelaFim,
        ?string $diasJson,
        string $padraoInicio,
        string $padraoFim,
    ): array {
        $dias = $diasJson !== null
            ? array_map('intval', json_decode($diasJson, true) ?: [])
            : [];
        $temDias = $dias !== [];
        $temJanela = $janelaInicio !== null || $janelaFim !== null;

        if (! $temJanela && ! $temDias) {
            return [];
        }

        $diasEfetivos = $temDias ? $dias : [1, 2, 3, 4, 5, 6, 7];
        $inicio = $janelaInicio ?? $padraoInicio;
        $fim = $janelaFim ?? $padraoFim;

        $linhas = [];
        foreach ($diasEfetivos as $dia) {
            $linhas[] = ['dia_semana' => $dia, 'inicio' => $inicio, 'fim' => $fim];
        }

        return $linhas;
    }
}
