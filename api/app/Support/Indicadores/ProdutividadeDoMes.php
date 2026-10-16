<?php

namespace App\Support\Indicadores;

use App\Models\Agendamento;
use App\Models\Feriado;
use App\Models\Profissional;
use App\Support\Rbac\Escopo;
use Carbon\Carbon;
use Illuminate\Support\Collection;

/**
 * A vista de PRODUTIVIDADE do mês (change produtividade-do-profissional, §11): por profissional
 * ativo, a capacidade pela grade real (`CapacidadeDoMes`) confrontada com o que aconteceu com ela.
 *
 * Os agendamentos são agregados em SQL por profissional × dia da semana × BALDE; a capacidade é
 * calendário e fica em PHP. SEIS consultas por requisição, independentemente do número de
 * profissionais (medido com `DB::enableQueryLog`: 6 com 1 e 6 com 12 profissionais — sem N+1):
 * profissionais, especialidades, horários, feriados, bloqueios e a agregação.
 *
 * **Status é DADO (§13): a classificação usa as FLAGS, nunca o nome.** Cada agendamento de
 * atendimento cai em UM balde, nesta ordem:
 *   0. `marca_reserva`          → liberado se `ocupa_horario = false`; senão em aberto
 *   1. `marca_falta`            → falta
 *   2. `desconta_sessao`        → realizado
 *   3. `ocupa_horario = false`  → liberado (devolveu o horário)
 *   4. o resto                  → em aberto
 *
 * A RESERVA vem antes de tudo (change painel-do-profissional, gate r1/r2): ela NUNCA é realizada nem
 * falta — como em `ClassificacaoDosStatus`, que o cartão do painel lê; um status de reserva que também
 * descontasse a sessão contava na série e não no cartão (I1). E o horário dela segue o que a clínica
 * configurou: a reserva que SEGURA o horário é "em aberto" (marcada, sem cobrança — o manual), a que
 * o LIBERA (`ocupa_horario = false`, que o cadastro de status permite) é "liberado", como qualquer
 * status que devolve o horário. Mandá-la para um balde fora de "marcado" (a primeira correção) fazia
 * do horário segurado hora ociosa; pô-la inteira em "em aberto" (a segunda) fazia da reserva que
 * libera uma marcada (gate r2).
 *
 * A FALTA vem ANTES do realizado, e isso é deliberado: o status padrão "Não Compareceu" carrega
 * as duas flags (`desconta_sessao` porque a clínica cobra a sessão perdida; `marca_falta` porque
 * é falta). Classificar pelo `desconta_sessao` primeiro contaria toda falta cobrada como trabalho
 * REALIZADO — e o cenário da spec ("a clínica renomeou o status com `marca_falta` para 'Ausente'
 * → conta em `faltas`") reprovaria com o catálogo padrão. Realizado é, portanto, "desconta a
 * sessão E não é falta".
 *
 * *Marcado* = realizado + falta + em aberto (o liberado não ocupa mais a grade). Percentuais são
 * inteiros calculados AQUI (D3): ocupação = marcado ÷ grade, produtividade = realizado ÷ grade,
 * aproveitamento = realizado ÷ marcado; `null` sem denominador, e o teto é 100 (o contrato
 * promete 0..100 — marcado fora da janela configurada não estoura a barra da tela; os minutos
 * ao lado explicam).
 *
 * Do profissional sai SÓ id, nome e versão da foto (+ a especialidade principal); nada de
 * cadastro, nada de paciente — a resposta é whitelist explícita, nunca `toArray()` do model.
 */
final class ProdutividadeDoMes
{
    private const BALDES = ['realizado', 'falta', 'liberado', 'em_aberto'];

    /**
     * A expressão do balde, UMA só (a ordem dos WHEN está no docblock da classe). Status ausente (LEFT
     * JOIN sem par) cai em "em aberto".
     *
     * Quem agrupa por ela agrupa pelo APELIDO (`balde`), nunca repetindo a expressão no GROUP BY: com
     * qualquer condição composta num WHEN (o `AND` da reserva que libera, ou um `COALESCE`), o MariaDB
     * deixa de casar a expressão do SELECT com a do GROUP BY sob ONLY_FULL_GROUP_BY — erro 1055 (gate r2).
     */
    private const BALDE_SQL = "CASE
        WHEN status_agendamento.marca_reserva = 1 AND status_agendamento.ocupa_horario = 0 THEN 'liberado'
        WHEN status_agendamento.marca_reserva = 1 THEN 'em_aberto'
        WHEN status_agendamento.marca_falta = 1 THEN 'falta'
        WHEN status_agendamento.desconta_sessao = 1 THEN 'realizado'
        WHEN status_agendamento.ocupa_horario = 0 THEN 'liberado'
        ELSE 'em_aberto' END";

    /**
     * @param  Escopo  $escopo  a INTERSEÇÃO dos eixos agenda × clínico (`EscopoDoProfissional::agendaEClinico`)
     * @return array{mes: string, totais: array<string, int|null>, linhas: list<array<string, mixed>>}
     */
    public function calcular(Carbon $mes, Escopo $escopo): array
    {
        $limites = [
            $mes->copy()->startOfMonth()->format('Y-m-d 00:00:00'),
            $mes->copy()->endOfMonth()->format('Y-m-d 23:59:59'),
        ];

        // D11 na coluna DONA (`id`, como a seleção da agenda): plano lista todos os ativos,
        // `de(id)` só o próprio, `nenhum` ninguém (fail-closed). Ordem por nome no banco.
        $profissionais = $escopo->aplicar(
            Profissional::query()
                ->where('ativo', true)
                ->with(['especialidades:id,nome,cor,tempo_sessao', 'horarios']),
            'id',
        )
            ->orderBy('nome')
            // `atendimentos_simultaneos` entra na whitelist porque é o MULTIPLICADOR do
            // denominador (change atendimento-em-grupo): fora dela, o modelo devolve o
            // default do `$attributes` (1) e quem atende em grupo volta a ser medido contra
            // o relógio — em silêncio, porque 1 é um número plausível.
            ->get(['id', 'nome', 'foto_atualizado_em', 'atendimentos_simultaneos']);

        $feriados = $this->feriadosAtivos();
        $bloqueios = $this->bloqueiosPorProfissional($profissionais->pluck('id')->all(), $limites);
        $baldes = $this->baldesPorProfissional($escopo, $limites);

        $linhas = $profissionais
            ->map(fn (Profissional $profissional): array => $this->linha(
                $profissional,
                (int) $mes->format('Y'),
                (int) $mes->format('n'),
                $feriados,
                $bloqueios->get($profissional->id, collect())->all(),
                $baldes->get($profissional->id, []),
            ))
            ->values()
            ->all();

        return [
            'mes' => $mes->format('Y-m'),
            'totais' => $this->totais($linhas),
            'linhas' => $linhas,
        ];
    }

    /**
     * Realizados e faltas MÊS A MÊS, de `$primeiroMes` a `$ultimoMes` (inclusive) — a série de seis
     * meses do painel do profissional (change painel-do-profissional, D2).
     *
     * Os MESMOS baldes de `calcular` (a expressão `BALDE_SQL`, com a falta antes do realizado), o
     * mesmo corte por `inicio` e o mesmo escopo, agrupados por mês numa consulta só: o número de um
     * mês da série é, por construção, o `realizados`/`faltas` da linha da produtividade daquele mês.
     * A alternativa medida e recusada foi chamar `calcular` seis vezes — seis consultas por mês,
     * com a grade inteira, para usar duas contagens: 36 consultas e ~40 ms de mediana contra uma
     * consulta e ~4 ms, com os MESMOS números (6 meses de agenda cheia fictícia, 2026-10-15).
     *
     * Ao contrário de `calcular`, não filtra profissional ATIVO: o histórico de quem saiu continua
     * sendo o histórico dele.
     *
     * `$ate` (a parede de agora) corta no "já passou" (`inicio < agora`) dos painéis: no MESMO quadro
     * em que o cartão de realizados dizia 108 (sessões que já passaram), a coluna do mês corrente dizia
     * 109, porque a sessão mais tarde já finalizada pela recepção entrava aqui e não lá (integração,
     * 2026-10-15). Os meses fechados não mudam: tudo neles já passou.
     *
     * @param  string  $primeiroMes  "YYYY-MM"
     * @param  string  $ultimoMes  "YYYY-MM"
     * @param  string|null  $ate  "Y-m-d H:i:s" na parede — o corte de "já passou"
     * @return array<string, array{realizados: int, faltas: int}> "YYYY-MM" → contagens (só os meses com sessão)
     */
    public function realizadosEFaltasPorMes(Escopo $escopo, string $primeiroMes, string $ultimoMes, ?string $ate = null): array
    {
        $ultimoDia = Carbon::createFromFormat('Y-m-d', $ultimoMes.'-01')->endOfMonth()->format('Y-m-d');
        $mesSql = "DATE_FORMAT(agendamentos.inicio, '%Y-%m')";

        $linhas = $escopo->aplicar(
            Agendamento::query()
                ->leftJoin('status_agendamento', fn ($join) => $join
                    ->on('status_agendamento.id', '=', 'agendamentos.status_id'))
                ->where('agendamentos.tipo', 'atendimento')
                ->whereBetween('agendamentos.inicio', ["{$primeiroMes}-01 00:00:00", "{$ultimoDia} 23:59:59"])
                ->when($ate !== null, fn ($consulta) => $consulta->where('agendamentos.inicio', '<', $ate)),
            'agendamentos.profissional_id',
        )
            // pelos APELIDOS: repetir a expressão do balde no GROUP BY dá o 1055 (ver `BALDE_SQL`)
            ->groupByRaw('mes, balde')
            ->selectRaw($mesSql.' as mes, '.self::BALDE_SQL.' as balde, COUNT(*) as total')
            ->toBase()
            ->get();

        $porMes = [];
        foreach ($linhas as $linha) {
            $chave = ['realizado' => 'realizados', 'falta' => 'faltas'][(string) $linha->balde] ?? null;
            if ($chave === null) {
                continue;
            }
            $porMes[(string) $linha->mes] ??= ['realizados' => 0, 'faltas' => 0];
            $porMes[(string) $linha->mes][$chave] += (int) $linha->total;
        }

        return $porMes;
    }

    /**
     * Só os feriados ATIVOS, como `/agenda/selecao` entrega à grade — o desativado não fecha a
     * clínica. A regra do recorrente (dia-mês em qualquer ano) vive em `CapacidadeDoMes`.
     *
     * @return list<array{data: string, recorrente: bool}>
     */
    private function feriadosAtivos(): array
    {
        return Feriado::query()
            ->where('ativo', true)
            ->get(['data', 'recorrente'])
            ->map(fn (Feriado $feriado): array => [
                'data' => $feriado->data->toDateString(),
                'recorrente' => (bool) $feriado->recorrente,
            ])
            ->all();
    }

    /**
     * As OCORRÊNCIAS de bloqueio dos profissionais listados que tocam o mês — por sobreposição
     * (`inicio <= fim do mês` e `fim >= início do mês`), para um bloqueio que começa no mês
     * anterior e invade este não escapar. A série recorrente já está expandida em linhas
     * (`AgendamentoService::criarSerie` grava uma por semana), então ler as linhas basta.
     *
     * @param  list<int>  $profissionalIds
     * @param  array{0: string, 1: string}  $limites
     * @return Collection<int, Collection<int, array{inicio: string, fim: string}>>
     */
    private function bloqueiosPorProfissional(array $profissionalIds, array $limites): Collection
    {
        if ($profissionalIds === []) {
            return collect();
        }

        return Agendamento::query()
            ->where('tipo', 'bloqueio')
            ->whereIn('profissional_id', $profissionalIds)
            ->where('inicio', '<=', $limites[1])
            ->where('fim', '>=', $limites[0])
            ->get(['profissional_id', 'inicio', 'fim'])
            ->groupBy('profissional_id')
            ->map(fn (Collection $doProfissional): Collection => $doProfissional->map(
                fn (Agendamento $bloqueio): array => [
                    'inicio' => $bloqueio->inicio->format('Y-m-d H:i:s'),
                    'fim' => $bloqueio->fim->format('Y-m-d H:i:s'),
                ],
            ));
    }

    /**
     * Os agendamentos de ATENDIMENTO do mês (bucket por `inicio`, como a vista da agenda),
     * agregados em SQL por profissional × dia da semana ISO × balde: contagem e minutos
     * (`fim − inicio`). O escopo entra na MESMA query — bloqueio fica fora pelo `tipo`.
     *
     * @param  array{0: string, 1: string}  $limites
     * @return Collection<int, array<int, array<string, array{total: int, minutos: int}>>> profissional → dia → balde
     */
    private function baldesPorProfissional(Escopo $escopo, array $limites): Collection
    {
        $linhas = $escopo->aplicar(
            Agendamento::query()
                ->leftJoin('status_agendamento', fn ($join) => $join
                    ->on('status_agendamento.id', '=', 'agendamentos.status_id'))
                ->where('agendamentos.tipo', 'atendimento')
                ->whereBetween('agendamentos.inicio', $limites),
            'agendamentos.profissional_id',
        )
            // WEEKDAY é 0=segunda…6=domingo; o +1 para ISO fica no PHP. O GROUP BY vai pelos APELIDOS:
            // repetir a expressão do balde dá o 1055 (ver `BALDE_SQL`). `profissional_id` sem prefixo é
            // a coluna de `agendamentos` — o status não tem essa coluna, e o apelido é a mesma
            ->groupByRaw('agendamentos.profissional_id, dia_zero, balde')
            ->selectRaw(
                'agendamentos.profissional_id as profissional_id, WEEKDAY(agendamentos.inicio) as dia_zero, '
                .self::BALDE_SQL.' as balde, COUNT(*) as total, '
                .'COALESCE(SUM(GREATEST(0, TIMESTAMPDIFF(MINUTE, agendamentos.inicio, agendamentos.fim))), 0) as minutos',
            )
            ->get();

        $mapa = [];
        foreach ($linhas as $linha) {
            $mapa[(int) $linha->profissional_id][(int) $linha->dia_zero + 1][(string) $linha->balde] = [
                'total' => (int) $linha->total,
                'minutos' => (int) $linha->minutos,
            ];
        }

        return collect($mapa);
    }

    /**
     * Uma linha do contrato — as chaves na ordem que o web declara.
     *
     * @param  list<array{data: string, recorrente: bool}>  $feriados
     * @param  list<array{inicio: string, fim: string}>  $bloqueios
     * @param  array<int, array<string, array{total: int, minutos: int}>>  $baldes  dia → balde
     * @return array<string, mixed>
     */
    private function linha(Profissional $profissional, int $ano, int $mes, array $feriados, array $bloqueios, array $baldes): array
    {
        $capacidade = CapacidadeDoMes::calcular($ano, $mes, $profissional->mapaDeHorarios(), $feriados, $bloqueios);

        // D4: a referência é a especialidade PRINCIPAL — a primeira da relação, a mesma que dá a
        // cor do avatar na grade (`especialidades[0]` no web). `tempo_sessao` é dado da clínica.
        $principal = $profissional->especialidades->first();
        $duracao = $principal !== null && (int) $principal->tempo_sessao > 0 ? (int) $principal->tempo_sessao : null;

        $soma = array_fill_keys([...self::BALDES, 'minutos_realizado', 'minutos_marcados'], 0);
        $porDiaDaSemana = [];
        for ($dia = 1; $dia <= 7; $dia++) {
            $doDia = $baldes[$dia] ?? [];
            $contagem = [];
            $minutos = [];
            foreach (self::BALDES as $balde) {
                $contagem[$balde] = $doDia[$balde]['total'] ?? 0;
                $minutos[$balde] = $doDia[$balde]['minutos'] ?? 0;
                $soma[$balde] += $contagem[$balde];
            }
            $marcadosDoDia = $contagem['realizado'] + $contagem['falta'] + $contagem['em_aberto'];
            $minutosMarcadosDoDia = $minutos['realizado'] + $minutos['falta'] + $minutos['em_aberto'];
            $soma['minutos_realizado'] += $minutos['realizado'];
            $soma['minutos_marcados'] += $minutosMarcadosDoDia;

            $porDiaDaSemana[] = [
                'dia' => $dia,
                'minutos_na_grade' => $capacidade['por_dia_da_semana'][$dia],
                'marcados' => $marcadosDoDia,
                'minutos_marcados' => $minutosMarcadosDoDia,
                'realizados' => $contagem['realizado'],
                'minutos_realizados' => $minutos['realizado'],
            ];
        }

        $marcados = $soma['realizado'] + $soma['falta'] + $soma['em_aberto'];
        $minutosNaGrade = $capacidade['minutos_na_grade'];

        /*
         * MINUTOS DE VAGA — o denominador de quem atende em GRUPO (change atendimento-em-grupo).
         *
         * `minutos_na_grade` é tempo de RELÓGIO: a escala do profissional menos feriados e
         * bloqueios. Quem atende 4 crianças ao mesmo tempo marca 4 × 40 min num slot de 40, e
         * dividir por relógio daria 400% — clampado a 100 pelo teto do `percentual()`. A
         * Margarete apareceria LOTADA todo mês, no indicador que a clínica usa para decidir
         * contratação, e o número pararia de responder à realidade.
         *
         * O campo `minutos_na_grade` continua no payload com o sentido de sempre: mudar o
         * significado de um campo existente é pior do que acrescentar um. Quem tem
         * simultaneidade 1 — todo mundo, hoje — não vê diferença nenhuma: multiplicar por 1
         * não faz nada.
         */
        $simultaneos = max(1, (int) ($profissional->atendimentos_simultaneos ?? 1));
        $minutosDeVaga = $minutosNaGrade * $simultaneos;

        return [
            'profissional' => [
                'id' => $profissional->id,
                'nome' => $profissional->nome,
                'foto_versao' => $profissional->foto_atualizado_em?->format('YmdHis'),
            ],
            'especialidade' => $principal === null
                ? null
                : ['id' => $principal->id, 'nome' => $principal->nome, 'cor' => $principal->cor],
            'duracao_referencia_min' => $duracao,
            'minutos_na_grade' => $minutosNaGrade,
            'atendimentos_simultaneos' => $simultaneos,
            'minutos_de_vaga' => $minutosDeVaga,
            'minutos_em_feriados' => $capacidade['minutos_em_feriados'],
            'minutos_em_bloqueios' => $capacidade['minutos_em_bloqueios'],
            'capacidade_atendimentos' => $duracao === null ? 0 : intdiv($minutosDeVaga, $duracao),
            'marcados' => $marcados,
            'minutos_marcados' => $soma['minutos_marcados'],
            'realizados' => $soma['realizado'],
            'minutos_realizados' => $soma['minutos_realizado'],
            'faltas' => $soma['falta'],
            'liberados' => $soma['liberado'],
            'em_aberto' => $soma['em_aberto'],
            'minutos_ociosos' => max(0, $minutosDeVaga - $soma['minutos_marcados']),
            'ocupacao_pct' => self::percentual($soma['minutos_marcados'], $minutosDeVaga),
            'produtividade_pct' => self::percentual($soma['minutos_realizado'], $minutosDeVaga),
            'aproveitamento_pct' => self::percentual($soma['minutos_realizado'], $soma['minutos_marcados']),
            'por_dia_da_semana' => $porDiaDaSemana,
        ];
    }

    /**
     * Os totais da clínica: SOMAS das linhas, e os percentuais sobre as somas — nunca média
     * de percentuais (um profissional de 4 h/mês pesaria o mesmo que um de 160 h).
     *
     * @param  list<array<string, mixed>>  $linhas
     * @return array<string, int|null>
     */
    private function totais(array $linhas): array
    {
        $chaves = [
            'minutos_na_grade', 'minutos_de_vaga', 'minutos_marcados', 'minutos_realizados', 'minutos_ociosos',
            'capacidade_atendimentos', 'marcados', 'realizados', 'faltas', 'liberados', 'em_aberto',
        ];
        $totais = array_fill_keys($chaves, 0);
        foreach ($linhas as $linha) {
            foreach ($chaves as $chave) {
                $totais[$chave] += (int) $linha[$chave];
            }
        }

        return [
            ...$totais,
            'ocupacao_pct' => self::percentual($totais['minutos_marcados'], $totais['minutos_de_vaga']),
            'produtividade_pct' => self::percentual($totais['minutos_realizados'], $totais['minutos_de_vaga']),
            'aproveitamento_pct' => self::percentual($totais['minutos_realizados'], $totais['minutos_marcados']),
        ];
    }

    /**
     * Inteiro 0..100 arredondado; `null` quando não há o que medir (D3) — nunca zero por divisão.
     *
     * O piso em 0 e o teto em 100 são CINTO E SUSPENSÓRIO contra dado inconsistente: uma linha
     * com `fim < inicio` (impossível pela API, possível por escrita direta no banco) devolvia
     * minutos negativos e percentual negativo, e o ocioso passava a ser maior que a grade
     * (achado SEC-PR-01 da auditoria). O `GREATEST` na soma já corta a origem; aqui a conta
     * também se recusa a inventar sinal.
     */
    private static function percentual(int $numerador, int $denominador): ?int
    {
        if ($denominador <= 0) {
            return null;
        }

        return (int) max(0, min(100, round($numerador * 100 / $denominador)));
    }
}
