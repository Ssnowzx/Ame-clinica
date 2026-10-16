<?php

namespace App\Support\Agenda;

use App\Models\StatusAgendamento;

/**
 * Conjunto default de status observado na referência (§6), com flags
 * desconta_sessao de partida (design D3 — chute informado, 100% editável pela
 * clínica; nenhuma regra depende do NOME do status, só da flag no banco).
 */
class StatusAgendamentoDefaults
{
    /**
     * `tipo` = ícone do status na grade (§2.3 do design system), do
     * CatalogoIconesStatus. É dado: a clínica troca o ícone junto com o nome.
     *
     * `em_aberto` (ainda sem desfecho — entra na baixa em lote) e `aplicavel_em_lote` (alvo
     * oferecido no "Dar baixa") são a semente da change baixa-em-lote-por-status (D2): só
     * "Em Aberto"/"Aguardando" nascem em aberto e só "Finalizado"/"Falta Justificada" nascem
     * aplicáveis — "Consulta", "Reposição", "Não Compareceu" e "Finalizado com Evolução" a
     * clínica liga na tela, que diz a consequência. `marca_reserva` nasce em "Reserva de
     * Agenda" (a migration semeava por nome; a clínica nova nascia sem a flag).
     *
     * @var list<array{nome: string, cor: string, tipo: string, desconta_sessao: bool, ocupa_horario: bool, ordem: int, marca_falta?: bool, marca_reserva?: bool, em_aberto?: bool, aplicavel_em_lote?: bool}>
     */
    public const DEFAULTS = [
        ['nome' => 'Em Aberto', 'cor' => '#64748B', 'tipo' => 'circle-dashed', 'desconta_sessao' => false, 'ocupa_horario' => true, 'em_aberto' => true, 'ordem' => 1],
        ['nome' => 'Aguardando Atendimento', 'cor' => '#F59E0B', 'tipo' => 'clock', 'desconta_sessao' => false, 'ocupa_horario' => true, 'em_aberto' => true, 'ordem' => 2],
        ['nome' => 'Finalizado', 'cor' => '#10B981', 'tipo' => 'check', 'desconta_sessao' => true, 'ocupa_horario' => true, 'aplicavel_em_lote' => true, 'ordem' => 3],
        ['nome' => 'Finalizado com Evolução', 'cor' => '#059669', 'tipo' => 'clipboard-check', 'desconta_sessao' => true, 'ocupa_horario' => true, 'ordem' => 4],
        ['nome' => 'Não Compareceu', 'cor' => '#EF4444', 'tipo' => 'user-x', 'desconta_sessao' => true, 'ocupa_horario' => true, 'marca_falta' => true, 'ordem' => 5],
        ['nome' => 'Falta Justificada', 'cor' => '#F97316', 'tipo' => 'file-check', 'desconta_sessao' => false, 'ocupa_horario' => true, 'aplicavel_em_lote' => true, 'ordem' => 6],
        ['nome' => 'Desmarcado pelo Profissional', 'cor' => '#94A3B8', 'tipo' => 'calendar-x', 'desconta_sessao' => false, 'ocupa_horario' => false, 'ordem' => 7],
        ['nome' => 'Reserva de Agenda', 'cor' => '#8B5CF6', 'tipo' => 'bookmark', 'desconta_sessao' => false, 'ocupa_horario' => true, 'marca_reserva' => true, 'ordem' => 8],
        ['nome' => 'Consulta', 'cor' => '#3B82F6', 'tipo' => 'stethoscope', 'desconta_sessao' => false, 'ocupa_horario' => true, 'ordem' => 9],
        ['nome' => 'Reposição', 'cor' => '#14B8A6', 'tipo' => 'rotate-ccw', 'desconta_sessao' => false, 'ocupa_horario' => true, 'ordem' => 10],
        // a família desmarcou (change `lembrete-com-botoes-de-resposta`, resposta da clínica em
        // 28/09): libera o horário para outra criança, não consome a sessão e não é falta
        self::DESMARCADO_PELO_PACIENTE,
    ];

    /**
     * Também usado pelo backfill da clínica já existente, que cria SÓ este status — rodar
     * `criar` de novo ressuscitaria os status que a clínica apagou ou renomeou.
     *
     * @var array{nome: string, cor: string, tipo: string, desconta_sessao: bool, ocupa_horario: bool, ordem: int}
     */
    public const DESMARCADO_PELO_PACIENTE = ['nome' => 'Desmarcado pelo Paciente', 'cor' => '#78716C', 'tipo' => 'ban', 'desconta_sessao' => false, 'ocupa_horario' => false, 'ordem' => 11];

    /** Idempotente: cria, por nome, os status default que ainda não existem. */
    public static function criar(): void
    {
        foreach (self::DEFAULTS as $status) {
            StatusAgendamento::firstOrCreate(['nome' => $status['nome']], $status);
        }
    }
}
