<?php

namespace App\Support\Clinica;

use App\Models\Atendimento;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\Escopo;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;

/**
 * Consulta canônica de "evoluções em aberto" (§7/T-ate-18) — usada pelo
 * endpoint da etapa 6 E pelo bloco do centro de notificações (etapa 8, §1.3
 * do parecer: reaproveitar é requisito — reimplementar com payload maior é
 * regressão de minimização).
 */
class EvolucoesEmAberto
{
    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly JanelaDasNotificacoes $janela,
    ) {}

    /** @return Builder<Atendimento> atendimentos SEM evolução, com o eager mínimo */
    public function consulta(?int $profissionalId = null): Builder
    {
        return Atendimento::query()
            ->whereDoesntHave('evolucao')
            ->with([
                'agendamento:id,paciente_id,profissional_id',
                'agendamento.paciente:id,nome',
                'agendamento.profissional:id,nome',
            ])
            ->when($profissionalId !== null, fn ($q) => $q->whereHas(
                'agendamento',
                fn ($a) => $a->where('profissional_id', $profissionalId)
            ))
            ->orderBy('finalizado_em');
    }

    /**
     * A fila do AVISO de evoluções em aberto (bloco `evolucoes_em_aberto` do centro de notificações):
     * a consulta canônica no escopo D11 do eixo CLÍNICO e acima do piso da janela do centro
     * (`notificacoes.a_partir_de`, nunca mais de 366 dias). É a fonte ÚNICA do total do sino e do
     * `sem_evolucao` do painel da equipe (change indicadores-profissionais, CR-IND-04): o painel
     * dizia "a mesma conta do aviso" e contava sem o piso e em outro eixo — 255 num, 240 no outro.
     *
     * O escopo entra por `aplicarNaRelacao` (o dono é o profissional do agendamento-mãe): o
     * escopado vê só a própria fila, e `nenhum` zera (fail-closed).
     *
     * @return Builder<Atendimento>
     */
    public function doAviso(Escopo $escopo): Builder
    {
        return $escopo
            ->aplicarNaRelacao($this->consulta(), 'agendamento')
            ->where('finalizado_em', '>=', $this->janela->piso().' 00:00:00');
    }

    /**
     * Pendências VENCIDAS do profissional: o prazo estourou e a evolução segue em
     * aberto. Mesmo corte de `serializar()` (`prazo_ate < hoje`, inclusivo no
     * dia-limite), expresso em SQL para contar sem hidratar a fila.
     *
     * @return Builder<Atendimento>
     */
    public function vencidas(int $profissionalId): Builder
    {
        return $this->vencidasHaMaisDe(
            $profissionalId,
            (int) $this->configuracoes->get('evolucoes.prazo_dias'),
        );
    }

    /**
     * As VENCIDAS da fila do aviso: a MESMA base de `doAviso` (piso da janela + o escopo dado),
     * cortada pelo prazo de `evolucoes.prazo_dias` com o mesmo corte inclusivo de `vencidas()`.
     *
     * É o "atrasadas" do painel da equipe (change indicadores-profissionais, rodada 1): por
     * construção, um SUBCONJUNTO do `sem_evolucao` — a tela nunca diz "2 sem evolução, 3 passaram
     * do prazo". A alternativa recusada foi contar pela fonte da trava (`vencidas()`, sem piso): a
     * vencida mais antiga que o piso entrava nas atrasadas e não no total. A TRAVA continua sem piso
     * de propósito — ela não expira com a janela do centro —, e é outra função do sistema.
     *
     * @return Builder<Atendimento>
     */
    public function vencidasDoAviso(Escopo $escopo): Builder
    {
        $corte = $this->corteDoPrazo((int) $this->configuracoes->get('evolucoes.prazo_dias'));

        return $this->doAviso($escopo)->where('finalizado_em', '<', $corte.' 00:00:00');
    }

    /**
     * As vencidas ALÉM DA CARÊNCIA — a fonte ÚNICA da trava do finalizar (change
     * trava-de-evolucao, D1): a guarda do `AtendimentoController::store` e o aviso do
     * centro de notificações derivam DAQUI, nunca de queries paralelas que possam
     * divergir da fila. Corte exato e inclusivo: no dia de
     * `finalizado_em + prazo + carência` ainda finaliza; a trava começa no dia seguinte.
     *
     * @return Builder<Atendimento>
     */
    public function vencidasAlemDaCarencia(int $profissionalId): Builder
    {
        $prazo = (int) $this->configuracoes->get('evolucoes.prazo_dias');
        $carencia = (int) $this->configuracoes->get('evolucoes.trava_carencia_dias');

        return $this->vencidasHaMaisDe($profissionalId, $prazo + $carencia);
    }

    /**
     * O aviso computado do bloco de evoluções (D3): contagem de vencidas e dias até a
     * trava do finalizar — MESMAS chaves e MESMO corte da guarda (D1), calculado por
     * leitura, nada persistido. `bloqueio_em_dias = 0` exatamente no primeiro dia em
     * que o finalizar é recusado (o teste cruzado prova a coincidência); `null` quando
     * não há vencida — sem vencida, nada sugere bloqueio.
     *
     * @return array{vencidas: int, bloqueio_em_dias: int|null}
     */
    public function avisoDeBloqueio(int $profissionalId): array
    {
        $vencidas = $this->vencidas($profissionalId)->count();
        if ($vencidas === 0) {
            return ['vencidas' => 0, 'bloqueio_em_dias' => null];
        }

        $prazo = (int) $this->configuracoes->get('evolucoes.prazo_dias');
        $carencia = (int) $this->configuracoes->get('evolucoes.trava_carencia_dias');

        // a vencida mais ANTIGA decide (min sobre as vencidas) — consulta() já ordena
        // por finalizado_em; datas comparadas na parede da clínica, como em serializar()
        $maisAntiga = (string) $this->vencidas($profissionalId)->value('finalizado_em');
        $hoje = Carbon::parse(now($this->configuracoes->get('clinica.timezone'))->toDateString());
        $idade = (int) Carbon::parse($maisAntiga)->startOfDay()->diffInDays($hoje);

        return [
            'vencidas' => $vencidas,
            // a trava começa no dia SEGUINTE a prazo+carência (corte inclusivo): no
            // dia-limite ainda resta 1 dia; um dia além, 0 — travado
            'bloqueio_em_dias' => max(0, $prazo + $carencia + 1 - $idade),
        ];
    }

    /**
     * Pendências cujo `finalizado_em` (a DATA, na parede da clínica) está a mais de
     * `$dias` dias de hoje: `date(finalizado_em) + $dias < hoje` — o mesmo corte
     * inclusivo de `vencida` em `serializar()`, no dia-limite ainda não conta.
     *
     * @return Builder<Atendimento>
     */
    private function vencidasHaMaisDe(int $profissionalId, int $dias): Builder
    {
        return $this->consulta($profissionalId)
            ->where('finalizado_em', '<', $this->corteDoPrazo($dias).' 00:00:00');
    }

    /**
     * O dia de corte, "Y-m-d" na parede da clínica: vence o que foi finalizado ANTES dele (no
     * dia-limite ainda não conta). Um corte só para a trava e para as vencidas do aviso.
     */
    private function corteDoPrazo(int $dias): string
    {
        return now($this->configuracoes->get('clinica.timezone'))->subDays($dias)->toDateString();
    }

    /** Metadados apenas — whitelist {id, nome}; NUNCA conteúdo clínico. */
    public function serializar(Atendimento $atendimento): array
    {
        $prazoDias = (int) $this->configuracoes->get('evolucoes.prazo_dias');
        $hoje = now($this->configuracoes->get('clinica.timezone'))->toDateString();
        $prazoAte = $atendimento->finalizado_em->copy()->addDays($prazoDias)->toDateString();

        return [
            'atendimento_id' => $atendimento->id,
            'agendamento_id' => $atendimento->agendamento_id,
            'finalizado_em' => $atendimento->finalizado_em->format('Y-m-d H:i'),
            'paciente' => $atendimento->agendamento?->paciente?->only(['id', 'nome']),
            'profissional' => $atendimento->agendamento?->profissional?->only(['id', 'nome']),
            'prazo_ate' => $prazoAte,
            'vencida' => $prazoAte < $hoje,
        ];
    }
}
