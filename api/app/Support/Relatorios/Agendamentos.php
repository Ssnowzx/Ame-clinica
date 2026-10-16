<?php

namespace App\Support\Relatorios;

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Rbac\Escopo;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Relatório `agendamentos` (change `area-de-relatorios`): os agendamentos de atendimento do
 * período — analítico (linha a linha, por dia) ou sintético (totais divididos por status ·
 * profissional · convênio · especialidade · dia). Cobre, no ClinicaÁgil, "Agenda por Status"
 * e "Agendamentos por Período".
 *
 * É de CONFERÊNCIA (AP-09): sai com o nome da criança — só o nome, nada do cadastro. Sob
 * `agenda.ver`, no eixo AGENDA (D11): o escopado vê só a própria agenda; sem vínculo e sem
 * `agenda.ver_todos`, vazio (fail-closed pelo `Escopo`).
 *
 * O convênio vem do TRATAMENTO do agendamento (é o que valia quando o pacote foi vendido —
 * o mesmo caminho dos GETs agregados); agendamento sem pacote é "Sem convênio", nunca some
 * da soma. Status é DADO: aqui só o nome dele, nenhuma regra por nome.
 */
final class Agendamentos implements Relatorio
{
    /** @var list<string> */
    public const RESULTADOS = ['analitico', 'sintetico'];

    /** @var list<string> */
    public const DIVISOES = ['status', 'profissional', 'convenio', 'especialidade', 'dia'];

    private const ROTULO_DA_DIVISAO = [
        'status' => 'Status',
        'profissional' => 'Profissional',
        'convenio' => 'Convênio',
        'especialidade' => 'Especialidade',
        'dia' => 'Dia',
    ];

    /** O corte do analítico é injetável (teste) e por padrão o teto comum do envelope. */
    public function __construct(private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS) {}

    public function slug(): string
    {
        return 'agendamentos';
    }

    public function titulo(): string
    {
        return 'Agendamentos';
    }

    public function permissoes(): array
    {
        return ['agenda.ver'];
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
        // ids de filtro existem na base (id inexistente → 422)
        return [
            'resultado' => ['sometimes', Rule::in(self::RESULTADOS)],
            'dividir_por' => ['required_if:resultado,sintetico', Rule::in(self::DIVISOES)],
            'profissional_id' => ['sometimes', 'integer', Rule::exists('profissionais', 'id')],
            'convenio_id' => ['sometimes', 'integer', Rule::exists('convenios', 'id')],
            'especialidade_id' => ['sometimes', 'integer', Rule::exists('especialidades', 'id')],
            'status_id' => ['sometimes', 'integer', Rule::exists('status_agendamento', 'id')],
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
     * O recorte comum: atendimentos do período, filtros em AND com o escopo NA MESMA query
     * (interseção por construção). Colunas qualificadas porque o analítico faz join.
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
            ->when($parametros['status_id'] ?? null, fn (Builder $q, $id) => $q->where('agendamentos.status_id', $id))
            ->when($parametros['convenio_id'] ?? null, fn (Builder $q, $id) => $q
                ->whereHas('tratamento', fn (Builder $t) => $t->where('convenio_id', $id)));

        return $escopo->aplicar($consulta, 'agendamentos.profissional_id');
    }

    /**
     * @param  Builder<Agendamento>  $consulta
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function analitico(Builder $consulta, array $periodo, array $filtros): Envelope
    {
        // ordem: data, hora, profissional (pelo NOME — daí o join) e id como desempate estável.
        // `agendamentos.*` no select para o join não sobrescrever coluna do model.
        $brutas = (clone $consulta)
            ->join('profissionais', fn (JoinClause $join) => $join
                ->on('profissionais.id', '=', 'agendamentos.profissional_id'))
            ->select('agendamentos.*')
            ->with([
                'paciente:id,nome',
                'profissional:id,nome',
                'especialidade:id,nome',
                'status:id,nome',
                'tratamento:id,convenio_id',
                'tratamento.convenio:id,nome',
            ])
            ->orderBy('agendamentos.inicio')
            ->orderBy('profissionais.nome')
            ->orderBy('agendamentos.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;
        // com corte, o total é o do RECORTE inteiro (uma contagem a mais só nesse caso) — o
        // papel mostra 2000 linhas e diz quantos agendamentos o período tem de verdade
        $quantidade = $truncado ? (clone $consulta)->count() : $brutas->count();

        // whitelist explícita no transform (lição WHITELIST-do-menor): nunca toArray() do model
        $linhas = $brutas->take($this->limiteDeLinhas)->map(fn (Agendamento $a): array => [
            'data' => $a->inicio->format('Y-m-d'),
            'hora' => $a->inicio->format('H:i'),
            'paciente' => $a->paciente?->nome,
            'profissional' => $a->profissional?->nome,
            'especialidade' => $a->especialidade?->nome ?? 'Sem especialidade',
            'convenio' => $a->tratamento?->convenio?->nome ?? 'Sem convênio',
            'status' => $a->status?->nome,
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
                ['chave' => 'status', 'rotulo' => 'Status', 'tipo' => 'texto'],
            ],
            linhas: $linhas,
            grupos: null,
            totais: ['quantidade' => $quantidade],
            truncado: $truncado,
        );
    }

    /**
     * Totais por dimensão, somados NO BANCO (lição CR-04): um grupo por valor da dimensão,
     * cada um com quantidade e minutos (inicio → fim). Grupo é a LINHA da tabela sintética.
     *
     * @param  Builder<Agendamento>  $consulta
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function sintetico(Builder $consulta, string $dimensao, array $periodo, array $filtros): Envelope
    {
        // a expressão vem de um `match` fechado sobre `DIVISOES` (validado) — nunca do payload
        $expressao = match ($dimensao) {
            'status' => 'agendamentos.status_id',
            'profissional' => 'agendamentos.profissional_id',
            'especialidade' => 'agendamentos.especialidade_id',
            'convenio' => 'tratamentos.convenio_id',
            'dia' => 'DATE(agendamentos.inicio)',
        };

        $agregado = (clone $consulta)
            ->when($dimensao === 'convenio', fn (Builder $q) => $q
                ->leftJoin('tratamentos', fn (JoinClause $join) => $join
                    ->on('tratamentos.id', '=', 'agendamentos.tratamento_id')))
            ->selectRaw(
                "{$expressao} as chave, COUNT(*) as quantidade, "
                .'COALESCE(SUM(TIMESTAMPDIFF(MINUTE, agendamentos.inicio, agendamentos.fim)), 0) as minutos'
            )
            ->groupByRaw($expressao)
            ->get()
            ->map(fn ($linha): array => [
                'chave' => $linha->chave,
                'quantidade' => (int) $linha->quantidade,
                'minutos' => (int) $linha->minutos,
            ]);

        $grupos = $this->gruposOrdenados($dimensao, $agregado)
            ->map(fn (array $grupo): array => [
                'titulo' => $grupo['titulo'],
                'linhas' => [],
                'totais' => ['quantidade' => $grupo['quantidade'], 'minutos' => $grupo['minutos']],
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
                ['chave' => 'quantidade', 'rotulo' => 'Agendamentos', 'tipo' => 'numero'],
                ['chave' => 'minutos', 'rotulo' => 'Minutos', 'tipo' => 'numero'],
            ],
            linhas: [],
            grupos: $grupos,
            totais: [
                'quantidade' => (int) $agregado->sum('quantidade'),
                'minutos' => (int) $agregado->sum('minutos'),
            ],
        );
    }

    /**
     * Dá TÍTULO legível a cada grupo e o ordena como a clínica lê: status pela `ordem` do
     * cadastro, dia em ordem cronológica, o resto pelo nome. Nulo vira "Sem convênio"/"Sem
     * especialidade" — entra na soma, nunca some.
     *
     * @param  Collection<int, array{chave: mixed, quantidade: int, minutos: int}>  $agregado
     * @return Collection<int, array{titulo: string, quantidade: int, minutos: int}>
     */
    private function gruposOrdenados(string $dimensao, Collection $agregado): Collection
    {
        $chaves = $agregado->pluck('chave')->filter(fn ($chave) => $chave !== null)->unique()->values();

        [$titulos, $posicoes] = match ($dimensao) {
            'status' => (function () use ($chaves): array {
                $status = StatusAgendamento::whereIn('id', $chaves)->orderBy('ordem')->orderBy('id')->get(['id', 'nome']);

                return [$status->pluck('nome', 'id'), $status->pluck('id')->flip()];
            })(),
            'profissional' => [Profissional::whereIn('id', $chaves)->pluck('nome', 'id'), null],
            'especialidade' => [Especialidade::whereIn('id', $chaves)->pluck('nome', 'id'), null],
            'convenio' => [Convenio::whereIn('id', $chaves)->pluck('nome', 'id'), null],
            'dia' => [null, null],
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
                $dimensao === 'dia' => Carbon::parse((string) $chave)->format('d/m/Y'),
                default => (string) ($titulos[$chave] ?? $semValor),
            };

            return ['chave' => $chave, 'titulo' => $titulo, 'quantidade' => $grupo['quantidade'], 'minutos' => $grupo['minutos']];
        });

        return match ($dimensao) {
            'dia' => $comTitulo->sortBy('chave'),
            // status pela ordem do cadastro; chave nula (não existe para status) iria ao fim
            'status' => $comTitulo->sortBy(fn (array $g) => $g['chave'] === null ? PHP_INT_MAX : ($posicoes[$g['chave']] ?? PHP_INT_MAX)),
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
        if (isset($parametros['status_id'])) {
            $filtros[] = ['rotulo' => 'Status', 'valor' => (string) StatusAgendamento::whereKey($parametros['status_id'])->value('nome')];
        }

        return $filtros;
    }
}
