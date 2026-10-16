<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\TratamentoRequest;
use App\Models\LancamentoCaixa;
use App\Models\Tratamento;
use App\Support\Ciclos\GuardaDeCicloFechado;
use App\Support\Clinica\RealceDoPacote;
use App\Support\Clinica\ResumoDoPaciente;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Http\ConcorrenciaOtimista;
use App\Support\Rbac\Escopo;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class TratamentoController extends Controller
{
    use ProtegeExclusaoEmUso;

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly GuardaDeCicloFechado $ciclos,
        private readonly RealceDoPacote $realce,
        private readonly EscopoDoProfissional $escopos,
    ) {}

    /** `tipo` fica de fora: coluna sem leitor e sem escritor (SEC-TR-17) não atravessa a fronteira. */
    private const CAMPOS = [
        'id', 'paciente_id', 'convenio_id', 'especialidade_id', 'profissional_id',
        'servico_id', 'matricula', 'guia', 'sessoes_total', 'sessoes_realizadas',
        'data_inicio', 'validade_dias',
        // pedido médico (limites-e-pedidos, D4) — as COLUNAS são detail-only, como
        // matricula/guia: a emissão e, sobretudo, o override semanal não saem em
        // listagem paginada (SEC-LP-02/03). Os DERIVADOS (`pedido_vence_em`,
        // `pedido_vencido`) saem nas duas superfícies — ver `serializar()`
        'pedido_emitido_em', 'pedido_sessoes_por_semana',
        'status',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    /** matricula/guia são detail-only (parecer T-trat-06) — nunca em listagem paginada. */
    private const CAMPOS_LISTAGEM = [
        'id', 'paciente_id', 'convenio_id', 'especialidade_id', 'profissional_id',
        'servico_id', 'sessoes_total', 'sessoes_realizadas',
        'data_inicio', 'validade_dias', 'status',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    public function index(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'paciente_id' => ['sometimes', 'integer'],
            // recorte da ficha do profissional: mesma permissão, mesma whitelist —
            // só estreita a lista que `tratamentos.ver` já entrega inteira
            'profissional_id' => ['sometimes', 'integer'],
            'status' => ['sometimes', Rule::in(Tratamento::STATUS)],
            // "quem está acabando" e "quem venceu" filtram NO SERVIDOR: filtrar depois de
            // paginar dá resposta errada (a página é uma amostra), e recalcular `vencido`
            // no navegador usaria o fuso do CLIENTE — a clínica tem o dela (§13)
            'vencido' => ['sometimes', 'boolean'],
            'saldo_max' => ['sometimes', 'integer', 'min:0', 'max:1000'],
            // recorte "Acabando" pelo limiar da CLÍNICA: o front pedia `saldo_max=2` com uma
            // constante própria, e o número do filtro podia divergir do número do selo. Agora
            // ele só diz o que quer; quem sabe o limiar é quem o configura.
            'acabando' => ['sometimes', 'boolean'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $hojeNaClinica = now($this->configuracoes->get('clinica.timezone'))->toDateString();
        // `validate()` não faz cast: a string crua do query string decidiria por
        // truthiness, e um dia em que a regra afrouxar o filtro INVERTE em silêncio
        // (pede não-vencidos, recebe vencidos)
        $querVencidos = $request->boolean('vencido');

        $tratamentos = $this->escopos->agenda($request->user())->aplicar(Tratamento::query())
            // camada 1 (BANCO → app): o cadastro do MENOR nem chega à memória do processo.
            // A camada 2 é o `ResumoDoPaciente::de()` do serializador — uma não substitui
            // a outra, e cada uma tem o SEU teste (SEC-TR-18)
            ->with(['paciente' => fn ($q) => $q->select(ResumoDoPaciente::CAMPOS)])
            // os derivados do pedido (`pedido_vence_em`/`pedido_vencido`) leem a validade
            // do convênio: sem este eager-load, uma página de 50 pacotes vira 50 queries.
            // Só as duas colunas — o convênio não atravessa a fronteira desta listagem
            ->with(['convenio:id,pedido_validade_meses'])
            ->when(isset($filtros['paciente_id']), fn ($q) => $q->where('paciente_id', $filtros['paciente_id']))
            ->when(isset($filtros['profissional_id']), fn ($q) => $q->where('profissional_id', $filtros['profissional_id']))
            ->when($filtros['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when(
                array_key_exists('vencido', $filtros),
                fn ($q) => $querVencidos
                    ? $q->whereNotNull('data_inicio')
                        ->whereNotNull('validade_dias')
                        ->whereRaw('DATE_ADD(data_inicio, INTERVAL validade_dias DAY) < ?', [$hojeNaClinica])
                    : $q->where(fn ($sub) => $sub->whereNull('data_inicio')
                        ->orWhereNull('validade_dias')
                        ->orWhereRaw('DATE_ADD(data_inicio, INTERVAL validade_dias DAY) >= ?', [$hojeNaClinica]))
            )
            ->when(
                isset($filtros['saldo_max']),
                // soma, não subtração: `sessoes_total - sessoes_realizadas` são colunas
                // UNSIGNED, e um resultado negativo (linha inconsistente) seria ERROR 1690
                // — 500 na aba PADRÃO da tela, para todo mundo, por causa de uma linha
                fn ($q) => $q->whereRaw('sessoes_total <= sessoes_realizadas + ?', [$filtros['saldo_max']])
            )
            ->when(
                filter_var($filtros['acabando'] ?? false, FILTER_VALIDATE_BOOLEAN),
                // o MESMO limiar do selo, do card e do contador — vindo de `configuracoes`,
                // não de um número que o front escolheu mandar
                fn ($q) => $q->whereRaw('sessoes_total <= sessoes_realizadas + ?', [$this->realce->saldoDeAlerta()])
            )
            ->orderByDesc('id')
            ->paginate($filtros['per_page'] ?? 50);

        $tratamentos->getCollection()->transform(
            fn (Tratamento $t) => $this->serializar($t, self::CAMPOS_LISTAGEM)
        );

        return response()->json($tratamentos);
    }

    public function store(TratamentoRequest $request): JsonResponse
    {
        // A SEGUNDA PERNA DO PREDICADO (`SEC-CP-04`) é aplicada em `TratamentoRequest`, pela regra
        // `PacienteVinculadoAoEscopo` — no MESMO passe de validação da inexistência, que é o que
        // fecha o oráculo composto. Havia aqui uma segunda checagem idêntica; a rodada 2 do gate
        // mediu que ela é INALCANÇÁVEL por HTTP (mesmo predicado, mesmo usuário, mesmo id, e a
        // regra recusa antes), e guarda que nenhum teste pode alcançar não é rede: é ruído que
        // faz o leitor achar que há duas defesas onde há uma.
        $tratamento = Tratamento::create($request->validated());
        $tratamento->refresh(); // defaults do banco (status, sessoes_realizadas) na resposta

        return response()->json($this->serializar($tratamento), 201);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        // POSSE ANTES DA EXISTÊNCIA (`SEC-VP-33`): com `findOrFail` primeiro, o escopado recebia
        // 404 para id inexistente e 403 para o pacote do colega — a diferença contava se a linha
        // existe. Resolvendo a posse contra `find()?->profissional_id`, o inexistente vira `null`
        // e para quem é escopado as duas respostas são 403. Para o plano na agenda, 404 como sempre
        // — a posse do pacote que JÁ EXISTE é do eixo da agenda (`SEC-VP-44`); os dois eixos só
        // entram onde nasce vínculo (`TratamentoRequest::authorize`).
        $tratamento = Tratamento::find($id);
        $this->escopoAgenda($request)->assegurarPosse($tratamento?->profissional_id);

        abort_if($tratamento === null, 404);

        return response()->json($this->serializar($tratamento));
    }

    private function escopoAgenda(Request $request): Escopo
    {
        return $this->escopos->agenda($request->user());
    }

    public function update(TratamentoRequest $request, int $id): JsonResponse
    {
        $dados = $request->validated();

        // sob LOCK: o piso de sessões é validado contra `sessoes_realizadas`, que uma
        // reconciliação concorrente (que também trava a linha) pode incrementar entre a
        // validação e a gravação — e o saldo negativo ficaria persistido
        $tratamento = DB::transaction(function () use ($id, $dados, $request) {
            $tratamento = Tratamento::whereKey($id)->lockForUpdate()->firstOrFail();
            // POSSE ANTES DA VERSÃO — o 409/428 nunca vira oráculo de existência (mesmo padrão do
            // EvolucaoController). O escopado editava pacote do colega e, pior, transferia a posse
            // para si: `recusarMudancaDeIdentidade` protege `paciente_id` e `especialidade_id`,
            // NUNCA `profissional_id` (gate r1 · SEC-VP-11). O pacote existente é do eixo da
            // agenda; o dono NOVO é vínculo, e vínculo pede os dois eixos (`SEC-VP-31`/`SEC-VP-44`).
            // O `authorize()` da Request já decidiu as duas; esta é a rede de quem chegar por outro caminho.
            $this->escopoAgenda($request)->assegurarPosse($tratamento->profissional_id);
            if (array_key_exists('profissional_id', $dados)
                && $dados['profissional_id'] !== null
                && (int) $dados['profissional_id'] !== (int) $tratamento->profissional_id) {
                $this->escopos->assegurarPosseDoProfissional($request->user(), (int) $dados['profissional_id']);
            }
            ConcorrenciaOtimista::assegurar($tratamento, $request);

            $this->recusarMudancaDeIdentidade($tratamento, $dados);
            $this->recusarTrocaDeConvenioComProducaoCongelada($tratamento, $dados);
            $this->revalidarPisoDeSessoes($tratamento, $dados);

            $tratamento->update($dados);

            return $tratamento;
        });

        return response()->json($this->serializar($tratamento));
    }

    /**
     * O tratamento não muda de IDENTIDADE. Três colunas dele são pré-condição de
     * agendamentos, sessões e dinheiro que já existem:
     *
     * - **`paciente_id`** — o pacote pertence a UMA criança. As sessões consumidas
     *   nasceram dos atendimentos dela, os agendamentos dela apontam para ele
     *   (`agendamentos.tratamento_id`) e os lançamentos também. Trocar o dono
     *   re-parenta histórico clínico e financeiro de uma criança para outra.
     *   Recusado SEMPRE — e não "quando já tem uso": a condicional seria um `SELECT`
     *   sem lock, e um agendamento pode nascer entre a checagem e a gravação. Não se
     *   perde nada: um pacote sem uso já pode ser EXCLUÍDO e recriado no paciente certo.
     *
     * - **`especialidade_id`** — é pré-condição do agendamento tanto quanto o paciente
     *   ("O tratamento é de outra especialidade"), e a coerência vale inclusive para
     *   agendamento já consumido. Trocá-la CONGELA os agendamentos existentes: qualquer
     *   edição neles (mover, trocar status, estornar) passa a ser recusada para sempre,
     *   e a recepção fica sem caminho de volta. Recusada SEMPRE, pelo mesmo motivo do
     *   paciente: condicionar a "quando já tem agendamento" seria um `SELECT` sem lock, e
     *   a criação de agendamento valida a coerência FORA da transação — um agendamento
     *   pode nascer entre a checagem e a gravação e já nascer congelado.
     *
     * - **`convenio_id`** — decide se o tratamento é lançado no caixa ou segue a esteira
     *   do sistema irmão (§14, `convenio.particular`). Pacote com dinheiro rodando não
     *   muda de política de faturamento por edição de tela.
     *
     * @param  array<string, mixed>  $dados
     *
     * @throws ValidationException
     */
    private function recusarMudancaDeIdentidade(Tratamento $tratamento, array $dados): void
    {
        $mudou = fn (string $campo): bool => array_key_exists($campo, $dados)
            && (int) $dados[$campo] !== (int) $tratamento->{$campo};

        if ($mudou('paciente_id')) {
            throw ValidationException::withMessages([
                'paciente_id' => 'O tratamento pertence a este paciente e não pode mudar de dono: '
                    .'as sessões consumidas e os agendamentos são dele. Para outro paciente, cadastre '
                    .'um tratamento novo.',
            ]);
        }

        if ($mudou('especialidade_id')) {
            throw ValidationException::withMessages([
                'especialidade_id' => 'A especialidade do tratamento não muda: os agendamentos dele a '
                    .'exigem, e trocá-la os deixaria impossíveis de editar. Cadastre um tratamento novo '
                    .'para a outra especialidade.',
            ]);
        }

        if ($mudou('convenio_id')
            && ($tratamento->sessoes_realizadas > 0
                || LancamentoCaixa::where('tratamento_id', $tratamento->id)->exists())) {
            throw ValidationException::withMessages([
                'convenio_id' => 'Este tratamento já tem sessões realizadas ou lançamentos no caixa: '
                    .'trocar o convênio mudaria a regra de faturamento de um pacote que já está rodando.',
            ]);
        }
    }

    /**
     * SEC-FC-14 (bloqueante) — o convênio do tratamento não muda com PRODUÇÃO CONGELADA.
     *
     * A cerca de identidade acima já protege `convenio_id`, mas ela é condicionada a
     * `sessoes_realizadas > 0` **ou** lançamento no caixa — e para tratamento DE CONVÊNIO a
     * segunda condição é estruturalmente falsa: produção de convênio não cai no caixa (§14,
     * é a esteira do sistema irmão). Basta então um atendimento finalizado cujo status NÃO
     * desconta sessão para as DUAS condições falharem: `sessoes_realizadas` continua 0,
     * nenhum lançamento existe, e o convênio troca — levando a produção congelada para fora
     * do ciclo sem reabrir nada. É a mesma classe do SEC-LP-12: `tratamentos.editar` não
     * fura política de `convenios.editar`.
     *
     * ORIGEM **E** DESTINO: o convênio novo pode ter o período correspondente também
     * fechado, e mudar a produção de um ciclo enviado para dentro de outro ciclo enviado
     * suja os dois.
     *
     * A varredura da produção congelada e a dupla verificação origem→destino vivem na
     * `GuardaDeCicloFechado` (fonte única do D3): a competência do atendimento é definida em
     * UM lugar, e este cadastro não vira superfície de leitura clínica só para consultá-la.
     *
     * @param  array<string, mixed>  $dados
     *
     * @throws ValidationException
     */
    private function recusarTrocaDeConvenioComProducaoCongelada(Tratamento $tratamento, array $dados): void
    {
        if (! array_key_exists('convenio_id', $dados)) {
            return; // chave ausente = não mexi no convênio
        }

        $this->ciclos->assegurarTrocaDeConvenioDoTratamento(
            (int) $tratamento->id,
            $tratamento->convenio_id === null ? null : (int) $tratamento->convenio_id,
            $dados['convenio_id'] === null ? null : (int) $dados['convenio_id'],
        );
    }

    /**
     * O piso das sessões, RELIDO sob o lock (o validator o checou fora dele).
     *
     * @param  array<string, mixed>  $dados
     *
     * @throws ValidationException
     */
    private function revalidarPisoDeSessoes(Tratamento $tratamento, array $dados): void
    {
        if (! array_key_exists('sessoes_total', $dados)) {
            return;
        }

        $realizadas = (int) $tratamento->sessoes_realizadas;

        if ((int) $dados['sessoes_total'] < $realizadas) {
            throw ValidationException::withMessages([
                'sessoes_total' => sprintf(
                    'Este tratamento já tem %d sessão(ões) realizada(s): o total não pode ser menor que isso.',
                    $realizadas,
                ),
            ]);
        }
    }

    public function destroy(Request $request, int $id): Response
    {
        // POSSE ANTES DA EXISTÊNCIA e antes de qualquer regra (`SEC-VP-33` + r3 do code-review)
        $tratamento = Tratamento::find($id);

        // POSSE ANTES DE QUALQUER REGRA — o `destroy` não consultava escopo NENHUM (rodada 3 do
        // gate): o escopado apagava o pacote do colega, e o escopo `nenhum` também, contra a
        // invariante que este mesmo controller cita como razão do `SEC-VP-21`. `show` e `update`
        // ganharam posse na r2; o `destroy` passou batido porque a lista de resíduos que eu
        // escrevi enumerava "show/update/index" e não olhou a quarta porta.
        //
        // A posse vem antes da regra das sessões realizadas de propósito: senão o pacote do
        // colega COM sessões responderia 422 e o SEM sessões 204, e a diferença contaria o que o
        // escopado não pode saber. Apagar não vincula ninguém: eixo da agenda (`SEC-VP-44`).
        $this->escopoAgenda($request)->assegurarPosse($tratamento?->profissional_id);

        abort_if($tratamento === null, 404);

        // histórico clínico/financeiro: pacote consumido não some (design D6)
        if ($tratamento->sessoes_realizadas > 0) {
            throw ValidationException::withMessages([
                'tratamento' => 'Tratamento com sessões realizadas não pode ser excluído.',
            ]);
        }

        $this->excluirProtegido(
            $tratamento,
            'tratamento',
            'Este tratamento está vinculado a outros registros e não pode ser excluído.'
        );

        return response()->noContent();
    }

    /** saldo e vencimento entram calculados (design D2), com casts aplicados. */
    private function serializar(Tratamento $tratamento, array $campos = self::CAMPOS): array
    {
        $paciente = $tratamento->relationLoaded('paciente') ? $tratamento->paciente : null;

        return [
            ...collect($tratamento->attributesToArray())->only($campos)->all(),
            'sessoes_saldo' => $tratamento->sessoes_saldo,
            'vencido' => $tratamento->vencido,
            // pedido médico DERIVADO (D4 — nunca coluna, nunca aceito por payload).
            // Sai nas DUAS superfícies, detalhe e listagem: a linha do pedido no bloco de
            // tratamentos vive na lista paginada, e sem esses dois campos ela ficaria morta.
            // Minimização preservada: aqui vão só a data-limite e o VEREDITO — a emissão e o
            // override semanal continuam presos ao detalhe (SEC-LP-02/03).
            // `pedido_vencido` é decidido NO SERVIDOR, no fuso da clínica (§13): o navegador
            // não conhece esse fuso e compararia a data no fuso do CLIENTE.
            'pedido_vence_em' => $tratamento->pedidoVenceEm(),
            'pedido_vencido' => $tratamento->pedidoVencido(),
            /*
             * O VEREDITO do fim de pacote, decidido aqui pelo mesmo `RealceDoPacote` que
             * governa o card da agenda e o bloco do centro (§13 — o limiar é dado da clínica).
             *
             * O selo desta lista refazia a conta com uma constante do FRONT. Duas contas para
             * o mesmo número, e o comentário daquela constante já dizia o que ia acontecer:
             * "no dia em que divergirem, a aba Acabando e o selo contariam histórias
             * diferentes sobre a mesma criança".
             */
            'realce' => $this->realce->de($tratamento),
            // camada 2 (app → HTTP): mesmo com o model INTEIRO em mãos, só o nome sai
            ...($paciente === null ? [] : ['paciente' => ResumoDoPaciente::de($paciente)]),
        ];
    }
}
