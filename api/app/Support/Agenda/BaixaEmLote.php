<?php

namespace App\Support\Agenda;

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Ciclos\GuardaDeCicloFechado;
use App\Support\Clinica\EvolucoesEmAberto;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

/**
 * Baixa em lote por status da agenda de um profissional (change `baixa-em-lote-por-status`).
 *
 * O CÁLCULO é um só: a prévia e a execução chamam `resolver()` com os mesmos parâmetros — a
 * prévia com leituras puras, a execução com o alcance TRAVADO (`$sobLock`) e a MESMA
 * `$referencia` que a prévia devolveu (D5), para que o número que a recepção leu seja o número
 * que roda. A prévia nunca entrega uma lista de ids para a execução consumir; ela entrega uma
 * ASSINATURA do conjunto elegível, e a execução recalcula e compara.
 *
 * Esta classe NÃO escreve. Quem escreve é o controller, pelo `AplicadorDeStatusEmLote` →
 * `AgendamentoService`, para que a baixa seja um CHAMADOR A MAIS das guardas do agendamento
 * individual, nunca um atalho em volta delas. O que fica aqui é o que só a baixa decide: quem
 * entra (a flag `em_aberto`, §13 — nunca nome nem `inicialId()`), quem é recusado e por quê
 * (D6), as contagens da prévia e a assinatura.
 */
class BaixaEmLote
{
    /** Quanto tempo uma prévia vale antes de a execução recusá-la por velhice (D5). */
    public const VALIDADE_DA_PREVIA_MINUTOS = 30;

    /** A chave §13 do teto de LINHAS — própria da baixa, separada da do desmarque (D12). */
    public const CHAVE_DO_TETO = 'agenda.baixa_em_lote_maximo';

    /** O alcance é sempre o DIA inteiro (D16): a Request não aceita `periodo`. */
    private const PERIODO = 'dia';

    /** Motivos de recusa — constantes que a tela traduz; qualquer outra frase é a mensagem crua do domínio. */
    public const RECUSA_AINDA_NAO_COMECOU = 'ainda_nao_comecou';

    public const RECUSA_SEM_SALDO = 'sem_saldo';

    public const RECUSA_CICLO_FECHADO = 'ciclo_fechado';

    public const RECUSA_ATENDIMENTO = 'atendimento_registrado';

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly GuardaDeCicloFechado $ciclos,
        private readonly AlcanceEmLote $alcance,
        private readonly EvolucoesEmAberto $evolucoes,
    ) {}

    /**
     * Resolve o alcance e classifica cada agendamento em elegível ou recusado com motivo.
     *
     * A ordem é `inicio, id` na prévia e na execução — a simulação de saldo (D6) só faz sentido
     * se as duas percorrem o mesmo caminho. O teto (D12) é comparado contra os ALCANÇADOS, antes
     * da classificação: é o maior número que a operação lê.
     *
     * @param  CarbonImmutable  $referencia  o "agora" da classificação `ainda_nao_comecou` — o
     *                                       minuto da prévia, na parede da clínica (D5)
     * @param  bool  $sobLock  na execução: trava agendamentos → atendimentos → tratamentos, em
     *                         `id` crescente (ordem da casa), antes de qualquer escrita
     * @return array{
     *     status: array{id: int, nome: string, desconta_sessao: bool, marca_falta: bool},
     *     elegiveis: Collection<int, Agendamento>,
     *     ids_a_descontar: list<int>,
     *     recusados: list<array{agendamento: Agendamento, motivo: string}>,
     *     contagens: array{agendamentos: int, criancas: int, sessoes_a_descontar: int, sem_pacote: int, ja_consumidas: int, com_atendimento_registrado: int},
     *     avisos: array{evolucoes_vencidas?: int},
     *     assinatura: string,
     *     referencia: string
     * }
     *
     * O predicado "em aberto" é pela FLAG do status (§13) — a única fonte do alcance, nunca por
     * nome ("Aguardando Atendimento" ficaria de fora com `inicialId()`; "Marcado", numa clínica
     * que renomeou, ficaria de fora por nome). Os ids em aberto são lidos UMA vez e entram nas
     * duas formas que a espinha exige: a SQL estreita a leitura, a PHP decide sobre a linha
     * travada (PERF-02 — a leitura travante é só pela PK).
     *
     * @throws ValidationException intervalo invertido ou alcance acima do teto
     */
    public function resolver(
        int $profissionalId,
        StatusAgendamento $alvo,
        string $de,
        string $ate,
        CarbonImmutable $referencia,
        bool $sobLock = false,
    ): array {
        [$inicio, $fim] = $this->alcance->intervalo($de, $ate);

        $emAberto = StatusAgendamento::query()->where('em_aberto', true)->pluck('id')->map(fn ($id) => (int) $id)->all();
        $alcancados = $this->alcance->atendimentosDoProfissional(
            $profissionalId, $inicio, $fim, self::PERIODO, $sobLock,
            refinar: fn (Builder $consulta) => $consulta->whereIn('status_id', $emAberto),
            aceita: fn (Agendamento $a): bool => in_array((int) $a->status_id, $emAberto, true),
        );

        $this->alcance->assegurarTeto(
            $alcancados->count(),
            self::CHAVE_DO_TETO,
            fn (int $total, int $teto): string => "A operação alcançaria {$total} agendamentos em aberto "
                ."e o máximo por baixa é {$teto}. Estreite as datas.",
        );

        $comAtendimento = $this->alcance->atendimentosRegistrados($alcancados, $sobLock);
        $saldos = $this->saldosDosTratamentos($alcancados, $alvo, $sobLock);

        $elegiveis = collect();
        $idsADescontar = [];
        $recusados = [];
        foreach ($alcancados as $agendamento) {
            $motivo = $this->motivoDaRecusa($agendamento, $alvo, $referencia, $comAtendimento, $saldos);
            if ($motivo !== null) {
                $recusados[] = ['agendamento' => $agendamento, 'motivo' => $motivo];

                continue;
            }

            $elegiveis->push($agendamento);
            if ($this->descontaria($agendamento, $alvo)) {
                $idsADescontar[] = $agendamento->id;
            }
        }

        return [
            'status' => [
                'id' => $alvo->id,
                'nome' => $alvo->nome,
                'desconta_sessao' => (bool) $alvo->desconta_sessao,
                'marca_falta' => (bool) $alvo->marca_falta,
            ],
            'elegiveis' => $elegiveis,
            'ids_a_descontar' => $idsADescontar,
            'recusados' => $recusados,
            'contagens' => $this->contagens($elegiveis, $alvo, $comAtendimento, count($idsADescontar)),
            'avisos' => $this->avisos($profissionalId, $alvo),
            'assinatura' => self::assinar($elegiveis->pluck('id')->all(), $alvo->id, $referencia),
            'referencia' => $referencia->format('Y-m-d H:i'),
        ];
    }

    /**
     * O status que a operação aplica: marcado como aplicável em lote e NÃO em aberto
     * (o alvo nunca é a origem — invariante D2). O caminho
     * "Marque em Cadastros › Status de agendamento" só para quem pode fazê-lo.
     *
     * Chamado ANTES da transação (erro de cadastro não merece rollback) e RELIDO dentro dela
     * (D10): o admin que desligou a flag entre a validação e o commit não deixa o lote passar.
     *
     * @throws ValidationException em `status_id`
     */
    public function statusAplicado(int $statusId): StatusAgendamento
    {
        $status = StatusAgendamento::whereKey($statusId)->first();

        if ($status === null || ! $status->aplicavel_em_lote || $status->em_aberto) {
            $caminho = Auth::user()?->can('status_agendamento.editar') === true
                ? ' Marque em Cadastros › Status de agendamento.'
                : '';

            throw ValidationException::withMessages([
                'status_id' => 'Este status não está marcado como aplicável em lote.'.$caminho,
            ]);
        }

        return $status;
    }

    /**
     * O minuto atual na parede da clínica (§13), no frame "naive" em que a agenda inteira
     * vive — comparável direto com `agendamentos.inicio` e com a `referencia` do payload.
     */
    public function agoraNaParede(): CarbonImmutable
    {
        $agora = now($this->configuracoes->get('clinica.timezone'))->format('Y-m-d H:i');

        return CarbonImmutable::parse($agora);
    }

    /**
     * A prévia só vale por `VALIDADE_DA_PREVIA_MINUTOS`, e nunca vem do futuro (D5): fora
     * disso a execução recusa com 409 e a prévia nova — não há "agora" que a recepção tenha
     * conferido.
     */
    public function referenciaValida(CarbonImmutable $referencia, CarbonImmutable $agora): bool
    {
        return $referencia->lessThanOrEqualTo($agora)
            && $referencia->greaterThanOrEqualTo($agora->subMinutes(self::VALIDADE_DA_PREVIA_MINUTOS));
    }

    /**
     * O corpo da PRÉVIA como a API o devolve (200 da prévia e `previa` do 409): só id, horário e
     * motivo por recusado, mais contagens — nunca nome nem id de criança (D17).
     *
     * @param  array<string, mixed>  $resolvido  o retorno de `resolver()`
     * @return array<string, mixed>
     */
    public static function serializarPrevia(array $resolvido): array
    {
        return [
            'status' => $resolvido['status'],
            'contagens' => $resolvido['contagens'],
            'recusados' => AplicadorDeStatusEmLote::serializar($resolvido['recusados']),
            // objeto sempre, mesmo vazio: `avisos.evolucoes_vencidas` é opcional, não a chave-mãe
            'avisos' => (object) $resolvido['avisos'],
            'assinatura' => $resolvido['assinatura'],
            'referencia' => $resolvido['referencia'],
        ];
    }

    /**
     * `HMAC-SHA256(ids elegíveis na ordem inicio,id | status_id | referencia)` com a chave da
     * aplicação (D5): muda se um agendamento entrou ou saiu do conjunto, se o alvo é outro ou
     * se a prévia é outra.
     *
     * COM CHAVE, não um sha256 puro (achado SEC-BL-02 do gate): sem segredo, qualquer cliente que
     * já lê a agenda monta a assinatura localmente e executa sem a prévia ter sido emitida — e
     * "prévia obrigatória" vira convenção da tela, não fato do servidor. Com a `APP_KEY` no
     * cálculo, só uma prévia que este servidor emitiu bate na execução. A forma continua 64 hex
     * (a Request valida o formato); a comparação segue `hash_equals`.
     *
     * @param  list<int>  $ids
     */
    private static function assinar(array $ids, int $statusId, CarbonImmutable $referencia): string
    {
        return hash_hmac(
            'sha256',
            implode(',', $ids).'|'.$statusId.'|'.$referencia->format('Y-m-d H:i'),
            (string) config('app.key'),
        );
    }

    /**
     * O saldo de cada tratamento do lote, em UMA consulta — só quando o alvo desconta, que é
     * quando saldo importa. Sob lock, a leitura é TRAVANTE em `id` crescente (ordem da casa:
     * agendamentos → atendimentos → tratamentos) e a simulação passa a ser autoritativa.
     *
     * @param  Collection<int, Agendamento>  $alcancados
     * @return array<int, int> tratamento_id => saldo (total − realizadas)
     */
    private function saldosDosTratamentos(Collection $alcancados, StatusAgendamento $alvo, bool $sobLock): array
    {
        if (! $alvo->desconta_sessao) {
            return [];
        }

        $ids = $alcancados->pluck('tratamento_id')->filter()->unique()->sort()->values();
        if ($ids->isEmpty()) {
            return [];
        }

        $consulta = Tratamento::whereIn('id', $ids)->orderBy('id');
        if ($sobLock) {
            $consulta->lockForUpdate();
        }

        return $consulta->get(['id', 'sessoes_realizadas', 'sessoes_total'])
            ->mapWithKeys(fn (Tratamento $t) => [$t->id => $t->sessoes_total - $t->sessoes_realizadas])
            ->all();
    }

    /**
     * A classificação por linha (D6), na ordem em que a execução vai encontrar cada guarda.
     * A simulação de saldo vem por ÚLTIMO: uma linha recusada por outro motivo não consome o
     * saldo simulado — senão a prévia recusaria por `sem_saldo` a linha seguinte do mesmo
     * pacote, que a execução aplicaria.
     *
     * @param  Collection<int, Atendimento>  $comAtendimento  indexados pelo id do agendamento
     * @param  array<int, int>  $saldos  por tratamento — MUTADO pela simulação sequencial
     */
    private function motivoDaRecusa(
        Agendamento $agendamento,
        StatusAgendamento $alvo,
        CarbonImmutable $referencia,
        Collection $comAtendimento,
        array &$saldos,
    ): ?string {
        // desfecho antes do fato: a linha fica à vista, com o motivo, em vez de sumir do número
        if ($agendamento->inicio->greaterThan($referencia)) {
            return self::RECUSA_AINDA_NAO_COMECOU;
        }

        // produção já enviada à operadora (§14) — MESMA fonte única dos demais caminhos
        if ($this->ciclos->emCicloFechado($agendamento->tratamento_id, $agendamento->inicio)) {
            return self::RECUSA_CICLO_FECHADO;
        }

        // atendido não vira falta (D7); para alvo descontante, atendido é o caso normal
        if ($alvo->marca_falta && $comAtendimento->has($agendamento->id)) {
            return self::RECUSA_ATENDIMENTO;
        }

        // duas linhas do mesmo pacote com saldo 1: a 1ª desconta, a 2ª é recusada AQUI — na
        // prévia, não na execução (lição do gate do desmarque: "a prévia contou 6, o lote recusou")
        if ($this->descontaria($agendamento, $alvo)) {
            $tratamentoId = (int) $agendamento->tratamento_id;
            if (($saldos[$tratamentoId] ?? 0) <= 0) {
                return self::RECUSA_SEM_SALDO;
            }
            $saldos[$tratamentoId]--;
        }

        return null;
    }

    /** A linha consumiria uma sessão: alvo descontante, com pacote, sem consumo prévio (`reconciliar`). */
    private function descontaria(Agendamento $agendamento, StatusAgendamento $alvo): bool
    {
        return (bool) $alvo->desconta_sessao
            && $agendamento->tratamento_id !== null
            && $agendamento->sessao_consumida_em === null;
    }

    /**
     * As contagens da prévia — todas sobre os ELEGÍVEIS. `sem_pacote` e `com_atendimento_registrado`
     * só fazem sentido quando o alvo desconta (o que a tela pergunta é "vai descontar de quem?");
     * `ja_consumidas` conta sempre, porque com alvo não-descontante ela vira estorno.
     *
     * @param  Collection<int, Agendamento>  $elegiveis
     * @param  Collection<int, Atendimento>  $comAtendimento
     * @return array{agendamentos: int, criancas: int, sessoes_a_descontar: int, sem_pacote: int, ja_consumidas: int, com_atendimento_registrado: int}
     */
    private function contagens(Collection $elegiveis, StatusAgendamento $alvo, Collection $comAtendimento, int $aDescontar): array
    {
        $desconta = (bool) $alvo->desconta_sessao;

        return [
            'agendamentos' => $elegiveis->count(),
            'criancas' => $this->alcance->criancasDistintas($elegiveis),
            'sessoes_a_descontar' => $aDescontar,
            'sem_pacote' => $desconta ? $elegiveis->whereNull('tratamento_id')->count() : 0,
            'ja_consumidas' => $elegiveis->whereNotNull('sessao_consumida_em')->count(),
            'com_atendimento_registrado' => $desconta
                ? $elegiveis->filter(fn (Agendamento $a) => $comAtendimento->has($a->id))->count()
                : 0,
        ];
    }

    /**
     * Evoluções vencidas além da carência (D8): a prévia INFORMA pela mesma fonte única da
     * trava do registro de atendimento, e só quando o alvo desconta — com alvo não-descontante
     * a pergunta não existe, e a consulta não roda.
     *
     * @return array{evolucoes_vencidas?: int}
     */
    private function avisos(int $profissionalId, StatusAgendamento $alvo): array
    {
        if (! $alvo->desconta_sessao) {
            return [];
        }

        return ['evolucoes_vencidas' => $this->evolucoes->vencidasAlemDaCarencia($profissionalId)->count()];
    }
}
