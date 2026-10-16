<?php

namespace App\Support\Relatorios;

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Paciente;
use App\Models\Tratamento;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\Escopo;
use App\Support\Rbac\EscopoDoProfissional;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Relatório `pacientes` (change `area-de-relatorios`): as crianças por SITUAÇÃO — ativas
 * (default), cadastradas no período, sem atendimento há N dias, aniversariantes do mês — e o
 * sintético por convênio. Cobre, no ClinicaÁgil, "Pacientes Cadastrados", "Pacientes Ativos" e
 * "Aniversariantes".
 *
 * WHITELIST ESTRITA (AP-09, base de MENORES): sai nome, convênio, situação — e, por situação, a
 * data do cadastro, o dia "dd/mm" com a idade que fará, ou a data do último atendimento. Nada
 * mais do cadastro atravessa; o `RelatoriosContratoTest` varre. **A data de nascimento não sai
 * como campo, mas em "aniversariantes" ela é RECONSTRUÍVEL** (dia + idade que fará + o mês do
 * filtro) — dito por inteiro no transform, com o gatilho de produto que decide o que fazer.
 *
 * Eixo AGENDA (D11 — ver `eixo()`): o escopado vê só as crianças "dele" — `EXISTS` em agendamentos ∪
 * tratamentos com o seu `profissional_id`, o MESMO predicado da seleção de pacientes
 * (`EscopoDoProfissional::restringirAosPacientesDoEscopo`); sem vínculo, vazio (fail-closed).
 *
 * O período é CONDICIONAL (`usaPeriodo()` falso): só `cadastrados_no_periodo` exige `de`/`ate`,
 * com o mesmo teto de 366 dias (T-not-14) — validado aqui, porque o controller só o aplica a
 * quem declara período. "Realizado" (para "sem atendimento") é o helper canônico
 * `SituacaoDoAgendamento::realizados` — desconta a sessão E não marca falta —, pelas FLAGS do
 * status e nunca pelo nome (§13).
 *
 * O convênio da criança é o do seu tratamento MAIS RECENTE — pelo vínculo de tratamento, como o
 * painel conta; sem tratamento, "Sem convênio" (entra na soma, nunca some). Um convênio por
 * criança de propósito: o sintético PARTICIONA a lista, e a soma dos grupos é a contagem do
 * analítico.
 */
final class Pacientes implements Relatorio
{
    /** @var list<string> */
    public const SITUACOES = ['ativos', 'cadastrados_no_periodo', 'sem_atendimento', 'aniversariantes'];

    /** @var list<string> */
    public const RESULTADOS = ['analitico', 'sintetico'];

    /** @var list<string> */
    public const DIVISOES = ['convenio'];

    public const DIAS_PADRAO = 60;

    /** O teto do período (T-not-14) — o do controller, que só o aplica a quem declara período. */
    private const JANELA_MAXIMA_DIAS = 366;

    private const ROTULO_DA_SITUACAO = [
        'ativos' => 'Ativos',
        'cadastrados_no_periodo' => 'Cadastrados no período',
        'sem_atendimento' => 'Sem atendimento',
        'aniversariantes' => 'Aniversariantes do mês',
    ];

    public function __construct(
        private readonly EscopoDoProfissional $escopos,
        private readonly ConfiguracaoService $configuracoes,
        private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS,
    ) {}

    public function slug(): string
    {
        return 'pacientes';
    }

    public function titulo(): string
    {
        return 'Pacientes';
    }

    public function permissoes(): array
    {
        return ['pacientes.ver'];
    }

    /**
     * Eixo AGENDA (D11) — o mesmo de `SessoesDosTratamentos`, e pelo mesmo motivo
     * (`SEC-REL-01`/`CRR-01`): §12 põe pacote e criança no alcance OPERACIONAL do eixo agenda,
     * e é por ele que as portas donas deste dado escopam. Com `clinico`, Secretaria e Faturista
     * (`agenda.ver_todos`, sem `clinico.ver_todos`, sem vínculo — AP-10) recebiam folha em
     * branco, e quem tem só `clinico.ver_todos` saía plano aqui e escopado na porta antiga.
     * Amarrado, papel a papel, por `RelatoriosEixoDoEscopoTest`.
     */
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
        return false;
    }

    public function regras(): array
    {
        return [
            'situacao' => ['sometimes', Rule::in(self::SITUACOES)],
            // o período só existe para "cadastrados no período" — `required_if` é implícita e
            // roda mesmo com o campo ausente; o teto de 366 dias é conferido em `executar`
            'de' => ['required_if:situacao,cadastrados_no_periodo', 'date_format:Y-m-d'],
            'ate' => ['required_if:situacao,cadastrados_no_periodo', 'date_format:Y-m-d', 'after_or_equal:de'],
            'dias' => ['sometimes', 'integer', 'min:1', 'max:365'],
            'mes' => ['required_if:situacao,aniversariantes', 'date_format:Y-m'],
            'resultado' => ['sometimes', Rule::in(self::RESULTADOS)],
            'dividir_por' => ['required_if:resultado,sintetico', Rule::in(self::DIVISOES)],
        ];
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        $situacao = $parametros['situacao'] ?? 'ativos';
        $fuso = (string) $this->configuracoes->get('clinica.timezone');

        if ($situacao === 'cadastrados_no_periodo') {
            $this->assegurarJanela($parametros['de'], $parametros['ate']);
        }

        $consulta = $this->consultaBase($situacao, $parametros, $escopo, $fuso);
        $periodo = $situacao === 'cadastrados_no_periodo' ? ['de' => $parametros['de'], 'ate' => $parametros['ate']] : null;
        $filtros = $this->filtrosAplicados($situacao, $parametros);

        if (($parametros['resultado'] ?? 'analitico') === 'sintetico') {
            return $this->sintetico($consulta, $periodo, $filtros);
        }

        return $this->analitico($consulta, $situacao, $parametros, $periodo, $filtros, $fuso);
    }

    /**
     * O recorte por situação, com o escopo NA MESMA query (interseção por construção).
     *
     * @param  array<string, mixed>  $parametros
     * @return Builder<Paciente>
     */
    private function consultaBase(string $situacao, array $parametros, Escopo $escopo, string $fuso): Builder
    {
        $consulta = Paciente::query();

        match ($situacao) {
            'ativos' => $consulta->where('pacientes.ativo', true),
            // `created_at` é UTC; o dia pedido é na parede da clínica
            'cadastrados_no_periodo' => $consulta->whereBetween('pacientes.created_at', [
                Carbon::parse("{$parametros['de']} 00:00:00", $fuso)->utc()->format('Y-m-d H:i:s'),
                Carbon::parse("{$parametros['ate']} 23:59:59", $fuso)->utc()->format('Y-m-d H:i:s'),
            ]),
            // ativa e SEM agendamento realizado (desconta a sessão e NÃO é falta) desde N dias atrás
            'sem_atendimento' => $consulta->where('pacientes.ativo', true)
                ->whereDoesntHave('agendamentos', fn (Builder $a) => $this->realizados($a)
                    ->where('agendamentos.inicio', '>=', now($fuso)->subDays($this->dias($parametros))->toDateString().' 00:00:00')),
            'aniversariantes' => $consulta->where('pacientes.ativo', true)
                ->whereMonth('pacientes.nascimento', (int) substr($parametros['mes'], 5, 2)),
        };

        return $this->escopos->restringirAosPacientesDoEscopo($escopo, $consulta);
    }

    /**
     * @param  Builder<Paciente>  $consulta
     * @param  array<string, mixed>  $parametros
     * @param  array{de: string, ate: string}|null  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function analitico(Builder $consulta, string $situacao, array $parametros, ?array $periodo, array $filtros, string $fuso): Envelope
    {
        // colunas NOMEADAS, nunca `pacientes.*`: o cadastro do menor não entra nem na memória
        $brutas = (clone $consulta)
            ->select(['pacientes.id', 'pacientes.nome', 'pacientes.ativo', 'pacientes.nascimento', 'pacientes.created_at'])
            ->addSelect(['convenio_id_do_tratamento' => $this->convenioDoTratamento()])
            ->when($situacao === 'sem_atendimento', fn (Builder $q) => $q
                ->addSelect(['ultimo_atendimento' => $this->realizados(Agendamento::query())
                    ->selectRaw('MAX(agendamentos.inicio)')
                    ->whereColumn('agendamentos.paciente_id', 'pacientes.id')]))
            ->when($situacao === 'aniversariantes', fn (Builder $q) => $q->orderByRaw('DAY(pacientes.nascimento)'))
            ->orderBy('pacientes.nome')
            ->orderBy('pacientes.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;
        $quantidade = $truncado ? (clone $consulta)->count() : $brutas->count();

        $nomesDeConvenio = Convenio::whereIn('id', $brutas->pluck('convenio_id_do_tratamento')->filter()->unique())->pluck('nome', 'id');
        $anoDoMes = $situacao === 'aniversariantes' ? (int) substr($parametros['mes'], 0, 4) : null;

        // whitelist explícita no transform (lição WHITELIST-do-menor): nunca toArray() do model
        $linhas = $brutas->take($this->limiteDeLinhas)->map(function (Paciente $p) use ($situacao, $nomesDeConvenio, $anoDoMes, $fuso): array {
            $linha = [
                'paciente' => $p->nome,
                'convenio' => $p->convenio_id_do_tratamento === null ? 'Sem convênio' : (string) ($nomesDeConvenio[$p->convenio_id_do_tratamento] ?? 'Sem convênio'),
                'situacao' => $p->ativo ? 'Ativo' : 'Inativo',
            ];

            return match ($situacao) {
                'cadastrados_no_periodo' => [...$linha, 'cadastro' => $p->created_at->copy()->timezone($fuso)->format('Y-m-d')],
                // A data de nascimento não sai como CAMPO — mas sai RECONSTRUÍVEL, e o
                // comentário anterior dizia o contrário (`CRR-17`): `dia` é "dd/mm",
                // `idade_que_fara` dá o ano (ano do mês pedido − idade) e o `mes` é o do filtro.
                // Quem lê a linha tem a data inteira. Fica assim porque é o que o papel de
                // aniversariantes precisa mostrar; a alternativa (faixa etária) é decisão de
                // PRODUTO, registrada em `GATILHOS.md` como `ANIVERSARIANTES-RECONSTROEM-NASCIMENTO`.
                'aniversariantes' => [
                    ...$linha,
                    'dia' => $p->nascimento->format('d/m'),
                    'idade_que_fara' => $anoDoMes - (int) $p->nascimento->format('Y'),
                ],
                'sem_atendimento' => [
                    ...$linha,
                    'ultimo_atendimento' => $p->ultimo_atendimento === null ? '—' : substr((string) $p->ultimo_atendimento, 0, 10),
                ],
                default => $linha,
            };
        })->values()->all();

        $colunas = [
            ['chave' => 'paciente', 'rotulo' => 'Paciente', 'tipo' => 'texto'],
            ['chave' => 'convenio', 'rotulo' => 'Convênio', 'tipo' => 'texto'],
            ['chave' => 'situacao', 'rotulo' => 'Situação', 'tipo' => 'texto'],
            ...match ($situacao) {
                'cadastrados_no_periodo' => [['chave' => 'cadastro', 'rotulo' => 'Cadastro', 'tipo' => 'data']],
                'aniversariantes' => [
                    ['chave' => 'dia', 'rotulo' => 'Dia', 'tipo' => 'texto'],
                    ['chave' => 'idade_que_fara', 'rotulo' => 'Idade que fará', 'tipo' => 'numero'],
                ],
                'sem_atendimento' => [['chave' => 'ultimo_atendimento', 'rotulo' => 'Último atendimento', 'tipo' => 'data']],
                default => [],
            },
        ];

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            colunas: $colunas,
            linhas: $linhas,
            grupos: null,
            totais: ['quantidade' => $quantidade],
            truncado: $truncado,
        );
    }

    /**
     * Crianças por convênio, contadas NO BANCO (lição CR-04) sobre o mesmo recorte: cada
     * criança num grupo só (o do tratamento mais recente), "Sem convênio" por último.
     *
     * @param  Builder<Paciente>  $consulta
     * @param  array{de: string, ate: string}|null  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function sintetico(Builder $consulta, ?array $periodo, array $filtros): Envelope
    {
        $recorte = (clone $consulta)
            ->select('pacientes.id')
            ->addSelect(['chave' => $this->convenioDoTratamento()]);

        $agregado = DB::query()
            ->fromSub($recorte, 'recorte')
            ->selectRaw('chave, COUNT(*) as quantidade')
            ->groupBy('chave')
            ->get()
            ->map(fn ($linha): array => ['chave' => $linha->chave, 'quantidade' => (int) $linha->quantidade]);

        $nomes = Convenio::whereIn('id', $agregado->pluck('chave')->filter()->unique())->pluck('nome', 'id');

        $grupos = $agregado
            ->map(fn (array $grupo): array => [
                'chave' => $grupo['chave'],
                'titulo' => $grupo['chave'] === null ? 'Sem convênio' : (string) ($nomes[$grupo['chave']] ?? 'Sem convênio'),
                'quantidade' => $grupo['quantidade'],
            ])
            // pelo nome, com o "Sem convênio" por último — é o resto, não o primeiro da lista
            ->sortBy(fn (array $g) => ($g['chave'] === null ? "\u{FFFF}" : '').mb_strtolower($g['titulo']))
            ->map(fn (array $g): array => ['titulo' => $g['titulo'], 'linhas' => [], 'totais' => ['quantidade' => $g['quantidade']]])
            ->values()->all();

        $filtros[] = ['rotulo' => 'Dividido por', 'valor' => 'Convênio'];

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            colunas: [
                ['chave' => 'grupo', 'rotulo' => 'Convênio', 'tipo' => 'texto'],
                ['chave' => 'quantidade', 'rotulo' => 'Pacientes', 'tipo' => 'numero'],
            ],
            linhas: [],
            grupos: $grupos,
            totais: ['quantidade' => (int) $agregado->sum('quantidade')],
        );
    }

    /**
     * O convênio do tratamento MAIS RECENTE da criança (subconsulta correlacionada).
     *
     * @return Builder<Tratamento>
     */
    private function convenioDoTratamento(): Builder
    {
        return Tratamento::query()
            ->select('tratamentos.convenio_id')
            ->whereColumn('tratamentos.paciente_id', 'pacientes.id')
            ->orderByDesc('tratamentos.id')
            ->limit(1);
    }

    /**
     * Agendamentos de atendimento REALIZADOS — pelo helper canônico desta change
     * (`SituacaoDoAgendamento::realizados`): desconta a sessão E não marca falta.
     *
     * Filtrar só por `desconta_sessao` era o defeito `CRR-02`: o status padrão "Não Compareceu"
     * carrega as DUAS flags (a clínica cobra a sessão perdida), então a criança cujo único
     * registro recente é falta cobrada SUMIA de "sem atendimento há N dias" — a lista existe
     * justamente para achá-la.
     *
     * @param  Builder<Agendamento>  $consulta
     * @return Builder<Agendamento>
     */
    private function realizados(Builder $consulta): Builder
    {
        return SituacaoDoAgendamento::realizados($consulta->where('agendamentos.tipo', 'atendimento'));
    }

    /** @param array<string, mixed> $parametros */
    private function dias(array $parametros): int
    {
        return (int) ($parametros['dias'] ?? self::DIAS_PADRAO);
    }

    /**
     * Teto de 366 dias (T-not-14) — 422 no mesmo formato do validador, como o controller faz,
     * e com a MESMA contagem INCLUSIVA dele (`CRR-15`): 366 dias com as duas pontas passam,
     * 367 recusam. Divergir do controller aqui seria o teto valendo dois números diferentes
     * dentro do mesmo relatório.
     */
    private function assegurarJanela(string $de, string $ate): void
    {
        $inicio = Carbon::createFromFormat('Y-m-d', $de);
        $fim = Carbon::createFromFormat('Y-m-d', $ate);
        if ((int) $inicio->diffInDays($fim) + 1 > self::JANELA_MAXIMA_DIAS) {
            throw ValidationException::withMessages([
                'ate' => ['Janela máxima de '.self::JANELA_MAXIMA_DIAS.' dias.'],
            ]);
        }
    }

    /**
     * @param  array<string, mixed>  $parametros
     * @return list<array{rotulo: string, valor: string}>
     */
    private function filtrosAplicados(string $situacao, array $parametros): array
    {
        $filtros = [['rotulo' => 'Situação', 'valor' => self::ROTULO_DA_SITUACAO[$situacao]]];

        if ($situacao === 'sem_atendimento') {
            $filtros[] = ['rotulo' => 'Sem atendimento há', 'valor' => $this->dias($parametros).' dias'];
        }
        if ($situacao === 'aniversariantes') {
            $filtros[] = ['rotulo' => 'Mês', 'valor' => substr($parametros['mes'], 5, 2).'/'.substr($parametros['mes'], 0, 4)];
        }

        return $filtros;
    }
}
