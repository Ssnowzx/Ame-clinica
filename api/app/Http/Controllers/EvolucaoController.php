<?php

namespace App\Http\Controllers;

use App\Http\Requests\EvolucaoRequest;
use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Evolucao;
use App\Models\Profissional;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Ciclos\CorridaDoMotor;
use App\Support\Ciclos\GuardaDeCicloFechado;
use App\Support\Clinica\EvolucoesEmAberto;
use App\Support\Clinica\FinalizacaoPelaEvolucao;
use App\Support\Clinica\RegistroDeAtendimento;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Http\ConcorrenciaOtimista;
use App\Support\Rbac\Escopo;
use App\Support\Rbac\EscopoDoProfissional;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use PDOException;

/**
 * Prontuário (§7) — evolução por sessão. Sem DELETE no v1 (T-ate-08); conteúdo
 * detail-only, cifrado e mascarado no diff; leitura do detalhe auditada (T-ate-05).
 */
class EvolucaoController extends Controller
{
    private const ERRO_UNIQUE = 1062;

    private const CAMPOS = [
        'id', 'atendimento_id', 'profissional_id', 'responsavel_tecnico_id',
        'conteudo', 'preenchida_em',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EscopoDoProfissional $escopos,
        private readonly GuardaDeCicloFechado $ciclos,
        private readonly FinalizacaoPelaEvolucao $finalizacao,
        private readonly RegistroDeAtendimento $registro,
    ) {}

    /** O escopo CLÍNICO do usuário atual (D11 · SEC-VP-01) — o dono é o agendamento-mãe. */
    private function escopoClinico(): Escopo
    {
        return $this->escopos->clinico(request()->user());
    }

    /**
     * "Evoluções em aberto" (§7): atendimentos SEM evolução — só metadados
     * (T-ate-18). Consulta canônica compartilhada com o centro de notificações
     * (etapa 8) — ver EvolucoesEmAberto.
     */
    public function emAberto(Request $request, EvolucoesEmAberto $emAberto): JsonResponse
    {
        $filtros = $request->validate([
            'profissional_id' => ['sometimes', 'integer'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        // D11 (eixo CLÍNICO): a fila é por `agendamento.profissional_id`. Plano usa o filtro do
        // cliente; o escopado é FORÇADO ao próprio (o filtro do cliente não amplia nem zera) —
        // e o fail-closed (sem vínculo) devolve fila vazia, nunca a de todos.
        $escopo = $this->escopoClinico();
        $pendentes = $escopo->aplicarNaRelacao(
            $emAberto->consulta($escopo->ehPlano() ? ($filtros['profissional_id'] ?? null) : null),
            'agendamento',
        )
            ->paginate($filtros['per_page'] ?? 50);

        $pendentes->getCollection()->transform(
            fn (Atendimento $atendimento) => $emAberto->serializar($atendimento)
        );

        return response()->json($pendentes);
    }

    public function store(EvolucaoRequest $request, int $atendimentoId): JsonResponse
    {
        // POSSE ANTES DA EXISTÊNCIA (`SEC-VP-47`, rodada 4): inexistente e do colega respondem 403
        // iguais ao escopado; inexistente → `null` → 404 depois da posse (só para o plano).
        $atendimento = Atendimento::find($atendimentoId);
        // D11 (eixo CLÍNICO): o escopado só evolui no PRÓPRIO agendamento (403). A autoria vinculada
        // (`EvolucaoRequest::authorize` + validarInvariantes) força assinar em nome próprio; este
        // portão barra o atendimento de OUTRO.
        $this->escopoClinico()->assegurarPosse($atendimento?->agendamento()->value('profissional_id'));
        abort_if($atendimento === null, 404);

        [$evolucao, $sessao] = $this->gravarEFinalizar((int) $atendimento->agendamento_id, fn (): Atendimento => $atendimento, $request);

        return response()->json([...$this->serializar($evolucao->refresh()), 'sessao' => $sessao], 201);
    }

    /**
     * A evolução escrita DIRETO DA SESSÃO (change evolucao-finaliza-a-sessao, D1): registra o
     * atendimento que falta e grava a evolução numa transação só — falhou uma parte, nada fica. O
     * término do atendimento é o fim da sessão, ou agora se ela ainda não acabou: a evolução escrita
     * dias depois não joga o atendimento para o mês da escrita. Depois, a finalização (D2).
     *
     * A rota exige `evolucoes.criar` E `atendimentos.criar` (403 antes de validar): esta porta
     * registra a sessão. A posse é a mesma da evolução e do atendimento — o eixo clínico (D11).
     */
    public function storeDaSessao(EvolucaoRequest $request, int $agendamentoId): JsonResponse
    {
        // POSSE ANTES DA EXISTÊNCIA (`SEC-VP-47`): inexistente e do colega respondem 403 iguais
        $agendamento = Agendamento::find($agendamentoId);
        $this->escopoClinico()->assegurarPosse($agendamento?->profissional_id);
        abort_if($agendamento === null, 404);

        [$evolucao, $sessao] = $this->gravarEFinalizar(
            (int) $agendamento->id,
            fn (): Atendimento => Atendimento::query()->where('agendamento_id', $agendamento->id)->first()
                ?? $this->registro->registrar($agendamento->id, ['finalizado_em' => $this->terminoDaSessao($agendamento)]),
            $request,
        );

        return response()->json([...$this->serializar($evolucao->refresh()), 'sessao' => $sessao], 201);
    }

    /**
     * Grava a evolução e finaliza a sessão — o caminho comum às duas rotas (D2).
     *
     * Sem o bloqueio pós-status, a evolução comita primeiro e a finalização vem depois, em transação
     * própria: a recusa do status nunca derruba o registro clínico. Com o bloqueio ligado e a
     * finalização ligada, a evolução só passa porque a sessão VAI ser finalizada (D4): a sessão é
     * travada ANTES das invariantes e tudo acontece numa transação só — recusado o status, nada fica
     * (gate SEC-EVO-01: a previsão sem trava deixava evolução gravada em sessão de data futura, sem
     * saldo ou desmarcada no meio do caminho).
     *
     * @param  Closure(): Atendimento  $atendimento  resolve ou registra o atendimento, DENTRO da transação
     * @return array{0: Evolucao, 1: array{finalizada: bool, motivo: string|null, versao_antes: string|null, versao_depois: string|null}}
     */
    private function gravarEFinalizar(int $agendamentoId, Closure $atendimento, EvolucaoRequest $request): array
    {
        $junto = $this->finalizacao->exigeFinalizacaoJunto();

        try {
            [$evolucao, $sessaoJunto, $profissionalDaEscrita] = DB::transaction(function () use ($agendamentoId, $atendimento, $request, $junto): array {
                // A sessão é travada PRIMEIRO, nos dois modos: a leitura do atendimento abria o snapshot
                // antes da trava, e uma gravação da recepção no mesmo instante virava 500 (1020) no modo
                // padrão (gate SEC-EVO-R3-02)
                $sessao = Agendamento::query()->with('status')->lockForUpdate()->findOrFail($agendamentoId);
                // a posse de novo, SOB o lock: a sessão pode ter sido passada a outra profissional
                // enquanto esta escrita esperava a trava (gates SEC-EVO-R2-04 e, no modo padrão, R3-01)
                $this->escopoClinico()->assegurarPosse($sessao->profissional_id);
                $alvo = $atendimento();
                // as invariantes leem a sessão TRAVADA, não a que foi carregada antes do lock
                $alvo->setRelation('agendamento', $sessao);
                $evolucao = $this->criar($alvo, $request);

                return [$evolucao, $junto ? $this->finalizacao->finalizarJunto($sessao) : null, (int) $sessao->profissional_id];
            });
        } catch (PDOException $erro) {
            // lock wait ou deadlock com a baixa em lote: 409, nunca 500 (o molde do `ContextoDoLote`)
            throw CorridaDoMotor::traduzir($erro);
        }

        // sem o bloqueio, a finalização vem DEPOIS do commit, em transação própria (D2) — e só se a sessão
        // continua da profissional que estava com ela quando a evolução foi gravada (SEC-EVO-R4-01)
        return [$evolucao, $sessaoJunto ?? $this->finalizacao->finalizar($agendamentoId, $profissionalDaEscrita)];
    }

    /** Fim da sessão ou agora, o que vier antes — o atendimento nunca termina no futuro. */
    private function terminoDaSessao(Agendamento $agendamento): string
    {
        $agora = now($this->fusoDaClinica())->format('Y-m-d H:i');
        $fim = $agendamento->fim?->format('Y-m-d H:i') ?? $agora;

        return min($fim, $agora);
    }

    /**
     * Grava a evolução de um atendimento — o núcleo de sempre, comum à rota do atendimento e à da
     * sessão: 1:1, invariantes, `preenchida_em` do servidor e a prova da assinatura por outro.
     */
    private function criar(Atendimento $atendimento, EvolucaoRequest $request): Evolucao
    {
        if ($atendimento->evolucao()->exists()) {
            throw ValidationException::withMessages([
                'atendimento_id' => 'Este atendimento já tem evolução registrada.',
            ]);
        }

        $dados = $request->validated();
        // o motivo da exceção NUNCA encosta no model (SEC-AE-03): não é coluna —
        // vive só no request e no evento da trilha
        $motivo = $dados['motivo_assinatura'] ?? null;
        unset($dados['motivo_assinatura']);

        $this->validarInvariantes(
            $atendimento,
            (int) $dados['profissional_id'],
            $dados['responsavel_tecnico_id'] ?? null,
            null, // criando: não há registro anterior
        );

        $evolucao = new Evolucao($dados);
        $evolucao->atendimento_id = $atendimento->id;
        // SEMPRE do servidor (T-ate-07), na parede da clínica (CR-03): preenchida
        // às 21:30 não pode virar 00:30 do dia seguinte no prontuário
        $evolucao->preenchida_em = now($this->fusoDaClinica())->format('Y-m-d H:i');

        try {
            // Exceção de autoria (FA-04): a evolução e o evento `assinou_por_outro`
            // comitam JUNTOS (SEC-AE-05) — não existe evolução-por-outro sem a prova
            // do consentimento (a trilha é append-only: perdido o evento, perdido para
            // sempre), nem evento órfão (o catch do unique envolve a transação:
            // rollback leva os dois embora antes do 422).
            DB::transaction(function () use ($evolucao, $request, $motivo): void {
                $evolucao->save(); // unique(atendimento_id) é o anti-race no banco

                // o predicado do evento é O MESMO do gate do authorize() (SEC-AE-04):
                // sem-vínculo criando — nunca "motivo presente no payload"
                if ($request->assinandoPorOutro()) {
                    // whitelist LITERAL: o $auditExclude do model protege o `criou`
                    // do observer, NÃO este call-site — atributos do model (conteúdo
                    // clínico) jamais entram aqui
                    RegistroDeAuditoria::registrar($evolucao, 'assinou_por_outro', [
                        'depois' => [
                            'profissional_id' => (int) $evolucao->profissional_id,
                            'motivo' => $motivo,
                        ],
                    ]);
                }
            });
        } catch (QueryException $excecao) {
            if (($excecao->errorInfo[1] ?? null) !== self::ERRO_UNIQUE) {
                throw $excecao;
            }
            throw ValidationException::withMessages([
                'atendimento_id' => 'Este atendimento já tem evolução registrada.',
            ]);
        }

        return $evolucao;
    }

    /** Detalhe com conteúdo — leitura AUDITADA (art. 11, parecer §1). */
    public function show(int $id): JsonResponse
    {
        $evolucao = Evolucao::find($id);
        // D11 (eixo CLÍNICO): a evolução é alcançada por QUALQUER de seus donos (SEC-VP-05) — autor,
        // responsável técnico (co-assina) OU atendente do agendamento-mãe. 403 ANTES de auditar.
        // Posse antes da existência (`SEC-VP-47`): lista de donos vazia = inexistente = 403 sem rastro.
        $this->escopoClinico()->assegurarAlgum($evolucao === null ? [] : $this->donos($evolucao));
        abort_if($evolucao === null, 404);

        RegistroDeAuditoria::registrar($evolucao, 'consultou', []);

        return response()->json($this->serializar($evolucao));
    }

    public function update(EvolucaoRequest $request, int $id): JsonResponse
    {
        $evolucao = Evolucao::find($id);
        // D11 (eixo CLÍNICO): editar exige alcançar a evolução por algum dono (SEC-VP-05).
        // Posse ANTES da versão — o 409/428 nunca vira oráculo de existência (SEC-OCC-02) — e
        // ANTES da existência (`SEC-VP-47`).
        $this->escopoClinico()->assegurarAlgum($evolucao === null ? [] : $this->donos($evolucao));
        abort_if($evolucao === null, 404);
        $dados = $request->validated(); // profissional_id é `missing` na edição (SEC-R2-01)
        // cinto-e-suspensório (rodada 3): a autoria JAMAIS chega ao update, mesmo que a
        // regra de validação mude de semântica de novo
        unset($dados['profissional_id']);

        // Aqui a concorrência otimista roda SOB LOCK, dentro da transação (SEC-OCC-01/C1):
        // o `conteudo` é mascarado na trilha (art. 11) — um lost update aqui é
        // IRRECUPERÁVEL, então a janela entre comparar e gravar não é aceitável nem
        // em milissegundos. A comparação e a gravação leem a MESMA linha travada.
        DB::transaction(function () use ($request, $dados, $evolucao): void {
            $travada = Evolucao::whereKey($evolucao->id)->lockForUpdate()->firstOrFail();
            ConcorrenciaOtimista::assegurar($travada, $request);

            // invariantes no ESTADO FINAL (T-ate-06/T-ate-09); autoria imutável —
            // versão ANTES das invariantes (o conflito se resolve antes da forma)
            $profissionalFinal = (int) $travada->profissional_id;
            $responsavelFinal = array_key_exists('responsavel_tecnico_id', $dados)
                ? $dados['responsavel_tecnico_id']
                : $travada->responsavel_tecnico_id;
            $this->validarInvariantes($travada->atendimento, $profissionalFinal, $responsavelFinal, $travada);

            // CICLO FECHADO (spec evolucoes) — só no `update`, NUNCA no `store`: a clínica
            // registra o que aconteceu (é a mesma razão pela qual a escrita da evolução
            // nunca é recusada por atraso), e o que já foi enviado à operadora é que não se
            // reescreve. A evolução não tem competência própria: quem decide o ciclo é o
            // `finalizado_em` do atendimento-mãe (D3) — e não há "destino" a checar, porque
            // este PUT não move essa data (quem a move é o `AtendimentoController`, e lá a
            // verificação é dupla). Independente das demais travas (prazo,
            // `bloquear_apos_status`, autoria), que seguem valendo como estão.
            $this->ciclos->assegurarPorTratamento([[
                $travada->atendimento?->agendamento()->value('tratamento_id'),
                $travada->atendimento?->finalizado_em,
            ]]);

            $travada->update($dados);
        });

        return response()->json($this->serializar($evolucao->refresh()));
    }

    /**
     * Regras clínicas configuráveis (§13 — DADO, nunca código) + autoria
     * vinculada, aplicadas em criação E edição.
     */
    private function validarInvariantes(
        Atendimento $atendimento,
        int $profissionalFinal,
        ?int $responsavelFinal,
        ?Evolucao $atual,
    ): void {
        // autoria clínica (T-ate-06): usuário vinculado só assina como si mesmo
        $vinculo = Auth::user()?->profissional_id;
        if ($vinculo !== null && $profissionalFinal !== (int) $vinculo) {
            throw ValidationException::withMessages([
                'profissional_id' => 'Usuário vinculado a um profissional só registra evolução em nome próprio.',
            ]);
        }

        // PROFISSIONAL DESLIGADO só assina a sessão que ELE mesmo atendeu.
        //
        // A autoria do prontuário diz a VERDADE: quem realizou a sessão foi ela. Fazer outra
        // pessoa assinar no lugar seria FALSIFICAR a autoria — pior que o problema. Mas ela não
        // pode virar autora de sessões que não atendeu: a fonoaudióloga que saiu em março não
        // assina, em julho, o prontuário de uma criança que nunca viu.
        //
        // A regra mora AQUI, no boundary, e não no `.filter()` da tela: uma aba velha, um cliente
        // antigo ou um `curl` passariam direto por uma defesa de UI (§13). O gate pegou isso (r11).
        //
        // **SÓ NA CRIAÇÃO**, e a distinção é vital: a regra é sobre ESCOLHER o autor. Na edição a
        // autoria é IMUTÁVEL (SEC-R2-01) — revalidá-la transformaria um fato histórico legítimo
        // em erro. A supervisora ATIVA que assinou a sessão de outra pessoa (permitido hoje) é
        // desligada três dias depois: sem este `$atual === null`, TODO PUT naquela evolução viraria
        // 422, numa chave que o cliente não pode mandar e o formulário nem renderiza. Prontuário
        // congelado, sem saída — o mesmo beco que a re-review I-2 já tinha removido (r12).
        if ($atual === null) {
            $autor = Profissional::find($profissionalFinal);
            if ($autor === null || (! $autor->ativo
                && $profissionalFinal !== (int) ($atendimento->agendamento?->profissional_id ?? 0))) {
                throw ValidationException::withMessages([
                    'profissional_id' => 'Profissional desligado só assina a evolução da sessão que ele mesmo atendeu.',
                ]);
            }
        }

        // O RESPONSÁVEL TÉCNICO é a OUTRA assinatura do prontuário — e, ao contrário da autoria,
        // é uma escolha feita AGORA, não um fato histórico: não existe "ele foi o RT da sessão".
        // Um desligado só continua ali se JÁ ERA o RT gravado (vínculo histórico); ninguém o
        // INSTALA depois. Sem esta guarda, um `PUT` com `responsavel_tecnico_id` da fono que saiu
        // em março respondia 200 — a regra vivia só no `.filter()` da tela (r12, bloqueante).
        if ($responsavelFinal !== null && $responsavelFinal !== $atual?->responsavel_tecnico_id) {
            $responsavel = Profissional::find($responsavelFinal);
            if ($responsavel === null || ! $responsavel->ativo) {
                throw ValidationException::withMessages([
                    'responsavel_tecnico_id' => 'Profissional desligado não pode ser responsável técnico.',
                ]);
            }
        }

        if ($this->configuracoes->get('evolucoes.responsavel_tecnico_obrigatorio')
            && $responsavelFinal === null) {
            throw ValidationException::withMessages([
                'responsavel_tecnico_id' => 'Responsável técnico é obrigatório (configuração da clínica).',
            ]);
        }

        // O PRAZO NÃO RECUSA A ESCRITA (change trava-de-evolucao, D2 — decisão da
        // clínica, 2026-07-19/FA-10): evolução atrasada é sempre aceita — o prontuário
        // atrasado é melhor que o prontuário em branco, e escrever é o que QUITA a
        // pendência. `evolucoes.prazo_dias` define VENCIMENTO (fila, aviso e trava do
        // finalizar — EvolucoesEmAberto/AtendimentoController), nunca um 422 aqui.

        // bloqueio pós-status (D6/P3): atendimento desfeito não evolui — status
        // ausente também bloqueia (CR-04: defesa em profundidade contra órfãos)
        // com a finalização pela evolução ligada, conta o status que SERÁ aplicado à sessão em
        // aberto (evolucao-finaliza-a-sessao, D4) — só na criação: editar não finaliza
        if ($this->configuracoes->get('evolucoes.bloquear_apos_status')
            && $atendimento->agendamento?->status?->desconta_sessao !== true
            && ! ($atual === null && $atendimento->agendamento !== null && $this->finalizacao->vaiFinalizar($atendimento->agendamento))) {
            throw ValidationException::withMessages([
                'evolucao' => 'O status atual do agendamento não permite evolução (configuração da clínica).',
            ]);
        }
    }

    /**
     * Os profissionais que ALCANÇAM a evolução (SEC-VP-05): o autor, o responsável técnico
     * (co-assina) e o atendente do agendamento-mãe. Qualquer um satisfaz o escopo escopado.
     *
     * @return list<int|null>
     */
    private function donos(Evolucao $evolucao): array
    {
        return [
            $evolucao->profissional_id,
            $evolucao->responsavel_tecnico_id,
            $evolucao->atendimento?->agendamento()->value('profissional_id'),
        ];
    }

    /**
     * Detalhe do prontuário + o booleano derivado do ciclo (SEC-FC-09): a tela some com
     * "Editar" quando a produção do período já foi enviada. Um booleano sobre ESTE registro
     * — nunca a lista de fechamentos nem o calendário do convênio.
     */
    private function serializar(Evolucao $evolucao): array
    {
        return [
            ...collect($evolucao->attributesToArray())->only(self::CAMPOS)->all(),
            'em_ciclo_fechado' => $this->ciclos->emCicloFechado(
                $evolucao->atendimento?->agendamento()->value('tratamento_id'),
                $evolucao->atendimento?->finalizado_em,
            ),
        ];
    }

    private function fusoDaClinica(): string
    {
        return $this->configuracoes->get('clinica.timezone');
    }
}
