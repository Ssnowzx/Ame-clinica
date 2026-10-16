<?php

namespace App\Support\Relatorios;

use App\Models\Convenio;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Servico;
use App\Models\TipoPagamento;
use App\Support\Rbac\Escopo;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Relatório `recebido-por-profissional` (change `recebido-por-profissional`): o dinheiro que
 * ENTROU no caixa no período, atribuído ao profissional. É o "demonstrativo" da clínica — no
 * ClinicaÁgil, "Serviços Executados" com Convênio = Particular —, pedido pela Mariana em
 * 2026-09-24 para fechar o mês de cada profissional ("tipo um rateio").
 *
 * A regra é a da clínica, e é simples de propósito (respostas de 2026-09-24): conta o que a
 * família PAGOU no período (`pago_em`, nunca competência nem vencimento); SEM percentual — a
 * clínica soma e fecha à mão; a falta conta se foi paga e não conta se não foi (é só a regra do
 * pago, sem caso especial); o pacote pago adiantado conta INTEIRO quando é pago. Não é o módulo de
 * comissão/repasse (Fase 2, FA-14) e não lê recebido de convênio — o que a operadora paga não
 * passa por este caixa (§14); a linha "Base" do cabeçalho diz isso no papel.
 *
 * Atribuição (design D3): quem ATENDEU a sessão faturada; senão o dono do tratamento vinculado;
 * senão "Sem profissional" — que aparece e soma, nunca some. O escopo D11 (eixo agenda) é
 * aplicado sobre a MESMA expressão: o escopado vê só o que é dele e nunca o que não tem dono.
 *
 * De FECHAMENTO (AP-09 revisado): sai com o nome da criança — só o nome, que a lista de
 * lançamentos já mostra a quem tem `lancamentos.ver`.
 *
 * Permissões (decisão da clínica 2026-07-19, perguntas 9-10: a FATURISTA monta os valores por
 * profissional e informa ao administrador, mas NÃO vê o total recebido da clínica):
 * - `repasse.ver` + `lancamentos.ver` + `tratamentos.ver` abrem o relatório — `repasse.ver` é a
 *   permissão do MÓDULO de repasse, que a clínica concede à faturista (a recepção não a tem), e
 *   `tratamentos.ver` porque a linha diz o serviço e o convênio de cada criança (SEC-RPP-10);
 * - sem `fluxo_caixa.ver`, o PROFISSIONAL É OBRIGATÓRIO: um profissional por vez, com o total
 *   dele. A visão de todos, com o "Total geral" da clínica, é de quem vê o fluxo de caixa.
 *   Somar profissional a profissional reconstrói o total — o mesmo resíduo aceito na lista de
 *   lançamentos (SEC-TC-01).
 *
 * A primeira versão (entregue na mesma data) exigia `fluxo_caixa.ver` e `agenda.ver`: a
 * faturista, que não tem nenhuma das duas, ficava sem a ferramenta que é função dela.
 */
final class RecebidoPorProfissional implements Relatorio
{
    /** @var list<string> */
    public const RESULTADOS = ['analitico', 'sintetico'];

    /** @var list<string> */
    public const DIVISOES = ['profissional', 'convenio', 'servico'];

    /** A base do número, impressa no cabeçalho — a fronteira §14 dita onde o número aparece. */
    public const BASE = 'Pagamentos recebidos no caixa da clínica';

    /**
     * Quem recebe: quem atendeu a sessão, senão o dono do pacote (design D3).
     *
     * PÚBLICA de propósito (change `relatorios-do-caixa`, D4): `vendas-do-periodo` atribui a venda
     * pela MESMA regra, e uma segunda cópia seria o jeito de as duas folhas darem o mesmo pacote a
     * profissionais diferentes. Só faz sentido sobre os joins de `comAtribuicao()`.
     */
    public const PROFISSIONAL_ATRIBUIDO = 'COALESCE(agendamentos.profissional_id, tratamentos.profissional_id)';

    /** A criança: a interessada do lançamento; sem ela, a dona do tratamento vinculado. */
    private const PACIENTE_DO_LANCAMENTO = "CASE WHEN lancamentos_caixa.interessado_tipo = 'paciente' "
        .'THEN lancamentos_caixa.interessado_id ELSE tratamentos.paciente_id END';

    /**
     * Quantos PAGAMENTOS da família: só receita conta (CR-RPP-10). A devolução subtrai do valor,
     * mas não é um pagamento — contá-la dava "2 pagamentos" a quem recebeu um e devolveu parte.
     */
    private const PAGAMENTOS = "COALESCE(SUM(CASE WHEN lancamentos_caixa.tipo = 'receita' THEN 1 ELSE 0 END), 0)";

    private const ROTULO_DA_DIVISAO = [
        'profissional' => 'Profissional',
        'convenio' => 'Convênio',
        'servico' => 'Serviço',
    ];

    private const SEM_VALOR = '—';

    public function __construct(private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS) {}

    public function slug(): string
    {
        return 'recebido-por-profissional';
    }

    public function titulo(): string
    {
        return 'Recebido por profissional';
    }

    public function permissoes(): array
    {
        // `tratamentos.ver` (SEC-RPP-10): a linha diz o serviço, o convênio e a terapeuta de cada
        // criança — o vínculo que só quem vê tratamentos lê; a faturista (AP-10) a tem
        return ['repasse.ver', 'lancamentos.ver', 'tratamentos.ver'];
    }

    public function eixo(): ?string
    {
        return 'agenda';
    }

    public function expoeNomeDaCrianca(): bool
    {
        return true;
    }

    public function usaPeriodo(): bool
    {
        return true;
    }

    public function regras(): array
    {
        return [
            'resultado' => ['sometimes', Rule::in(self::RESULTADOS)],
            'dividir_por' => ['required_if:resultado,sintetico', Rule::in(self::DIVISOES)],
            // sem o total da clínica, um profissional por vez (ver o docblock da classe)
            'profissional_id' => [
                $this->veOTotalDaClinica() ? 'sometimes' : 'required',
                'integer',
                Rule::exists('profissionais', 'id'),
            ],
            'convenio_id' => ['sometimes', 'integer', Rule::exists('convenios', 'id')],
            'servico_id' => ['sometimes', 'integer', Rule::exists('servicos', 'id')],
        ];
    }

    /** Quem vê o total recebido da clínica (`fluxo_caixa.ver`) pode ver todos os profissionais juntos. */
    private function veOTotalDaClinica(): bool
    {
        return request()->user()?->can('fluxo_caixa.ver') === true;
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        $this->assegurarServicoDoConvenio($parametros);

        $consulta = $this->consultaBase($parametros, $escopo);
        $periodo = ['de' => $parametros['de'], 'ate' => $parametros['ate']];
        $filtros = $this->filtrosAplicados($parametros);
        $avisos = $this->avisoDeSemProfissional($parametros, $escopo);

        if (($parametros['resultado'] ?? 'analitico') === 'sintetico') {
            return $this->sintetico($consulta, $parametros['dividir_por'], $periodo, $filtros, $avisos);
        }

        return $this->analitico($consulta, $periodo, $filtros, $avisos);
    }

    /**
     * Serviço é procedimento × convênio (o preço muda por operadora): um serviço de OUTRO
     * convênio que o escolhido é pedido incoerente, e responde 422 — nunca uma folha vazia
     * calada, que a clínica leria como "ninguém pagou".
     *
     * @param  array<string, mixed>  $parametros
     */
    private function assegurarServicoDoConvenio(array $parametros): void
    {
        if (! isset($parametros['servico_id'], $parametros['convenio_id'])) {
            return;
        }

        $convenioDoServico = Servico::whereKey($parametros['servico_id'])->value('convenio_id');
        if ((int) $convenioDoServico !== (int) $parametros['convenio_id']) {
            throw ValidationException::withMessages([
                'servico_id' => 'Este serviço é de outro convênio.',
            ]);
        }
    }

    /**
     * Filtros e escopo sobre o recorte comum (`pagosNoPeriodo`), na MESMA query: interseção por
     * construção.
     *
     * @param  array<string, mixed>  $parametros
     * @return Builder<LancamentoCaixa>
     */
    private function consultaBase(array $parametros, Escopo $escopo): Builder
    {
        $consulta = self::pagosNoPeriodo($parametros['de'], $parametros['ate'])
            ->when($parametros['profissional_id'] ?? null, fn (Builder $q, $id) => $q
                ->whereRaw(self::PROFISSIONAL_ATRIBUIDO.' = ?', [$id]))
            ->when($parametros['convenio_id'] ?? null, fn (Builder $q, $id) => $q->where('tratamentos.convenio_id', $id))
            ->when($parametros['servico_id'] ?? null, fn (Builder $q, $id) => $q->where('tratamentos.servico_id', $id));

        return $escopo->aplicar($consulta, DB::raw(self::PROFISSIONAL_ATRIBUIDO));
    }

    /**
     * O recorte comum: lançamentos PAGOS de `$de` a `$ate` (`pago_em`, dias inteiros) que são de
     * uma criança (interessada, ou vínculo com sessão ou tratamento), já com os joins da atribuição.
     * Os dois joins são LEFT — sem vínculo o
     * lançamento continua, e vai para "Sem profissional".
     *
     * PÚBLICO desde a change `painel-do-profissional` (D4): o financeiro da ficha é ESTE recorte com
     * o profissional fixo — uma segunda cópia seria o jeito de a ficha e o relatório discordarem
     * sobre o que a família pagou.
     *
     * @param  string  $de  "Y-m-d"
     * @param  string  $ate  "Y-m-d"
     * @return Builder<LancamentoCaixa>
     */
    public static function pagosNoPeriodo(string $de, string $ate): Builder
    {
        return self::comAtribuicao(LancamentoCaixa::query())
            ->whereBetween('lancamentos_caixa.pago_em', ["{$de} 00:00:00", "{$ate} 23:59:59"])
            ->where(fn (Builder $q) => $q
                ->where('lancamentos_caixa.interessado_tipo', 'paciente')
                ->orWhereNotNull('lancamentos_caixa.agendamento_id')
                ->orWhereNotNull('lancamentos_caixa.tratamento_id'));
    }

    /**
     * Os dois joins de que a atribuição depende — a sessão faturada e o tratamento vinculado —,
     * LEFT (sem vínculo o lançamento continua e
     * cai em "Sem profissional"). Público junto com `PROFISSIONAL_ATRIBUIDO` (D4 de
     * `relatorios-do-caixa`): a expressão sem os joins não existe.
     *
     * @param  Builder<LancamentoCaixa>  $consulta
     * @return Builder<LancamentoCaixa>
     */
    public static function comAtribuicao(Builder $consulta): Builder
    {
        return $consulta
            ->leftJoin('agendamentos', fn (JoinClause $join) => $join
                ->on('agendamentos.id', '=', 'lancamentos_caixa.agendamento_id'))
            ->leftJoin('tratamentos', fn (JoinClause $join) => $join
                ->on('tratamentos.id', '=', 'lancamentos_caixa.tratamento_id'));
    }

    /**
     * Uma linha por pagamento. As colunas lidas são uma whitelist no SQL (`obs` e `documento`
     * nunca são nem hidratados); os nomes vêm em lote, um `whereIn` por cadastro.
     *
     * @param  Builder<LancamentoCaixa>  $consulta
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     * @param  list<string>  $avisos
     */
    private function analitico(Builder $consulta, array $periodo, array $filtros, array $avisos): Envelope
    {
        $brutas = (clone $consulta)
            ->select([
                'lancamentos_caixa.id', 'lancamentos_caixa.tipo', 'lancamentos_caixa.valor',
                'lancamentos_caixa.juros', 'lancamentos_caixa.multa', 'lancamentos_caixa.desconto',
                'lancamentos_caixa.pago_em', 'lancamentos_caixa.tipo_pagamento_id',
                'lancamentos_caixa.agendamento_id', 'lancamentos_caixa.tratamento_id',
            ])
            ->selectRaw(self::PROFISSIONAL_ATRIBUIDO.' as profissional_ref')
            ->selectRaw(self::PACIENTE_DO_LANCAMENTO.' as paciente_ref')
            ->selectRaw('tratamentos.convenio_id as convenio_ref, tratamentos.servico_id as servico_ref, agendamentos.inicio as sessao_inicio')
            ->orderBy('lancamentos_caixa.pago_em')
            ->orderBy('lancamentos_caixa.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;
        $brutas = $brutas->take($this->limiteDeLinhas);

        $profissionais = Profissional::whereIn('id', $this->ids($brutas, 'profissional_ref'))->pluck('nome', 'id');
        $pacientes = Paciente::whereIn('id', $this->ids($brutas, 'paciente_ref'))->pluck('nome', 'id');
        $convenios = Convenio::whereIn('id', $this->ids($brutas, 'convenio_ref'))->pluck('nome', 'id');
        $servicos = Servico::whereIn('id', $this->ids($brutas, 'servico_ref'))->pluck('procedimento', 'id');
        $formas = TipoPagamento::whereIn('id', $this->ids($brutas, 'tipo_pagamento_id'))->pluck('nome', 'id');

        $linhas = $brutas->map(fn (LancamentoCaixa $l): array => [
            'data' => $l->pago_em->format('Y-m-d'),
            'paciente' => $pacientes[$l->paciente_ref] ?? self::SEM_VALOR,
            'profissional' => $l->profissional_ref === null
                ? 'Sem profissional'
                : ($profissionais[$l->profissional_ref] ?? 'Sem profissional'),
            'servico' => $servicos[$l->servico_ref] ?? self::SEM_VALOR,
            'convenio' => $convenios[$l->convenio_ref] ?? self::SEM_VALOR,
            'origem' => $this->origem($l),
            'forma_de_pagamento' => $formas[$l->tipo_pagamento_id] ?? self::SEM_VALOR,
            'recebido' => $l->tipo === 'despesa' ? bcmul($l->liquido, '-1', 2) : $l->liquido,
        ])->values()->all();

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            colunas: [
                ['chave' => 'data', 'rotulo' => 'Pago em', 'tipo' => 'data'],
                ['chave' => 'paciente', 'rotulo' => 'Paciente', 'tipo' => 'texto'],
                ['chave' => 'profissional', 'rotulo' => 'Profissional', 'tipo' => 'texto'],
                ['chave' => 'servico', 'rotulo' => 'Serviço', 'tipo' => 'texto'],
                ['chave' => 'convenio', 'rotulo' => 'Convênio', 'tipo' => 'texto'],
                ['chave' => 'origem', 'rotulo' => 'Origem', 'tipo' => 'texto'],
                ['chave' => 'forma_de_pagamento', 'rotulo' => 'Forma de pagamento', 'tipo' => 'texto'],
                // chave `recebido`, a MESMA do total: a tela só desenha na linha de totais a chave
                // que tem coluna — com `valor` aqui, o papel saía sem o total do mês
                ['chave' => 'recebido', 'rotulo' => 'Valor', 'tipo' => 'dinheiro'],
            ],
            linhas: $linhas,
            grupos: null,
            totais: $this->totais($consulta),
            truncado: $truncado,
            avisos: $avisos,
        );
    }

    /**
     * Totais por dimensão, somados NO BANCO em decimal: cada grupo é uma linha da tabela, com
     * quantos pagamentos e quanto entrou. O nulo vira "Sem profissional/convênio/serviço".
     *
     * @param  Builder<LancamentoCaixa>  $consulta
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     * @param  list<string>  $avisos
     */
    private function sintetico(Builder $consulta, string $dimensao, array $periodo, array $filtros, array $avisos): Envelope
    {
        // a expressão vem de um `match` fechado sobre `DIVISOES` (validado) — nunca do payload
        $expressao = match ($dimensao) {
            'profissional' => self::PROFISSIONAL_ATRIBUIDO,
            'convenio' => 'tratamentos.convenio_id',
            'servico' => 'tratamentos.servico_id',
        };

        $agregado = (clone $consulta)
            ->selectRaw("{$expressao} as chave, ".self::PAGAMENTOS.' as pagamentos, '
                .'COALESCE(SUM('.LancamentoCaixa::LIQUIDO_COM_SINAL_SQL.'), 0) as recebido')
            ->groupByRaw($expressao)
            ->get()
            ->map(fn ($linha): array => [
                'chave' => $linha->chave === null ? null : (int) $linha->chave,
                'pagamentos' => (int) $linha->pagamentos,
                'recebido' => bcadd((string) $linha->recebido, '0', 2),
            ]);

        $grupos = $this->gruposOrdenados($dimensao, $agregado)
            ->map(fn (array $grupo): array => [
                'titulo' => $grupo['titulo'],
                'linhas' => [],
                'totais' => ['pagamentos' => $grupo['pagamentos'], 'recebido' => $grupo['recebido']],
            ])
            ->values()->all();

        $filtros[] = ['rotulo' => 'Dividido por', 'valor' => self::ROTULO_DA_DIVISAO[$dimensao]];

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            // o RECEBIDO logo depois do nome: a 390 px a tabela passa ~20 px da tela e o que fica
            // atrás do véu de "role para o lado" é a última coluna — tem de ser a contagem, não o
            // dinheiro que a clínica veio conferir (conferido no celular em 2026-09-24)
            colunas: [
                ['chave' => 'grupo', 'rotulo' => self::ROTULO_DA_DIVISAO[$dimensao], 'tipo' => 'texto'],
                ['chave' => 'recebido', 'rotulo' => 'Recebido', 'tipo' => 'dinheiro'],
                ['chave' => 'pagamentos', 'rotulo' => 'Pagamentos', 'tipo' => 'numero'],
            ],
            linhas: [],
            grupos: $grupos,
            totais: $this->totais($consulta),
            avisos: $avisos,
        );
    }

    /**
     * Os totais do RECORTE inteiro (não das linhas carregadas, que o corte pode ter encurtado),
     * somados no banco.
     *
     * @param  Builder<LancamentoCaixa>  $consulta
     * @return array{pagamentos: int, recebido: string}
     */
    private function totais(Builder $consulta): array
    {
        $somas = (clone $consulta)
            ->selectRaw(self::PAGAMENTOS.' as pagamentos, COALESCE(SUM('.LancamentoCaixa::LIQUIDO_COM_SINAL_SQL.'), 0) as recebido')
            ->first();

        return [
            'pagamentos' => (int) $somas->pagamentos,
            'recebido' => bcadd((string) $somas->recebido, '0', 2),
        ];
    }

    /**
     * De onde veio o pagamento: a sessão faturada (com a data dela), o tratamento sem sessão
     * (o pacote pago) ou nada (avulso, lançado à mão sem vínculo).
     */
    private function origem(LancamentoCaixa $lancamento): string
    {
        if ($lancamento->agendamento_id !== null && $lancamento->sessao_inicio !== null) {
            return 'Sessão de '.substr((string) $lancamento->sessao_inicio, 8, 2).'/'.substr((string) $lancamento->sessao_inicio, 5, 2);
        }

        return $lancamento->tratamento_id !== null ? 'Pacote' : 'Avulso';
    }

    /**
     * @param  Collection<int, LancamentoCaixa>  $linhas
     * @return Collection<int, int>
     */
    private function ids(Collection $linhas, string $atributo): Collection
    {
        return $linhas->pluck($atributo)->filter(fn ($id) => $id !== null)->map(fn ($id): int => (int) $id)->unique()->values();
    }

    /**
     * Dá TÍTULO a cada grupo e o ordena pelo nome, com o "Sem …" por último — é o resto, não o
     * primeiro da lista. O serviço é "Procedimento (Convênio)", porque o serviço é a dupla.
     *
     * @param  Collection<int, array{chave: int|null, pagamentos: int, recebido: string}>  $agregado
     * @return Collection<int, array{titulo: string, chave: int|null, pagamentos: int, recebido: string}>
     */
    private function gruposOrdenados(string $dimensao, Collection $agregado): Collection
    {
        $chaves = $agregado->pluck('chave')->filter(fn ($chave) => $chave !== null)->unique()->values();

        $titulos = match ($dimensao) {
            'profissional' => Profissional::whereIn('id', $chaves)->pluck('nome', 'id'),
            'convenio' => Convenio::whereIn('id', $chaves)->pluck('nome', 'id'),
            'servico' => Servico::whereIn('id', $chaves)->with('convenio:id,nome')->get(['id', 'procedimento', 'convenio_id'])
                ->mapWithKeys(fn (Servico $s): array => [
                    $s->id => $s->convenio === null ? $s->procedimento : "{$s->procedimento} ({$s->convenio->nome})",
                ]),
        };

        $semValor = match ($dimensao) {
            'profissional' => 'Sem profissional',
            'convenio' => 'Sem convênio',
            'servico' => 'Sem serviço',
        };

        return $agregado
            ->map(fn (array $grupo): array => [
                ...$grupo,
                'titulo' => $grupo['chave'] === null ? $semValor : (string) ($titulos[$grupo['chave']] ?? $semValor),
            ])
            ->sortBy(fn (array $g) => ($g['chave'] === null ? "\u{FFFF}" : '').mb_strtolower($g['titulo']));
    }

    /**
     * Com UM profissional escolhido, o grupo "Sem profissional" fica de fora — e a faturista, que
     * fecha um profissional por vez, nunca o veria: fecharia o mês da Bia com o pacote pago sem
     * vínculo faltando, sem nada na tela apontando (CR-RPP-26). O aviso diz QUANTOS pagamentos do
     * período estão sem profissional — só a contagem, nunca o valor, que somado aos profissionais
     * refaria o total da clínica. Vai em `avisos` (não é filtro: a tela o desenha como o aviso de
     * corte, e ele não entra na frase do "nenhum registro" — CR-RPP-31), e portanto no papel.
     *
     * O escopo é o do relatório: para o escopado, "sem profissional" nunca é dele, e a contagem é 0.
     *
     * @param  array<string, mixed>  $parametros
     * @return list<string>
     */
    private function avisoDeSemProfissional(array $parametros, Escopo $escopo): array
    {
        if (! isset($parametros['profissional_id'])) {
            return []; // sem profissional escolhido, o grupo aparece na própria tabela
        }

        $semProfissional = $this->consultaBase(['de' => $parametros['de'], 'ate' => $parametros['ate']], $escopo)
            ->whereRaw(self::PROFISSIONAL_ATRIBUIDO.' IS NULL')
            ->count();

        if ($semProfissional === 0) {
            return [];
        }

        return [$semProfissional === 1
            ? '1 pagamento do período está sem profissional — vincule-o ao tratamento em Financeiro.'
            : "{$semProfissional} pagamentos do período estão sem profissional — vincule-os ao tratamento em Financeiro."];
    }

    /**
     * O que o papel imprime no cabeçalho: a BASE primeiro (sempre), depois os filtros usados
     * com o nome legível. Os ids já passaram por `exists`.
     *
     * @param  array<string, mixed>  $parametros
     * @return list<array{rotulo: string, valor: string}>
     */
    private function filtrosAplicados(array $parametros): array
    {
        $filtros = [['rotulo' => 'Base', 'valor' => self::BASE]];

        if (isset($parametros['profissional_id'])) {
            $filtros[] = ['rotulo' => 'Profissional', 'valor' => (string) Profissional::whereKey($parametros['profissional_id'])->value('nome')];
        }
        if (isset($parametros['convenio_id'])) {
            $filtros[] = ['rotulo' => 'Convênio', 'valor' => (string) Convenio::whereKey($parametros['convenio_id'])->value('nome')];
        }
        if (isset($parametros['servico_id'])) {
            $filtros[] = ['rotulo' => 'Serviço', 'valor' => (string) Servico::whereKey($parametros['servico_id'])->value('procedimento')];
        }

        return $filtros;
    }
}
