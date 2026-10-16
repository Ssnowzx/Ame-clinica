<?php

namespace App\Support\Financeiro;

use App\Models\Categoria;
use App\Models\Fornecedor;
use App\Models\Funcionario;
use App\Models\LancamentoAnexo;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Subcategoria;
use App\Models\Tratamento;
use App\Support\Arquivos\ArquivoCifrado;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Ciclos\GuardaDeCicloFechado;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Invariantes do lançamento de caixa (§9) avaliadas no ESTADO FINAL (lição da
 * etapa 5): coerência categoria×tipo×subcategoria, interessado polimórfico
 * escopado por tipo (T-fin-11/12 — sem FK física, a validação AQUI é a única
 * defesa), líquido ≥ 0 (T-fin-06) e imutabilidade do PAGO (T-fin-09).
 */
class LancamentoCaixaService
{
    public const MAX_PARCELAS = 60; // D10/P6

    /**
     * Campos financeiros imutáveis em lançamento pago (T-fin-09). O `tratamento_id` fica FORA
     * de propósito (change `recebido-por-profissional`): não é valor, data nem conta — diz de
     * qual tratamento é o dinheiro. Exigir estorno para acertá-lo empurraria o `pago_em` para o
     * dia do novo pagamento e tiraria o dinheiro do mês em que a família pagou.
     */
    private const FINANCEIROS = [
        'tipo', 'competencia', 'vencimento', 'interessado_tipo', 'interessado_id',
        'categoria_id', 'subcategoria_id', 'valor', 'juros', 'multa', 'desconto',
        'tipo_pagamento_id', 'conta_id', 'contabil',
    ];

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly GuardaDeCicloFechado $ciclos,
    ) {}

    /**
     * @param  array<string, mixed>  $dados
     * @return list<LancamentoCaixa> uma linha, ou N parcelas materializadas (D4)
     */
    public function criar(array $dados): array
    {
        $dados['contabil'] ??= (bool) $this->configuracoes->get('financeiro.contabil_padrao');
        $this->validarEstadoFinal($dados, null);

        $parcelas = (int) ($dados['parcelas'] ?? 1);
        // o vínculo é gravado à parte, nunca por mass-assignment (ver o model)
        $tratamentoId = $dados['tratamento_id'] ?? null;
        $pagarAgora = (bool) ($dados['pagar_agora'] ?? false);
        unset($dados['parcelas'], $dados['tratamento_id'], $dados['pagar_agora']);

        // o parcelamento é pago parcela a parcela (change `caixa-do-dia-a-dia`)
        if ($pagarAgora && $parcelas > 1) {
            throw ValidationException::withMessages([
                'pagar_agora' => 'Parcelado não nasce pago — dê baixa em cada parcela quando ela for paga.',
            ]);
        }

        if ($parcelas <= 1) {
            return DB::transaction(function () use ($dados, $tratamentoId, $pagarAgora): array {
                $this->assegurarVinculoForaDeCicloFechado($tratamentoId, $dados['competencia']);
                $lancamento = new LancamentoCaixa($dados);
                $lancamento->tratamento_id = $tratamentoId;
                if ($pagarAgora) {
                    // antes do `save()`: a auditoria registra UMA criação, já paga
                    $this->marcarComoPago($lancamento);
                }
                $lancamento->save();

                return [$lancamento->refresh()];
            });
        }

        // acessórios não rateiam: com parcelamento, lance-os por parcela depois
        if (bccomp(bcadd(bcadd((string) ($dados['juros'] ?? 0), (string) ($dados['multa'] ?? 0), 2), (string) ($dados['desconto'] ?? 0), 2), '0', 2) !== 0) {
            throw ValidationException::withMessages([
                'parcelas' => 'Parcelamento não aceita juros/multa/desconto no total — aplique-os por parcela.',
            ]);
        }

        // TOTAL rateado; a última parcela absorve o arredondamento — centavos
        // nunca somem (D4/D10-P6)
        $total = (string) $dados['valor'];
        $valorParcela = bcdiv($total, (string) $parcelas, 2);

        // parcela de 0,00 seria um lançamento "pagável" sem valor (gate r1, CR-03)
        if (bccomp($valorParcela, '0.00', 2) === 0) {
            throw ValidationException::withMessages([
                'parcelas' => 'O valor não comporta este número de parcelas.',
            ]);
        }
        $ultimaParcela = bcsub($total, bcmul($valorParcela, (string) ($parcelas - 1), 2), 2);
        $vencimento = Carbon::createFromFormat('Y-m-d', $dados['vencimento']);
        $grupo = (string) Str::uuid();

        return DB::transaction(function () use ($dados, $parcelas, $valorParcela, $ultimaParcela, $vencimento, $grupo, $tratamentoId): array {
            $this->assegurarVinculoForaDeCicloFechado($tratamentoId, $dados['competencia']);
            $linhas = [];
            for ($numero = 1; $numero <= $parcelas; $numero++) {
                $linha = new LancamentoCaixa([
                    ...$dados,
                    'valor' => $numero === $parcelas ? $ultimaParcela : $valorParcela,
                    'vencimento' => $vencimento->copy()->addMonthsNoOverflow($numero - 1)->toDateString(),
                ]);
                // server-set (T-fin-10): nunca do payload
                $linha->grupo_parcelamento = $grupo;
                $linha->parcela = $numero;
                $linha->parcelas_total = $parcelas;
                $linha->tratamento_id = $tratamentoId;
                $linha->save();
                $linhas[] = $linha->refresh();
            }

            return $linhas;
        });
    }

    /**
     * @param  array<string, mixed>  $dados
     * @param  array{tratamento_id: int|null, pago: bool}|null  $estadoAutorizado  o que a autorização do vínculo viu
     */
    public function atualizar(LancamentoCaixa $lancamento, array $dados, ?array $estadoAutorizado = null): LancamentoCaixa
    {
        return DB::transaction(function () use ($lancamento, $dados, $estadoAutorizado): LancamentoCaixa {
            $travado = LancamentoCaixa::whereKey($lancamento->id)->lockForUpdate()->firstOrFail();

            // A autorização do vínculo (posse e `lancamentos.pagar`, no `LancamentoCaixaRequest`)
            // leu o lançamento SEM lock. Se, até aqui, alguém trocou o vínculo ou deu baixa, a
            // decisão valeu para um estado que não existe mais (CR-RPP-18/SEC-RPP-06): quem não dá
            // baixa trocaria o vínculo de um lançamento que acabou de ser pago. Conflito, não 403:
            // recarregar mostra o estado atual, e a autorização é refeita sobre ele.
            // FAIL-CLOSED (SEC-RPP-08): vínculo no payload sem o que a autorização viu é
            // autorização que não rodou — recusar, nunca pular a conferência.
            abort_if(
                $estadoAutorizado === null && array_key_exists('tratamento_id', $dados),
                403,
                'A troca do tratamento deste lançamento não foi autorizada.',
            );

            // O "pago mudou" só pesa quando o vínculo MUDA: é só aí que a autorização decidiu algo
            // sobre o pago (`lancamentos.pagar`); reenviar o mesmo vínculo não passou por essa
            // decisão, e o 409 seria falso (CR-RPP-23).
            if (array_key_exists('tratamento_id', $dados)
                && ($travado->tratamento_id !== $estadoAutorizado['tratamento_id']
                    || ($this->idOuNulo($dados['tratamento_id']) !== $estadoAutorizado['tratamento_id']
                        && ($travado->pago_em !== null) !== $estadoAutorizado['pago']))) {
                abort(409, 'Este lançamento foi alterado por outra pessoa enquanto você editava. '
                    .'Recarregue para ver a versão atual antes de salvar.');
            }

            if ($travado->pago_em !== null) {
                $alterados = array_intersect(array_keys($dados), self::FINANCEIROS);
                if ($alterados !== []) {
                    throw ValidationException::withMessages([
                        'lancamento' => 'Lançamento pago é documento contábil: estorne o pagamento antes de alterar valores.',
                    ]); // T-fin-09 — obs/documento seguem editáveis
                }
            }

            // CICLO FECHADO — guarda INDEPENDENTE e ADICIONAL à imutabilidade do pago acima:
            // uma protege o documento contábil, a outra protege a produção já enviada à
            // operadora, e lançamento em ciclo fechado costuma estar EM ABERTO (o convênio
            // ainda não pagou). Se uma bastasse, a outra não existiria.
            //
            // O vínculo do faturamento pela agenda é do SERVIDOR: a sessão faturada diz de qual
            // tratamento é o dinheiro, e a edição não o troca nem o desfaz. Reenviar o MESMO
            // valor passa (idempotente).
            $mexeNoVinculo = array_key_exists('tratamento_id', $dados);
            if ($mexeNoVinculo && $travado->agendamento_id !== null
                && $this->idOuNulo($dados['tratamento_id']) !== $this->idOuNulo($travado->tratamento_id)) {
                throw ValidationException::withMessages([
                    'tratamento_id' => 'O tratamento deste lançamento vem do faturamento da sessão e não muda.',
                ]);
            }

            // DUPLA VERIFICAÇÃO ORIGEM→DESTINO (SEC-FC-15): `competencia` é editável em
            // lançamento não pago, então este é o MESMO contorno do atendimento — checar só
            // a origem deixaria "empurrar para dentro" de um ciclo já enviado; só o destino
            // deixaria "arrastar para fora". E a ÂNCORA do convênio também muda: o vínculo com
            // tratamento é editável no lançamento manual (change `recebido-por-profissional`),
            // então trocar ou desfazer o vínculo é outro jeito de arrastar para fora — a origem
            // é o par (tratamento, competência) ATUAL e o destino, o par FINAL.
            //
            // A COERÊNCIA vem ANTES (SEC-RPP-04): a recusa do ciclo nomeia o convênio e o período,
            // e rodando primeiro ela respondia sobre o tratamento de OUTRA criança — um oráculo
            // tratamento → operadora para quem nem vê tratamentos.
            $this->validarEstadoFinal($dados, $travado);

            $competenciaFinal = array_key_exists('competencia', $dados)
                ? $dados['competencia']
                : $travado->competencia;
            $tratamentoFinal = $mexeNoVinculo ? $dados['tratamento_id'] : $travado->tratamento_id;
            // ORDEM DE LOCKS da casa (D8/SEC-FC-12): lancamentos_caixa → tratamentos → convenios.
            // A guarda trava o convênio; os tratamentos de origem e de destino vêm ANTES, senão o
            // cruzamento com o PUT de agendamento (que trava o tratamento e depois o convênio) é
            // deadlock 1213 — 500 onde o desenho promete 409 (CR-RPP-15).
            $this->travarTratamentos([$travado->tratamento_id, $tratamentoFinal]);
            $this->ciclos->assegurarPorTratamento([
                [$travado->tratamento_id, $travado->competencia], // origem
                [$tratamentoFinal, $competenciaFinal],            // destino
            ]);

            // fora do `$fillable`: gravado aqui, depois das checagens, no MESMO save auditado
            if ($mexeNoVinculo) {
                $travado->tratamento_id = $dados['tratamento_id'];
                unset($dados['tratamento_id']);
            }
            $travado->update($dados);

            return $travado->refresh();
        });
    }

    public function excluir(LancamentoCaixa $lancamento, bool $aplicarNoGrupo): void
    {
        DB::transaction(function () use ($lancamento, $aplicarNoGrupo): void {
            $travado = LancamentoCaixa::whereKey($lancamento->id)->lockForUpdate()->firstOrFail();

            if ($travado->pago_em !== null) {
                throw ValidationException::withMessages([
                    'lancamento' => 'Lançamento pago é documento contábil e não pode ser excluído.',
                ]); // T-fin-09 — sem célula de permissão que permita
            }

            if (! $aplicarNoGrupo || $travado->grupo_parcelamento === null) {
                $this->ciclos->assegurarPorTratamento([[$travado->tratamento_id, $travado->competencia]]);
                $this->liberarDosAnexos([$travado->id]);
                $travado->delete();

                return;
            }

            // só as parcelas que a pessoa VÊ: a de salário, para quem não vê a folha, fica intacta e
            // calada — recusar por ela denunciaria que existe (CR-FIN-02, `financeiro-sem-faturamento-total`)
            $doGrupo = LancamentosVisiveis::filtrar(LancamentoCaixa::query())
                ->where('grupo_parcelamento', $travado->grupo_parcelamento)
                ->whereNull('pago_em') // parcela paga NUNCA (D4)
                ->orderBy('id')        // ordem estável entre transações concorrentes
                ->lockForUpdate()
                ->get();

            // TODAS as parcelas do lote, não só a clicada: "aplicar no grupo" apaga linhas
            // que o usuário não está olhando, e uma delas pode ter competência em período
            // fechado. Tudo-ou-nada — a recusa de uma desfaz a exclusão das demais.
            $this->ciclos->assegurarPorTratamento($doGrupo
                ->map(fn (LancamentoCaixa $l): array => [$l->tratamento_id, $l->competencia])
                ->all());

            $this->liberarDosAnexos($doGrupo->pluck('id')->all());
            $doGrupo->each->delete(); // um a um: cada exclusão auditada
        });
    }

    /**
     * Os anexos seguram o lançamento (FK `restrict`, change `anexo-no-lancamento`, D2): com anexo
     * ATIVO a exclusão é recusada — a pessoa vê o que está apagando. Os já excluídos (lógicos)
     * são PURGADOS junto, com o arquivo: o lançamento EM ABERTO que se exclui some, e os anexos
     * dele também (o pago nunca chega aqui — é documento contábil). Sem isto, a FK seguraria para
     * sempre um lançamento em aberto. A trilha registra `purgou`, distinto da exclusão lógica.
     *
     * @param  list<int>  $lancamentoIds
     */
    private function liberarDosAnexos(array $lancamentoIds): void
    {
        if (LancamentoAnexo::whereIn('lancamento_id', $lancamentoIds)->exists()) {
            throw ValidationException::withMessages([
                'lancamento' => 'Este lançamento tem anexos — exclua os anexos antes de excluir o lançamento.',
            ]);
        }

        LancamentoAnexo::onlyTrashed()->whereIn('lancamento_id', $lancamentoIds)->get()
            ->each(function (LancamentoAnexo $anexo): void {
                RegistroDeAuditoria::registrar($anexo, 'purgou', []);
                LancamentoAnexo::withoutEvents(fn () => $anexo->forceDelete());
                // o arquivo só sai DEPOIS do commit: se a exclusão desfizer, a linha volta e o
                // arquivo tem de estar lá
                $caminho = $anexo->caminho;
                DB::afterCommit(fn () => app(ArquivoCifrado::class)->apagar($caminho));
            });
    }

    public function pagar(LancamentoCaixa $lancamento): LancamentoCaixa
    {
        return DB::transaction(function () use ($lancamento): LancamentoCaixa {
            $travado = LancamentoCaixa::whereKey($lancamento->id)->lockForUpdate()->firstOrFail();

            // máquina de estados (gate r1, CR-02/SEC-fin-02): re-pagar deslocaria a
            // linha de período no extrato sem o passo de estorno que o D5 exige
            if ($travado->pago_em !== null) {
                throw ValidationException::withMessages([
                    'lancamento' => 'Lançamento já pago — estorne o pagamento primeiro.',
                ]);
            }

            $this->marcarComoPago($travado);
            $travado->save();

            return $travado->refresh();
        });
    }

    /**
     * A baixa, sem gravar: a régua ÚNICA do "pago", usada pela transição `pagar()` e pela criação
     * já paga (`pagar_agora` no lançamento e no faturamento — change `caixa-do-dia-a-dia`, D1).
     * Exige transação aberta (a guarda do ciclo trava o convênio).
     */
    public function marcarComoPago(LancamentoCaixa $lancamento): void
    {
        // pagar/estornar entram na trava do ciclo (spec lancamentos-caixa) porque
        // DESLOCAM a linha de período no extrato: fora daqui, o fechamento não
        // seguraria o número que foi enviado à operadora. A competência não muda nestas
        // duas transições — só a origem existe.
        $this->ciclos->assegurarPorTratamento([[$lancamento->tratamento_id, $lancamento->competencia]]);

        // parede da clínica (T-fin-07/CR-03) — a data do REGISTRO do pagamento (D10/P3)
        $lancamento->pago_em = now($this->configuracoes->get('clinica.timezone'))->format('Y-m-d H:i');
        // QUEM deu a baixa (change `fechamento-de-caixa`, D1) — server-set, como o `pago_em`; fora
        // de request (console, importação) fica nulo, igual à auditoria
        $lancamento->pago_por_id = Auth::id();
    }

    public function estornarPagamento(LancamentoCaixa $lancamento): LancamentoCaixa
    {
        return DB::transaction(function () use ($lancamento): LancamentoCaixa {
            $travado = LancamentoCaixa::whereKey($lancamento->id)->lockForUpdate()->firstOrFail();

            if ($travado->pago_em === null) {
                throw ValidationException::withMessages([
                    'lancamento' => 'Este lançamento não está pago.',
                ]); // gate r1, CR-06 — coerência com o pagar
            }

            $this->ciclos->assegurarPorTratamento([[$travado->tratamento_id, $travado->competencia]]);

            $travado->pago_em = null;
            // quem deu a baixa sai junto (change `fechamento-de-caixa`): o estornado não está no
            // caixa de ninguém
            $travado->pago_por_id = null;
            $travado->save(); // auditado — caminho de correção legítimo (D10/P2)

            return $travado->refresh();
        });
    }

    /**
     * CRIAR já vinculado a um tratamento cujo convênio tem o período da competência FECHADO é
     * recusado (SEC-RPP-01/CR-RPP-06): o lançamento nasceria sem poder ser pago, excluído nem
     * desvinculado — só a reabertura do ciclo o soltaria. É o "empurrar para dentro" que a
     * edição já recusa, pela porta da criação. Criar retroativo SEM vínculo segue livre.
     * Roda dentro da transação da criação: a guarda trava a linha do convênio.
     */
    private function assegurarVinculoForaDeCicloFechado(?int $tratamentoId, mixed $competencia): void
    {
        if ($tratamentoId !== null) {
            // tratamento ANTES do convênio (D8/SEC-FC-12, CR-RPP-15): sem isto a guarda travava o
            // convênio com o tratamento livre — deadlock contra o PUT de agendamento, e uma troca
            // de convênio do pacote concorrente passava por baixo da checagem do ciclo
            $this->travarTratamentos([$tratamentoId]);
            $this->ciclos->assegurarPorTratamento([[$tratamentoId, $competencia]]);
        }
    }

    /**
     * Trava os tratamentos dados, DISTINTOS e em ordem CRESCENTE de id — dois caminhos que
     * travam o mesmo par nunca o fazem em ordens opostas.
     *
     * @param  list<int|string|null>  $ids
     */
    private function travarTratamentos(array $ids): void
    {
        $distintos = array_values(array_unique(array_map('intval', array_filter($ids, fn ($id) => $id !== null))));
        sort($distintos);
        if ($distintos !== []) {
            Tratamento::whereKey($distintos)->orderBy('id')->lockForUpdate()->get(['id']);
        }
    }

    /** Id vindo do payload (string ou int) ou do model, comparável; nulo continua nulo. */
    private function idOuNulo(mixed $id): ?int
    {
        return $id === null || $id === '' ? null : (int) $id;
    }

    /**
     * Coerências no ESTADO FINAL (T-fin-06/11/12) — PUT parcial coberto.
     *
     * @param  array<string, mixed>  $dados
     */
    private function validarEstadoFinal(array $dados, ?LancamentoCaixa $atual): void
    {
        $final = fn (string $campo) => array_key_exists($campo, $dados)
            ? $dados[$campo]
            : $atual?->getAttribute($campo);

        $erros = [];

        // categoria da MESMA natureza do lançamento
        $tipo = $final('tipo');
        $categoria = Categoria::find($final('categoria_id'));
        if ($categoria !== null && $categoria->tipo !== $tipo) {
            $erros['categoria_id'] = 'A categoria não é da natureza do lançamento.';
        }

        // subcategoria pertence à categoria
        $subcategoriaId = $final('subcategoria_id');
        if ($subcategoriaId !== null && $categoria !== null
            && Subcategoria::whereKey($subcategoriaId)->value('categoria_id') !== $categoria->id) {
            $erros['subcategoria_id'] = 'A subcategoria não pertence à categoria do lançamento.';
        }

        // interessado polimórfico: par atômico + id existente no TIPO
        $interessadoTipo = $final('interessado_tipo');
        $interessadoId = $final('interessado_id');
        if (($interessadoTipo === null) !== ($interessadoId === null)) {
            $erros['interessado_tipo'] = 'Interessado exige tipo e id juntos.';
        } elseif ($interessadoTipo !== null) {
            $existe = match ($interessadoTipo) {
                'paciente' => Paciente::whereKey($interessadoId)->exists(),
                'fornecedor' => Fornecedor::whereKey($interessadoId)->exists(),
                'funcionario' => Funcionario::whereKey($interessadoId)->exists(),
                default => false,
            };
            if (! $existe) {
                $erros['interessado_id'] = 'Interessado inexistente para o tipo informado.';
            }
        }

        // vínculo com tratamento: só de uma CRIANÇA, e do tratamento DELA. Avaliado quando o
        // vínculo ou o interessado entram no payload — a edição parcial que troca só a criança
        // e deixa o vínculo no tratamento da outra cai aqui
        $mexeNoVinculo = array_key_exists('tratamento_id', $dados)
            || array_key_exists('interessado_tipo', $dados)
            || array_key_exists('interessado_id', $dados);
        $tratamentoId = $final('tratamento_id');
        if ($mexeNoVinculo && $tratamentoId !== null && ! isset($erros['interessado_id'])) {
            $donoDoTratamento = Tratamento::whereKey($tratamentoId)->value('paciente_id');
            $incoerente = $interessadoTipo !== 'paciente'
                || $donoDoTratamento === null
                || (int) $donoDoTratamento !== (int) $interessadoId;
            if ($incoerente && $atual?->agendamento_id !== null) {
                // no faturado o vínculo é do servidor e a tela o mostra só para leitura: o que a
                // pessoa pode corrigir é a criança (CR-RPP-08)
                $erros['interessado_id'] = 'A criança precisa ser a da sessão faturada.';
            } elseif ($interessadoTipo !== 'paciente') {
                $erros['tratamento_id'] = 'Só o lançamento de uma criança se vincula a um tratamento.';
            } elseif ($incoerente) {
                $erros['tratamento_id'] = 'O tratamento precisa ser da criança deste lançamento.';
            }
        }

        // líquido nunca negativo (T-fin-06)
        $liquido = bcsub(
            bcadd(bcadd((string) ($final('valor') ?? 0), (string) ($final('juros') ?? 0), 2), (string) ($final('multa') ?? 0), 2),
            (string) ($final('desconto') ?? 0),
            2
        );
        if (bccomp($liquido, '0', 2) < 0) {
            $erros['desconto'] = 'O desconto não pode deixar o líquido negativo.';
        }

        if ($erros !== []) {
            throw ValidationException::withMessages($erros);
        }
    }
}
