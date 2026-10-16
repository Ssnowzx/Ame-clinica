<?php

namespace App\Support\Agenda;

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\StatusAgendamento;
use App\Support\Ciclos\GuardaDeCicloFechado;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * Baixa em massa da agenda de um profissional (change `desmarque-do-profissional`).
 *
 * O CÁLCULO é um só (design D1): a prévia e a execução chamam `resolver()` com os mesmos
 * parâmetros. A prévia devolve a classificação; a execução RECALCULA e então escreve — a prévia
 * nunca entrega uma lista de ids para a execução consumir, porque essa lista envelhece: entre
 * ver e confirmar, alguém finaliza um atendimento ou o faturamento fecha um ciclo, e escrever
 * sobre a lista velha é escrever num mundo que mudou.
 *
 * Esta classe NÃO escreve. Ela resolve e classifica; quem escreve é o controller, pelo
 * `AplicadorDeStatusEmLote` → `AgendamentoService`, para que a baixa em massa seja um CHAMADOR
 * A MAIS das guardas do agendamento individual, nunca um atalho em volta delas.
 *
 * A leitura do alcance (intervalo, período, teto, atendimentos registrados, crianças) vive na
 * espinha partilhada `AlcanceEmLote` (change `baixa-em-lote-por-status`, D1): o que fica aqui é
 * o que só o desmarque decide — quem é recusado, qual status se aplica e as janelas do bloqueio.
 */
class DesmarqueEmLote
{
    public const PERIODOS = AlcanceEmLote::PERIODOS;

    /** Motivos de recusa — o que a tela mostra ao lado de cada agendamento não tocado. */
    public const RECUSA_CICLO_FECHADO = 'ciclo_fechado';

    public const RECUSA_ATENDIMENTO = 'atendimento_registrado';

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly GuardaDeCicloFechado $ciclos,
        private readonly AlcanceEmLote $alcance,
    ) {}

    /**
     * Resolve o alcance e classifica cada agendamento em elegível ou recusado com motivo.
     *
     * @param  bool  $sobLock  na execução (D7 de `baixa-em-lote-por-status`): trava agendamentos
     *                         e atendimentos ANTES do loop, na ordem da casa
     * @return array{
     *     elegiveis: Collection<int, Agendamento>,
     *     recusados: list<array{agendamento: Agendamento, motivo: string}>,
     *     contagens: array{agendamentos: int, bloqueios: int, criancas: int, sessoes_estornadas: int}
     * }
     *
     * @throws ValidationException intervalo invertido, período inválido ou alcance acima do teto
     */
    public function resolver(int $profissionalId, string $de, string $ate, string $periodo, bool $sobLock = false): array
    {
        $this->alcance->assegurarPeriodo($periodo);
        [$inicio, $fim] = $this->alcance->intervalo($de, $ate);

        $alcancados = $this->alcance->atendimentosDoProfissional($profissionalId, $inicio, $fim, $periodo, $sobLock);

        // O BLOQUEIO conta no mesmo teto. Sem isso, um intervalo de anos com poucos
        // agendamentos passava limpo — o teto contava linhas de agenda — e o serviço criava um
        // bloqueio POR DIA: o gate mediu 1096 bloqueios em 3,12s com o alcance em ZERO
        // agendamentos. Pior, o caminho normal: a prévia dizia "1 agendamento · 1 criança" e a
        // operação escrevia 1206 linhas. O número que a pessoa confirma tem de ser o maior
        // número que a operação grava.
        $bloqueios = count($this->janelasDoBloqueio($de, $ate, $periodo));
        $this->alcance->assegurarTeto(
            $alcancados->count() + $bloqueios,
            'agenda.desmarque_em_lote_maximo',
            fn (int $total, int $teto): string => "A operação escreveria {$total} registros ({$alcancados->count()} agendamentos "
                ."e {$bloqueios} bloqueios) e o máximo por operação é {$teto}. "
                .'Estreite o intervalo de datas ou o período.',
        );

        $comAtendimento = $this->alcance->atendimentosRegistrados($alcancados, $sobLock);

        $elegiveis = collect();
        $recusados = [];
        foreach ($alcancados as $agendamento) {
            $motivo = $this->motivoDaRecusa($agendamento, $comAtendimento);
            if ($motivo !== null) {
                $recusados[] = ['agendamento' => $agendamento, 'motivo' => $motivo];

                continue;
            }
            $elegiveis->push($agendamento);
        }

        return [
            'elegiveis' => $elegiveis,
            'recusados' => $recusados,
            'contagens' => [
                'agendamentos' => $elegiveis->count(),
                // o que a operação GRAVA além dos agendamentos — a prévia é a proteção inteira
                // desta feature, e ela precisa dizer o maior número, não o menor
                'bloqueios' => $bloqueios,
                'criancas' => $this->alcance->criancasDistintas($elegiveis),
                // o estorno em massa aparece ANTES, para não ser surpresa no saldo do pacote
                'sessoes_estornadas' => $elegiveis->whereNotNull('sessao_consumida_em')->count(),
            ],
        ];
    }

    /**
     * O status que a operação aplica: o informado, ou o default da clínica (§13).
     * Ele NUNCA pode descontar sessão — imprevisto do profissional não consome a sessão da
     * criança —, e a validação se repete aqui porque a configuração pode ter sido gravada antes
     * de o status virar descontante.
     *
     * @throws ValidationException status ausente ou descontante
     */
    public function statusAplicado(?int $statusInformado): StatusAgendamento
    {
        $id = $statusInformado ?? (int) $this->configuracoes->get('agenda.status_desmarque_id');

        if ($id === 0) {
            throw ValidationException::withMessages([
                'status_id' => 'Configure o status do desmarque em Configurações › Agenda antes de desmarcar em lote.',
            ]);
        }

        $status = StatusAgendamento::whereKey($id)->first();
        if ($status === null) {
            throw ValidationException::withMessages([
                'status_id' => 'Status de agendamento desconhecido.',
            ]);
        }

        if ($status->desconta_sessao) {
            throw ValidationException::withMessages([
                'status_id' => 'O status do desmarque não pode descontar sessão da criança.',
            ]);
        }

        return $status;
    }

    /**
     * As janelas de cada dia do intervalo, para o bloqueio (design D5) — uma por dia, cobrindo
     * o período pedido. Vazio quando o dia não tem janela (período fora da janela da clínica).
     *
     * @return list<array{inicio: CarbonImmutable, fim: CarbonImmutable}>
     */
    public function janelasDoBloqueio(string $de, string $ate, string $periodo): array
    {
        $corte = $this->alcance->corte();
        $abertura = AlcanceEmLote::minutos((string) $this->configuracoes->get('agenda.janela_padrao_inicio'));
        $fechamento = AlcanceEmLote::minutos((string) $this->configuracoes->get('agenda.janela_padrao_fim'));

        [$deMinutos, $ateMinutos] = match ($periodo) {
            'manha' => [$abertura, min($corte, $fechamento)],
            'tarde' => [max($corte, $abertura), $fechamento],
            default => [$abertura, $fechamento],
        };

        if ($ateMinutos <= $deMinutos) {
            return [];
        }

        $janelas = [];
        $dia = CarbonImmutable::parse($de)->startOfDay();
        $ultimo = CarbonImmutable::parse($ate)->startOfDay();
        while ($dia->lessThanOrEqualTo($ultimo)) {
            $janelas[] = [
                'inicio' => $dia->addMinutes($deMinutos),
                'fim' => $dia->addMinutes($ateMinutos),
            ];
            $dia = $dia->addDay();
        }

        return $janelas;
    }

    /**
     * @param  Collection<int, Atendimento>  $comAtendimento  indexados pelo id do agendamento
     */
    private function motivoDaRecusa(Agendamento $agendamento, Collection $comAtendimento): ?string
    {
        // não se desmarca o que já aconteceu (decisão de produto, design D7)
        if ($comAtendimento->has($agendamento->id)) {
            return self::RECUSA_ATENDIMENTO;
        }

        // produção já enviada à operadora: mudar o status reescreveria o que foi faturado.
        // MESMA fonte única dos demais caminhos — a baixa em massa não tem régua própria
        if ($this->ciclos->emCicloFechado($agendamento->tratamento_id, $agendamento->inicio)) {
            return self::RECUSA_CICLO_FECHADO;
        }

        // sessão consumida NÃO recusa: o status não-descontante ESTORNA (design D7). A guarda
        // de consumo do domínio protege a EXCLUSÃO, e recusar aqui deixaria a criança sem a
        // sessão E sem o atendimento — o oposto do que a operação existe para evitar.
        return null;
    }
}
