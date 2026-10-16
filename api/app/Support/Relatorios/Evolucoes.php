<?php

namespace App\Support\Relatorios;

use App\Models\Agendamento;
use App\Models\Profissional;
use App\Support\Rbac\Escopo;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Relatório `evolucoes` (change `area-de-relatorios`, task 2.3): os atendimentos REALIZADOS
 * do período com a situação da evolução — preenchida ou pendente —, linha a linha (analítico)
 * ou por profissional com totais e o percentual preenchido (sintético). Cobre, no ClinicaÁgil,
 * "Evoluções", "Evoluções Preenchidas" e "Evoluções Não Preenchidas".
 *
 * O universo é o mesmo do relatório `atendimentos` (`SituacaoDoAgendamento::realizados`:
 * desconta a sessão e não é falta — pelas FLAGS, nunca pelo nome). Pendente é o realizado
 * sem evolução, incluindo o que nem tem registro clínico (sem `atendimentos`).
 *
 * O filtro `situacao` escolhe QUAIS LINHAS saem no analítico; os `totais` são sempre a
 * FOTO INTEIRA do recorte (realizados · preenchidas · pendentes · percentual) — quem imprime
 * "as pendentes" quer ver "2 de 8, 75% preenchido" no rodapé, não "0 de 2, 0%". Pela mesma
 * razão o sintético, que não tem linhas, não aplica `situacao`: ele JÁ é a separação.
 * O percentual é inteiro 0..100, calculado AQUI (a tela não faz aritmética).
 *
 * É de CONFERÊNCIA (AP-09): sai com o nome da criança — só o nome; o `conteudo` da evolução
 * (cifrado, dado clínico do menor) nunca é lido. Exige `evolucoes.ver` E `atendimentos.ver`
 * (TODAS — o controller nega faltando qualquer uma), no eixo CLÍNICO (D11): o escopado vê só
 * os próprios; sem vínculo e sem `clinico.ver_todos`, vazio (fail-closed pelo `Escopo`).
 */
final class Evolucoes implements Relatorio
{
    /** @var list<string> */
    public const RESULTADOS = ['analitico', 'sintetico'];

    /** @var list<string> */
    public const SITUACOES = ['todas', 'preenchida', 'pendente'];

    private const ROTULO_DA_SITUACAO = [
        'preenchida' => 'Preenchidas',
        'pendente' => 'Pendentes',
    ];

    /** O corte do analítico é injetável (teste) e por padrão o teto comum do envelope. */
    public function __construct(private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS) {}

    public function slug(): string
    {
        return 'evolucoes';
    }

    public function titulo(): string
    {
        return 'Evoluções';
    }

    public function permissoes(): array
    {
        return ['evolucoes.ver', 'atendimentos.ver'];
    }

    public function eixo(): ?string
    {
        return 'clinico';
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
        // id de filtro existe na base (id inexistente → 422)
        return [
            'resultado' => ['sometimes', Rule::in(self::RESULTADOS)],
            // o sintético é SEMPRE por profissional: o web declara a divisão e a manda; aqui ela
            // é aceita (e só ela) para o link do catálogo não cair em 422
            'dividir_por' => ['sometimes', Rule::in(['profissional'])],
            'situacao' => ['sometimes', Rule::in(self::SITUACOES)],
            'profissional_id' => ['sometimes', 'integer', Rule::exists('profissionais', 'id')],
        ];
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        $consulta = $this->consultaBase($parametros, $escopo);
        $periodo = ['de' => $parametros['de'], 'ate' => $parametros['ate']];
        $filtros = $this->filtrosAplicados($parametros);

        if (($parametros['resultado'] ?? 'analitico') === 'sintetico') {
            return $this->sintetico($consulta, $periodo, $filtros);
        }

        return $this->analitico($consulta, $parametros['situacao'] ?? 'todas', $periodo, $filtros);
    }

    /**
     * O recorte comum: atendimentos REALIZADOS do período, filtro de profissional em AND com o
     * escopo NA MESMA query. Colunas qualificadas porque o analítico faz join.
     *
     * @param  array<string, mixed>  $parametros
     * @return Builder<Agendamento>
     */
    private function consultaBase(array $parametros, Escopo $escopo): Builder
    {
        $consulta = Agendamento::query()
            ->where('agendamentos.tipo', 'atendimento')
            ->whereBetween('agendamentos.inicio', ["{$parametros['de']} 00:00:00", "{$parametros['ate']} 23:59:59"])
            ->when($parametros['profissional_id'] ?? null, fn (Builder $q, $id) => $q->where('agendamentos.profissional_id', $id));

        return $escopo->aplicar(SituacaoDoAgendamento::realizados($consulta), 'agendamentos.profissional_id');
    }

    /**
     * @param  Builder<Agendamento>  $consulta
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function analitico(Builder $consulta, string $situacao, array $periodo, array $filtros): Envelope
    {
        // `situacao` recorta as LINHAS; os totais (abaixo) ficam com a foto inteira
        $linhasDoRecorte = (clone $consulta)
            ->when($situacao === 'preenchida', fn (Builder $q) => $q->whereHas('atendimento.evolucao'))
            ->when($situacao === 'pendente', fn (Builder $q) => $q->whereDoesntHave('atendimento.evolucao'));

        // ordem: data, hora, profissional (pelo NOME — daí o join) e id como desempate estável.
        // `agendamentos.*` para o join não
        // sobrescrever coluna do model; a evolução entra só por id/atendimento_id.
        $brutas = $linhasDoRecorte
            ->join('profissionais', fn (JoinClause $join) => $join
                ->on('profissionais.id', '=', 'agendamentos.profissional_id'))
            ->select('agendamentos.*')
            ->with([
                'paciente:id,nome',
                'profissional:id,nome',
                'especialidade:id,nome',
                'atendimento:id,agendamento_id',
                'atendimento.evolucao:id,atendimento_id',
            ])
            ->orderBy('agendamentos.inicio')
            ->orderBy('profissionais.nome')
            ->orderBy('agendamentos.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;
        $porProfissional = $this->porProfissional($consulta);

        // whitelist explícita no transform (lição WHITELIST-do-menor): nunca toArray() do model
        $linhas = $brutas->take($this->limiteDeLinhas)->map(fn (Agendamento $a): array => [
            'data' => $a->inicio->format('Y-m-d'),
            'hora' => $a->inicio->format('H:i'),
            'paciente' => $a->paciente?->nome,
            'profissional' => $a->profissional?->nome,
            'especialidade' => $a->especialidade?->nome ?? 'Sem especialidade',
            'evolucao' => $a->atendimento?->evolucao !== null ? 'Preenchida' : 'Pendente',
        ])->values()->all();

        if ($situacao !== 'todas') {
            $filtros[] = ['rotulo' => 'Situação', 'valor' => self::ROTULO_DA_SITUACAO[$situacao]];
        }

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            colunas: [
                ['chave' => 'data', 'rotulo' => 'Data', 'tipo' => 'data'],
                ['chave' => 'hora', 'rotulo' => 'Hora', 'tipo' => 'hora'],
                ['chave' => 'paciente', 'rotulo' => 'Paciente', 'tipo' => 'texto'],
                ['chave' => 'profissional', 'rotulo' => 'Profissional', 'tipo' => 'texto'],
                ['chave' => 'especialidade', 'rotulo' => 'Especialidade', 'tipo' => 'texto'],
                ['chave' => 'evolucao', 'rotulo' => 'Evolução', 'tipo' => 'texto'],
            ],
            linhas: $linhas,
            grupos: null,
            // UMA agregação, não duas (`CRR-14`): `porProfissional()` é ida ao banco, e chamá-la
            // duas vezes na mesma expressão fazia 4 consultas onde bastam 2
            totais: self::totais((int) $porProfissional->sum('realizados'), (int) $porProfissional->sum('preenchidas')),
            truncado: $truncado,
        );
    }

    /**
     * Um grupo por profissional (ordem pelo nome), cada um com realizados · preenchidas ·
     * pendentes · percentual; profissional sem realizado no recorte não aparece. Somado NO
     * BANCO (lição CR-04); os totais gerais são as somas, e o percentual sobre as somas —
     * nunca média de percentuais.
     *
     * @param  Builder<Agendamento>  $consulta
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function sintetico(Builder $consulta, array $periodo, array $filtros): Envelope
    {
        $agregado = $this->porProfissional($consulta);
        $nomes = Profissional::whereIn('id', $agregado->keys())->pluck('nome', 'id');

        $grupos = $agregado
            ->map(fn (array $conta, int $profissionalId): array => [
                'titulo' => (string) ($nomes[$profissionalId] ?? 'Sem profissional'),
                'linhas' => [],
                'totais' => self::totais($conta['realizados'], $conta['preenchidas']),
            ])
            ->sortBy(fn (array $grupo) => mb_strtolower($grupo['titulo']))
            ->values()->all();

        $filtros[] = ['rotulo' => 'Dividido por', 'valor' => 'Profissional'];

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            colunas: [
                ['chave' => 'grupo', 'rotulo' => 'Profissional', 'tipo' => 'texto'],
                ['chave' => 'realizados', 'rotulo' => 'Realizados', 'tipo' => 'numero'],
                ['chave' => 'preenchidas', 'rotulo' => 'Preenchidas', 'tipo' => 'numero'],
                ['chave' => 'pendentes', 'rotulo' => 'Pendentes', 'tipo' => 'numero'],
                ['chave' => 'percentual', 'rotulo' => '% preenchido', 'tipo' => 'percentual'],
            ],
            linhas: [],
            grupos: $grupos,
            totais: self::totais($agregado->sum('realizados'), $agregado->sum('preenchidas')),
        );
    }

    /**
     * Realizados e preenchidas por profissional, em duas agregações sobre o MESMO recorte
     * (a segunda é o subconjunto com evolução — `whereHas`, sem join).
     *
     * @param  Builder<Agendamento>  $consulta
     * @return Collection<int, array{realizados: int, preenchidas: int}> profissional_id → contagens
     */
    private function porProfissional(Builder $consulta): Collection
    {
        $realizados = (clone $consulta)
            ->groupBy('agendamentos.profissional_id')
            ->selectRaw('agendamentos.profissional_id as profissional_id, COUNT(*) as total')
            ->pluck('total', 'profissional_id');

        $preenchidas = (clone $consulta)
            ->whereHas('atendimento.evolucao')
            ->groupBy('agendamentos.profissional_id')
            ->selectRaw('agendamentos.profissional_id as profissional_id, COUNT(*) as total')
            ->pluck('total', 'profissional_id');

        return $realizados->mapWithKeys(fn ($total, $profissionalId): array => [
            (int) $profissionalId => [
                'realizados' => (int) $total,
                'preenchidas' => (int) ($preenchidas[$profissionalId] ?? 0),
            ],
        ]);
    }

    /**
     * As quatro chaves numéricas do contrato; percentual inteiro 0..100 de preenchidas sobre
     * realizados, e 0 quando não há o que medir.
     *
     * @return array{realizados: int, preenchidas: int, pendentes: int, percentual: int}
     */
    private static function totais(int $realizados, int $preenchidas): array
    {
        return [
            'realizados' => $realizados,
            'preenchidas' => $preenchidas,
            'pendentes' => $realizados - $preenchidas,
            'percentual' => $realizados > 0 ? (int) min(100, round($preenchidas * 100 / $realizados)) : 0,
        ];
    }

    /**
     * O filtro de profissional com o NOME legível — o cabeçalho impresso. O id já passou por
     * `exists`. `situacao` entra só no analítico, onde é aplicado.
     *
     * @param  array<string, mixed>  $parametros
     * @return list<array{rotulo: string, valor: string}>
     */
    private function filtrosAplicados(array $parametros): array
    {
        if (! isset($parametros['profissional_id'])) {
            return [];
        }

        return [['rotulo' => 'Profissional', 'valor' => (string) Profissional::whereKey($parametros['profissional_id'])->value('nome')]];
    }
}
