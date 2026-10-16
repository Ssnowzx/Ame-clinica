<?php

namespace App\Support\Relatorios;

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Profissional;
use App\Support\Rbac\Escopo;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Relatório `atendimentos` (change `area-de-relatorios`, task 2.1): os atendimentos
 * REALIZADOS do período — analítico (linha a linha, com se há evolução) ou sintético (totais
 * divididos por profissional · convênio · especialidade · mês). Cobre, no ClinicaÁgil,
 * "Atendimentos", "Atendimentos por Mês" e "Pacientes Atendidos" (crianças distintas nos totais).
 *
 * Realizado é pelas FLAGS do status (`SituacaoDoAgendamento::realizados`): desconta a sessão
 * e não é falta — nunca pelo nome. O período é pelo `inicio` do agendamento (o dia da sessão).
 *
 * É de CONFERÊNCIA (AP-09): sai com o nome da criança — só o nome. Sob `atendimentos.ver`,
 * no eixo CLÍNICO (D11): o escopado vê só os próprios; sem vínculo e sem `clinico.ver_todos`,
 * vazio (fail-closed pelo `Escopo`). O convênio vem do TRATAMENTO do agendamento (o mesmo
 * caminho do relatório `agendamentos`); sem pacote é "Sem convênio", nunca some da soma.
 */
final class Atendimentos implements Relatorio
{
    /** @var list<string> */
    public const RESULTADOS = ['analitico', 'sintetico'];

    /** @var list<string> */
    public const DIVISOES = ['profissional', 'convenio', 'especialidade', 'mes'];

    private const ROTULO_DA_DIVISAO = [
        'profissional' => 'Profissional',
        'convenio' => 'Convênio',
        'especialidade' => 'Especialidade',
        'mes' => 'Mês',
    ];

    /** O corte do analítico é injetável (teste) e por padrão o teto comum do envelope. */
    public function __construct(private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS) {}

    public function slug(): string
    {
        return 'atendimentos';
    }

    public function titulo(): string
    {
        return 'Atendimentos';
    }

    public function permissoes(): array
    {
        return ['atendimentos.ver'];
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
        // ids de filtro existem na base (id inexistente → 422)
        return [
            'resultado' => ['sometimes', Rule::in(self::RESULTADOS)],
            'dividir_por' => ['required_if:resultado,sintetico', Rule::in(self::DIVISOES)],
            'profissional_id' => ['sometimes', 'integer', Rule::exists('profissionais', 'id')],
            'convenio_id' => ['sometimes', 'integer', Rule::exists('convenios', 'id')],
            'especialidade_id' => ['sometimes', 'integer', Rule::exists('especialidades', 'id')],
        ];
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        $consulta = $this->consultaBase($parametros, $escopo);
        $periodo = ['de' => $parametros['de'], 'ate' => $parametros['ate']];
        $filtros = $this->filtrosAplicados($parametros);

        if (($parametros['resultado'] ?? 'analitico') === 'sintetico') {
            return $this->sintetico($consulta, $parametros['dividir_por'], $periodo, $filtros);
        }

        return $this->analitico($consulta, $periodo, $filtros);
    }

    /**
     * O recorte comum: atendimentos REALIZADOS do período, filtros em AND com o escopo NA
     * MESMA query (interseção por construção). Colunas qualificadas porque o analítico faz join.
     *
     * @param  array<string, mixed>  $parametros
     * @return Builder<Agendamento>
     */
    private function consultaBase(array $parametros, Escopo $escopo): Builder
    {
        $consulta = Agendamento::query()
            ->where('agendamentos.tipo', 'atendimento')
            ->whereBetween('agendamentos.inicio', ["{$parametros['de']} 00:00:00", "{$parametros['ate']} 23:59:59"])
            ->when($parametros['profissional_id'] ?? null, fn (Builder $q, $id) => $q->where('agendamentos.profissional_id', $id))
            ->when($parametros['especialidade_id'] ?? null, fn (Builder $q, $id) => $q->where('agendamentos.especialidade_id', $id))
            ->when($parametros['convenio_id'] ?? null, fn (Builder $q, $id) => $q
                ->whereHas('tratamento', fn (Builder $t) => $t->where('convenio_id', $id)));

        return $escopo->aplicar(SituacaoDoAgendamento::realizados($consulta), 'agendamentos.profissional_id');
    }

    /**
     * @param  Builder<Agendamento>  $consulta
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function analitico(Builder $consulta, array $periodo, array $filtros): Envelope
    {
        // ordem: data, hora, profissional (pelo NOME — daí o join) e id como desempate estável.
        // `agendamentos.*` no select para o join não sobrescrever coluna do model. A evolução
        // entra só por id/atendimento_id — o `conteudo` (cifrado, dado clínico do menor) nunca é lido aqui.
        $brutas = (clone $consulta)
            ->join('profissionais', fn (JoinClause $join) => $join
                ->on('profissionais.id', '=', 'agendamentos.profissional_id'))
            ->select('agendamentos.*')
            ->with([
                'paciente:id,nome',
                'profissional:id,nome',
                'especialidade:id,nome',
                'tratamento:id,convenio_id',
                'tratamento.convenio:id,nome',
                'atendimento:id,agendamento_id',
                'atendimento.evolucao:id,atendimento_id',
            ])
            ->orderBy('agendamentos.inicio')
            ->orderBy('profissionais.nome')
            ->orderBy('agendamentos.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;
        // com corte, o total é o do RECORTE inteiro (uma contagem a mais só nesse caso)
        $quantidade = $truncado ? (clone $consulta)->count() : $brutas->count();

        // whitelist explícita no transform (lição WHITELIST-do-menor): nunca toArray() do model
        $linhas = $brutas->take($this->limiteDeLinhas)->map(fn (Agendamento $a): array => [
            'data' => $a->inicio->format('Y-m-d'),
            'hora' => $a->inicio->format('H:i'),
            'paciente' => $a->paciente?->nome,
            'profissional' => $a->profissional?->nome,
            'especialidade' => $a->especialidade?->nome ?? 'Sem especialidade',
            'convenio' => $a->tratamento?->convenio?->nome ?? 'Sem convênio',
            'evolucao' => $a->atendimento?->evolucao !== null ? 'Preenchida' : 'Pendente',
        ])->values()->all();

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
                ['chave' => 'convenio', 'rotulo' => 'Convênio', 'tipo' => 'texto'],
                ['chave' => 'evolucao', 'rotulo' => 'Evolução', 'tipo' => 'texto'],
            ],
            linhas: $linhas,
            grupos: null,
            totais: [
                'quantidade' => $quantidade,
                'criancas_distintas' => $this->criancasDistintas($consulta),
            ],
            truncado: $truncado,
        );
    }

    /**
     * Totais por dimensão, somados NO BANCO (lição CR-04): um grupo por valor da dimensão,
     * cada um com a quantidade e as crianças distintas. Grupo é a LINHA da tabela sintética.
     * As crianças distintas GERAIS são do recorte inteiro — a mesma criança em dois grupos
     * conta uma vez —, por isso não é a soma dos grupos.
     *
     * @param  Builder<Agendamento>  $consulta
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function sintetico(Builder $consulta, string $dimensao, array $periodo, array $filtros): Envelope
    {
        // a expressão vem de um `match` fechado sobre `DIVISOES` (validado) — nunca do payload
        $expressao = match ($dimensao) {
            'profissional' => 'agendamentos.profissional_id',
            'especialidade' => 'agendamentos.especialidade_id',
            'convenio' => 'tratamentos.convenio_id',
            'mes' => "DATE_FORMAT(agendamentos.inicio, '%Y-%m')",
        };

        $agregado = (clone $consulta)
            ->when($dimensao === 'convenio', fn (Builder $q) => $q
                ->leftJoin('tratamentos', fn (JoinClause $join) => $join
                    ->on('tratamentos.id', '=', 'agendamentos.tratamento_id')))
            ->selectRaw("{$expressao} as chave, COUNT(*) as quantidade, COUNT(DISTINCT agendamentos.paciente_id) as criancas_distintas")
            ->groupByRaw($expressao)
            ->get()
            ->map(fn ($linha): array => [
                'chave' => $linha->chave,
                'quantidade' => (int) $linha->quantidade,
                'criancas_distintas' => (int) $linha->criancas_distintas,
            ]);

        $grupos = $this->gruposOrdenados($dimensao, $agregado)
            ->map(fn (array $grupo): array => [
                'titulo' => $grupo['titulo'],
                'linhas' => [],
                'totais' => ['quantidade' => $grupo['quantidade'], 'criancas_distintas' => $grupo['criancas_distintas']],
            ])
            ->values()->all();

        $filtros[] = ['rotulo' => 'Dividido por', 'valor' => self::ROTULO_DA_DIVISAO[$dimensao]];

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            colunas: [
                ['chave' => 'grupo', 'rotulo' => self::ROTULO_DA_DIVISAO[$dimensao], 'tipo' => 'texto'],
                ['chave' => 'quantidade', 'rotulo' => 'Atendimentos', 'tipo' => 'numero'],
                ['chave' => 'criancas_distintas', 'rotulo' => 'Crianças distintas', 'tipo' => 'numero'],
            ],
            linhas: [],
            grupos: $grupos,
            totais: [
                'quantidade' => (int) $agregado->sum('quantidade'),
                'criancas_distintas' => $this->criancasDistintas($consulta),
            ],
        );
    }

    /**
     * As crianças distintas do RECORTE inteiro ("pacientes atendidos"), contadas no banco.
     *
     * @param  Builder<Agendamento>  $consulta
     */
    private function criancasDistintas(Builder $consulta): int
    {
        return (int) (clone $consulta)->distinct()->count('agendamentos.paciente_id');
    }

    /**
     * Dá TÍTULO legível a cada grupo e o ordena como a clínica lê: mês em ordem cronológica
     * ("setembro de 2026"), o resto pelo nome. Nulo vira "Sem convênio"/"Sem especialidade" —
     * entra na soma, nunca some.
     *
     * @param  Collection<int, array{chave: mixed, quantidade: int, criancas_distintas: int}>  $agregado
     * @return Collection<int, array{titulo: string, quantidade: int, criancas_distintas: int}>
     */
    private function gruposOrdenados(string $dimensao, Collection $agregado): Collection
    {
        $chaves = $agregado->pluck('chave')->filter(fn ($chave) => $chave !== null)->unique()->values();

        $titulos = match ($dimensao) {
            'profissional' => Profissional::whereIn('id', $chaves)->pluck('nome', 'id'),
            'especialidade' => Especialidade::whereIn('id', $chaves)->pluck('nome', 'id'),
            'convenio' => Convenio::whereIn('id', $chaves)->pluck('nome', 'id'),
            'mes' => null,
        };

        $semValor = match ($dimensao) {
            'convenio' => 'Sem convênio',
            'especialidade' => 'Sem especialidade',
            default => 'Sem valor',
        };

        $comTitulo = $agregado->map(function (array $grupo) use ($dimensao, $titulos, $semValor): array {
            $chave = $grupo['chave'];
            $titulo = match (true) {
                $chave === null => $semValor,
                // `-01` explícito: `createFromFormat('Y-m')` herdaria o DIA de hoje e, no dia 31,
                // "2026-02" viraria março
                $dimensao === 'mes' => Carbon::createFromFormat('Y-m-d', "{$chave}-01")->locale('pt_BR')->isoFormat('MMMM [de] YYYY'),
                default => (string) ($titulos[$chave] ?? $semValor),
            };

            return [...$grupo, 'titulo' => $titulo];
        });

        return match ($dimensao) {
            'mes' => $comTitulo->sortBy('chave'),
            // pelo nome, com o "Sem …" por último — é o resto, não o primeiro da lista
            default => $comTitulo->sortBy(fn (array $g) => ($g['chave'] === null ? "\u{FFFF}" : '').mb_strtolower($g['titulo'])),
        };
    }

    /**
     * Os filtros usados, com o NOME legível — o que o papel imprime no cabeçalho para dizer
     * de que recorte ele é. Os ids já passaram por `exists`.
     *
     * @param  array<string, mixed>  $parametros
     * @return list<array{rotulo: string, valor: string}>
     */
    private function filtrosAplicados(array $parametros): array
    {
        $filtros = [];

        if (isset($parametros['profissional_id'])) {
            $filtros[] = ['rotulo' => 'Profissional', 'valor' => (string) Profissional::whereKey($parametros['profissional_id'])->value('nome')];
        }
        if (isset($parametros['convenio_id'])) {
            $filtros[] = ['rotulo' => 'Convênio', 'valor' => (string) Convenio::whereKey($parametros['convenio_id'])->value('nome')];
        }
        if (isset($parametros['especialidade_id'])) {
            $filtros[] = ['rotulo' => 'Especialidade', 'valor' => (string) Especialidade::whereKey($parametros['especialidade_id'])->value('nome')];
        }

        return $filtros;
    }
}
