<?php

namespace App\Support\Agenda;

use App\Models\Agendamento;
use App\Models\RegraLimiteConvenio;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * A guarda de LIMITE DO CONVÊNIO (limites-e-pedidos, D2) em UM lugar só.
 *
 * Conta os agendamentos ATIVOS do MESMO paciente na MESMA especialidade cujo
 * tratamento aponta o convênio da regra, dentro da janela do período — dia,
 * semana ISO (seg–dom) ou mês calendário. A janela é derivada do `inicio` do
 * candidato, que JÁ é parede da clínica (convenção da agenda): nenhuma
 * conversão de fuso acontece aqui.
 *
 * - "Ativo" é decidido pela flag `ocupa_horario` do status (DADO §13 —
 *   SEC-LP-09), NUNCA pelo nome; desmarcados ficam fora, bloqueios nem entram
 *   (tipo ≠ atendimento).
 * - Regra de especialidade ESPECÍFICA vence a regra "todas" no MESMO período
 *   (a mais específica aplica); a regra "todas" é o default POR especialidade.
 * - Override do pedido (SEC-LP-12): `pedido_sessoes_por_semana` substitui SÓ o
 *   número da regra `semana` APLICÁVEL — a que sobreviveu à resolução acima, seja
 *   ela a específica da especialidade ou a "todas". O pedido médico é prescrição
 *   DAQUELE caso, naquela especialidade: se ele vencesse só a regra-default e
 *   parasse na específica, a especialidade com regra própria — justamente a que a
 *   clínica configurou com cuidado — seria a única onde o pedido do médico não
 *   valeria. O override afrouxa o TETO SEMANAL; não muda a ação da regra e não
 *   desliga dia nem mês (cada período é avaliado por si — teste do cross-período).
 *   Sem `pedido_emitido_em`, o override NÃO tem efeito (cerca contra
 *   `tratamentos.editar` furar política de `convenios.editar`). Pedido VENCIDO
 *   MANTÉM o override (decisão default registrada em DECISOES-PENDENTES: a
 *   clínica pediu alerta para pedido, não bloqueio).
 * - `bloquear` excedida → 422 na chave `limite_convenio`, mensagem SÓ com
 *   limite + período + nome do convênio (minimização SEC-LP-01). `avisar`
 *   excedida → devolve o aviso {convenio, periodo, limite}; nada persiste (D3).
 * - Sem regra aplicável (inclui particular sem regra) → null: fail-safe,
 *   comportamento idêntico ao de antes da change (SEC-LP-11).
 *
 * Dois consumidores — a escrita (AgendamentoService, que herda encaixe e série)
 * e a leitura do painel (`avisoNaLeitura`) — dependem da MESMA contagem; em
 * dois lugares elas divergiriam em silêncio (lição do ContadorDeFaltas).
 */
class GuardaDeLimiteDoConvenio
{
    private const NOME_DO_PERIODO = ['dia' => 'dia', 'semana' => 'semana', 'mes' => 'mês'];

    /** memo por request: convênio do tratamento e flag ocupa do status (irmãs pendentes). */
    private array $memoTratamento = [];

    private array $memoStatusOcupa = [];

    /**
     * Avalia o candidato no seu ESTADO FINAL contra as regras do convênio.
     *
     * @param  array<string, mixed>  $atributos  estado final: tipo, paciente_id,
     *                                           especialidade_id, status_id, inicio (Carbon, parede da clínica)
     * @param  int|null  $tratamentoId  tratamento FINAL do candidato
     * @param  list<int>  $ignorarIds  fora da contagem: o próprio na remarcação, o
     *                                 GRUPO no aplicar-na-série (todos deslocam juntos)
     * @param  list<array<string, mixed>>  $pendentes  irmãs da MESMA transação já aceitas
     *                                                 (ainda não no banco — SEC-LP-10), cada uma com
     *                                                 inicio/paciente_id/especialidade_id/tratamento_id/status_id
     * @param  bool  $bloquear  false = leitura (painel): regra `bloquear` não lança —
     *                          o show nunca vira 422 (D3/SEC-LP-03); só `avisar` sinaliza
     * @return array{convenio: string, periodo: string, limite: int}|null aviso de
     *                                                                    regra `avisar` excedida — viaja no payload, nunca persiste (D3)
     *
     * @throws ValidationException regra `bloquear` excedida (422 `limite_convenio`)
     */
    public function avaliar(
        array $atributos,
        ?int $tratamentoId,
        array $ignorarIds = [],
        array $pendentes = [],
        bool $bloquear = true,
    ): ?array {
        if (($atributos['tipo'] ?? 'atendimento') !== 'atendimento' || $tratamentoId === null) {
            return null; // bloqueio não conta nem é contado; sem tratamento não há convênio
        }

        // candidato cujo status final NÃO ocupa não consome vaga da janela: mudá-lo
        // para desmarcado nunca pode ser recusado por limite (estado final, SEC-LP-09)
        if (! $this->statusOcupa($atributos['status_id'] ?? null)) {
            return null;
        }

        $tratamento = $this->tratamento((int) $tratamentoId);
        $convenio = $tratamento?->convenio;
        if ($tratamento === null || $convenio === null) {
            return null; // coerência do tratamento é responsabilidade do validarDominio
        }

        $especialidadeId = (int) $atributos['especialidade_id'];
        $regras = $this->regrasAplicaveis($convenio->id, $especialidadeId);
        if ($regras === []) {
            return null; // fail-safe (SEC-LP-11): sem regra, nada muda
        }

        $overrideSemanal = ($tratamento->pedido_sessoes_por_semana !== null
            && $tratamento->pedido_emitido_em !== null)
            ? (int) $tratamento->pedido_sessoes_por_semana
            : null; // sem emissão, override SEM efeito (cerca SEC-LP-12)

        $aviso = null;
        foreach ($regras as $regra) {
            $limite = ($regra->periodo === 'semana' && $overrideSemanal !== null)
                ? $overrideSemanal   // o pedido vence a regra semanal APLICÁVEL (D4/SEC-LP-12)
                : (int) $regra->limite;

            if ($regra->acao === 'bloquear' && ! $bloquear) {
                continue; // leitura do painel sinaliza só `avisar` (spec detalhe-agenda)
            }

            [$inicioJanela, $fimJanela] = $this->janela($regra->periodo, $atributos['inicio']);
            $naJanela = $this->contar(
                (int) $atributos['paciente_id'],
                $especialidadeId,
                $convenio->id,
                $inicioJanela,
                $fimJanela,
                $ignorarIds,
                $pendentes,
            );

            if ($naJanela < $limite) {
                continue; // o candidato ainda cabe na janela
            }

            if ($regra->acao === 'bloquear') {
                // minimização (SEC-LP-01): SÓ limite + período + nome do convênio —
                // nunca a contagem atual, datas/profissionais das demais sessões
                throw ValidationException::withMessages([
                    'limite_convenio' => sprintf(
                        $limite === 1
                            ? 'Limite do convênio %s atingido: %d sessão por %s.'
                            : 'Limite do convênio %s atingido: %d sessões por %s.',
                        $convenio->nome,
                        $limite,
                        self::NOME_DO_PERIODO[$regra->periodo],
                    ),
                ]);
            }

            $aviso ??= [
                'convenio' => $convenio->nome,
                'periodo' => $regra->periodo,
                'limite' => $limite,
            ];
        }

        return $aviso;
    }

    /**
     * O sinal do PAINEL (D3/D5): o agendamento em vista excedeu uma regra
     * `avisar`? DERIVADO a cada leitura — o próprio agendamento fica fora da
     * contagem (simetria com a escrita que o aceitou); nada persistido.
     *
     * @return array{convenio: string, periodo: string, limite: int}|null
     */
    public function avisoNaLeitura(Agendamento $agendamento): ?array
    {
        return $this->avaliar(
            [
                'tipo' => $agendamento->tipo,
                'paciente_id' => $agendamento->paciente_id,
                'especialidade_id' => $agendamento->especialidade_id,
                'status_id' => $agendamento->status_id,
                'inicio' => $agendamento->inicio,
            ],
            $agendamento->tratamento_id,
            [$agendamento->id],
            [],
            bloquear: false,
        );
    }

    /**
     * As regras do convênio que alcançam a especialidade do candidato — a
     * ESPECÍFICA vence a "todas" no mesmo período (D2).
     *
     * @return list<RegraLimiteConvenio>
     */
    private function regrasAplicaveis(int $convenioId, int $especialidadeId): array
    {
        $todas = RegraLimiteConvenio::query()
            ->where('convenio_id', $convenioId)
            ->where(fn ($q) => $q->whereNull('especialidade_id')
                ->orWhere('especialidade_id', $especialidadeId))
            ->get();

        $porPeriodo = [];
        foreach ($todas as $regra) {
            $existente = $porPeriodo[$regra->periodo] ?? null;
            // a específica ocupa o lugar da "todas"; a "todas" nunca desloca a específica
            // (duplicidade no MESMO período é impossível — índice único do banco)
            if ($existente === null
                || ($existente->especialidade_id === null && $regra->especialidade_id !== null)) {
                $porPeriodo[$regra->periodo] = $regra;
            }
        }

        return array_values($porPeriodo);
    }

    /**
     * Janela do período na PAREDE da clínica — derivada do início do candidato,
     * que já vive nesse frame (convenção da agenda). Semana é ISO: seg–dom.
     *
     * @return array{0: Carbon, 1: Carbon}
     */
    private function janela(string $periodo, Carbon $inicio): array
    {
        return match ($periodo) {
            'dia' => [$inicio->copy()->startOfDay(), $inicio->copy()->endOfDay()],
            'semana' => [
                $inicio->copy()->startOfWeek(CarbonInterface::MONDAY),
                $inicio->copy()->endOfWeek(CarbonInterface::SUNDAY),
            ],
            'mes' => [$inicio->copy()->startOfMonth(), $inicio->copy()->endOfMonth()],
            // o enum é fechado no boundary e no banco; um período novo que chegasse aqui
            // sem janela cairia no UnhandledMatchError anônimo do PHP — este morre com nome
            default => throw new InvalidArgumentException(
                "Período de limite sem janela definida: {$periodo}."
            ),
        };
    }

    /**
     * Sessões que JÁ ocupam a janela: as do banco
     * + as irmãs pendentes da mesma transação (série — SEC-LP-10).
     *
     * @param  list<int>  $ignorarIds
     * @param  list<array<string, mixed>>  $pendentes
     */
    private function contar(
        int $pacienteId,
        int $especialidadeId,
        int $convenioId,
        Carbon $inicioJanela,
        Carbon $fimJanela,
        array $ignorarIds,
        array $pendentes,
    ): int {
        $noBanco = Agendamento::query()
            ->where('tipo', 'atendimento')
            ->where('paciente_id', $pacienteId)
            ->where('especialidade_id', $especialidadeId)
            ->whereBetween('inicio', [$inicioJanela, $fimJanela])
            ->when($ignorarIds !== [], fn ($q) => $q->whereNotIn('id', $ignorarIds))
            ->whereHas('status', fn ($s) => $s->where('ocupa_horario', true))
            ->whereHas('tratamento', fn ($t) => $t->where('convenio_id', $convenioId))
            ->count();

        $emVoo = 0;
        foreach ($pendentes as $pendente) {
            if ((int) $pendente['paciente_id'] !== $pacienteId
                || (int) $pendente['especialidade_id'] !== $especialidadeId
                || ! $pendente['inicio']->between($inicioJanela, $fimJanela)
                || ! $this->statusOcupa($pendente['status_id'] ?? null)) {
                continue;
            }
            $tratamentoDaIrma = isset($pendente['tratamento_id'])
                ? $this->tratamento((int) $pendente['tratamento_id'])
                : null;
            if ($tratamentoDaIrma !== null && (int) $tratamentoDaIrma->convenio_id === $convenioId) {
                $emVoo++;
            }
        }

        return $noBanco + $emVoo;
    }

    private function tratamento(int $id): ?Tratamento
    {
        // `??=` NÃO segura o miss: um id inexistente memoiza `null`
        // e o `??=` reconsulta a cada chamada — numa série de 20 irmãs, 20 idas ao banco
        // para reaprender a mesma ausência. `array_key_exists` memoiza o miss também
        if (! array_key_exists($id, $this->memoTratamento)) {
            $this->memoTratamento[$id] = Tratamento::query()
                ->with('convenio:id,nome,pedido_validade_meses')
                ->find($id);
        }

        return $this->memoTratamento[$id];
    }

    private function statusOcupa(mixed $statusId): bool
    {
        if ($statusId === null) {
            return false; // atendimento sem status não existe (invariante D3); defensivo
        }

        return $this->memoStatusOcupa[(int) $statusId]
            ??= (bool) StatusAgendamento::whereKey((int) $statusId)->value('ocupa_horario');
    }
}
