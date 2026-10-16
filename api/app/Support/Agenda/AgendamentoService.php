<?php

namespace App\Support\Agenda;

use App\Http\Requests\ProfissionalRequest;
use App\Http\Requests\SalaRequest;
use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Equipamento;
use App\Models\Especialidade;
use App\Models\Profissional;
use App\Models\Sala;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Ciclos\GuardaDeCicloFechado;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\EscopoDoProfissional;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Regras de domínio da criação/edição de agendamentos (pseudo-fluxo do §6).
 * A FormRequest valida forma e FKs escopadas; AQUI vivem as invariantes.
 */
class AgendamentoService
{
    public const MAX_OCORRENCIAS_SERIE = 52;

    /** Quantas datas a recusa da série mostra antes de contar o resto (a parede de 48 não é lista). */
    private const DATAS_NA_RECUSA = 5;

    /** Nome do dia por ISO weekday (1=segunda..7=domingo) — para a recusa nomear o dia. */
    private const NOME_DO_DIA = [
        1 => 'segunda-feira', 2 => 'terça-feira', 3 => 'quarta-feira', 4 => 'quinta-feira',
        5 => 'sexta-feira', 6 => 'sábado', 7 => 'domingo',
    ];

    public function __construct(
        private readonly VerificadorDeConflitos $conflitos,
        private readonly ConfiguracaoService $configuracoes,
        private readonly ConsumoSessaoService $consumo,
        private readonly EncadeamentoService $encadeamento,
        private readonly GuardaDeLimiteDoConvenio $guardaLimite,
        private readonly GuardaDeCicloFechado $ciclos,
        private readonly EscopoDoProfissional $escopo,
    ) {}

    /**
     * Aviso de regra `avisar` excedida na ÚLTIMA mutação (limites-e-pedidos, D3):
     * viaja no payload da resposta, NUNCA persiste — derivado a cada escrita.
     *
     * @var array{convenio: string, periodo: string, limite: int}|null
     */
    private ?array $avisoDeLimite = null;

    /** @return array{convenio: string, periodo: string, limite: int}|null */
    public function avisoDeLimite(): ?array
    {
        return $this->avisoDeLimite;
    }

    /**
     * Datas em que o PACIENTE já tinha atendimento sobreposto, na ÚLTIMA mutação, quando o
     * clínica escolheu `avisar` (change conflito-do-paciente, D4): viaja no payload da resposta,
     * NUNCA persiste — derivado a cada escrita, como o aviso de limite.
     *
     * LISTA, e não booleano, porque a série avisa por OCORRÊNCIA: "avisou em alguma das 52"
     * não é informação com a qual a recepção consiga fazer alguma coisa.
     *
     * @var list<string>
     */
    private array $avisoDePacienteSobreposto = [];

    /** @var array<int, bool> memo de `ocupa_horario` por status — a série pergunta por ocorrência */
    private array $memoStatusOcupa = [];

    /** @var array<int, bool> memo do portão de escopo por paciente — idem (achado MÉDIO da r2) */
    private array $memoEnxergaPaciente = [];

    /** @var array<int, bool> memo da TRAVA de vínculo (dois eixos) — idem */
    private array $memoPodeVincular = [];

    /**
     * Memos das CAPACIDADES do conflito (change atendimento-em-grupo, D2).
     *
     * A série pergunta por ocorrência e o profissional é constante nas 52: sem memo, um SELECT
     * por data — o N+1 que `horariosPorProfissional` já evita ali ao lado.
     *
     * @var array<int, int>
     */
    private array $memoCapacidadeProfissional = [];

    /** @var array<int, int> */
    private array $memoCapacidadeSala = [];

    /** @return list<string>|null */
    public function avisoDePacienteSobreposto(): ?array
    {
        return $this->avisoDePacienteSobreposto === [] ? null : $this->avisoDePacienteSobreposto;
    }

    /**
     * O estado POR ESCRITA do serviço, zerado — avisos derivados e memos de leitura.
     *
     * Toda entrada pública de mutação chama isto como PRIMEIRA instrução, e a guarda de idioma
     * `tests/Arquitetura/RitualDeMutacaoTest.php` reprova quem esquecer. O ritual estava copiado
     * nas quatro entradas, e a cópia já cobrou: na rodada 1 do gate, `excluir()` era a única sem
     * ele. Cada campo novo aqui era mais um a lembrar em quatro lugares — e o que não se lembra
     * serve resposta da operação ANTERIOR do mesmo request, em silêncio.
     */
    private function iniciarMutacao(): void
    {
        $this->avisoDeLimite = null;
        $this->avisoDePacienteSobreposto = [];
        $this->memoStatusOcupa = [];
        $this->memoEnxergaPaciente = [];
        $this->memoPodeVincular = [];
        $this->memoCapacidadeProfissional = [];
        $this->memoCapacidadeSala = [];
    }

    /** @param array<string, mixed> $dados */
    public function criar(array $dados): Agendamento
    {
        $this->iniciarMutacao();
        $atributos = $this->resolverAtributos($dados, null);
        $this->assegurarVinculoPrevio($atributos);
        $this->validarDominio($atributos, null);

        // consumo na MESMA transação da criação (T-ate-13): status descontante
        // já no payload (registro retroativo) desconta aqui
        $agendamento = DB::transaction(function () use ($atributos): Agendamento {
            $agendamento = Agendamento::create($atributos);
            $this->consumo->reconciliar($agendamento, null);
            $this->encadeamento->aoMudarStatus($agendamento, null); // etapa 8

            return $agendamento;
        });

        return $agendamento->refresh();
    }

    /**
     * Série materializada, tudo-ou-nada (design D6, ampliada pela change `repeticao-da-serie`).
     *
     * O INTERVALO é em semanas (1 = semanal, 2 = quinzenal, até 8) e o término vem por UM de
     * dois modos, garantidos exclusivos pelo `AgendamentoRequest`:
     *   - `ate`         → repete enquanto a ocorrência couber até o fim daquele dia;
     *   - `ocorrencias` → repete até somar essa quantidade, CONTANDO a primeira.
     * Omitir o intervalo vale 1 — o pedido antigo (`{ate}` sozinho) continua literal.
     *
     * @param  array<string, mixed>  $dados
     * @param  array{intervalo_semanas?: int, ate?: string, ocorrencias?: int}  $recorrencia
     * @return list<Agendamento>
     */
    public function criarSerie(array $dados, array $recorrencia): array
    {
        // `iniciarMutacao()` é a PRIMEIRA linha de toda mutação — a guarda de arquitetura
        // `RitualDeMutacaoTest` existe porque zerar o estado depois de já ter lido algo deixa
        // aviso de uma chamada anterior vazar para esta. Ler a recorrência vem depois.
        $this->iniciarMutacao();

        // CADÊNCIA: semanas (como sempre) ou MESES (change `recorrencia-mensal`). A Request já
        // recusou as duas juntas; aqui a de meses ganha quando vier, e omitir as duas vale 1 semana.
        $meses = isset($recorrencia['intervalo_meses']) ? max(1, (int) $recorrencia['intervalo_meses']) : null;
        $intervalo = max(1, (int) ($recorrencia['intervalo_semanas'] ?? 1));
        $ate = $recorrencia['ate'] ?? null;
        $quantas = isset($recorrencia['ocorrencias']) ? (int) $recorrencia['ocorrencias'] : null;

        $atributos = $this->resolverAtributos($dados, null);
        $this->assegurarVinculoPrevio($atributos);
        $this->validarDominio($atributos, null);

        // a guarda compara com o INTERVALO, não com sete dias fixos (design D5): um evento de
        // dez dias sobreporia numa série semanal e é legítimo numa quinzenal. Na cadência mensal o
        // piso é o mês mais CURTO (28 dias): usar 30 deixaria passar um evento que se sobrepõe em
        // fevereiro, e a série não pode depender do mês em que começou.
        $diasDoIntervalo = $meses === null ? $intervalo * 7 : $meses * 28;
        if ($atributos['inicio']->diffInDays($atributos['fim']) >= $diasDoIntervalo) {
            throw ValidationException::withMessages([
                'recorrencia' => 'Eventos de '.$diasDoIntervalo.' dias ou mais não podem se repetir a cada '
                    .$diasDoIntervalo.' dias (as ocorrências se sobreporiam).',
            ]); // gate r1, I2
        }

        $limite = $ate === null ? null : Carbon::createFromFormat('Y-m-d', $ate)->endOfDay();
        $ocorrencias = [$atributos];
        // `addMonthsNoOverflow` é a parte que importa na cadência mensal: `addMonths` levaria
        // 31/01 para 03/03, mudando o MÊS da sessão em silêncio. Sem transbordo, fevereiro recebe
        // o último dia dele, que é o que qualquer calendário faz.
        // SEMPRE a partir da BASE, nunca encadeando o cursor anterior. Encadeando, a cadência
        // mensal DERRAPA: 31/01 vira 28/02 e, do 28/02, o próximo vira 28/03 — o dia do mês
        // encurtado uma vez ficava encurtado para sempre, contra a regra "mesmo dia do mês".
        // Em semanas os dois caminhos dão o mesmo resultado; em meses, não.
        $daBase = static fn (CarbonInterface $base, int $passo): CarbonInterface => $meses === null
            ? $base->copy()->addWeeks($intervalo * $passo)
            : $base->copy()->addMonthsNoOverflow($meses * $passo);
        $passo = 1;
        $cursorInicio = $daBase($atributos['inicio'], $passo);
        $cursorFim = $daBase($atributos['fim'], $passo);

        while ($limite !== null ? $cursorInicio->lte($limite) : count($ocorrencias) < $quantas) {
            if (count($ocorrencias) >= self::MAX_OCORRENCIAS_SERIE) {
                throw ValidationException::withMessages([
                    'recorrencia' => 'A série excede o máximo de '.self::MAX_OCORRENCIAS_SERIE.' ocorrências.',
                ]);
            }
            $ocorrencias[] = [...$atributos, 'inicio' => $cursorInicio->copy(), 'fim' => $cursorFim->copy()];
            $passo++;
            $cursorInicio = $daBase($atributos['inicio'], $passo);
            $cursorFim = $daBase($atributos['fim'], $passo);
        }

        // valida TODAS antes; qualquer conflito lista as datas e nada é criado
        $datasEmConflito = [];
        $motivos = [];
        $primeiraEmConflito = null;
        foreach (array_slice($ocorrencias, 1) as $ocorrencia) {
            $conflitos = $this->verificarConflitos($ocorrencia, []);
            if ($conflitos !== []) {
                $datasEmConflito[] = $ocorrencia['inicio'];
                $motivos += $conflitos;
                $primeiraEmConflito ??= $ocorrencia;
            }
        }
        if ($datasEmConflito !== []) {
            throw ValidationException::withMessages([
                'recorrencia' => $this->recusaDaSerie($datasEmConflito, $motivos, $primeiraEmConflito, count($ocorrencias)),
            ]);
        }

        // limite do convênio POR IRMÃ, em ordem cronológica, cada uma enxergando as
        // anteriores da MESMA transação (SEC-LP-10): sem os pendentes, 5 irmãs no mesmo
        // mês passariam por baixo de uma regra 4/mês porque o banco ainda não as tem.
        // `bloquear` em qualquer irmã → 422 e NADA é criado (a transação nem abre).
        // A primeira ocorrência já foi avaliada em validarDominio.
        $pendentes = [$this->pendenteDe($atributos)];
        foreach (array_slice($ocorrencias, 1) as $ocorrencia) {
            // avaliar SEMPRE (`??=` curto-circuita e desligaria a guarda das irmãs
            // seguintes assim que a primeira regra `avisar` memorizasse um aviso);
            // memorizar só o PRIMEIRO aviso é decisão de UX, não de guarda.
            $aviso = $this->guardaLimite->avaliar(
                $ocorrencia,
                isset($ocorrencia['tratamento_id']) ? (int) $ocorrencia['tratamento_id'] : null,
                [],
                $pendentes,
            );
            $this->avisoDeLimite ??= $aviso;
            $pendentes[] = $this->pendenteDe($ocorrencia);
        }

        $grupo = (string) Str::uuid();

        return DB::transaction(function () use ($ocorrencias, $grupo): array {
            return array_map(function (array $atributos) use ($grupo): Agendamento {
                $agendamento = new Agendamento($atributos);
                $agendamento->recorrencia_grupo_id = $grupo;
                $agendamento->save();
                // POR LINHA, tudo-ou-nada (T-ate-15): saldo insuficiente em
                // qualquer ocorrência → 422 e a transação inteira desfaz
                $this->consumo->reconciliar($agendamento, null);

                return $agendamento->refresh();
            }, $ocorrencias);
        });
    }

    /**
     * O alcance do `aplicar_na_serie` da alteração: as irmãs POSTERIORES ao agendamento, qualquer que
     * seja o status. Fonte única — o aviso à família conta por aqui quantas sessões mudam junto, e
     * uma cópia do predicado deixaria a família ouvir um número falso no dia em que o alcance mudar
     * (rodada 3 do gate dos avisos, CR3-04). Fora de série não há irmãs: a consulta não acha nada
     * (e nunca `recorrencia_grupo_id IS NULL`, que acharia todo agendamento avulso).
     *
     * @return Builder<Agendamento>
     */
    public function irmasSeguintes(Agendamento $agendamento): Builder
    {
        if ($agendamento->recorrencia_grupo_id === null) {
            return Agendamento::query()->whereKey([]);
        }

        return Agendamento::query()
            ->where('recorrencia_grupo_id', $agendamento->recorrencia_grupo_id)
            ->where('inicio', '>', $agendamento->inicio);
    }

    /**
     * @param  array<string, mixed>  $dados
     * @param  bool  $encadear  `false` nas operações em LOTE da agenda (baixa por status e
     *                          desmarque — D9 de `baixa-em-lote-por-status`): a supressão é por
     *                          PARÂMETRO explícito, nunca pelo contexto de auditoria. 40 finalizados
     *                          puxariam 40 "próximos do dia" para fora do alcance que a prévia mostrou.
     */
    public function atualizar(Agendamento $agendamento, array $dados, bool $aplicarNaSerie = false, bool $encadear = true): Agendamento
    {
        $this->iniciarMutacao();
        $idsDoGrupoParaIgnorar = ($aplicarNaSerie && $agendamento->recorrencia_grupo_id !== null)
            ? Agendamento::where('recorrencia_grupo_id', $agendamento->recorrencia_grupo_id)
                ->pluck('id')->all()
            : null;

        $atributos = $this->resolverAtributos($dados, $agendamento);
        $this->assegurarVinculoPrevio($atributos, $agendamento);
        $this->validarDominio($atributos, $agendamento, $idsDoGrupoParaIgnorar);

        // o que o usuário REALMENTE ENVIOU (≠ do resolvido — ver `guardasClinicas`)
        $tipoFinal = $atributos['tipo'] ?? null;
        $pacienteSolicitado = array_key_exists('paciente_id', $dados) && $dados['paciente_id'] !== null
            ? (int) $dados['paciente_id']
            : null;
        // SEC-FC-13: o ENVIO decide se há troca de vínculo — e o `null` explícito (anular o
        // tratamento) é um envio como qualquer outro. Por isso o par (bool, valor) e não um
        // `?int` sozinho: `null` significaria "não mexi" e "desvincule", que são opostos.
        $trocaTratamento = array_key_exists('tratamento_id', $dados);
        $tratamentoSolicitado = $trocaTratamento && $dados['tratamento_id'] !== null
            ? (int) $dados['tratamento_id']
            : null;

        if (! $aplicarNaSerie || $agendamento->recorrencia_grupo_id === null) {
            $tratamentoAnterior = $agendamento->tratamento_id;
            $statusAnterior = $agendamento->status_id;
            // SEC-TS (trava-de-status-em-ciclo-fechado): o status FINAL resolvido — carrega o
            // atual quando o payload o omite (⇒ a guarda não vê mudança) e `null` na conversão
            // para bloqueio (⇒ anular status É mudança, e o estorno move produção). A mudança
            // REAL é decidida na guarda, sob lock, contra o estado travado.
            $statusFinal = $atributos['status_id'] === null ? null : (int) $atributos['status_id'];
            DB::transaction(function () use ($agendamento, $atributos, $tratamentoAnterior, $statusAnterior, $tipoFinal, $pacienteSolicitado, $trocaTratamento, $tratamentoSolicitado, $statusFinal, $encadear): void {
                $this->guardasClinicas(
                    [$agendamento->id],
                    $tipoFinal,
                    $pacienteSolicitado,
                    $trocaTratamento,
                    $tratamentoSolicitado,
                    statusInformado: true,
                    statusFinal: $statusFinal,
                    inicioDestinoPorId: [$agendamento->id => $atributos['inicio']],
                );
                $agendamento->update($atributos);
                // ESTADO FINAL (lição da etapa 5): PUT parcial, mudança de status,
                // troca de tratamento e conversão de tipo reconciliam aqui
                $this->consumo->reconciliar($agendamento, $tratamentoAnterior);
                // automação do §6 (etapa 8) — série e LOTE ficam de fora: conveniência
                // pontual da recepção, não operação em massa
                if ($encadear) {
                    $this->encadeamento->aoMudarStatus($agendamento, $statusAnterior);
                }
            });

            return $agendamento->refresh();
        }

        // série: mesmo delta temporal + mesmos campos não-temporais nos FUTUROS (D6)
        $deltaSegundos = $agendamento->inicio->diffInSeconds($atributos['inicio'], false);
        $duracaoSegundos = $atributos['inicio']->diffInSeconds($atributos['fim']);
        // converter o TIPO em massa deixaria as irmãs incoerentes (bloqueio com
        // paciente, ou atendimento sem status = slot fantasma) — operação ambígua,
        // rejeitada explicitamente (gate r3)
        if ($atributos['tipo'] !== $agendamento->tipo) {
            throw ValidationException::withMessages([
                'aplicar_na_serie' => 'Não é possível mudar o tipo aplicando na série; '
                    .'edite cada agendamento individualmente.',
            ]);
        }

        // só o que o usuário REALMENTE enviou propaga para as irmãs (gate r2): o
        // estado resolvido carregaria status/paciente e ressuscitaria uma ocorrência
        // futura cancelada individualmente
        $naoTemporais = collect($atributos)
            ->only(array_keys(collect($dados)->except([
                'inicio', 'fim', 'duracao_minutos', 'recorrencia', 'aplicar_na_serie',
            ])->all()))
            ->all();

        $futuros = $this->irmasSeguintes($agendamento)->orderBy('inicio')->get();

        // ignorar o GRUPO inteiro: todos deslocam pelo mesmo delta, então o slot
        // antigo de uma irmã não é conflito real (gate r1, I1)
        $idsDoGrupo = [$agendamento->id, ...$futuros->pluck('id')->all()];

        // tudo-ou-nada: valida os futuros deslocados antes de gravar
        foreach ($futuros as $futuro) {
            $novoInicio = $futuro->inicio->copy()->addSeconds($deltaSegundos);
            $conflitos = $this->verificarConflitos([
                ...$naoTemporais,
                'inicio' => $novoInicio,
                'fim' => $novoInicio->copy()->addSeconds($duracaoSegundos),
            ], $idsDoGrupo, $futuro);
            if ($conflitos !== []) {
                throw ValidationException::withMessages([
                    'recorrencia' => 'Conflito ao aplicar na série em '.$novoInicio->format('Y-m-d').'.',
                ]);
            }
        }

        // SEC-TS: no ramo de série o status só muda se foi ENVIADO (só o enviado propaga
        // para as irmãs); o valor resolvido é o mesmo para o clicado e para o lote. O
        // destino do `inicio` é por linha — o clicado vai para o resolvido, cada irmã
        // desloca pelo delta (a MESMA expressão da gravação lá embaixo).
        $trocaStatusNaSerie = array_key_exists('status_id', $naoTemporais);
        $statusDaSerie = $trocaStatusNaSerie && $naoTemporais['status_id'] !== null
            ? (int) $naoTemporais['status_id'] : null;
        $inicioDestinoPorId = [$agendamento->id => $atributos['inicio']];
        foreach ($futuros as $futuro) {
            $inicioDestinoPorId[$futuro->id] = $futuro->inicio->copy()->addSeconds($deltaSegundos);
        }

        return DB::transaction(function () use ($agendamento, $atributos, $futuros, $deltaSegundos, $duracaoSegundos, $naoTemporais, $idsDoGrupo, $tipoFinal, $pacienteSolicitado, $trocaTratamento, $tratamentoSolicitado, $trocaStatusNaSerie, $statusDaSerie, $inicioDestinoPorId): Agendamento {
            // o LOTE inteiro: as irmãs são gravadas por `$futuro->update()`, que NÃO passa
            // por `resolverAtributos` nem por `validarDominio` — sem esta guarda aqui, uma
            // requisição re-parentaria N prontuários de uma vez. E "futuro" neste ramo é
            // relativo ao agendamento CLICADO, não a hoje: ocorrências já ATENDIDAS entram
            // no lote.
            $this->guardasClinicas(
                $idsDoGrupo,
                $tipoFinal,
                $pacienteSolicitado,
                $trocaTratamento,
                $tratamentoSolicitado,
                statusInformado: $trocaStatusNaSerie,
                statusFinal: $statusDaSerie,
                inicioDestinoPorId: $inicioDestinoPorId,
            );

            // SEC-PD-03: as irmãs são gravadas por `$futuro->update()`, que NÃO passa pelo Rule
            // do boundary — um desligado propagado não pode RE-vincular uma irmã que apontava
            // para outro profissional (a regra "ativo OU já vinculado", aplicada por irmã).
            $this->guardaSerieProfissionalDesligado($naoTemporais, $futuros);

            // DAT-DADOS-01 nota 2: o mesmo bypass vale para os DIAS de atendimento — o delta pode
            // deslocar uma irmã para um dia em que o profissional não atende, sem passar por
            // `validarDominio`. Cada irmã de atendimento é validada aqui, dentro da transação.
            $this->guardaSerieDiasDeAtendimento($naoTemporais, $futuros, $deltaSegundos);

            // SEC-LP-10: e também para o LIMITE DO CONVÊNIO — o delta pode empurrar uma irmã
            // para uma janela (dia/semana/mês) já cheia sem passar por `validarDominio`.
            // Guarda por-irmã na mesma transação, tudo-ou-nada (molde da guarda de dias).
            $this->guardaSerieLimiteDoConvenio(
                $naoTemporais,
                $futuros,
                $deltaSegundos,
                [
                    ...$this->pendenteDe($atributos),
                    'tratamento_id' => array_key_exists('tratamento_id', $atributos)
                        ? $atributos['tratamento_id']
                        : $agendamento->tratamento_id,
                ],
                $idsDoGrupo,
            );

            $tratamentoAnterior = $agendamento->tratamento_id;
            $agendamento->update($atributos);
            $this->consumo->reconciliar($agendamento, $tratamentoAnterior);
            foreach ($futuros as $futuro) {
                $novoInicio = $futuro->inicio->copy()->addSeconds($deltaSegundos);
                $tratamentoAnteriorDaIrma = $futuro->tratamento_id;
                $futuro->update([
                    ...$naoTemporais,
                    'inicio' => $novoInicio,
                    'fim' => $novoInicio->copy()->addSeconds($duracaoSegundos),
                ]);
                // POR LINHA na mesma transação (T-ate-15): qualquer 422 desfaz tudo
                $this->consumo->reconciliar($futuro, $tratamentoAnteriorDaIrma);
            }

            return $agendamento->refresh();
        });
    }

    /**
     * As duas guardas clínicas do agendamento — decididas SOB LOCK, dentro da transação,
     * sobre o estado RELIDO do banco (nunca sobre o model que o controller carregou).
     *
     * **PAC-REP** — trocar o paciente de um agendamento JÁ ATENDIDO re-parenta a observação
     * clínica de uma criança para outra: o atendimento é 1:1 com o agendamento e a evolução
     * é 1:1 com o atendimento. Enquanto NÃO há atendimento, a troca é permitida — marcar na
     * criança errada é o erro mais banal da recepção, e corrigi-lo não pode custar recriar o
     * agendamento inteiro.
     *
     * **IRMÃ** — agendamento com atendimento não vira `bloqueio` (bloqueio não carrega
     * vínculo clínico).
     *
     * **VÍNCULO CONGELADO (SEC-FC-13 — o fix REAL do SEC-TE-01)** — `tratamento_id` não muda
     * nem se anula quando o atendimento do agendamento cai em período fechado. É por ESTA
     * porta que o contorno sobrevivia: o convênio de um atendimento mora aqui, e esta coluna
     * é editável sob `agenda.editar` — permissão MAIS distribuída que `atendimentos.editar`.
     * Travar o `finalizado_em` lá protegeria a data e deixaria o vínculo livre: bastava
     * apontar o agendamento para um tratamento de outro convênio (ou anular o vínculo, e o
     * registro cair no fail-open do D5 como "fora de todo ciclo") para a produção congelada
     * sair do ciclo sem reabrir nada. A verificação é ORIGEM **E** DESTINO — o tratamento
     * novo pode pertencer a outro convênio cujo período correspondente também está fechado.
     *
     * O fail-open do D5 vale como AUSÊNCIA de vínculo, jamais como REMOÇÃO (SEC-FC-16): é
     * exatamente esta guarda que faz essa frase ser verdade.
     *
     * **Por que SOB LOCK e não um `SELECT` antes da transação** (que é como a irmã vivia): o
     * atendimento nasce por OUTRO caminho (`AtendimentoController::store`), e pode nascer
     * ENTRE a checagem e a gravação. A guarda passaria e o dano aconteceria assim mesmo — e
     * aqui o dano é IRREPARÁVEL: com o prontuário da criança A colado na criança B, trocar de
     * volta é recusado (existe atendimento), a evolução NÃO tem rota de exclusão, o
     * atendimento não se exclui (tem evolução) e o agendamento não se exclui (tem
     * atendimento). Sobra intervenção manual no banco — e o conteúdo é mascarado na trilha,
     * que não prova de quem era. As corridas que este produto ACEITA foram aceitas por serem
     * reversíveis e detectáveis; esta não é nenhum dos dois.
     *
     * O lock que SUSTENTA a guarda é o (1): o `INSERT` em `atendimentos` precisa do S-lock da
     * FK na linha PAI e bloqueia — em REPEATABLE READ **e** em READ COMMITTED. O (2) é reforço
     * (gap lock no índice único), e ele só existe em REPEATABLE READ.
     *
     * Ordem de locks: **agendamentos → atendimentos → tratamentos → convenios** — estende a
     * ordem já vigente (agendamento → tratamento) SEM invertê-la. Todo escritor futuro
     * obedece. Os tratamentos são travados nesta função, ANTES da guarda de ciclo; deixá-los
     * para o `reconciliar()` lá adiante põe `convenios` na frente e cruza em deadlock com o
     * `TratamentoController::update` — ver a nota longa no fim do corpo.
     *
     * @param  list<int>  $ids  o lote afetado: tudo-ou-nada, como `garantirExcluiveis`
     * @param  string|null  $tipoFinal  o tipo pretendido
     * @param  int|null  $pacienteSolicitado  o paciente que o usuário REALMENTE ENVIOU — não o
     *                                        resolvido. `resolverAtributos` preenche o campo com
     *                                        o valor ATUAL quando o payload o omite, e comparar
     *                                        contra ele acusaria troca onde não há. No ramo da
     *                                        série, além disso, só o que foi enviado propaga
     *                                        para as irmãs: é o envio que diz o que vai mudar.
     * @param  bool  $trocaTratamento  o payload MENCIONOU `tratamento_id`. Separado do valor
     *                                 porque anular (`null` explícito) é troca, e um `?int`
     *                                 sozinho confundiria "não mexi" com "desvincule".
     * @param  int|null  $tratamentoSolicitado  o tratamento de DESTINO (`null` = desvincular)
     * @param  bool  $statusInformado  o gesto pode mudar status (ramo individual: sempre —
     *                                 o resolvido carrega o atual quando omitido; série: só
     *                                 quando `status_id` foi enviado e propaga)
     * @param  int|null  $statusFinal  o status que FICARÁ gravado (`null` = anulação, na
     *                                 conversão para bloqueio). A mudança REAL é decidida
     *                                 aqui, por linha, contra o estado travado (SEC-TS)
     * @param  array<int, \DateTimeInterface>  $inicioDestinoPorId  o `inicio` que cada linha
     *                                                              do lote terá após a gravação — o par de DESTINO da
     *                                                              dupla verificação (SEC-FC-15) quando o dia muda
     *
     * @throws ValidationException
     */
    private function guardasClinicas(
        array $ids,
        ?string $tipoFinal,
        ?int $pacienteSolicitado,
        bool $trocaTratamento = false,
        ?int $tratamentoSolicitado = null,
        bool $statusInformado = false,
        ?int $statusFinal = null,
        array $inicioDestinoPorId = [],
    ): void {
        sort($ids); // ordem estável entre transações concorrentes → sem deadlock

        // (1) ÂNCORA — X-lock nas linhas do agendamento
        $travados = Agendamento::whereIn('id', $ids)
            ->orderBy('id')
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        // (2) REFORÇO — leitura TRAVANTE no índice único `atendimentos.agendamento_id`.
        // `->exists()` NÃO serve: o Eloquent o embrulha em `select exists(...)`, e o
        // lockForUpdate se perde. Leitura explícita.
        //
        // `finalizado_em` entra na projeção porque é a COMPETÊNCIA do atendimento (D3), e a
        // guarda de ciclo abaixo decide por ela. Sem esta coluna aqui, a decisão precisaria
        // de uma segunda ida ao banco — fora do lock que acabamos de tomar.
        $comAtendimento = Atendimento::whereIn('agendamento_id', $ids)
            ->orderBy('agendamento_id')
            ->lockForUpdate()
            ->get(['id', 'agendamento_id', 'finalizado_em'])
            ->keyBy('agendamento_id');

        if ($comAtendimento->isEmpty() && ! $statusInformado && ! $trocaTratamento) {
            return; // sem atendimento, sem status e sem troca de vínculo: guardas inertes
        }

        /** @var list<array{0: int|null, 1: mixed}> pares (tratamento, competência) do ciclo */
        $paresDeCiclo = [];

        foreach ($comAtendimento as $idAtendido => $atendimento) {
            $atendido = $travados->get($idAtendido);
            if ($atendido === null) {
                continue;
            }

            if ($tipoFinal === 'bloqueio' && $atendido->tipo === 'atendimento') {
                throw ValidationException::withMessages([
                    'tipo' => 'Agendamento com atendimento registrado não pode virar bloqueio — exclua o atendimento primeiro.',
                ]);
            }

            // comparação sobre o estado TRAVADO — nunca sobre o model que o controller carregou
            if ($pacienteSolicitado !== null && $pacienteSolicitado !== (int) $atendido->paciente_id) {
                throw ValidationException::withMessages([
                    'paciente_id' => 'Este agendamento já tem atendimento registrado e não pode mudar de paciente: '
                        .'a evolução clínica pertence a esta criança. Para corrigir, exclua o atendimento primeiro.',
                ]);
            }

            // SEC-FC-13 — só quando o vínculo MUDA de fato. Reenviar o mesmo `tratamento_id`
            // (o que um PUT completo faz a cada salvamento) não é troca, e recusá-lo
            // congelaria a edição inteira do agendamento em vez de congelar o vínculo.
            $atual = $atendido->tratamento_id === null ? null : (int) $atendido->tratamento_id;
            if (! $trocaTratamento || $tratamentoSolicitado === $atual) {
                continue;
            }

            $paresDeCiclo[] = [$atual, $atendimento->finalizado_em];                // origem
            $paresDeCiclo[] = [$tratamentoSolicitado, $atendimento->finalizado_em]; // destino
        }

        // SEC-TS — a perna do 6º caminho (fecha o SEC-FC-20, pedido da clínica 2026-07-25):
        // mudança REAL de status decidida por linha contra o estado TRAVADO, nunca contra o
        // model do controller. Vale também SEM atendimento — o consumo de sessão move
        // `sessoes_realizadas` sem ele. Competência do agendamento = `inicio` (o dia da
        // SESSÃO — design D1; diverge deliberadamente do `finalizado_em`, que é a data do
        // REGISTRO clínico); origem sempre, destino quando o mesmo gesto remarca para outro
        // dia (dupla verificação, idioma SEC-FC-15). Linha sem tratamento/convênio cai no
        // fail-open do D5 dentro da guarda, como os demais caminhos.
        if ($statusInformado) {
            foreach ($travados as $id => $travado) {
                $statusAtual = $travado->status_id === null ? null : (int) $travado->status_id;
                if ($statusFinal === $statusAtual) {
                    continue; // reenviar o mesmo status não é mudança (idioma SEC-FC-13)
                }

                $diasDaLinha = [$travado->inicio];
                $destino = $inicioDestinoPorId[$id] ?? null;
                if ($destino !== null
                    && $destino->format('Y-m-d') !== $travado->inicio->format('Y-m-d')) {
                    $diasDaLinha[] = $destino; // remarcou para outro dia no MESMO gesto
                }

                // a produção movida pertence ao vínculo TRAVADO da linha — e, se o mesmo
                // gesto também troca o tratamento, ao de destino (os dois ciclos importam)
                $tratamentosDaLinha = [$travado->tratamento_id === null ? null : (int) $travado->tratamento_id];
                if ($trocaTratamento && $tratamentoSolicitado !== $tratamentosDaLinha[0]) {
                    $tratamentosDaLinha[] = $tratamentoSolicitado;
                }

                foreach ($tratamentosDaLinha as $tratamentoDaLinha) {
                    foreach ($diasDaLinha as $diaDaLinha) {
                        $paresDeCiclo[] = [$tratamentoDaLinha, $diaDaLinha];
                    }
                }
            }
        }

        // SEC-TS-02 (parecer desta change) — a troca de VÍNCULO move a MESMA contagem que
        // o status move, e sem atendimento nenhum: linha CONSUMIDA que muda de tratamento
        // (inclusive para `null`) estorna/consome produção pela competência da SESSÃO
        // (`inicio`, D1). O loop do SEC-FC-13 acima só enxerga linhas COM atendimento e
        // decide por `finalizado_em` (a competência do REGISTRO clínico) — sem esta perna,
        // remover o vínculo de um agendamento consumido seria fuga do ciclo em UM gesto,
        // exatamente a porta que o SEC-FC-16 promete não existir. Linha sem consumo segue
        // livre: sem consumo, nada faturável se move com a troca.
        if ($trocaTratamento) {
            foreach ($travados as $id => $travado) {
                if ($travado->sessao_consumida_em === null) {
                    continue;
                }
                $atualDaLinha = $travado->tratamento_id === null ? null : (int) $travado->tratamento_id;
                if ($tratamentoSolicitado === $atualDaLinha) {
                    continue; // reenviar o mesmo vínculo não é troca (SEC-FC-13)
                }

                $diasDaLinha = [$travado->inicio];
                $destino = $inicioDestinoPorId[$id] ?? null;
                if ($destino !== null
                    && $destino->format('Y-m-d') !== $travado->inicio->format('Y-m-d')) {
                    $diasDaLinha[] = $destino;
                }

                foreach ([$atualDaLinha, $tratamentoSolicitado] as $tratamentoDaLinha) {
                    foreach ($diasDaLinha as $diaDaLinha) {
                        $paresDeCiclo[] = [$tratamentoDaLinha, $diaDaLinha]; // origem E destino
                    }
                }
            }
        }

        // TRATAMENTOS ANTES DO CONVÊNIO — a ordem da casa, cumprida AQUI e não mais adiante.
        //
        // A guarda de ciclo toma X-lock em `convenios` **mesmo quando não acha fechamento
        // nenhum** (é o ponto de serialização do SEC-FC-10). O X-lock em `tratamentos` deste
        // caminho nascia só depois, no `consumo->reconciliar()` — ou seja, `convenios` ANTES
        // de `tratamentos`, invertendo a sequência que o D8/SEC-FC-12 declaram inegociável:
        //
        //     agendamentos → atendimentos → tratamentos → convenios → fechamentos_ciclo
        //
        // O cruzamento era alcançável e caro: `TratamentoController::update` trava o
        // tratamento e DEPOIS o convênio; um PUT de agendamento trocando `tratamento_id`
        // corria na ordem oposta. A segurava C esperando T, B segurava T esperando C —
        // deadlock 1213 estourando dentro do `reconciliar`, FORA do try/catch de
        // `recusarCorridaDoCiclo`, e o `DB::transaction` roda com `$attempts = 1` (sem
        // retry). A corrida que o desenho promete devolver como 409 chegava como **500**.
        //
        // Os ids já estão em mãos (são os pares de origem/destino montados acima), então
        // travá-los aqui não custa uma ida a mais ao banco — custa a ordem certa.
        $tratamentos = array_values(array_unique(array_filter(
            array_map(fn (array $par): ?int => $par[0], $paresDeCiclo),
            fn (?int $id): bool => $id !== null,
        )));
        sort($tratamentos); // ordem estável entre transações concorrentes — como o `sort($ids)`
        if ($tratamentos !== []) {
            Tratamento::whereIn('id', $tratamentos)->orderBy('id')->lockForUpdate()->get();
        }

        // uma chamada só, DEPOIS do loop: a guarda trava os convênios envolvidos em ordem
        // crescente de id, e chamá-la por linha tomaria os mesmos locks em ordem ditada pela
        // ordem das linhas — que varia entre requisições.
        $this->ciclos->assegurarPorTratamento($paresDeCiclo);
    }

    /**
     * SEC-PD-03 — aplicar-na-série propaga `profissional_id` para as irmãs via `$futuro->update()`,
     * que NÃO passa por FormRequest nem pelo Rule do boundary. Um desligado só permanece onde JÁ
     * estava vinculado; nunca é RE-vinculado a uma irmã que apontava para outro profissional. É a
     * regra "ativo OU já vinculado" do boundary (gatilho PROF-DESLIGADO), aplicada por irmã.
     *
     * @param  array<string, mixed>  $naoTemporais  o que o usuário enviou e será propagado
     * @param  Collection<int, Agendamento>  $futuros
     */
    private function guardaSerieProfissionalDesligado(array $naoTemporais, Collection $futuros): void
    {
        if (! array_key_exists('profissional_id', $naoTemporais)) {
            return; // nada de profissional a propagar
        }

        $profissionalId = (int) $naoTemporais['profissional_id'];
        $profissional = Profissional::find($profissionalId);
        if ($profissional === null || $profissional->ativo) {
            return; // ativo (ou inexistente — o boundary já barrou): propagação livre
        }

        foreach ($futuros as $futuro) {
            if ((int) $futuro->profissional_id !== $profissionalId) {
                throw ValidationException::withMessages([
                    'profissional_id' => 'Profissional desligado não pode ser aplicado na série a um '
                        .'agendamento que apontava para outro profissional.',
                ]);
            }
        }
    }

    /**
     * DAT-DADOS-01 (nota 2) — aplicar-na-série desloca cada irmã por `$deltaSegundos` via
     * `$futuro->update()`, que NÃO passa por `validarDominio`. Num grupo já HETEROGÊNEO em
     * weekday, o delta pode levar uma irmã de ATENDIMENTO para um dia em que o profissional
     * não atende sem passar pela regra. Cada irmã é validada aqui, dentro da transação
     * (mesmo espírito da guarda do desligado). Bloqueio é isento (D3); `null` = todos os dias.
     *
     * @param  array<string, mixed>  $naoTemporais
     * @param  Collection<int, Agendamento>  $futuros
     */
    private function guardaSerieDiasDeAtendimento(array $naoTemporais, Collection $futuros, int $deltaSegundos): void
    {
        $horariosPorProfissional = []; // memo id→horários: a série costuma ter um só profissional (sem N+1)
        foreach ($futuros as $futuro) {
            $tipoFinal = $naoTemporais['tipo'] ?? $futuro->tipo;
            if ($tipoFinal !== 'atendimento') {
                continue;
            }
            $profissionalId = (int) ($naoTemporais['profissional_id'] ?? $futuro->profissional_id);
            if (! array_key_exists($profissionalId, $horariosPorProfissional)) {
                $horariosPorProfissional[$profissionalId] = $this->horariosDoProfissional($profissionalId);
            }
            $horarios = $horariosPorProfissional[$profissionalId];
            if ($horarios === []) {
                continue;
            }
            $novoInicio = $futuro->inicio->copy()->addSeconds($deltaSegundos);
            $minutos = $novoInicio->hour * 60 + $novoInicio->minute;
            if (! $this->atendeEm($horarios, $novoInicio->isoWeekday(), $minutos)) {
                throw ValidationException::withMessages([
                    'inicio' => 'Ao aplicar na série, a ocorrência de '.$novoInicio->format('d/m/Y H:i')
                        .' cairia fora do atendimento do profissional.',
                ]);
            }
        }
    }

    /**
     * O teto de atendimentos simultâneos do profissional (change atendimento-em-grupo, D2).
     *
     * Memoizado por escrita: a série pergunta 52 vezes pelo mesmo profissional. `?? 1` cobre o
     * profissional que sumiu entre a validação e aqui — e 1 é a posição segura: na dúvida, a
     * agenda protege em vez de abrir.
     */
    private function capacidadeDoProfissional(int $profissionalId): int
    {
        return $this->memoCapacidadeProfissional[$profissionalId] ??= self::naFaixa(
            (int) (Profissional::whereKey($profissionalId)->value('atendimentos_simultaneos') ?? 1),
            ProfissionalRequest::SIMULTANEOS_MAXIMO,
        );
    }

    /** O teto da sala — mesmo contrato, mesma posição segura. */
    private function capacidadeDaSala(int $salaId): int
    {
        return $this->memoCapacidadeSala[$salaId] ??= self::naFaixa(
            (int) (Sala::whereKey($salaId)->value('capacidade') ?? 1),
            SalaRequest::CAPACIDADE_MAXIMA,
        );
    }

    /**
     * A capacidade lida do banco, presa na faixa — nos DOIS extremos (parecer SEC-AG-02).
     *
     * O piso é óbvio: `0 >= 0` lotaria o recurso com nenhum ocupante e travaria a agenda
     * inteira daquele profissional.
     *
     * O TETO é o que faltava, e é o que importa para a segurança: a coluna é
     * `unsignedTinyInteger` (aceita 255) e a faixa só existia na `FormRequest`. Qualquer
     * escrita que não passe por ela — SQL direto na VPS, restauração de backup, um importador
     * futuro, um endpoint novo que use o `$fillable` — desligaria o eixo de conflito **em
     * silêncio**, e um `40` no lugar de `4` não parece erro em lugar nenhum. Medido pelo gate:
     * com a coluna em 40, doze atendimentos entraram no mesmo horário.
     *
     * A faixa vem das FormRequests de propósito: uma segunda constante aqui divergiria da
     * primeira no dia em que a clínica pedir um teto maior.
     */
    private static function naFaixa(int $valor, int $maximo): int
    {
        return min($maximo, max(1, $valor));
    }

    /**
     * Os horários do profissional como mapa `dia ISO → lista de [iniMin, fimMin]`.
     * Vazio (`[]`) = sem horários = atende todos os dias/horas (retrocompat). Query direta —
     * o chamador memoiza por profissional para evitar N+1.
     *
     * @return array<int, list<array{0: int, 1: int}>>
     */
    private function horariosDoProfissional(int $profissionalId): array
    {
        $mapa = [];
        foreach (
            DB::table('profissional_horarios')
                ->where('profissional_id', $profissionalId)
                ->get(['dia_semana', 'inicio', 'fim']) as $linha
        ) {
            $mapa[(int) $linha->dia_semana][] = [$this->minutosDe($linha->inicio), $this->minutosDe($linha->fim)];
        }

        return $mapa;
    }

    /**
     * O `inicio` (dia ISO + minutos da parede) cai em ALGUM intervalo do dia? Fim exclusivo:
     * uma sessão que começa exatamente no fim do turno já está fora (basta o início cair dentro).
     *
     * @param  array<int, list<array{0: int, 1: int}>>  $horarios
     */
    private function atendeEm(array $horarios, int $isoWeekday, int $minutos): bool
    {
        foreach ($horarios[$isoWeekday] ?? [] as [$inicio, $fim]) {
            if ($minutos >= $inicio && $minutos < $fim) {
                return true;
            }
        }

        return false;
    }

    /** "HH:MM[:SS]" → minutos do dia. */
    private function minutosDe(string $hora): int
    {
        [$h, $m] = array_map('intval', explode(':', $hora));

        return $h * 60 + $m;
    }

    /**
     * A projeção de uma ocorrência AINDA NÃO GRAVADA para a contagem de limite do
     * convênio (SEC-LP-10): só o que a guarda precisa para casar janela/paciente/
     * especialidade/convênio — nunca o payload inteiro.
     *
     * @param  array<string, mixed>  $atributos
     * @return array<string, mixed>
     */
    private function pendenteDe(array $atributos): array
    {
        return [
            'inicio' => $atributos['inicio'],
            'paciente_id' => $atributos['paciente_id'] ?? null,
            'especialidade_id' => $atributos['especialidade_id'] ?? null,
            'tratamento_id' => $atributos['tratamento_id'] ?? null,
            'status_id' => $atributos['status_id'] ?? null,
        ];
    }

    /**
     * SEC-LP-10 — aplicar-na-série grava as irmãs por `$futuro->update()`, sem
     * `validarDominio`: cada irmã de atendimento é avaliada aqui contra as regras de
     * limite do convênio, no seu ESTADO FINAL deslocado, dentro da transação. O GRUPO
     * inteiro fica fora da contagem do banco (todos deslocam pelo mesmo delta); cada
     * irmã enxerga o clicado e as anteriores nas NOVAS posições (pendentes, ordem
     * cronológica — $futuros já vem ordenado por inicio). `bloquear` → 422 e a
     * transação inteira desfaz (tudo-ou-nada); `avisar` → aviso na resposta.
     *
     * @param  array<string, mixed>  $naoTemporais
     * @param  Collection<int, Agendamento>  $futuros
     * @param  array<string, mixed>  $pendenteDoClicado
     * @param  list<int>  $idsDoGrupo
     */
    private function guardaSerieLimiteDoConvenio(
        array $naoTemporais,
        Collection $futuros,
        int $deltaSegundos,
        array $pendenteDoClicado,
        array $idsDoGrupo,
    ): void {
        $pendentes = [$pendenteDoClicado];
        foreach ($futuros as $futuro) {
            $novoInicio = $futuro->inicio->copy()->addSeconds($deltaSegundos);
            // estado FINAL da irmã: o que foi enviado propaga; o resto é o dela
            $estadoFinal = [
                'tipo' => $naoTemporais['tipo'] ?? $futuro->tipo,
                'inicio' => $novoInicio,
                'paciente_id' => array_key_exists('paciente_id', $naoTemporais)
                    ? $naoTemporais['paciente_id'] : $futuro->paciente_id,
                'especialidade_id' => array_key_exists('especialidade_id', $naoTemporais)
                    ? $naoTemporais['especialidade_id'] : $futuro->especialidade_id,
                'status_id' => array_key_exists('status_id', $naoTemporais)
                    ? $naoTemporais['status_id'] : $futuro->status_id,
            ];
            $tratamentoFinal = array_key_exists('tratamento_id', $naoTemporais)
                ? $naoTemporais['tratamento_id'] : $futuro->tratamento_id;

            // avaliar SEMPRE — ver a nota do `??=` em criarSerie(): curto-circuito aqui
            // deixaria as irmãs seguintes passarem por baixo de uma regra `bloquear`.
            $aviso = $this->guardaLimite->avaliar(
                $estadoFinal,
                $tratamentoFinal !== null ? (int) $tratamentoFinal : null,
                $idsDoGrupo,
                $pendentes,
            );
            $this->avisoDeLimite ??= $aviso;
            $pendentes[] = [...$estadoFinal, 'tratamento_id' => $tratamentoFinal];
        }
    }

    public function excluir(Agendamento $agendamento, bool $aplicarNaSerie): void
    {
        // `excluir` não LÊ os avisos — mas a exceção é o começo da omissão (ver `iniciarMutacao`)
        $this->iniciarMutacao();

        if (! $aplicarNaSerie || $agendamento->recorrencia_grupo_id === null) {
            $this->garantirExcluiveis(collect([$agendamento]));
            $agendamento->delete();

            return;
        }

        DB::transaction(function () use ($agendamento): void {
            $daSerie = Agendamento::where('recorrencia_grupo_id', $agendamento->recorrencia_grupo_id)
                ->where('inicio', '>=', $agendamento->inicio)
                ->orderBy('inicio')
                ->get();

            // qualquer linha protegida rejeita a série INTEIRA (T-ate-17)
            $this->garantirExcluiveis($daSerie);

            $daSerie->each->delete(); // um a um: cada exclusão auditada
        });
    }

    /**
     * A cadeia clínico-financeira nunca some (T-ate-17): consumido → estorne
     * primeiro mudando o status; com atendimento → registro clínico é histórico.
     * O FK restrict de atendimentos é o backstop no banco.
     *
     * @param  Collection<int, Agendamento>  $agendamentos
     */
    private function garantirExcluiveis(Collection $agendamentos): void
    {
        if ($agendamentos->contains(fn (Agendamento $a) => $a->sessao_consumida_em !== null)) {
            throw ValidationException::withMessages([
                'agendamento' => 'Agendamento com sessão consumida não pode ser excluído — estorne primeiro mudando o status.',
            ]);
        }

        if (Atendimento::whereIn('agendamento_id', $agendamentos->pluck('id'))->exists()) {
            throw ValidationException::withMessages([
                'agendamento' => 'Agendamento com atendimento registrado não pode ser excluído.',
            ]);
        }
    }

    /**
     * Resolve fim (payload > duração > tempo_sessao da especialidade) e status
     * default (menor ordem) — pseudo-fluxo §6.
     *
     * @param  array<string, mixed>  $dados
     * @return array<string, mixed>
     */
    private function resolverAtributos(array $dados, ?Agendamento $atual): array
    {
        $tipo = $dados['tipo'] ?? $atual?->tipo ?? 'atendimento';
        // convenção (gate r1, B1): datetimes "naive" do payload/schema são a PAREDE
        // DA CLÍNICA. O pipeline inteiro (storage, conflitos, deltas de série) opera
        // nesse único frame; só o RETROATIVO compara parede-com-parede com o relógio
        // atual da clínica (ver validarDominio).
        $inicio = Carbon::parse($dados['inicio']);

        if (isset($dados['fim'])) {
            $fim = Carbon::parse($dados['fim']);
        } elseif (isset($dados['duracao_minutos'])) {
            $fim = $inicio->copy()->addMinutes((int) $dados['duracao_minutos']);
        } elseif ($atual !== null) {
            // EDIÇÃO sem falar de duração PRESERVA a duração atual. Recalcular
            // pela especialidade encolheria em silêncio uma sessão de 90 min
            // para os 40 do tempo padrão — só porque a recepção trocou o status
            // pelo card (gate agenda-escrita, B-03). Herdar da especialidade é
            // regra de CRIAÇÃO.
            $fim = $inicio->copy()->addMinutes($atual->inicio->diffInMinutes($atual->fim));
        } else {
            $especialidadeId = $dados['especialidade_id'] ?? null;
            $tempo = $especialidadeId !== null
                ? Especialidade::whereKey($especialidadeId)->value('tempo_sessao')
                : null;
            if ($tempo === null) {
                throw ValidationException::withMessages([
                    'fim' => 'Informe o fim, a duração ou uma especialidade com tempo de sessão.',
                ]);
            }
            $fim = $inicio->copy()->addMinutes((int) $tempo);
        }

        if ($fim->lte($inicio)) {
            throw ValidationException::withMessages(['fim' => 'O fim deve ser depois do início.']);
        }

        $atributos = collect($dados)->except(['duracao_minutos', 'recorrencia', 'aplicar_na_serie'])->all();
        $atributos['tipo'] = $tipo;
        $atributos['inicio'] = $inicio;
        $atributos['fim'] = $fim;

        // Marcador de lembrete (mensageria-whatsapp): na CRIAÇÃO sem valor explícito, o
        // default vem da parametrização da clínica (§13 — `whatsapp.pre_selecionado`), não
        // de uma constante. Um default de coluna seria a regra congelada no código, que é o
        // que a §13 proíbe. Na EDIÇÃO, ausência preserva o gravado.
        // BLOQUEIO não tem família a avisar — e o FormRequest já o proíbe no payload; sem
        // esta perna, o default da clínica o ligava pelas costas
        if ($atual === null && $tipo !== 'bloqueio' && ! array_key_exists('lembrete_whatsapp', $atributos)) {
            $atributos['lembrete_whatsapp'] = (bool) $this->configuracoes->get('whatsapp.pre_selecionado');
        }

        // invariante D3 no ESTADO FINAL (gate r1, B3): bloqueio nunca carrega
        // vínculos clínicos; atendimento sempre tem paciente/especialidade/status
        if ($tipo === 'bloqueio') {
            $atributos['paciente_id'] = null;
            $atributos['especialidade_id'] = null;
            $atributos['tratamento_id'] = null;
            $atributos['medico_id'] = null;
            $atributos['status_id'] = null;
        } else {
            $pacienteFinal = array_key_exists('paciente_id', $atributos)
                ? $atributos['paciente_id'] : $atual?->paciente_id;
            $especialidadeFinal = array_key_exists('especialidade_id', $atributos)
                ? $atributos['especialidade_id'] : $atual?->especialidade_id;
            if ($pacienteFinal === null || $especialidadeFinal === null) {
                throw ValidationException::withMessages([
                    'paciente_id' => 'Atendimento exige paciente e especialidade.',
                ]);
            }
            $atributos['paciente_id'] = $pacienteFinal;
            $atributos['especialidade_id'] = $especialidadeFinal;

            $statusFinal = array_key_exists('status_id', $atributos)
                ? $atributos['status_id'] : $atual?->status_id;
            if ($statusFinal === null) {
                $statusFinal = StatusAgendamento::inicialId(); // D9 (definição única — CR-06)
                if ($statusFinal === null) {
                    throw ValidationException::withMessages([
                        'status_id' => 'A clínica não possui status de agendamento cadastrados.',
                    ]);
                }
            }
            $atributos['status_id'] = $statusFinal; // atendimento sem status = slot fantasma
        }

        return $atributos;
    }

    /**
     * @param  array<string, mixed>  $atributos  já com inicio/fim resolvidos
     */
    private function validarDominio(array $atributos, ?Agendamento $atual, ?array $ignorarIds = null): void
    {
        $erros = [];

        // retroativo é config (§13, D8) — só quando o horário é novo/alterado
        $inicioMudou = $atual === null || ! $atual->inicio->equalTo($atributos['inicio']);
        $paredeAgora = now($this->fusoDaClinica())->format('Y-m-d H:i');
        if ($inicioMudou
            && $atributos['inicio']->format('Y-m-d H:i') < $paredeAgora
            && ! $this->configuracoes->get('agenda.permitir_retroativo')) {
            $erros['inicio'] = 'Agendamento retroativo não é permitido (configuração da clínica).';
        }

        if (($atributos['tipo'] ?? 'atendimento') === 'atendimento') {
            // profissional atende a especialidade (N:M — §6 passo 1)
            $especialidadeId = $atributos['especialidade_id'] ?? $atual?->especialidade_id;
            $profissionalId = $atributos['profissional_id'] ?? $atual?->profissional_id;
            $atende = DB::table('profissional_especialidade')
                ->where('profissional_id', $profissionalId)
                ->where('especialidade_id', $especialidadeId)
                ->exists();
            if (! $atende) {
                $erros['especialidade_id'] = 'O profissional não atende a esta especialidade.';
            }

            // horários de atendimento do profissional (§13, DADO): a agenda não promete um
            // DIA nem um HORÁRIO em que o profissional não vem — regra no boundary, não só na
            // tela. Sem horários (nenhuma linha) = todos os dias/horas abertos (retrocompat).
            // Basta o `inicio` cair em algum intervalo do dia (paridade com o dia-check anterior).
            // Bloqueio (o ramo `!= atendimento`) é isento: é o próprio profissional avisando
            // ausência/reunião. O weekday e a hora saem do `inicio` na PAREDE da clínica
            // (isoWeekday 1=seg..7=dom) — nunca converter para UTC antes.
            $horarios = $this->horariosDoProfissional($profissionalId);
            if ($horarios !== []) {
                $isoWeekday = $atributos['inicio']->isoWeekday();
                $minutos = $atributos['inicio']->hour * 60 + $atributos['inicio']->minute;
                if (! $this->atendeEm($horarios, $isoWeekday, $minutos)) {
                    $erros['inicio'] = 'O profissional não atende '.self::NOME_DO_DIA[$isoWeekday]
                        .' às '.$atributos['inicio']->format('H:i').'.';
                }
            }

            // tratamento coerente e com saldo (§6 passo "se tratamento").
            // COERÊNCIA (existe / mesmo paciente / mesma especialidade) vale SEMPRE
            // — inclusive consumido (gate r1, CR-02: trocar o paciente de um
            // agendamento consumido corromperia a cadeia clínico-financeira).
            // DISPONIBILIDADE (andamento/vencido/saldo) não revalida quando este
            // agendamento JÁ CONSUMIU deste tratamento: a sessão dele já está
            // contada no saldo — revalidar travaria o estorno legítimo (mudar
            // Finalizado → Falta Justificada) quando o próprio consumo esgotou o
            // pacote ou o tratamento venceu depois (etapa 6, D3)
            // `array_key_exists`, NUNCA `??`: os dois significam coisas diferentes e o `??`
            // os confunde. Chave AUSENTE = "não mexi no tratamento" (preserva o atual);
            // chave PRESENTE com `null` = **DESVINCULAR**, que é exatamente o que a tela
            // manda quando a criança do agendamento é corrigida (o pacote é da OUTRA
            // criança, então ele tem de sair junto).
            //
            // Com o `??`, o `null` explícito caía no fallback e a validação julgava o
            // tratamento VELHO contra a criança NOVA — recusando com "O tratamento pertence a
            // outro paciente". Ou seja: corrigir a criança era IMPOSSÍVEL sempre que o
            // agendamento tivesse tratamento, que é o caso normal. A permissão de corrigir
            // existia na spec e não na prática (achado dirigindo a app real).
            //
            // `resolverAtributos` já fazia essa distinção para `paciente_id` e
            // `especialidade_id`; aqui ela faltava.
            $tratamentoId = array_key_exists('tratamento_id', $atributos)
                ? $atributos['tratamento_id']
                : $atual?->tratamento_id;
            $jaConsumidoDesteTratamento = $atual !== null
                && $atual->sessao_consumida_em !== null
                && (int) $tratamentoId === $atual->tratamento_id;
            if ($tratamentoId !== null) {
                $tratamento = Tratamento::find($tratamentoId);
                $pacienteId = $atributos['paciente_id'] ?? $atual?->paciente_id;
                if ($tratamento === null) {
                    $erros['tratamento_id'] = 'Tratamento inválido.';
                } elseif ($tratamento->paciente_id !== (int) $pacienteId) {
                    $erros['tratamento_id'] = 'O tratamento pertence a outro paciente.';
                } elseif ($tratamento->especialidade_id !== (int) $especialidadeId) {
                    $erros['tratamento_id'] = 'O tratamento é de outra especialidade.';
                } elseif (! $jaConsumidoDesteTratamento) {
                    if ($tratamento->status !== 'andamento') {
                        $erros['tratamento_id'] = 'O tratamento não está em andamento.';
                    } elseif ($tratamento->vencido) {
                        $erros['tratamento_id'] = 'O tratamento está vencido.';
                    } elseif ($tratamento->sessoes_saldo <= 0) {
                        $erros['tratamento_id'] = 'O tratamento não tem saldo de sessões.';
                    }
                }
            }
        }

        // reposição de reposição é config (§6/§13, D7) — revalidada sobre o ESTADO
        // FINAL no update (parecer T-agd-06), incluindo auto-referência
        $isReposicaoFinal = array_key_exists('is_reposicao', $atributos)
            ? (bool) $atributos['is_reposicao']
            : (bool) ($atual?->is_reposicao);
        $reposicaoDeId = array_key_exists('reposicao_de_id', $atributos)
            ? $atributos['reposicao_de_id']
            : $atual?->reposicao_de_id;

        if ($isReposicaoFinal && $reposicaoDeId !== null) {
            if ($atual !== null && (int) $reposicaoDeId === $atual->id) {
                $erros['reposicao_de_id'] = 'Um agendamento não pode repor a si mesmo.';
            } else {
                $original = Agendamento::find($reposicaoDeId);
                if ($original !== null && $original->is_reposicao
                    && ! $this->configuracoes->get('agenda.permitir_reposicao_de_reposicao')) {
                    $erros['reposicao_de_id'] = 'Reposição de reposição não é permitida (configuração da clínica).';
                }
            }
        }

        if ($erros !== []) {
            throw ValidationException::withMessages($erros);
        }

        $conflitos = $this->verificarConflitos(
            $atributos,
            $ignorarIds ?? ($atual !== null ? [$atual->id] : []),
            $atual,
        );
        if ($conflitos !== []) {
            throw ValidationException::withMessages($conflitos);
        }

        // limite do convênio no ESTADO FINAL (limites-e-pedidos, D2): roda para TODA
        // mutação que passa por aqui — criação, remarcação, encaixe e a 1ª ocorrência
        // da série herdam por construção. Na remarcação o próprio agendamento (ou o
        // grupo, no aplicar-na-série) fica fora da contagem, via $ignorarIds — a mesma
        // técnica do conflito de horário. `bloquear` lança 422; `avisar` fica no
        // serviço e viaja na resposta da escrita (D3), nunca persistido.
        $tratamentoFinal = array_key_exists('tratamento_id', $atributos)
            ? $atributos['tratamento_id']
            : $atual?->tratamento_id;
        // avaliar SEMPRE, memorizar só o primeiro aviso (uniforme com criarSerie()).
        $aviso = $this->guardaLimite->avaliar(
            $atributos,
            $tratamentoFinal !== null ? (int) $tratamentoFinal : null,
            $ignorarIds ?? ($atual !== null ? [$atual->id] : []),
        );
        $this->avisoDeLimite ??= $aviso;
    }

    /**
     * @param  array<string, mixed>  $atributos
     * @return array<string, string>
     */
    /**
     * A recusa da série, escrita para quem vai RESOLVER — não para quem escreveu o código.
     *
     * A versão anterior devolvia só as datas em formato de máquina. Em produção isso virou um
     * parágrafo de 48 datas que não dizia o que estava ocupado: a recepcionista mandou foto, e nem
     * eu nem outra sessão de IA acertamos a causa sem abrir o banco da clínica. Era uma sessão de
     * 40 min começando às 08:00 contra uma que já existia às 08:20 — vinte minutos em cima.
     *
     * O intervalo ocupado sai só da PRIMEIRA data (uma leitura a mais, não uma por data) e só do
     * eixo do profissional, que é o que diz para onde mover. Nunca o nome da outra criança.
     *
     * @param  list<CarbonInterface>  $datas  as ocorrências em choque, em ordem
     * @param  array<string, string>  $motivos  campo => mensagem da primitiva, acumulados
     * @param  array<string, mixed>|null  $primeira  atributos da primeira ocorrência em choque
     */
    private function recusaDaSerie(array $datas, array $motivos, ?array $primeira, int $totalDaSerie): string
    {
        $frase = 'Conflito em '.count($datas).' de '.$totalDaSerie.' datas da série: '.$this->motivosEmProsa($motivos);

        if ($primeira !== null && array_key_exists('profissional_id', $motivos)) {
            $ocupado = $this->conflitos->intervaloOcupadoDoProfissional(
                (int) $primeira['profissional_id'],
                $primeira['inicio'],
                $primeira['fim'],
                [],
                'atendimento',
                true,
                // sem o teto, a frase apontaria a PRIMEIRA sessão do horário a quem tem quatro
                // vagas — mandando mover uma sessão que cabia (change atendimento-em-grupo)
                $this->capacidadeDoProfissional((int) $primeira['profissional_id']),
            );
            if ($ocupado !== null) {
                $frase .= ' Em '.$datas[0]->format('d/m/Y').' já há atendimento das '
                    .$ocupado['inicio'].' às '.$ocupado['fim'].'.';
            }
        }

        return $frase.' Nada foi criado — mude o horário ou o dia. Datas: '.$this->datasEmProsa($datas);
    }

    /**
     * Um eixo por frase, sem repetir: datas diferentes podem falhar por motivos diferentes.
     *
     * @param  array<string, string>  $motivos
     */
    private function motivosEmProsa(array $motivos): string
    {
        $porEixo = [
            'profissional_id' => 'o horário do profissional já está ocupado',
            'sala_id' => 'a sala já está ocupada',
            'equipamento_id' => 'o equipamento não tem disponibilidade',
            'paciente_id' => 'a criança já tem outro atendimento neste horário',
        ];

        $frases = [];
        foreach (array_keys($motivos) as $eixo) {
            $frases[] = $porEixo[$eixo] ?? 'há conflito de horário';
        }

        return implode('; ', array_unique($frases)).'.';
    }

    /**
     * `dd/mm/aaaa` porque é assim que a recepção lê data, e as primeiras mais a contagem porque
     * 48 datas seguidas não são uma lista, são uma parede.
     *
     * @param  list<CarbonInterface>  $datas
     */
    private function datasEmProsa(array $datas): string
    {
        $mostradas = array_slice($datas, 0, self::DATAS_NA_RECUSA);
        $texto = implode(', ', array_map(fn (CarbonInterface $data): string => $data->format('d/m/Y'), $mostradas));
        $restantes = count($datas) - count($mostradas);

        return $restantes > 0 ? $texto.' e mais '.$restantes.'.' : $texto.'.';
    }

    private function verificarConflitos(array $atributos, array $ignorarIds, ?Agendamento $atual = null): array
    {
        // estado final também para sala/equipamento (gate r1, B2): PUT parcial que
        // não reenvia os campos mantém os valores atuais — o conflito vale para eles
        $salaId = array_key_exists('sala_id', $atributos)
            ? $atributos['sala_id'] : $atual?->sala_id;
        $equipamentoId = array_key_exists('equipamento_id', $atributos)
            ? $atributos['equipamento_id'] : $atual?->equipamento_id;
        $quantidade = $equipamentoId !== null
            ? (int) Equipamento::whereKey($equipamentoId)->value('quantidade_total')
            : null;

        // QUEM está perguntando muda a resposta (ver `VerificadorDeConflitos::ocupantes`):
        // bloqueio marca ausência e não precisa do slot livre; atendimento que não muda de
        // horário não colide de novo com um bloqueio que já estava ali.
        //
        // "Não se moveu" SHALL significar **não mudou de horário NEM de dono** (parecer
        // SEC-AG-04). Enquanto olhava só o relógio, transferir um atendimento para um
        // profissional BLOQUEADO passava com 200 desde que a hora ficasse igual: o alvo
        // "não estava movendo", então os bloqueios eram ignorados — inclusive os de quem ele
        // acabava de invadir. O atendimento ia parar em cima de uma folga declarada. Chegar
        // na agenda de outra pessoa É mover, mesmo que o relógio não mude.
        $profissionalId = (int) $atributos['profissional_id'];

        $movendo = $atual === null
            || ! $atual->inicio->equalTo($atributos['inicio'])
            || ! $atual->fim->equalTo($atributos['fim'])
            || $profissionalId !== (int) $atual->profissional_id
            || (int) $salaId !== (int) $atual->sala_id;

        $conflitos = $this->conflitos->verificar(
            $profissionalId,
            $atributos['inicio'],
            $atributos['fim'],
            $salaId,
            $equipamentoId,
            $quantidade,
            $ignorarIds,
            (string) ($atributos['tipo'] ?? 'atendimento'),
            $movendo,
            $this->capacidadeDoProfissional($profissionalId),
            $salaId === null ? 1 : $this->capacidadeDaSala((int) $salaId),
        );

        // Os eixos de RECURSO barram só a ocupação que ESTA escrita cria (D4). Sem isto,
        // BAIXAR a capacidade de 4 para 2 tornaria os quatro agendamentos já marcados
        // mutuamente ineditáveis — nem avançar o status pelo card seria possível. É o dano
        // que o eixo do paciente já pagou uma vez para aprender; aqui ele nasce no dia em que
        // a clínica corrige um número.
        //
        // **Isto alcança o BLOQUEIO de sala, e é deliberado** (parecer SEC-AG-01): uma sala
        // interditada DEPOIS não pode tornar ineditável o atendimento que já estava nela —
        // seria o mesmo envenenamento que o bloqueio do profissional causou na `desmarque-do-
        // profissional` (o card não podia nem ser desmarcado). O que continua recusado, e é o
        // que o bloqueio existe para impedir: CRIAR ali, ou MOVER para dentro — inclusive
        // mover só de sala, que `$movendo` agora reconhece como movimento.
        $alvoEhBloqueio = (string) ($atributos['tipo'] ?? 'atendimento') === 'bloqueio';
        foreach (['profissional_id', 'sala_id'] as $eixo) {
            if (! array_key_exists($eixo, $conflitos)) {
                continue;
            }
            // **A CAUSA decide se pode relevar** (achado BLOQUEANTE da r1 do gate). Bloqueio é
            // ausência declarada, não disputa de vaga: nunca se releva. E o alvo BLOQUEIO não
            // entra no laço de jeito nenhum — ele não tem status, então `criaOcupacaoNova`
            // devolveria `false` por acidente semântico (status que não ocupa ⇒ "não cria
            // ocupação") e o bloqueio novo passaria por cima de tudo.
            if ($alvoEhBloqueio || $conflitos[$eixo]->ehBloqueio()) {
                continue;
            }
            if (! $this->criaOcupacaoNova($atributos, $atual, $eixo)) {
                unset($conflitos[$eixo]);
            }
        }

        $mensagens = array_map(fn (ConflitoDoEixo $conflito): string => $conflito->mensagem, $conflitos);

        return [...$mensagens, ...$this->avaliarPacienteSobreposto($atributos, $ignorarIds, $atual)];
    }

    /**
     * Eixo PACIENTE, com a AÇÃO da clínica (change conflito-do-paciente, D1/§13).
     *
     * Fica AQUI, e não na primitiva, porque `bloquear`/`avisar`/`permitir` é decisão de
     * produto: a primitiva continua respondendo só "quem ocupa o quê", e o contrato dela
     * (mapa vazio = pode gravar) segue valendo para todo chamador.
     *
     * Bloqueio de agenda não entra: `resolverAtributos` zera o `paciente_id` dele, e o
     * `AgendamentoRequest` proíbe o campo no payload.
     *
     * @param  array<string, mixed>  $atributos
     * @param  list<int>  $ignorarIds
     * @return array<string, string>
     */
    private function avaliarPacienteSobreposto(array $atributos, array $ignorarIds, ?Agendamento $atual): array
    {
        // estado FINAL, como sala e equipamento acima: o PUT parcial que não reenvia o
        // paciente mantém o gravado — sem isso a trava valeria só na criação.
        $pacienteId = array_key_exists('paciente_id', $atributos)
            ? $atributos['paciente_id'] : $atual?->paciente_id;

        $acao = (string) $this->configuracoes->get('agenda.conflito_paciente');
        if ($pacienteId === null || $acao === 'permitir') {
            return [];
        }

        if (! $this->criaOcupacaoNova($atributos, $atual, 'paciente_id')) {
            return [];
        }

        if (! $this->enxergaAAgendaDaCrianca((int) $pacienteId)) {
            return [];
        }

        $ocupado = $this->conflitos->pacienteOcupado(
            (int) $pacienteId,
            $atributos['inicio'],
            $atributos['fim'],
            $ignorarIds,
        );
        if (! $ocupado) {
            return [];
        }

        if ($acao === 'bloquear') {
            return ['paciente_id' => 'Este paciente já tem outro atendimento neste horário.'];
        }

        // `avisar`: a escrita passa e a data viaja na resposta (D4)
        $data = $atributos['inicio']->format('Y-m-d');
        if (! in_array($data, $this->avisoDePacienteSobreposto, true)) {
            $this->avisoDePacienteSobreposto[] = $data;
        }

        return [];
    }

    /**
     * Esta mutação CRIA ocupação NOVA neste eixo, ou apenas convive com uma que já existia?
     * (achado BLOQUEANTE do gate da change conflito-do-paciente, rodada 1)
     *
     * Nasceu no eixo do PACIENTE e passou a servir os eixos de RECURSO com a change
     * atendimento-em-grupo (D4): capacidade editável faz o mesmo dano aparecer do outro lado —
     * baixar o teto de 4 para 2 trancaria os quatro agendamentos já marcados.
     *
     * É o mesmo princípio que `VerificadorDeConflitos::ocupantes()` já codifica em `$movendo`:
     * **conflito que já estava ali não é conflito NOVO**, e re-litigá-lo a cada escrita
     * envenena a operação em vez de proteger a agenda. Sem esta guarda, medido:
     *
     * - o **desmarque em lote** — o gesto "o profissional faltou" — recusava a linha com uma
     *   mensagem sobre o PACIENTE, e a prévia prometia 1 desmarcado enquanto a execução
     *   entregava 0. A operação LIBERA o slot e era barrada por criar a sobreposição que
     *   justamente desfaz;
     * - um par sobreposto já gravado (legado, ou nascido no modo `avisar`) ficava
     *   **mutuamente ineditável**: os dois lados recusavam, inclusive para avançar o status
     *   pelo card, e a única saída era desligar a regra na clínica inteira.
     *
     * A ocupação é NOVA em quatro casos, e só neles:
     * 1. criação;
     * 2. o agendamento MUDA de horário;
     * 3. o agendamento MUDA o DONO daquele eixo (a criança, o profissional ou a sala);
     * 4. o agendamento PASSA A OCUPAR o horário (status que liberava vira status que ocupa) —
     *    sem este, reativar um "Desmarcado" por cima de uma sessão da criança passaria batido.
     *
     * Alvo que NÃO ocupa no estado final nunca cria sobreposição: sai antes dos quatro.
     *
     * @param  array<string, mixed>  $atributos
     */
    private function criaOcupacaoNova(array $atributos, ?Agendamento $atual, string $eixo): bool
    {
        $statusFinal = array_key_exists('status_id', $atributos)
            ? $atributos['status_id'] : $atual?->status_id;
        if (! $this->statusOcupa($statusFinal)) {
            return false; // desmarcar, cancelar: a escrita devolve o slot, não o disputa
        }

        if ($atual === null) {
            return true; // criação
        }

        $mudouDeHorario = ! $atual->inicio->equalTo($atributos['inicio'])
            || ! $atual->fim->equalTo($atributos['fim']);

        // Cada eixo tem o SEU "mudou de dono": trocar a sala não cria ocupação nova na agenda
        // do profissional, e trocar o profissional não cria ocupação nova na sala.
        $mudouDeDono = (int) (array_key_exists($eixo, $atributos) ? $atributos[$eixo] : $atual->{$eixo})
            !== (int) $atual->{$eixo};

        return $mudouDeHorario || $mudouDeDono || ! $this->statusOcupa($atual->status_id);
    }

    /**
     * O solicitante enxerga a agenda desta criança? (achado SEC-CP-01 do gate de segurança)
     *
     * **A recusa do eixo é um oráculo.** O profissional ESCOPADO (papel sem `agenda.ver_todos`)
     * leva 403 ao abrir a ficha de uma criança do colega — mas, tentando marcá-la na PRÓPRIA
     * agenda, a diferença entre 422 e 201 responde a pergunta que o 403 acabou de negar. O gate
     * provou com 19 sondas de `duracao_minutos: 5` que reconstruíram o intervalo exato da sessão
     * alheia, **sem escrever nada e sem deixar rastro**; e uma série no modo `avisar` devolvia o
     * mapa anual daquele horário numa requisição só.
     *
     * A casa já decidiu que o escopado não vê a agenda alheia — o 403 existe de propósito. Uma
     * trava que fura essa decisão é incoerente, então o eixo simplesmente **não roda** quando a
     * criança não é dele. Não é 403: é silêncio (recusar aqui seria o mesmo oráculo com outra
     * roupa). O preço, aceito e nomeado: o escopado volta a poder criar sobreposição com o
     * colega. Quem marca na clínica é a recepção, e para ela o eixo continua inteiro.
     *
     * `plano` (recepção, admin, console/job) enxerga tudo; `nenhum` (fail-closed) não enxerga
     * nada — e nem chega aqui, porque o controller já o barra com 403.
     */
    private function enxergaAAgendaDaCrianca(int $pacienteId): bool
    {
        // Memoizado por escrita: a SÉRIE pergunta por ocorrência, e a resposta é a mesma nas 52
        // (o paciente é constante). Para a RECEPÇÃO, que é quem marca na clínica, o portão nunca
        // toca o banco — `ehPlano()` retorna antes.
        //
        // NOTA (2026-08-31): a medição original citava o custo de uma série pedida por escopado
        // sobre criança que NÃO é dele (104 consultas). Esse caso deixou de existir — a trava de
        // vínculo prévio o recusa antes de a série ser montada. O memo agora serve ao caso
        // legítimo, que é o que sobrou.
        return $this->memoEnxergaPaciente[$pacienteId]
            ??= $this->escopo->enxergaPaciente($this->escopo->agenda(Auth::user()), $pacienteId);
    }

    /**
     * TRAVA DE VÍNCULO PRÉVIO — o escopado só se vincula a quem JÁ é paciente dele.
     *
     * Fecha o `SEC-CP-04`. O predicado "é paciente dele" é `EXISTS` em agendamentos ∪ tratamentos
     * e, sem trava, se AUTO-CONCEDE: o próprio ato satisfaz o EXISTS e devolve a ficha inteira.
     *
     * **O QUE A TRAVA GOVERNA É A TROCA DE PACIENTE, NÃO O NASCIMENTO** — e a rodada 1 do gate
     * corrigiu isto na marra. A versão anterior isentava o `update` inteiro, com a justificativa
     * "ali o vínculo já existe por construção". É falso: remarcar não cria vínculo, mas **trocar
     * a criança cria**. Medido pelo code-review: `403 403 403 403` → `PUT` com outro `paciente_id`
     * → `200 200 200 200`. E havia a variante sem agendamento legítimo — criar um **bloqueio**
     * (que não tem paciente) e convertê-lo depois em atendimento da criança alheia.
     *
     * Daí a forma atual: compara o paciente RESOLVIDO com o GRAVADO. Igual (ou bloqueio) → passa;
     * diferente → exige vínculo. Criação é o caso em que não há gravado, logo sempre exige.
     *
     * A isenção do bloqueio é **pelo TIPO**, não pela ausência de `paciente_id` (achado 8.9): a
     * ausência é consequência, e guarda que se desliga por campo faltando é fail-open esperando
     * um refactor em `resolverAtributos`.
     *
     * A RECUSA ASSUME A FORMA DA INEXISTÊNCIA: um 403 "não é seu paciente" confirmaria que a
     * criança existe, devolvendo pela escrita o oráculo que o `SEC-CP-01` fechou na leitura.
     *
     * @param  array<string, mixed>  $atributos
     */
    private function assegurarVinculoPrevio(array $atributos, ?Agendamento $atual = null): void
    {
        // bloqueio não tem paciente a vincular — isenção pelo TIPO, nunca pelo campo ausente
        if (($atributos['tipo'] ?? null) === 'bloqueio') {
            return;
        }

        $pacienteId = isset($atributos['paciente_id']) ? (int) $atributos['paciente_id'] : null;

        // atendimento SEM paciente é invariante violada (D3): fail-closed, nunca "passa direto"
        if ($pacienteId === null) {
            throw ValidationException::withMessages([
                'paciente_id' => [trans('validation.required', [
                    'attribute' => trans('validation.attributes.paciente_id'),
                ])],
            ]);
        }

        // o vínculo só é EXIGIDO quando ele muda: remarcar o próprio horário não concede nada
        if ($atual !== null && (int) $atual->paciente_id === $pacienteId) {
            return;
        }

        if ($this->podeVincularPaciente($pacienteId)) {
            return;
        }

        // A recusa é CEGA para quem a recebe, mas não pode ser INVISÍVEL para a clínica: o que
        // sobra depois da cegueira é a varredura por insistência. Ela não aprende nada pela
        // resposta — e é por isso que precisa deixar rastro, senão ninguém nota que aconteceu.
        //
        // O `paciente_id` tentado NÃO entra no log, seguindo o precedente da
        // `GuardaProfissionalDesligado` (cujo teste exige `not->toHaveKey('paciente_id')`): id de
        // criança é identificador de MENOR, e log de segurança é lido fora do contexto que o
        // justifica. PREÇO NOMEADO (gate, SEC-VP-18): a rajada denuncia a varredura, mas não diz
        // QUAIS crianças foram sondadas.
        Log::channel('seguranca')->warning('vinculo_previo.bloqueado', [
            'usuario_id' => Auth::id(),
            'profissional_do_escopo_id' => $this->escopo->agenda(Auth::user())->profissionalId(),
            'motivo' => 'paciente sem vínculo prévio com o profissional do escopo',
            'ip' => request()->ip(),
        ]);

        throw ValidationException::withMessages([
            'paciente_id' => [trans('validation.exists', [
                'attribute' => trans('validation.attributes.paciente_id'),
            ])],
        ]);
    }

    /** O predicado da trava, memoizado por escrita — a série pergunta por ocorrência. */
    private function podeVincularPaciente(int $pacienteId): bool
    {
        return $this->memoPodeVincular[$pacienteId]
            ??= $this->escopo->podeVincularPaciente(Auth::user(), $pacienteId);
    }

    /** O status ocupa o horário? Memoizado por escrita — a série pergunta por ocorrência. */
    private function statusOcupa(mixed $statusId): bool
    {
        if ($statusId === null) {
            return false; // atendimento sem status não existe (invariante D3); defensivo
        }

        return $this->memoStatusOcupa[(int) $statusId]
            ??= (bool) StatusAgendamento::whereKey((int) $statusId)->value('ocupa_horario');
    }

    private function fusoDaClinica(): string
    {
        return $this->configuracoes->get('clinica.timezone');
    }
}
