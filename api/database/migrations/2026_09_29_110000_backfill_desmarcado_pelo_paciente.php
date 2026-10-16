<?php

use App\Support\Agenda\StatusAgendamentoDefaults;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * "Desmarcado pelo Paciente" na clínica que já existe (change `lembrete-com-botoes-de-resposta`,
 * design D12). A clínica respondeu em 28/09: *"Pode colocar desmarcado pelo paciente"* — e o status
 * não existia.
 *
 * Idempotente e POR NOME: se a clínica já tem um status com esse nome não ganha outro, e rodar de
 * novo não desfaz a edição da clínica. Cria SÓ este status — `StatusAgendamentoDefaults::criar`
 * recriaria, por nome, qualquer default que a clínica tenha apagado ou renomeado. O ponteiro
 * `lembretes.status_desmarque_familia_id` NÃO é gravado aqui: é escolha da clínica, feita na tela.
 * Num banco novo (sem a linha da clínica) é no-op: os defaults nascem com a clínica.
 */
return new class extends Migration
{
    public function up(): void
    {
        $padrao = StatusAgendamentoDefaults::DESMARCADO_PELO_PACIENTE;

        if (! DB::table('clinica')->exists()
            || DB::table('status_agendamento')->where('nome', $padrao['nome'])->exists()) {
            return;
        }

        $agora = now();
        $ordem = (int) DB::table('status_agendamento')->max('ordem');

        DB::table('status_agendamento')->insert([
            'nome' => $padrao['nome'],
            'cor' => $padrao['cor'],
            'tipo' => $padrao['tipo'],
            'desconta_sessao' => false,
            'ocupa_horario' => false,
            'marca_falta' => false,
            'marca_reserva' => false,
            'em_aberto' => false,
            'aplicavel_em_lote' => false,
            // o mesmo teto da tela de status (N3)
            'ordem' => min($ordem + 1, 999),
            'created_at' => $agora,
            'updated_at' => $agora,
        ]);
    }

    /** Irreversível de propósito: o status pode já estar em uso por agendamentos da clínica. */
    public function down(): void {}
};
