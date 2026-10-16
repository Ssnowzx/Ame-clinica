<?php

namespace App\Support\Indicadores;

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\LembreteEnviado;
use App\Models\Profissional;
use App\Support\Rbac\Escopo;
use Illuminate\Support\Collection;

/**
 * `GET /api/indicadores/painel/agenda` (change indicadores-profissionais, D4/D9) — sob `agenda.ver`,
 * escopo D11 do eixo agenda: o escopado vê os números da PRÓPRIA agenda.
 *
 * As definições moram em `ClassificacaoDosStatus` (pelas flags) e a base de toda porcentagem é a
 * sessão que JÁ PASSOU (`SessoesDoPeriodo`). A ocupação é a exceção deliberada: o numerador são as
 * sessões MARCADAS do período inteiro (até o fim de hoje) porque o denominador — a grade — também
 * conta o dia de hoje inteiro.
 *
 * Custo fixo (D8): histórico, cadastro de status, sessões do período e do comparado, a grade (cinco
 * consultas), convênios (duas) e lembretes (duas) — nada cresce com o número de profissionais.
 */
final class PainelDaAgenda
{
    /** Convênios nomeados no corte por convênio; o resto vira a linha "Outros" (D9). */
    private const CONVENIOS_NOMEADOS = 8;

    public function calcular(PeriodoComparado $periodo, Escopo $escopo): array
    {
        $comparacao = ComparacaoDoPainel::para($periodo);
        $status = ClassificacaoDosStatus::daClinica();
        $agora = $periodo->agoraNaParede();

        $atual = SessoesDoPeriodo::agregar($escopo, $periodo->limites(), $agora);
        $anterior = $comparacao->comparavel()
            ? SessoesDoPeriodo::agregar($escopo, $periodo->limitesComparados(), $agora)
            : null;
        // uma carga só para os dois períodos: os bloqueios cobrem do começo do comparado ao fim do atual —
        // e só do atual quando não há comparação (PERF-05: nada de ler bloqueio que nenhuma conta usa)
        $primeiroDia = $anterior === null ? $periodo->de : $periodo->comparadoDe;
        $grade = GradeDoPeriodo::carregar($escopo, $primeiroDia->toDateString(), $periodo->ate->toDateString());
        $ocupacao = $this->ocupacao($atual, $grade, $status, $periodo->de->toDateString(), $periodo->ate->toDateString());

        return [
            ...$comparacao->cabecalho(),
            'ocupacao' => [
                'atual' => $ocupacao['taxa'],
                'anterior' => $comparacao->anterior(fn (): ?float => $this->ocupacao(
                    $anterior ?? collect(), $grade, $status,
                    $periodo->comparadoDe->toDateString(), $periodo->comparadoAte->toDateString(),
                )['taxa']),
                'profissionais_com_grade' => $ocupacao['profissionais_com_grade'],
                'profissionais' => $ocupacao['profissionais'],
            ],
            ...$this->paresDaBase($comparacao, $this->contagens($atual, $status), $anterior === null ? null : $this->contagens($anterior, $status)),
            // foto do período, sem par (D4): as que já passaram e seguem sem desfecho
            'sem_baixa' => $this->passadas($atual, $status)->sum(fn (object $linha): int => $status->ehEmAberto($linha->status_id) ? $linha->total : 0),
            'confirmadas' => [
                'atual' => $this->confirmacao($this->confirmadas($escopo, $periodo->limites())),
                // sem lembrete ENVIADO no período comparado, não há o que comparar (D9)
                'anterior' => $comparacao->anterior(function () use ($escopo, $periodo): ?array {
                    $doComparado = $this->confirmadas($escopo, $periodo->limitesComparados());

                    return $doComparado['enviados'] === 0 ? null : $this->confirmacao($doComparado);
                }),
            ],
            'status_que_contam' => $status->quemConta(),
            'faltas_por_dia_semana' => $this->faltasPorDiaDaSemana($atual, $status),
            'ocupacao_por_periodo' => $ocupacao['mapa'],
            'por_convenio' => $this->porConvenio($escopo, $periodo->limites(), $agora, $status),
            'situacao' => $this->situacao($atual, $status),
        ];
    }

    /**
     * Os quatro pares que saem da BASE (sessões que já passaram): realizadas, a própria base,
     * faltas e desmarques — os dois últimos como `{quantidade, taxa}` (D9).
     *
     * @param  array{passadas: int, faltas: int, desmarques: int, realizadas: int}  $atual
     * @param  array{passadas: int, faltas: int, desmarques: int, realizadas: int}|null  $anterior
     * @return array<string, array{atual: mixed, anterior: mixed}>
     */
    private function paresDaBase(ComparacaoDoPainel $comparacao, array $atual, ?array $anterior): array
    {
        $taxaDe = fn (?array $conta, string $chave): ?array => $conta === null
            ? null
            : $this->quantidadeETaxa($conta[$chave], $conta['passadas']);

        return [
            'realizadas' => $comparacao->par($atual['realizadas'], fn (): ?int => $anterior['realizadas'] ?? null),
            'sessoes_passadas' => $comparacao->par($atual['passadas'], fn (): ?int => $anterior['passadas'] ?? null),
            'faltas' => $comparacao->par($taxaDe($atual, 'faltas'), fn (): ?array => $taxaDe($anterior, 'faltas')),
            'desmarques' => $comparacao->par($taxaDe($atual, 'desmarques'), fn (): ?array => $taxaDe($anterior, 'desmarques')),
        ];
    }

    /**
     * A ocupação de um período: marcadas ÷ capacidade da grade, SÓ dos profissionais com grade
     * (D4) — quem não tem horário cadastrado não tem denominador, e somá-lo no numerador inflaria
     * a taxa. Devolve junto quantos profissionais com sessão no período têm grade, de quantos têm
     * sessão: é a frase que diz sobre quem a conta foi feita.
     *
     * O mapa (dia × faixa) é a MESMA conta partida. A capacidade de cada CÉLULA é arredondada para
     * sessões inteiras, porque é o que a tabela mostra; a TAXA total divide pela capacidade ainda
     * fracionária (`GradeDoPeriodo::capacidadeTotal`), a mesma régua da linha de cada profissional em
     * Indicadores › Equipe e na ficha (change painel-do-profissional, gate r1, B2). Antes ela somava
     * as células arredondadas: com sessão de 50 min, 1–15/10 deu 54 sessões aqui e 53 na Equipe
     * (52,8 de verdade) — 74% numa tela e 75% na outra para as mesmas 40 marcadas.
     *
     * @param  Collection<int, object>  $sessoes
     * @return array{taxa: ?float, profissionais: int, profissionais_com_grade: int, mapa: list<array<string, mixed>>}
     */
    private function ocupacao(Collection $sessoes, GradeDoPeriodo $grade, ClassificacaoDosStatus $status, string $de, string $ate): array
    {
        $comGrade = $grade->profissionais()->filter(fn ($profissional): bool => $grade->temGrade($profissional));
        $capacidade = $this->capacidadePorCelula($comGrade, $grade, $de, $ate);

        $marcadas = array_fill(1, 7, array_fill_keys(array_keys(CapacidadeDoMes::FAIXAS_DO_DIA), 0));
        $comSessao = [];
        foreach ($sessoes as $linha) {
            if ($status->ehReserva($linha->status_id) || ! $grade->profissionais()->has($linha->profissional_id)) {
                continue;
            }
            $comSessao[$linha->profissional_id] = true;
            if ($comGrade->has($linha->profissional_id) && $status->ehMarcada($linha->status_id)) {
                $marcadas[$linha->dia][$linha->faixa] += $linha->total;
            }
        }

        $mapa = $this->mapa($marcadas, $capacidade);

        return [
            'taxa' => ComparacaoDoPainel::taxa(
                array_sum(array_map('array_sum', $marcadas)),
                GradeDoPeriodo::capacidadeTotal($capacidade),
            ),
            'profissionais' => count($comSessao),
            'profissionais_com_grade' => count(array_filter(
                array_keys($comSessao),
                fn (int $id): bool => $comGrade->has($id),
            )),
            'mapa' => $mapa,
        ];
    }

    /**
     * A capacidade da clínica em sessões por dia × faixa — a soma da grade de cada profissional
     * com grade, ainda fracionária (o arredondamento é da célula, no mapa).
     *
     * @param  Collection<int, Profissional>  $comGrade
     * @return array<int, array<string, float>>
     */
    private function capacidadePorCelula(Collection $comGrade, GradeDoPeriodo $grade, string $de, string $ate): array
    {
        $capacidade = array_fill(1, 7, array_fill_keys(array_keys(CapacidadeDoMes::FAIXAS_DO_DIA), 0.0));
        foreach ($comGrade as $profissional) {
            foreach ($grade->capacidade($profissional, $de, $ate) as $dia => $faixas) {
                foreach ($faixas as $faixa => $sessoesNaGrade) {
                    $capacidade[$dia][$faixa] += $sessoesNaGrade;
                }
            }
        }

        return $capacidade;
    }

    /**
     * As células do mapa com marcação ou capacidade, em ordem de dia e faixa. A capacidade de
     * cada célula é arredondada para sessões inteiras, e a taxa sai das contagens inteiras.
     *
     * @param  array<int, array<string, int>>  $marcadas
     * @param  array<int, array<string, float>>  $capacidade
     * @return list<array{dia: int, periodo: string, marcadas: int, capacidade: int, taxa: ?float}>
     */
    private function mapa(array $marcadas, array $capacidade): array
    {
        $mapa = [];
        for ($dia = 1; $dia <= 7; $dia++) {
            foreach (array_keys(CapacidadeDoMes::FAIXAS_DO_DIA) as $faixa) {
                $celulaCapacidade = (int) round($capacidade[$dia][$faixa]);
                $celulaMarcadas = $marcadas[$dia][$faixa];
                if ($celulaMarcadas === 0 && $celulaCapacidade === 0) {
                    continue;
                }
                $mapa[] = [
                    'dia' => $dia,
                    'periodo' => $faixa,
                    'marcadas' => $celulaMarcadas,
                    'capacidade' => $celulaCapacidade,
                    'taxa' => ComparacaoDoPainel::taxa($celulaMarcadas, $celulaCapacidade),
                ];
            }
        }

        return $mapa;
    }

    /**
     * As contagens sobre a BASE — as sessões que já passaram, sem reserva.
     *
     * @param  Collection<int, object>  $sessoes
     * @return array{passadas: int, faltas: int, desmarques: int, realizadas: int}
     */
    private function contagens(Collection $sessoes, ClassificacaoDosStatus $status): array
    {
        $contagem = ['passadas' => 0, 'faltas' => 0, 'desmarques' => 0, 'realizadas' => 0];
        foreach ($this->passadas($sessoes, $status) as $linha) {
            $contagem['passadas'] += $linha->total;
            $contagem['faltas'] += $status->ehFalta($linha->status_id) ? $linha->total : 0;
            $contagem['desmarques'] += $status->ehDesmarque($linha->status_id) ? $linha->total : 0;
            $contagem['realizadas'] += $status->ehRealizada($linha->status_id) ? $linha->total : 0;
        }

        return $contagem;
    }

    /**
     * @param  Collection<int, object>  $sessoes
     * @return Collection<int, object>
     */
    private function passadas(Collection $sessoes, ClassificacaoDosStatus $status): Collection
    {
        return $sessoes->filter(fn (object $linha): bool => $linha->passou && ! $status->ehReserva($linha->status_id));
    }

    /** @return array{quantidade: int, taxa: ?float} */
    private function quantidadeETaxa(int $quantidade, int $base): array
    {
        return ['quantidade' => $quantidade, 'taxa' => ComparacaoDoPainel::taxa($quantidade, $base)];
    }

    /**
     * Os lembretes ENVIADOS cujo horário lembrado cai no período, e quantos a família (ou a
     * clínica, em nome dela) confirmou (D4). O escopo vem do agendamento do lembrete.
     *
     * @param  array{0: string, 1: string}  $limites
     * @return array{confirmadas: int, enviados: int}
     */
    private function confirmadas(Escopo $escopo, array $limites): array
    {
        $linha = $escopo->aplicar(
            LembreteEnviado::query()
                ->join('agendamentos', fn ($join) => $join
                    ->on('agendamentos.id', '=', 'lembretes_enviados.agendamento_id'))
                ->where('lembretes_enviados.tipo', LembreteEnviado::TIPO_AGENDAMENTO)
                ->where('lembretes_enviados.status', LembreteEnviado::ENVIADO)
                ->whereBetween('lembretes_enviados.inicio_lembrado', $limites),
            'agendamentos.profissional_id',
        )
            ->toBase()
            ->selectRaw(
                'COUNT(*) as enviados, COALESCE(SUM(CASE WHEN lembretes_enviados.resposta = ? THEN 1 ELSE 0 END), 0) as confirmadas',
                [LembreteEnviado::CONFIRMOU],
            )
            ->first();

        return ['confirmadas' => (int) ($linha->confirmadas ?? 0), 'enviados' => (int) ($linha->enviados ?? 0)];
    }

    /**
     * @param  array{confirmadas: int, enviados: int}  $contagem
     * @return array{confirmadas: int, enviados: int, taxa: ?float}
     */
    private function confirmacao(array $contagem): array
    {
        return [...$contagem, 'taxa' => ComparacaoDoPainel::taxa($contagem['confirmadas'], $contagem['enviados'])];
    }

    /**
     * Faltas por dia da semana (ISO, 1 = segunda), só dos dias com sessão que já passou.
     *
     * @param  Collection<int, object>  $sessoes
     * @return list<array{dia: int, sessoes: int, faltas: int, taxa: ?float}>
     */
    private function faltasPorDiaDaSemana(Collection $sessoes, ClassificacaoDosStatus $status): array
    {
        $porDia = [];
        foreach ($this->passadas($sessoes, $status) as $linha) {
            $porDia[$linha->dia] ??= ['sessoes' => 0, 'faltas' => 0];
            $porDia[$linha->dia]['sessoes'] += $linha->total;
            $porDia[$linha->dia]['faltas'] += $status->ehFalta($linha->status_id) ? $linha->total : 0;
        }
        ksort($porDia);

        return array_values(array_map(
            fn (int $dia, array $conta): array => [
                'dia' => $dia,
                'sessoes' => $conta['sessoes'],
                'faltas' => $conta['faltas'],
                'taxa' => ComparacaoDoPainel::taxa($conta['faltas'], $conta['sessoes']),
            ],
            array_keys($porDia),
            $porDia,
        ));
    }

    /**
     * Faltas e desmarques por convênio das sessões que já passaram: os 8 maiores pelo volume e o
     * resto numa linha "Outros" que diz quantos convênios juntou. A sessão sem pacote não tem
     * convênio e vira a linha "Sem convênio" — o mesmo rótulo que a tela já usa para o caso.
     * `taxa` = (faltas + desmarques) ÷ sessões.
     *
     * @param  array{0: string, 1: string}  $limites
     * @return list<array<string, mixed>>
     */
    private function porConvenio(Escopo $escopo, array $limites, string $agora, ClassificacaoDosStatus $status): array
    {
        $porConvenio = $this->contasPorConvenio($escopo, $limites, $agora, $status);
        $convenios = Convenio::query()
            ->whereIn('id', array_filter(array_keys($porConvenio)))
            ->get(['id', 'nome', 'particular'])
            ->keyBy('id');

        $ordenadas = collect($porConvenio)
            ->map(fn (array $conta, int $id): array => [
                'nome' => $id === 0 ? 'Sem convênio' : (string) ($convenios->get($id)?->nome ?? ''),
                'particular' => $id !== 0 && (bool) $convenios->get($id)?->particular,
                ...$conta,
            ])
            ->sort(fn (array $a, array $b): int => [$b['sessoes'], $a['nome']] <=> [$a['sessoes'], $b['nome']])
            ->values();

        $nomeadas = $ordenadas->take(self::CONVENIOS_NOMEADOS)
            ->map(fn (array $linha): array => $this->comTaxaDePerda($linha))
            ->all();
        $resto = $ordenadas->slice(self::CONVENIOS_NOMEADOS);

        if ($resto->isNotEmpty()) {
            $nomeadas[] = $this->comTaxaDePerda([
                'nome' => 'Outros',
                'outros' => $resto->count(),
                'particular' => false,
                'sessoes' => $resto->sum('sessoes'),
                'faltas' => $resto->sum('faltas'),
                'desmarques' => $resto->sum('desmarques'),
            ]);
        }

        return $nomeadas;
    }

    /**
     * As sessões que já passaram agregadas por convênio do pacote × status, numa consulta — a
     * chave 0 é a sessão sem pacote.
     *
     * @param  array{0: string, 1: string}  $limites
     * @return array<int, array{sessoes: int, faltas: int, desmarques: int}>
     */
    private function contasPorConvenio(Escopo $escopo, array $limites, string $agora, ClassificacaoDosStatus $status): array
    {
        $linhas = $escopo->aplicar(
            Agendamento::query()
                ->leftJoin('tratamentos', fn ($join) => $join
                    ->on('tratamentos.id', '=', 'agendamentos.tratamento_id'))
                ->where('agendamentos.tipo', 'atendimento')
                ->whereBetween('agendamentos.inicio', $limites)
                ->where('agendamentos.inicio', '<', $agora),
            'agendamentos.profissional_id',
        )
            ->groupBy('tratamentos.convenio_id', 'agendamentos.status_id')
            ->selectRaw('tratamentos.convenio_id as convenio_id, agendamentos.status_id as status_id, COUNT(*) as total')
            ->toBase()
            ->get();

        $porConvenio = [];
        foreach ($linhas as $linha) {
            $statusId = $linha->status_id === null ? null : (int) $linha->status_id;
            if ($status->ehReserva($statusId)) {
                continue;
            }
            $chave = $linha->convenio_id === null ? 0 : (int) $linha->convenio_id;
            $porConvenio[$chave] ??= ['sessoes' => 0, 'faltas' => 0, 'desmarques' => 0];
            $porConvenio[$chave]['sessoes'] += (int) $linha->total;
            $porConvenio[$chave]['faltas'] += $status->ehFalta($statusId) ? (int) $linha->total : 0;
            $porConvenio[$chave]['desmarques'] += $status->ehDesmarque($statusId) ? (int) $linha->total : 0;
        }

        return $porConvenio;
    }

    /**
     * @param  array<string, mixed>  $linha
     * @return array<string, mixed>
     */
    private function comTaxaDePerda(array $linha): array
    {
        return [...$linha, 'taxa' => ComparacaoDoPainel::taxa($linha['faltas'] + $linha['desmarques'], $linha['sessoes'])];
    }

    /**
     * Situação das sessões que JÁ PASSARAM, uma linha por status com quantidade, na ordem do
     * cadastro — o que substitui o "Em Aberto 2.815" das sessões futuras.
     *
     * @param  Collection<int, object>  $sessoes
     * @return list<array{status_id: int, nome: string, cor: string|null, quantidade: int}>
     */
    private function situacao(Collection $sessoes, ClassificacaoDosStatus $status): array
    {
        $porStatus = [];
        foreach ($this->passadas($sessoes, $status) as $linha) {
            if ($linha->status_id !== null) {
                $porStatus[$linha->status_id] = ($porStatus[$linha->status_id] ?? 0) + $linha->total;
            }
        }

        return $status->emOrdem()
            ->filter(fn ($registro): bool => ($porStatus[$registro->id] ?? 0) > 0)
            ->map(fn ($registro): array => [
                'status_id' => (int) $registro->id,
                'nome' => (string) $registro->nome,
                'cor' => $registro->cor,
                'quantidade' => $porStatus[$registro->id],
            ])
            ->values()
            ->all();
    }
}
