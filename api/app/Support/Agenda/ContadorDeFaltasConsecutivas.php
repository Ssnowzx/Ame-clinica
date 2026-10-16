<?php

namespace App\Support\Agenda;

use App\Models\Agendamento;

/**
 * A REGRA das faltas consecutivas (§13) em UM lugar só.
 *
 * "Faltas consecutivas" é a sequência de agendamentos passados do paciente em
 * status com a flag `marca_falta` (T-not-07 — flag, NUNCA nome), do mais recente
 * para trás, interrompida pelo PRIMEIRO não-falta (um comparecimento reinicia a
 * contagem). Dois consumidores dependem dessa definição — o centro de
 * notificações (`NotificacaoController`) e o alerta do painel (`show`) — e
 * enquanto ela viveu inline num deles, o outro nasceria como uma segunda
 * implementação da mesma regra, livre para divergir em silêncio.
 *
 * A memória é limitada POR CONSTRUÇÃO: só `$teto` linhas por paciente (o chamador
 * passa o limite configurado — ≤ 20), nunca a janela inteira da agenda.
 */
final class ContadorDeFaltasConsecutivas
{
    /**
     * Conta a sequência de faltas mais recente do paciente, até `$teto` linhas.
     *
     * @param  string  $agora  parede da clínica (`Y-m-d H:i`) — conta o que já aconteceu
     *                         (`Agendamento::jaContabilizavel`), o desfecho de hoje incluído
     * @param  string|null  $piso  corte inferior opcional (`Y-m-d H:i`); sem ele, o
     *                             teto de linhas já basta para limitar a varredura
     * @return array{consecutivas: int, ultima_em: string|null} `consecutivas` é a
     *                                                          sequência (limitada a `$teto`); `ultima_em` é a
     *                                                          data (`Y-m-d`) da ocorrência mais recente quando há
     *                                                          ao menos uma falta na ponta
     */
    public static function doPaciente(int $pacienteId, string $agora, int $teto, ?string $piso = null): array
    {
        $ultimos = Agendamento::query()
            ->where('tipo', 'atendimento')
            ->where('paciente_id', $pacienteId)
            ->whereNotNull('status_id')
            // MESMO predicado da assiduidade (change agendamentos-na-ficha, D5): já começou,
            // ou é de hoje com desfecho lançado. A falta que a clínica marca de manhã para a
            // sessão da tarde entra na sequência no mesmo dia — antes esperava o relógio.
            ->jaContabilizavel($agora)
            ->when($piso !== null, fn ($q) => $q->where('inicio', '>=', $piso))
            ->with('status:id,marca_falta')
            ->orderByDesc('inicio')
            ->take($teto)
            ->get(['id', 'paciente_id', 'status_id', 'inicio']);

        $consecutivas = 0;
        foreach ($ultimos as $agendamento) {
            if (! (bool) $agendamento->status?->marca_falta) {
                break; // o primeiro não-falta reinicia a contagem (P1)
            }
            $consecutivas++;
        }

        return [
            'consecutivas' => $consecutivas,
            'ultima_em' => $consecutivas > 0 ? $ultimos->first()->inicio->format('Y-m-d') : null,
        ];
    }
}
