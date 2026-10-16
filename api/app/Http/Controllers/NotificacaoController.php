<?php

namespace App\Http\Controllers;

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Conversa;
use App\Models\EnvioDeCadastro;
use App\Models\Informativo;
use App\Models\LancamentoCaixa;
use App\Models\LembreteEnviado;
use App\Models\Paciente;
use App\Models\Tarefa;
use App\Models\TarefaComentario;
use App\Models\TarefaNotificacao;
use App\Models\TermoConsentimento;
use App\Models\Tratamento;
use App\Support\Agenda\ContadorDeFaltasConsecutivas;
use App\Support\Clinica\EvolucoesEmAberto;
use App\Support\Clinica\JanelaDasNotificacoes;
use App\Support\Clinica\PacotesAcabando;
use App\Support\Clinica\PedidosMedicos;
use App\Support\Clinica\PendenciasDeRetorno;
use App\Support\Clinica\ResumoDoPaciente;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Financeiro\LancamentosEmAtraso;
use App\Support\Financeiro\LancamentosVisiveis;
use App\Support\Financeiro\NomesDosInteressados;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;

/**
 * Centro de notificações in-app (§10) — o centro AGREGA, nunca autoriza
 * (T-not-01): cada bloco (contador E lista) só entra com a permissão do módulo
 * DONO; bloco sem permissão fica AUSENTE do payload (zero seria informação
 * falsa; ausente é deny explícito). Payloads mínimos por bloco (T-not-02/03).
 */
class NotificacaoController extends Controller
{
    /** Teto de itens por bloco (P7) — o resto é contador. */
    private const ITENS_POR_BLOCO = 50;

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EvolucoesEmAberto $evolucoesEmAberto,
        private readonly EscopoDoProfissional $escopos,
        private readonly PedidosMedicos $pedidosMedicos,
        private readonly PendenciasDeRetorno $pendenciasDeRetorno,
        private readonly PacotesAcabando $pacotesAcabando,
        private readonly LancamentosEmAtraso $lancamentosEmAtraso,
        private readonly JanelaDasNotificacoes $janela,
    ) {}

    public function index(): JsonResponse
    {
        $usuario = Auth::user();
        $blocos = [];

        if ($usuario->can('evolucoes.ver')) {
            $blocos['evolucoes_em_aberto'] = $this->blocoEvolucoes();
        }
        if ($usuario->can('pacientes.ver')) {
            $blocos['aniversariantes'] = $this->blocoAniversariantes();
            $blocos['termos_pendentes'] = $this->blocoTermosPendentes();
        }
        if ($usuario->can('lancamentos.ver')) {
            $blocos['lancamentos_em_atraso'] = $this->blocoAtrasados();
        }
        if ($usuario->can('agenda.ver')) {
            $blocos['faltas_consecutivas'] = $this->blocoFaltasConsecutivas();
            $blocos['pendencias_de_retorno'] = $this->blocoPendenciasDeRetorno();
            $blocos['pedidos_de_desmarque'] = $this->blocoPedidosDeDesmarque();
        }
        if ($usuario->can('tratamentos.ver')) {
            $blocos['pedidos_medicos'] = $this->blocoPedidosMedicos();
            $blocos['pacotes_acabando'] = $this->blocoPacotesAcabando();
        }
        if ($usuario->can('mensagens.ver')) {
            $blocos['mensagens'] = $this->blocoMensagens();
        }
        if ($usuario->can('tarefas.ver')) {
            $blocos['tarefas'] = $this->blocoTarefas();
        }
        if ($usuario->can('cadastro_online.conferir')) {
            $blocos['cadastros_recebidos'] = $this->blocoCadastrosRecebidos();
        }
        $blocos['informativos'] = $this->blocoInformativos(); // todo autenticado

        return response()->json($blocos);
    }

    /** @return array{total: int, itens: list<array<string, mixed>>, vencidas?: int, bloqueio_em_dias?: int|null} */
    private function blocoEvolucoes(): array
    {
        // D11 (#27, eixo CLÍNICO): a fila de pendências vazava a todo mundo (consulta() sem filtro).
        // O escopado vê só a própria; sem vínculo → nada. Escopo e piso moram na fonte única
        // `doAviso`, a mesma do `sem_evolucao` do painel da equipe (CR-IND-04).
        $escopo = $this->escopos->clinico(Auth::user());
        $consulta = $this->evolucoesEmAberto->doAviso($escopo);

        $bloco = [
            'total' => (clone $consulta)->count(),
            'itens' => $consulta->limit(self::ITENS_POR_BLOCO)->get()
                ->map(fn (Atendimento $a) => $this->evolucoesEmAberto->serializar($a))
                ->all(),
        ];

        // Aviso da trava do finalizar (change trava-de-evolucao, D3): SÓ para o usuário
        // ESCOPADO a um profissional — o aviso é "o SEU finalizar será travado", não um
        // painel gerencial; plano/sem-vínculo não ganham os campos (ausência é deny,
        // como nos blocos). Computado por leitura na MESMA fonte da guarda (D1) e SEM o
        // piso da janela: a trava não expira com a janela do centro, e aviso × 422 não
        // podem divergir (o teste cruzado prende a coincidência do dia zero).
        $profissionalId = $escopo->profissionalId();
        if ($profissionalId !== null) {
            $bloco += $this->evolucoesEmAberto->avisoDeBloqueio($profissionalId);
        }

        return $bloco;
    }

    /** Aniversariantes do mês — {id, nome, dia}: nunca nascimento completo (D3). */
    private function blocoAniversariantes(): array
    {
        $mes = (int) now($this->fusoDaClinica())->format('m');
        $consulta = Paciente::query()
            ->where('ativo', true)
            ->whereMonth('nascimento', $mes)
            ->orderByRaw('DAY(nascimento)');

        return [
            'total' => (clone $consulta)->count(),
            'itens' => $consulta->limit(self::ITENS_POR_BLOCO)->get()
                ->map(fn (Paciente $p): array => [
                    'id' => $p->id,
                    'nome' => $p->nome,
                    'dia' => (int) $p->nascimento->format('d'),
                ])->all(),
        ];
    }

    /**
     * Gatilho exige_termo (D9/P6): quem NÃO aceitou a versão VIGENTE do termo.
     *
     * Era "a lista de consentimentos está vazia" — uma régua que qualquer texto
     * zerava, inclusive um consentimento de outra coisa. Desde a change
     * `aceite-do-regulamento` (FA-08) a pergunta é a que a clínica de fato faz:
     * *este paciente aceitou o Regulamento que está valendo?* Consequência
     * deliberada: aceite de versão ANTIGA, e consentimento anterior ao termo
     * versionado (texto livre, sem `termo_id`), voltam a aparecer aqui.
     *
     * Sem versão vigente publicada, o bloco fica VAZIO: não há régua para cobrar, e
     * cobrar sem régua é ruído (design D7).
     */
    private function blocoTermosPendentes(): array
    {
        $vigente = TermoConsentimento::emVigor();

        if ($vigente === null) {
            return ['total' => 0, 'itens' => []];
        }

        // `whereNull` explícito: `NOT JSON_CONTAINS(NULL, ...)` é NULL, não verdadeiro — sem
        // esta perna, o paciente que NUNCA teve consentimento (coluna nula) sumiria da fila,
        // que é justamente quem ela existe para achar.
        $consulta = Paciente::query()
            ->where('ativo', true)
            ->where(fn ($q) => $q->whereNull('consentimentos_json')
                ->orWhereNot(fn ($sub) => $sub->whereJsonContains(
                    'consentimentos_json', ['termo_id' => $vigente->id]
                )))
            ->whereHas('tratamentos', fn ($t) => $t->where('status', 'andamento')
                ->whereHas('especialidade', fn ($e) => $e->where('exige_termo', true)))
            ->with(['tratamentos' => fn ($t) => $t->where('status', 'andamento')
                ->whereHas('especialidade', fn ($e) => $e->where('exige_termo', true))
                ->with('especialidade:id,nome')])
            ->orderBy('nome');

        return [
            'total' => (clone $consulta)->count(),
            'itens' => $consulta->limit(self::ITENS_POR_BLOCO)->get()
                ->map(fn (Paciente $p): array => [
                    'id' => $p->id,
                    'nome' => $p->nome,
                    'especialidade' => $p->tratamentos->first()?->especialidade?->only(['id', 'nome']),
                ])->all(),
        ];
    }

    /**
     * Vencidos não-pagos — payload mínimo T-fin-21 (sem obs, interessado whitelist). A REGRA vive na
     * fonte única `LancamentosEmAtraso`, a mesma que o painel do dinheiro conta.
     */
    private function blocoAtrasados(): array
    {
        // o salário atrasado é da folha (change `financeiro-sem-faturamento-total`); o painel do
        // dinheiro, que lê a MESMA consulta, continua somando tudo
        $consulta = LancamentosVisiveis::filtrar($this->lancamentosEmAtraso->consulta());

        $itens = $consulta->limit(self::ITENS_POR_BLOCO)->get();
        $nomes = NomesDosInteressados::de($itens);

        return [
            'total' => (clone $consulta)->count(),
            'itens' => $itens->map(fn (LancamentoCaixa $l): array => [
                'lancamento_id' => $l->id,
                'tipo' => $l->tipo,
                'vencimento' => $l->vencimento->format('Y-m-d'),
                'valor_liquido' => $l->liquido,
                'interessado' => $l->interessado_tipo === null ? null : [
                    'tipo' => $l->interessado_tipo,
                    'id' => $l->interessado_id,
                    'nome' => $nomes[$l->interessado_tipo.'#'.$l->interessado_id] ?? null,
                ],
            ])->all(),
        ];
    }

    /** Teto de candidatos avaliados no bloco de faltas (limite estrutural do gate r1). */
    private const MAX_CANDIDATOS_FALTA = 200;

    /**
     * Sequência mais recente de agendamentos passados em status com
     * `marca_falta` (T-not-07 — flag, nunca nome), interrompida pelo primeiro
     * não-falta; ≥ limite configurado entra (D4/P1). A decisão é ANCORADA no
     * SQL (gate r1, CR-01): nunca hidratar a janela inteira da clínica —
     * primeiro os CANDIDATOS (pacientes cuja ocorrência passada mais recente é
     * falta), depois só os últimos `limite` agendamentos de cada um.
     */
    private function blocoFaltasConsecutivas(): array
    {
        $limite = (int) $this->configuracoes->get('agenda.faltas_consecutivas_limite');
        $agora = now($this->fusoDaClinica())->format('Y-m-d H:i');
        $piso = $this->pisoDaJanela().' 00:00:00';

        // D11 (#28, eixo AGENDA): os CANDIDATOS a alerta saem só dos agendamentos do próprio
        // profissional (fallback aceito do parecer: filtro na subquery por `profissional_id`).
        // Assim um paciente que o escopado não atende nunca aparece; a contagem da sequência
        // segue no contador (§13) — cross-profissional por construção, mas só para pacientes
        // que já são do profissional. Plano vê todos; sem vínculo → nenhum candidato.
        $escopo = $this->escopos->agenda(Auth::user());
        $passados = fn () => $escopo->aplicar(
            Agendamento::query()
                ->where('tipo', 'atendimento')
                ->whereNotNull('paciente_id')
                ->whereNotNull('status_id')
                // MESMO predicado do `ContadorDeFaltasConsecutivas` (change agendamentos-na-ficha,
                // D5): sem isto, a falta lançada hoje para mais tarde acendia o alerta no painel
                // e no da ficha, e o centro de avisos NÃO listava o paciente — duas telas
                // discordando no mesmo dia sobre a mesma sequência (achado ALTO do gate).
                ->jaContabilizavel($agora)
                ->where('inicio', '>=', $piso)
        );

        // candidatos: a ocorrência passada MAIS RECENTE é de falta (a subquery
        // e o outer partem de Agendamento::query())
        $ultimas = $passados()
            ->selectRaw('paciente_id, MAX(inicio) as ultima_ocorrencia')
            ->groupBy('paciente_id');
        $candidatos = Agendamento::query()
            ->joinSub($ultimas, 'ultimas', fn ($join) => $join
                ->on('agendamentos.paciente_id', '=', 'ultimas.paciente_id')
                ->on('agendamentos.inicio', '=', 'ultimas.ultima_ocorrencia'))
            ->whereHas('status', fn ($s) => $s->where('marca_falta', true))
            ->distinct()
            ->pluck('agendamentos.paciente_id')
            ->take(self::MAX_CANDIDATOS_FALTA);

        $noLimite = [];
        foreach ($candidatos as $pacienteId) {
            // a REGRA vive no contador (§13) — o mesmo que o alerta do painel usa;
            // memória limitada por construção: ≤ `limite` (≤ 20) linhas por candidato
            $sequencia = ContadorDeFaltasConsecutivas::doPaciente($pacienteId, $agora, $limite, $piso);

            if ($sequencia['consecutivas'] >= $limite) {
                $noLimite[$pacienteId] = [
                    'faltas_consecutivas' => $limite, // sequência atingiu o limite (P1)
                    'ultima_falta_em' => $sequencia['ultima_em'],
                ];
            }
        }

        $nomes = Paciente::whereIn('id', array_keys($noLimite))->pluck('nome', 'id');
        $itens = collect($noLimite)->map(fn (array $linha, int $pacienteId): array => [
            'paciente' => ['id' => $pacienteId, 'nome' => $nomes[$pacienteId] ?? null],
            ...$linha,
        ])->values();

        return [
            'total' => $itens->count(),
            'itens' => $itens->take(self::ITENS_POR_BLOCO)->all(),
        ];
    }

    /**
     * Pedidos médicos vencidos/a vencer (limites-e-pedidos, D5) — sob
     * `tratamentos.ver` (bloco AUSENTE sem a permissão, como os demais). A REGRA
     * (janela, antecedência §13 com clamp, whitelist SEC-LP-02) vive na fonte
     * única `PedidosMedicos` — a mesma que o alerta do painel consome (SEC-LP-06).
     * Teto e contador do padrão do centro (P7).
     */
    private function blocoPedidosMedicos(): array
    {
        $hoje = now($this->fusoDaClinica())->toDateString();
        // escopo D11 do eixo AGENDA dentro da fonte, como o bloco de pacotes acabando (`SEC-VP-45`)
        $consulta = $this->pedidosMedicos->consulta($hoje, $this->escopos->agenda(Auth::user()));

        return [
            'total' => (clone $consulta)->count(),
            'itens' => $consulta->limit(self::ITENS_POR_BLOCO)->get()
                ->map(fn (Tratamento $t) => $this->pedidosMedicos->item($t, $hoje))
                ->all(),
        ];
    }

    /**
     * Pacotes no FIM (change alerta-de-fim-de-pacote) — sob `tratamentos.ver`, como o de
     * pedidos médicos: quem repara que o pacote acabou é a recepção, no balcão, com a família
     * na frente, e é ela que tem essa permissão. O financeiro cobra depois; este bloco não é a
     * tela de cobrança, é o lembrete de que está na hora.
     *
     * A REGRA inteira vive na fonte única `PacotesAcabando`, que deriva das MESMAS colunas que
     * a grade e o painel leem — é o que faz contador, card e painel nunca divergirem.
     *
     * Escopo D11 do eixo AGENDA, aplicado DENTRO da fonte. Teto e contador do padrão do centro.
     */
    private function blocoPacotesAcabando(): array
    {
        $consulta = $this->pacotesAcabando->consulta($this->escopos->agenda(Auth::user()));

        return [
            'total' => (clone $consulta)->count(),
            'itens' => $consulta->limit(self::ITENS_POR_BLOCO)->get()
                ->map(fn (Tratamento $t) => $this->pacotesAcabando->item($t))
                ->all(),
        ];
    }

    /**
     * Pendências de RETORNO (protocolo-de-pendencias) — sob `agenda.ver`, como o de faltas:
     * a pendência é a AUSÊNCIA de horário, fato da agenda (design D6). A REGRA inteira vive
     * na fonte única `PendenciasDeRetorno`, a MESMA que a fila `/pendencias` consome — é o
     * que faz contador e lista nunca divergirem (contrato provado por teste cruzado).
     *
     * O escopo D11 entra DENTRO da fonte (por `tratamentos.profissional_id`): o escopado vê
     * só os seus, sem vínculo vê nada. Teto e contador do padrão do centro (P7).
     *
     * Sem piso de janela aqui: `notificacoes.a_partir_de` corta o PASSADO de um evento que
     * aconteceu, e esta pendência é o contrário — o evento que NÃO aconteceu. A janela
     * própria (§13) já é o corte, e aplicar as duas esconderia justamente o mais esquecido.
     */
    private function blocoPendenciasDeRetorno(): array
    {
        $hoje = now($this->fusoDaClinica())->toDateString();
        $consulta = $this->pendenciasDeRetorno->consulta($this->escopos->agenda(Auth::user()), $hoje);

        return [
            'total' => (clone $consulta)->count(),
            'itens' => $consulta->limit(self::ITENS_POR_BLOCO)->get()
                ->map(fn (Paciente $paciente) => $this->pendenciasDeRetorno->item($paciente, $hoje))
                ->all(),
        ];
    }

    /**
     * Mural de tarefas (kanban-da-equipe, design D5): ESTADO ATUAL do que pede a
     * atenção do PRÓPRIO usuário — sem janela de data (piso/366d são para evento
     * que aconteceu; tarefa parada há um ano é justamente a mais esquecida).
     * Quatro componentes: minhas em aberto · menções não lidas · demandas abertas
     * (sem responsável — sem elas no bloco, "Assumir" nunca seria descoberto) ·
     * eventos não lidos (alertas-do-mural: atribuições, mudanças de coluna e
     * comentários dirigidos a MIM — a mudança não some mais em silêncio).
     */
    private function blocoTarefas(): array
    {
        $usuarioId = Auth::id();
        $abertas = Tarefa::query()->whereNull('arquivada_em')->where('coluna', '!=', 'concluida');

        $minhas = (clone $abertas)
            ->whereHas('responsaveis', fn ($q) => $q->where('usuarios.id', $usuarioId))
            ->orderByRaw('prazo IS NULL, prazo')->orderBy('id');

        $demandas = (clone $abertas)
            ->whereDoesntHave('responsaveis')
            ->orderByRaw('prazo IS NULL, prazo')->orderBy('id');

        $mencoes = TarefaComentario::query()
            ->whereHas('mencionados', fn ($q) => $q->where('usuarios.id', $usuarioId))
            ->whereHas('tarefa', fn ($q) => $q->whereNull('arquivada_em'))
            ->whereRaw(
                'tarefa_comentarios.created_at > COALESCE((
                    SELECT l.lido_em FROM tarefa_comentario_leituras l
                    WHERE l.tarefa_id = tarefa_comentarios.tarefa_id
                      AND l.usuario_id = ?
                ), ?)',
                [$usuarioId, '1970-01-01 00:00:00']
            )
            ->with(['tarefa:id,titulo', 'autor:id,nome'])
            ->latest('id');

        // eventos não lidos DESTE usuário — minimizados ao título da tarefa e
        // ao nome do autor (adultos operadores; nada clínico)
        $eventos = TarefaNotificacao::query()
            ->where('usuario_id', $usuarioId)
            ->whereNull('lida_em')
            ->with(['tarefa:id,titulo', 'autor:id,nome'])
            ->latest('id');

        $itemDeTarefa = fn (Tarefa $t): array => [
            'id' => $t->id,
            'titulo' => $t->titulo,
            'coluna' => $t->coluna,
            'prazo' => $t->prazo?->format('Y-m-d'),
        ];

        return [
            'total' => (clone $minhas)->count() + (clone $mencoes)->count()
                + (clone $demandas)->count() + (clone $eventos)->count(),
            'minhas' => (clone $minhas)->limit(self::ITENS_POR_BLOCO)->get()->map($itemDeTarefa)->all(),
            'mencoes' => (clone $mencoes)->limit(self::ITENS_POR_BLOCO)->get()
                ->map(fn (TarefaComentario $c): array => [
                    'tarefa_id' => $c->tarefa_id,
                    'titulo' => $c->tarefa?->titulo,
                    'autor' => $c->autor?->nome,
                ])->all(),
            'demandas_abertas' => (clone $demandas)->limit(self::ITENS_POR_BLOCO)->get()->map($itemDeTarefa)->all(),
            'eventos' => (clone $eventos)->limit(self::ITENS_POR_BLOCO)->get()
                ->map(fn (TarefaNotificacao $n): array => [
                    'id' => $n->id,
                    'tarefa_id' => $n->tarefa_id,
                    'titulo' => $n->tarefa?->titulo,
                    'autor' => $n->autor?->nome,
                    'tipo' => $n->tipo,
                    'dados' => $n->dados,
                    // PAREDE da clínica (§13): o front renderiza a string crua —
                    // sem a conversão, o evento apareceria ~3h no futuro (B2)
                    'quando' => $n->created_at->timezone($this->fusoDaClinica())->format('Y-m-d H:i'),
                ])->all(),
        ];
    }

    /**
     * Conversas de WhatsApp esperando resposta (mensageria-whatsapp).
     *
     * ESTADO ATUAL, como o mural: os cortes de janela não se aplicam — a mensagem sem
     * resposta há muito tempo é justamente a que não pode sumir do radar.
     *
     * SEM TRECHO DO CONTEÚDO, e isso é requisito: o centro fica aberto em telas
     * compartilhadas do balcão, e o teor da conversa é dado de menor (art. 11). Sai o
     * nome (ou o telefone, quando a conversa não está vinculada), a contagem e a data.
     */
    private function blocoMensagens(): array
    {
        $aguardando = Conversa::query()
            ->whereNull('arquivada_em')
            ->where('nao_lidas', '>', 0)
            ->with(ResumoDoPaciente::relacao())
            ->orderByDesc('ultima_mensagem_em');

        return [
            'total' => (clone $aguardando)->count(),
            'conversas' => (clone $aguardando)->limit(self::ITENS_POR_BLOCO)->get()
                ->map(fn (Conversa $conversa): array => [
                    'id' => $conversa->id,
                    // nome da criança OU telefone — nunca os dois, nunca mais que isso
                    'quem' => $conversa->paciente?->nome ?? $conversa->telefone_e164,
                    'nao_lidas' => $conversa->nao_lidas,
                    'quando' => $conversa->ultima_mensagem_em
                        ?->timezone($this->fusoDaClinica())->format('Y-m-d H:i'),
                ])->all(),
        ];
    }

    /**
     * Cadastros que as famílias enviaram pelo link e ninguém conferiu ainda
     * (change cadastro-online-do-paciente).
     *
     * Sem contador, a fila é um formulário que a clínica divulgou e não lê — e o custo disso
     * recai sobre uma família esperando resposta. É o risco que o design nomeia, e este bloco é a
     * mitigação dele.
     *
     * NÃO traz o conteúdo do envio, só a contagem e o instante: o centro de notificações é uma
     * lista de coisas a fazer, e nome de criança que chegou de fora não precisa aparecer nele
     * para alguém decidir abrir a fila.
     *
     * @return array<string, mixed>
     */
    private function blocoCadastrosRecebidos(): array
    {
        $consulta = EnvioDeCadastro::query()
            ->where('situacao', 'pendente')
            ->whereNull('expurgado_em')
            ->orderBy('enviado_em');

        return [
            'total' => (clone $consulta)->count(),
            'itens' => $consulta->limit(self::ITENS_POR_BLOCO)->get()
                ->map(fn (EnvioDeCadastro $envio): array => [
                    'id' => $envio->id,
                    'enviado_em' => $envio->enviado_em?->toDateTimeString(),
                ])
                ->all(),
        ];
    }

    private function blocoInformativos(): array
    {
        $consulta = Informativo::query()->where('publicado', true)->latest('id');

        return [
            'total' => (clone $consulta)->count(),
            'itens' => $consulta->limit(self::ITENS_POR_BLOCO)
                ->get(['id', 'titulo', 'corpo', 'created_at'])
                ->map(fn (Informativo $i): array => [
                    'id' => $i->id,
                    'titulo' => $i->titulo,
                    'corpo' => $i->corpo,
                    // created_at é UTC do framework — converte para a PAREDE
                    // (§13); sem isso o informativo saía ~3h no futuro
                    'publicado_em' => $i->created_at->timezone($this->fusoDaClinica())->format('Y-m-d H:i'),
                ])->all(),
        ];
    }

    /**
     * Sessões cuja família tocou em "Preciso desmarcar" no lembrete e a recepção ainda não resolveu
     * (change `lembrete-com-botoes-de-resposta`) — o pedido da Mariana: a profissional saber "na
     * hora", sem a recepção avisar.
     *
     * No escopo do eixo AGENDA (D11): a escopada vê só as sessões da própria agenda. Só sessões
     * FUTURAS, ainda MARCADAS e com a resposta ao lembrete DAQUELA sessão (mesma criança, mesmo
     * horário) — a regra única de `LembreteEnviado`. Contado por DIA, sem nome de criança: o nome mora na agenda.
     *
     * @return array{total: int, itens: list<array{dia: string, total: int}>}
     */
    private function blocoPedidosDeDesmarque(): array
    {
        $agora = now($this->fusoDaClinica())->format('Y-m-d H:i:s');

        $porDia = $this->escopos->agenda(Auth::user())->aplicar(Agendamento::query())
            ->where('tipo', 'atendimento')
            ->where('inicio', '>', $agora)
            ->whereHas('status', fn ($status) => $status->deSessaoMarcada())
            // a regra única do card e do toque (CRB-10): mesma criança, mesmo horário
            ->whereHas('lembretesEnviados', fn ($lembrete) => $lembrete
                ->daSessaoComoFoiLembrada()
                ->where('resposta', LembreteEnviado::PEDIU_DESMARQUE))
            ->selectRaw('DATE(inicio) as dia, COUNT(*) as total')
            ->groupByRaw('DATE(inicio)')
            ->orderBy('dia')
            ->get();

        return [
            'total' => (int) $porDia->sum('total'),
            'itens' => $porDia->take(self::ITENS_POR_BLOCO)
                ->map(fn ($linha): array => ['dia' => (string) $linha->dia, 'total' => (int) $linha->total])
                ->values()->all(),
        ];
    }

    /** Piso das janelas: max(a_partir_de, hoje − 366d) — config nunca alarga (fonte única). */
    private function pisoDaJanela(): string
    {
        return $this->janela->piso();
    }

    private function fusoDaClinica(): string
    {
        return $this->configuracoes->get('clinica.timezone');
    }
}
