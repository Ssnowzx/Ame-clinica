<?php

namespace App\Support\Indicadores;

use App\Models\Profissional;
use App\Support\Clinica\EvolucoesEmAberto;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\Escopo;
use Illuminate\Support\Collection;

/**
 * `GET /api/indicadores/painel/equipe` (change indicadores-profissionais, D4/D9) — sob `agenda.ver`
 * E `atendimentos.ver`, escopo D11 pela INTERSEÇÃO dos eixos (`agendaEClinico`), como a
 * produtividade que esta aba substitui: ocupação e marcações são da agenda, realizado e evolução
 * são dado clínico. O escopado recebe só a PRÓPRIA linha, e as evoluções da clínica viram as dele.
 *
 *  - **evoluções em dia:** sessões realizadas (que já passaram) com evolução ÷ realizadas;
 *  - **atrasadas:** as VENCIDAS da fila do aviso (`EvolucoesEmAberto::vencidasDoAviso`) — a mesma
 *    base do sem evolução (piso da janela), cortada pelo prazo: um SUBCONJUNTO dele, nunca "2 sem
 *    evolução, 3 passaram do prazo". O total, os profissionais com atraso e a coluna de cada linha
 *    saem da MESMA consulta, no escopo da interseção (o das linhas). A trava do finalizar conta sem
 *    o piso, e é outra função;
 *  - **sem evolução:** o TOTAL do aviso de evoluções em aberto do sino (`EvolucoesEmAberto::doAviso`),
 *    com o piso da janela e o eixo de escopo DELE — o clínico, não a interseção (CR-IND-04): o "i"
 *    diz "a mesma conta do aviso", e o número tem de ser o mesmo para todo usuário;
 *  - **por profissional** (só os ativos, como na produtividade): ocupação pela grade (nula sem
 *    horário — a pendência), marcadas, realizadas, faltas e as duas contas de evolução.
 *
 * Custo fixo (D8): histórico, cadastro de status, sessões (do período e, se houver histórico, do
 * comparado), a grade (cinco consultas), as vencidas agrupadas por profissional e o total do aviso.
 */
final class PainelDaEquipe
{
    public function __construct(
        private readonly EvolucoesEmAberto $evolucoes,
        private readonly ConfiguracaoService $configuracoes,
    ) {}

    /**
     * @param  Escopo  $escopo  a INTERSEÇÃO dos eixos (`agendaEClinico`) — linhas, em dia e atrasadas
     * @param  Escopo  $escopoClinico  o eixo clínico — só o `sem_evolucao`, o MESMO escopo do sino
     */
    public function calcular(PeriodoComparado $periodo, Escopo $escopo, Escopo $escopoClinico): array
    {
        $comparacao = ComparacaoDoPainel::para($periodo);
        $status = ClassificacaoDosStatus::daClinica();
        $agora = $periodo->agoraNaParede();
        $sessoes = SessoesDoPeriodo::agregar($escopo, $periodo->limites(), $agora, comEvolucao: true);
        $grade = GradeDoPeriodo::carregar($escopo, $periodo->de->toDateString(), $periodo->ate->toDateString());
        $vencidas = $this->vencidasPorProfissional($escopo);
        $contas = $this->contasPorProfissional($sessoes, $status);

        $linhas = $grade->profissionais()
            ->map(fn (Profissional $profissional): array => $this->linha(
                $profissional,
                $grade,
                $contas[$profissional->id] ?? null,
                $vencidas[$profissional->id] ?? 0,
                $periodo,
            ))
            ->sort(fn (array $a, array $b): int => [$b['realizadas'], $a['nome']] <=> [$a['realizadas'], $b['nome']])
            ->values()
            ->all();

        return [
            ...$comparacao->cabecalho(),
            'evolucoes' => [
                'em_dia' => $comparacao->par(
                    $this->emDia($contas),
                    fn (): ?float => $this->emDia($this->contasPorProfissional(
                        SessoesDoPeriodo::agregar($escopo, $periodo->limitesComparados(), $agora, comEvolucao: true),
                        $status,
                    )),
                ),
                'atrasadas' => array_sum($vencidas),
                'profissionais_com_atraso' => count(array_filter($vencidas)),
                // o total "sem evolução" (a mesma regra do bloco do sino) e o prazo: com os dois, a tela diz
                // "255 sem evolução, nenhuma passou do prazo" — sem eles, "nenhuma atrasada" ao lado dos 255
                // do "Pede atenção" parecia contradição (validação local de 05/10)
                'sem_evolucao' => $this->evolucoes->doAviso($escopoClinico)->count(),
                'prazo_dias' => (int) $this->configuracoes->get('evolucoes.prazo_dias'),
            ],
            'profissionais' => $linhas,
        ];
    }

    /**
     * Por profissional: marcadas (o período inteiro — o numerador da ocupação) e, sobre as que já
     * passaram, realizadas, faltas e realizadas com evolução.
     *
     * @param  Collection<int, object>  $sessoes
     * @return array<int, array{marcadas: int, realizadas: int, faltas: int, com_evolucao: int}>
     */
    private function contasPorProfissional(Collection $sessoes, ClassificacaoDosStatus $status): array
    {
        $contas = [];
        foreach ($sessoes as $linha) {
            if ($status->ehReserva($linha->status_id)) {
                continue;
            }
            $conta = $contas[$linha->profissional_id] ?? ['marcadas' => 0, 'realizadas' => 0, 'faltas' => 0, 'com_evolucao' => 0];
            $conta['marcadas'] += $status->ehMarcada($linha->status_id) ? $linha->total : 0;
            if ($linha->passou && $status->ehRealizada($linha->status_id)) {
                $conta['realizadas'] += $linha->total;
                $conta['com_evolucao'] += $linha->com_evolucao;
            }
            $conta['faltas'] += $linha->passou && $status->ehFalta($linha->status_id) ? $linha->total : 0;
            $contas[$linha->profissional_id] = $conta;
        }

        return $contas;
    }

    /**
     * Evoluções em dia de TODAS as sessões do escopo — inclusive de profissional já inativo: a
     * evolução que ele deixou de escrever continua sendo da clínica.
     *
     * @param  array<int, array{marcadas: int, realizadas: int, faltas: int, com_evolucao: int}>  $contas
     */
    private function emDia(array $contas): ?float
    {
        return ComparacaoDoPainel::taxa(
            array_sum(array_column($contas, 'com_evolucao')),
            array_sum(array_column($contas, 'realizadas')),
        );
    }

    /**
     * As evoluções VENCIDAS da fila do aviso por profissional (dono do agendamento), numa consulta
     * agregada. O escopo (a interseção) entra na base do aviso; o join só dá a coluna do agrupamento.
     *
     * @return array<int, int>
     */
    private function vencidasPorProfissional(Escopo $escopo): array
    {
        return $this->evolucoes->vencidasDoAviso($escopo)
            // a consulta canônica carrega paciente e profissional para a FILA; aqui só se conta
            ->withoutEagerLoads()
            ->reorder()
            ->join('agendamentos', fn ($join) => $join
                ->on('agendamentos.id', '=', 'atendimentos.agendamento_id'))
            ->groupBy('agendamentos.profissional_id')
            ->toBase()
            ->selectRaw('agendamentos.profissional_id as profissional_id, COUNT(*) as total')
            ->pluck('total', 'profissional_id')
            ->map(fn (int|string $total): int => (int) $total)
            ->all();
    }

    /**
     * Uma linha do contrato (D9). Do profissional sai SÓ id, nome e as especialidades — nada de
     * cadastro, nada de paciente.
     *
     * @param  array{marcadas: int, realizadas: int, faltas: int, com_evolucao: int}|null  $conta
     * @return array<string, mixed>
     */
    private function linha(Profissional $profissional, GradeDoPeriodo $grade, ?array $conta, int $vencidas, PeriodoComparado $periodo): array
    {
        $conta ??= ['marcadas' => 0, 'realizadas' => 0, 'faltas' => 0, 'com_evolucao' => 0];
        $temGrade = $grade->temGrade($profissional);
        $capacidade = 0.0;
        if ($temGrade) {
            // fracionária, SEM arredondar: a mesma régua da taxa do painel da agenda (gate r1, B2)
            $capacidade = GradeDoPeriodo::capacidadeTotal(
                $grade->capacidade($profissional, $periodo->de->toDateString(), $periodo->ate->toDateString()),
            );
        }

        return [
            'id' => $profissional->id,
            'nome' => $profissional->nome,
            'especialidades' => $profissional->especialidades->pluck('nome')->values()->all(),
            'tem_grade' => $temGrade,
            'ocupacao' => $temGrade ? ComparacaoDoPainel::taxa($conta['marcadas'], $capacidade) : null,
            'marcadas' => $conta['marcadas'],
            'realizadas' => $conta['realizadas'],
            'faltas' => $conta['faltas'],
            'evolucoes_em_dia' => ComparacaoDoPainel::taxa($conta['com_evolucao'], $conta['realizadas']),
            'evolucoes_atrasadas' => $vencidas,
        ];
    }
}
