<?php

namespace App\Http\Controllers;

use App\Http\Requests\AgendamentoRequest;
use App\Models\Agendamento;
use App\Support\Agenda\AgendamentoService;
use App\Support\Agenda\ContadorDeFaltasConsecutivas;
use App\Support\Agenda\EstadoDaConfirmacao;
use App\Support\Agenda\GuardaDeLimiteDoConvenio;
use App\Support\Agenda\SerializadorDeAgendamento;
use App\Support\Ciclos\GuardaDeCicloFechado;
use App\Support\Clinica\NecessidadeEspecial;
use App\Support\Clinica\PedidosMedicos;
use App\Support\Clinica\RealceDoPacote;
use App\Support\Clinica\ResumoDoPaciente;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Http\ConcorrenciaOtimista;
use App\Support\Mensageria\AvisoDoAgendamento;
use App\Support\Rbac\Escopo;
use App\Support\Rbac\EscopoDoProfissional;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

class AgendamentoController extends Controller
{
    private const JANELA_MAXIMA_DIAS = 62;

    /**
     * Teto de cards por consulta (T-sag-03): sem ele, 62 dias × todos os
     * profissionais devolvem ~20 mil registros numa requisição — DoS autenticado
     * e colheita em massa da rotina física de menores. O pior caso REAL da grade
     * (Visão Geral, 20 profissionais × dia) fica muito abaixo deste teto.
     */
    private const TETO_ITENS = 2000;

    /**
     * Janela do alerta de faltas (design Decisão 3 — "na janela recente"): o teto
     * estrutural de 366 dias, o mesmo do centro de notificações — uma sequência de
     * faltas de um ano atrás não é "recente". Deliberadamente independente do
     * `notificacoes.a_partir_de` (config do digest, não da agenda).
     */
    private const JANELA_FALTAS_DIAS = 366;

    public function __construct(
        private readonly AgendamentoService $servico,
        private readonly ConfiguracaoService $configuracoes,
        private readonly EscopoDoProfissional $escopos,
        private readonly PedidosMedicos $pedidosMedicos,
        private readonly GuardaDeLimiteDoConvenio $guardaLimite,
        private readonly GuardaDeCicloFechado $ciclos,
        private readonly RealceDoPacote $realceDoPacote,
        private readonly AvisoDoAgendamento $avisos,
    ) {}

    /** O escopo AGENDA do usuário atual (D11 · SEC-VP-01) — fonte única, consumida por todo método. */
    private function escopoAgenda(): Escopo
    {
        return $this->escopos->agenda(request()->user());
    }

    /** Consulta por período — o dado das visões Dia/Semana/Geral (§6, design D10). */
    public function periodo(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'de' => ['required', 'date_format:Y-m-d'],
            'ate' => ['required', 'date_format:Y-m-d', 'after_or_equal:de'],
            'profissional_id' => ['sometimes', 'integer'],
            'paciente_id' => ['sometimes', 'integer'],
            'sala_id' => ['sometimes', 'integer'],
            'status_id' => ['sometimes', 'integer'],
            'tipo' => ['sometimes', Rule::in(Agendamento::TIPOS)],
        ]);

        $de = Carbon::createFromFormat('Y-m-d', $filtros['de'])->startOfDay();
        $ate = Carbon::createFromFormat('Y-m-d', $filtros['ate'])->endOfDay();
        if ($de->diffInDays($ate) > self::JANELA_MAXIMA_DIAS) {
            return response()->json([
                'message' => 'Janela máxima de '.self::JANELA_MAXIMA_DIAS.' dias.',
                'errors' => ['ate' => ['Janela máxima de '.self::JANELA_MAXIMA_DIAS.' dias.']],
            ], 422);
        }

        // eager-load do card §6 — sem N+1 com a grade cheia (§16). O convênio
        // pende do tratamento (dado NOSSO, §14): identifica o atendimento na
        // grade; guia/autorização/glosa são do gestao_de_convenios.
        // ESCOPO por vínculo (D11): o escopado vê só o próprio profissional — FORÇADO no
        // servidor. O `profissional_id` do cliente é IGNORADO para o escopado (o escopo
        // sobrepõe: pedir outro NÃO amplia e NÃO zera — ele sempre vê o seu). Só o PLANO
        // usa o filtro do cliente para escolher a coluna que quer ver.
        $escopo = $this->escopoAgenda();
        $agendamentos = $escopo->aplicar(Agendamento::query())
            ->with([
                ResumoDoPaciente::relacao(),
                'especialidade:id,nome,cor,tempo_sessao',
                'status:id,nome,cor,cor_borda,tipo,desconta_sessao,ocupa_horario,marca_reserva',
                // `status` entra porque o REALCE do fim de pacote é decidido aqui e um pacote
                // parado não pede cobrança — sem esta coluna, o card realçava o que o contador
                // não contava (design D8)
                'tratamento:id,convenio_id,status,sessoes_total,sessoes_realizadas',
                'tratamento.convenio:id,nome,particular',
                'profissional:id,nome',
                'sala:id,nome',
                // a resposta da família ao lembrete, no card (lembrete-com-botoes-de-resposta, D8)
                ...EstadoDaConfirmacao::relacoes(),
            ])
            ->where('inicio', '<', $ate)
            ->where('fim', '>', $de)
            ->when(isset($filtros['profissional_id']) && $escopo->ehPlano(), fn ($q) => $q->where('profissional_id', $filtros['profissional_id']))
            ->when(isset($filtros['paciente_id']), fn ($q) => $q->where('paciente_id', $filtros['paciente_id']))
            ->when(isset($filtros['sala_id']), fn ($q) => $q->where('sala_id', $filtros['sala_id']))
            ->when(isset($filtros['status_id']), fn ($q) => $q->where('status_id', $filtros['status_id']))
            ->when(isset($filtros['tipo']), fn ($q) => $q->where('tipo', $filtros['tipo']))
            ->orderBy('inicio')
            ->limit(self::TETO_ITENS + 1)
            ->get();

        if ($agendamentos->count() > self::TETO_ITENS) {
            $recado = 'A consulta excede '.self::TETO_ITENS.' agendamentos: reduza o período ou filtre por profissional.';

            return response()->json([
                'message' => $recado,
                'errors' => ['de' => [$recado]],
            ], 422);
        }

        return response()->json($agendamentos->map(fn (Agendamento $a) => $this->cartao($a)));
    }

    public function store(AgendamentoRequest $request): JsonResponse
    {
        $dados = $request->validated();
        // D11: o escopado só cria para o próprio profissional (403 se profissional_id ≠ vínculo)
        $this->escopoAgenda()->assegurarPosse($dados['profissional_id'] ?? null);

        if (isset($dados['recorrencia'])) {
            $serie = $this->servico->criarSerie($dados, $dados['recorrencia']);

            return response()->json([
                'criados' => count($serie),
                'recorrencia_grupo_id' => $serie[0]->recorrencia_grupo_id,
                'agendamentos' => array_map(fn (Agendamento $a) => $this->serializar($a), $serie),
                // regra `avisar` excedida em qualquer ocorrência (D3), e as datas em que a
                // criança já estava ocupada: o aviso acompanha a escrita — nunca persiste
                ...$this->comAvisosDaEscrita([]),
                // DEPOIS do commit (o serviço fechou a transação): uma confirmação pela série
                ...$this->comAvisoAFamilia($this->avisos->confirmar($serie, $request->user()?->id)),
            ], 201);
        }

        $criado = $this->servico->criar($dados);

        return response()->json([
            ...$this->comAvisosDaEscrita($this->serializar($criado)),
            ...$this->comAvisoAFamilia($this->avisos->confirmar([$criado], $request->user()?->id)),
        ], 201);
    }

    /**
     * Anexa os AVISOS da escrita ao corpo da resposta — os que a operação aceitou e ainda assim
     * precisa contar:
     *
     * - `alerta_limite`: regra `avisar` do convênio excedida (limites-e-pedidos, D3);
     * - `alerta_paciente`: as datas em que a criança já tinha atendimento sobreposto, com o
     *   clínica em `agenda.conflito_paciente = avisar` (conflito-do-paciente, D4).
     *
     * Cada um presente SÓ quando ocorreu, derivado por escrita e nunca gravado (SEC-LP-11: o
     * aviso não tem porta de persistência).
     *
     * @param  array<string, mixed>  $corpo
     * @return array<string, mixed>
     */
    private function comAvisosDaEscrita(array $corpo): array
    {
        $limite = $this->servico->avisoDeLimite();
        if ($limite !== null) {
            $corpo = [...$corpo, 'alerta_limite' => $limite];
        }

        $paciente = $this->servico->avisoDePacienteSobreposto();

        return $paciente === null ? $corpo : [...$corpo, 'alerta_paciente' => $paciente];
    }

    public function show(int $id): JsonResponse
    {
        // eager-load RESTRITO (id,necessidade) — deriva o flag sem hidratar o cadastro
        // do menor na memória (camada 1, SEC-NC-03). Fonte única em NecessidadeEspecial.
        // POSSE ANTES DA EXISTÊNCIA (`SEC-VP-33`/`SEC-VP-40`): com `findOrFail` primeiro, o
        // escopado recebia 404 no id inexistente e 403 no agendamento do colega — a diferença
        // contava se a linha existe. Fechei isto no tratamento e declarei fechado "nas rotas sem
        // FormRequest"; era metade, e o gate mediu a outra metade aqui.
        $agendamento = Agendamento::with([NecessidadeEspecial::RELACAO])->find($id);
        // D11: o escopado não abre o detalhe de outro profissional (403)
        $this->escopoAgenda()->assegurarPosse($agendamento?->profissional_id);
        abort_if($agendamento === null, 404);

        return response()->json([
            ...$this->serializar($agendamento),
            // leitura SOB DEMANDA (o painel abre o detalhe; a grade não paga por
            // isso — §16); null quando não se aplica (bloqueio/sem paciente)
            'alerta_faltas' => $this->alertaFaltas($agendamento),
            // pedido médico vencido/prestes a vencer do tratamento DESTE agendamento
            // (limites-e-pedidos, D5) — decidido no servidor, sob demanda no painel,
            // NUNCA no cartao() da grade (SEC-LP-03); fonte única PedidosMedicos
            'alerta_pedido' => $this->pedidosMedicos->alertaDoAgendamento($agendamento),
            // limite do convênio atingido (regra `avisar`, D3) — DERIVADO a cada
            // leitura pela MESMA contagem da guarda de escrita; nada persistido
            'alerta_limite' => $this->guardaLimite->avisoNaLeitura($agendamento),
            // sinal MINIMIZADO de necessidade especial (art. 11): BOOLEANO derivado,
            // nunca o enum cru; per-agendamento, NUNCA no cartao() da grade (SEC-NC-01/02)
            'necessidade_especial' => NecessidadeEspecial::flag($agendamento->paciente),
            // produção em período fechado (SEC-TS/SEC-FC-09): booleano DERIVADO, só no
            // DETALHE (a grade não paga por N leituras de fechamento e não vira oráculo);
            // competência do agendamento = `inicio` (dia da sessão, design D1)
            'em_ciclo_fechado' => $this->ciclos->emCicloFechado(
                $agendamento->tratamento_id === null ? null : (int) $agendamento->tratamento_id,
                $agendamento->inicio,
            ),
        ]);
    }

    /**
     * Alerta de faltas consecutivas do paciente DESTE agendamento (painel).
     *
     * `N` é DADO da clínica (§13, `agenda.faltas_consecutivas_limite`), nunca
     * hardcoded; a contagem é a mesma REGRA do centro de notificações
     * (ContadorDeFaltasConsecutivas). Só dispara ao ATINGIR o limite — abaixo
     * dele, nada (nunca um alerta que não é alerta).
     *
     * @return array{consecutivas: int, limite: int}|null
     */
    private function alertaFaltas(Agendamento $agendamento): ?array
    {
        if ($agendamento->tipo !== 'atendimento' || $agendamento->paciente_id === null) {
            return null;
        }

        $limite = (int) $this->configuracoes->get('agenda.faltas_consecutivas_limite');
        $agora = now($this->configuracoes->get('clinica.timezone'));
        $piso = $agora->copy()->subDays(self::JANELA_FALTAS_DIAS)->format('Y-m-d H:i');
        $sequencia = ContadorDeFaltasConsecutivas::doPaciente(
            $agendamento->paciente_id,
            $agora->format('Y-m-d H:i'),
            $limite,
            $piso,
        );

        return $sequencia['consecutivas'] >= $limite
            ? ['consecutivas' => $sequencia['consecutivas'], 'limite' => $limite]
            : null;
    }

    /**
     * Tamanho REAL da série (parecer T-aes-03 / decisão P-02).
     *
     * A tela NÃO pode contar os irmãos: ela só conhece o período consultado (na
     * visão Dia, um dia), e a série vai a 52 ocorrências — o dialog diria "e os
     * 0 seguintes" enquanto a exclusão apagaria 51. Uma confirmação que mente
     * fabrica o consentimento que o §2 exige.
     */
    public function serie(int $id): JsonResponse
    {
        $agendamento = Agendamento::find($id);
        // D11: a contagem da série de outro profissional não vaza — e a posse vem antes da
        // existência, senão o par colega × inexistente se separa por status (`SEC-VP-40`)
        $this->escopoAgenda()->assegurarPosse($agendamento?->profissional_id);
        abort_if($agendamento === null, 404);

        if ($agendamento->recorrencia_grupo_id === null) {
            return response()->json([
                'em_serie' => false,
                'total' => 1,
                'a_partir_deste' => 1,
                'futuros' => 0,
            ]);
        }

        $daSerie = Agendamento::query()->where('recorrencia_grupo_id', $agendamento->recorrencia_grupo_id);

        // "a partir deste" é EXATAMENTE o alcance do DELETE em série (inclui ele
        // mesmo); "futuros" é o alcance do aplicar_na_serie do PUT (não inclui)
        return response()->json([
            'em_serie' => true,
            'total' => (clone $daSerie)->count(),
            'a_partir_deste' => (clone $daSerie)->where('inicio', '>=', $agendamento->inicio)->count(),
            'futuros' => (clone $daSerie)->where('inicio', '>', $agendamento->inicio)->count(),
        ]);
    }

    public function update(AgendamentoRequest $request, int $id): JsonResponse
    {
        $agendamento = Agendamento::find($id);
        $dados = $request->validated();
        // D11: o escopado só edita o PRÓPRIO, e não pode re-parentear para outro profissional.
        // Posse antes da existência (`SEC-VP-40`) — o `authorize()` da Request já decidiu a posse
        // deste id, esta é a rede de quem chegar por outro caminho.
        $escopo = $this->escopoAgenda();
        $escopo->assegurarPosse($agendamento?->profissional_id);
        abort_if($agendamento === null, 404);
        if (array_key_exists('profissional_id', $dados) && $dados['profissional_id'] !== null) {
            $escopo->assegurarPosse((int) $dados['profissional_id']);
        }
        // posse ANTES da versão (a versão não é oráculo de existência — SEC-OCC-02)
        ConcorrenciaOtimista::assegurar($agendamento, $request);

        // o "de" dos avisos, capturado ANTES: o serviço altera esta mesma instância
        $deInicio = $agendamento->inicio?->copy();
        $deProfissionalId = $agendamento->profissional_id;
        $dePacienteId = $agendamento->paciente_id;
        $deStatusId = $agendamento->status_id;
        $avisarFamilia = (bool) ($dados['avisar_familia'] ?? false);
        unset($dados['avisar_familia']);
        $naSerie = (bool) ($dados['aplicar_na_serie'] ?? false);
        $seguintes = $avisarFamilia && $naSerie ? $this->sessoesSeguintesDaSerie($agendamento) : 0;

        $atualizado = $this->servico->atualizar($agendamento, $dados, $naSerie);

        // DEPOIS do commit, e só com o pedido explícito de quem gravou (a tela oferece a caixa —
        // já marcada no desmarque, desmarcada na remarcação; SEC-AV-02). O cancelamento vence a
        // remarcação: uma gravação, uma mensagem só.
        $aviso = null;
        if ($avisarFamilia && $deInicio !== null) {
            $autorId = $request->user()?->id;
            $aviso = $this->avisos->cancelamento($atualizado, $deStatusId, $deInicio, $deProfissionalId, $dePacienteId, $seguintes, $autorId)
                ?? $this->avisos->remarcacao($atualizado, $deInicio, $deProfissionalId, $dePacienteId, $seguintes, $autorId);
        }

        return response()->json([
            ...$this->comAvisosDaEscrita($this->serializar($atualizado)),
            ...$this->comAvisoAFamilia($aviso),
        ]);
    }

    public function destroy(Request $request, int $id): Response
    {
        $agendamento = Agendamento::find($id);
        // D11: o escopado não exclui a agenda de outro profissional (o pior do gatilho) — e a
        // posse vem antes da existência (`SEC-VP-40`)
        $this->escopoAgenda()->assegurarPosse($agendamento?->profissional_id);
        abort_if($agendamento === null, 404);

        $this->servico->excluir($agendamento, $request->boolean('aplicar_na_serie'));

        return response()->noContent();
    }

    /**
     * `aviso_familia` só quando um aviso foi TENTADO (change avisos-do-agendamento-por-whatsapp):
     * a resposta diz se a família foi avisada ou por quê não foi.
     *
     * @param  array{enviado: bool, motivo: string|null}|null  $aviso
     * @return array<string, mixed>
     */
    private function comAvisoAFamilia(?array $aviso): array
    {
        return $aviso === null ? [] : ['aviso_familia' => $aviso];
    }

    /**
     * As sessões da série que a gravação alcança (`irmasSeguintes`, o mesmo alcance do serviço) E
     * que a família conhece como marcadas — contadas ANTES de gravar (o desmarque em série as tira do
     * "marcado"). O aviso só cita as marcadas, que são as que mudam para a família.
     */
    private function sessoesSeguintesDaSerie(Agendamento $agendamento): int
    {
        return $this->servico->irmasSeguintes($agendamento)
            ->whereHas('status', fn ($status) => $status->deSessaoMarcada())
            ->count();
    }

    private function serializar(Agendamento $agendamento): array
    {
        return SerializadorDeAgendamento::escalares($agendamento);
    }

    /**
     * Payload do card da grade (§6): identifica sem despejar o cadastro
     * (parecer T-agd-01). obs de ATENDIMENTO é detail-only; em bloqueio a obs
     * é o rótulo da grade (sem paciente = baixo risco).
     */
    private function cartao(Agendamento $agendamento): array
    {
        $base = $this->serializar($agendamento);
        if ($agendamento->tipo !== 'bloqueio') {
            unset($base['obs']);
        }

        return [
            ...$base,
            'paciente' => ResumoDoPaciente::deOuNulo($agendamento->paciente),
            'especialidade' => $agendamento->especialidade?->only(['id', 'nome', 'cor']),
            // `tipo` é o ÍCONE do status no cadastro (§2.3 do design system):
            // sem ele, a tela derivaria o ícone do NOME — string-match de dado
            // editável pela clínica, proibido pelo §13.
            // `ocupa_horario` é a MESMA flag que `VerificadorDeConflitos::ocupantes()` usa para
            // decidir conflito: sem ela no cartão, a grade chamava de ocupada a célula que o
            // servidor já aceitava marcar de novo (change grade-conhece-ocupa-horario).
            'status' => $agendamento->status?->only(['id', 'nome', 'cor', 'cor_borda', 'tipo', 'ocupa_horario']),
            'profissional' => $agendamento->profissional?->only(['id', 'nome']),
            'sala' => $agendamento->sala?->only(['id', 'nome']),
            'tratamento_saldo' => $agendamento->tratamento?->sessoes_saldo,
            'tratamento_total' => $agendamento->tratamento?->sessoes_total,
            /*
             * O VEREDITO do realce, decidido aqui (§13 — o limiar é dado da clínica, e o
             * `RealceDoPacote` o lê). A tela recebe `nenhum`/`acabando`/`sem-saldo` e só
             * escolhe a pele: âmbar avisa, vermelho bloqueia.
             *
             * Antes o front refazia a conta com uma constante própria, e faltava-lhe o
             * `status` — um tratamento parado com saldo baixo ficava realçado na grade
             * enquanto o contador dizia "nenhum".
             */
            'tratamento_realce' => $this->realceDoPacote->de($agendamento->tratamento),
            // particular é FLAG do cadastro (fronteira §14 como dado), nunca o nome
            'convenio' => $agendamento->tratamento?->convenio?->only(['id', 'nome', 'particular']),
            // a resposta ao lembrete (aguardando / confirmado / pediu_desmarque / nao_entregue), só
            // quando o período a carregou — os outros caminhos do cartão não a mostram
            'confirmacao' => $agendamento->relationLoaded('lembretesEnviados') ? EstadoDaConfirmacao::de($agendamento) : null,
        ];
    }
}
