<?php

namespace App\Support\Mensageria;

use Illuminate\Support\Facades\DB;

/**
 * Backfill de `lembretes_enviados.paciente_id` / `inicio_lembrado` para as linhas que já existiam
 * antes da change `lembrete-com-botoes-de-resposta` (chamado pela migration `2026_09_29_100000`).
 *
 * Copia a criança e o horário ATUAIS do agendamento — mas o horário SÓ quando a data dele ainda é a
 * `competencia` do lembrete (rodada 2 do gate, CRB2-01): um lembrete antigo de uma sessão que depois
 * foi remarcada para outro dia não pode "valer" para a sessão da nova data. Fora disso fica nulo, e a
 * regra (`LembreteEnviado::valeParaASessao`) falha fechada.
 * Um só UPDATE, sem carregar modelos; rodar de novo dá o mesmo resultado.
 */
final class PreenchimentoDoLembrado
{
    public static function preencher(): void
    {
        DB::statement('UPDATE lembretes_enviados le
            JOIN agendamentos a ON a.id = le.agendamento_id
            SET le.paciente_id = a.paciente_id,
                le.inicio_lembrado = CASE WHEN DATE(a.inicio) = le.competencia THEN a.inicio END');
    }
}
