<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "Este status ainda NÃO teve desfecho?" e "este status é ALVO do lote?" viram flags
 * (change baixa-em-lote-por-status, D2).
 *
 * Mesmo padrão de `marca_falta` e `marca_reserva`, pela mesma razão (§13): a baixa em lote
 * precisa saber quem entra (`em_aberto`) e quem pode ser aplicado (`aplicavel_em_lote`), e
 * decidir isso pelo NOME quebraria no dia em que a clínica renomeasse "Aguardando Atendimento"
 * para "Na sala de espera". Derivar das flags existentes também falha: "Falta Justificada" não
 * desconta, não marca falta e ocupa horário — e seria varrida por um Finalizar em massa.
 *
 * O backfill por nome é semente, UMA vez só: só a clínica que ainda não tem nenhuma das duas
 * flags ligadas recebe a semente — rodar de novo não desfaz o que a clínica editou depois.
 * A varredura que segue olha o status INICIAL (menor `ordem`, desempate `id`):
 * se ele ficou fora do em aberto (a clínica renomeou "Em Aberto", por exemplo) e não carrega
 * nenhum desfecho, ganha a flag — é o invariante que `GuardaDoStatusInicial` passa a exigir.
 * Se carrega desfecho (desconta, marca falta ou reserva, libera o horário), fica sem, e a tela
 * de status acusa no primeiro salvamento. A migration não corrige cadastro: só semeia.
 *
 * O DDL é guardado por `hasColumn` para que o CORPO (semente + varredura) possa rodar sobre o
 * banco já migrado — é assim que o teste de migration prova o efeito, no molde de
 * `conceder_cadastro_online`.
 */
return new class extends Migration
{
    /** @var list<string> */
    private const EM_ABERTO_POR_NOME = ['Em Aberto', 'Aguardando Atendimento'];

    /** @var list<string> */
    private const APLICAVEL_EM_LOTE_POR_NOME = ['Finalizado', 'Falta Justificada'];

    public function up(): void
    {
        if (! Schema::hasColumn('status_agendamento', 'em_aberto')) {
            Schema::table('status_agendamento', function (Blueprint $table): void {
                $table->boolean('em_aberto')->default(false)->after('marca_reserva');
                $table->boolean('aplicavel_em_lote')->default(false)->after('em_aberto');
            });
        }

        $this->semearPorNomeUmaVez();
        $this->marcarOInicial();
    }

    public function down(): void
    {
        Schema::table('status_agendamento', function (Blueprint $table): void {
            $table->dropColumn(['em_aberto', 'aplicavel_em_lote']);
        });
    }

    /**
     * Só a clínica VIRGEM (nenhuma das duas flags ligada em status nenhum) recebe a semente por
     * nome. Clínica nova nasce pelos DEFAULTS; clínica já semeada não é tocada de novo.
     */
    private function semearPorNomeUmaVez(): void
    {
        $jaSemeada = DB::table('status_agendamento')
            ->where(fn ($q) => $q->where('em_aberto', true)->orWhere('aplicavel_em_lote', true))
            ->exists();

        if ($jaSemeada) {
            return;
        }

        DB::table('status_agendamento')
            ->whereIn('nome', self::EM_ABERTO_POR_NOME)
            ->update(['em_aberto' => true]);

        DB::table('status_agendamento')
            ->whereIn('nome', self::APLICAVEL_EM_LOTE_POR_NOME)
            ->update(['aplicavel_em_lote' => true]);
    }

    /**
     * O status inicial (menor `ordem`, desempate `id`) ganha `em_aberto` quando não carrega
     * desfecho nem é alvo do lote — os mesmos invariantes que a guarda cobra depois.
     */
    private function marcarOInicial(): void
    {
        $inicial = DB::table('status_agendamento')
            ->orderBy('ordem')
            ->orderBy('id')
            ->first(['id', 'em_aberto', 'aplicavel_em_lote', 'desconta_sessao', 'marca_falta', 'marca_reserva', 'ocupa_horario']);

        if ($inicial === null || $inicial->em_aberto || ! $this->podeEstarEmAberto($inicial)) {
            return;
        }

        DB::table('status_agendamento')->where('id', $inicial->id)->update(['em_aberto' => true]);
    }

    private function podeEstarEmAberto(object $status): bool
    {
        return ! $status->desconta_sessao
            && ! $status->marca_falta
            && ! $status->marca_reserva
            && ! $status->aplicavel_em_lote
            && (bool) $status->ocupa_horario;
    }
};
