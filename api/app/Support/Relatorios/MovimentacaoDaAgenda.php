<?php

namespace App\Support\Relatorios;

use App\Models\Agendamento;
use App\Models\Auditoria;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Auditoria\OrigemDaOperacao;
use App\Support\Auditoria\ResolvedorDeValores;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\Escopo;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Relatório `movimentacao-da-agenda` (change `area-de-relatorios`): o que a TRILHA DE AUDITORIA
 * registrou sobre agendamentos no período — criado, remarcado, desmarcado, troca de situação —
 * com quem fez e quando. Cobre, no ClinicaÁgil, "Histórico de Movimentação da Agenda" e
 * "Histórico de Movimentação de Status".
 *
 * Exige `auditoria.ver` E `agenda.ver` (a spec é explícita nos dois sentidos: `agenda.ver`
 * sozinha leva 403, e `auditoria.ver` sozinha também — ver `permissoes()`), sem eixo — a
 * trilha é da clínica. É de CONFERÊNCIA (AP-09): traz o nome da criança, e só ele.
 *
 * A classificação é pelos CAMPOS que mudaram no diff, nunca pelo NOME do status (status é dado,
 * §13), e mora numa expressão SQL única — a mesma que filtra por `tipo` e que sai na linha —
 * para o filtro e a coluna nunca divergirem:
 *   - `criou`                                    → criado
 *   - `excluiu`                                  → desmarcado (a exclusão tira a criança da grade)
 *   - `atualizou` com status que NÃO ocupa horário → desmarcado (é como a casa desmarca — o
 *     `DesmarqueEmLote` grava o status configurado do desmarque; a flag `ocupa_horario` é a
 *     definição, não o nome)
 *   - `atualizou` de inicio/fim/profissional       → remarcado
 *   - `atualizado` de status que ocupa horário      → status
 *   - qualquer outro `atualizou` (obs, sala, lembrete…) NÃO é movimentação e fica de fora.
 * Precedência quando um save muda mais de uma coisa: desmarcado > remarcado > status.
 *
 * Os VALORES saem legíveis pelo `ResolvedorDeValores` da tela de auditoria (REUSO, não cópia):
 * FK vira nome, `inicio` vira "dd/mm/aaaa às HH:MM". O diff de `atualizou` só carrega o que
 * mudou; o que não mudou (o profissional numa remarcação de horário, por exemplo) vem da FOTO
 * ATUAL do agendamento — e, se ele já foi excluído, do instantâneo que o próprio `excluiu` gravou.
 *
 * `criado_em` é UTC; o período e as colunas data/hora são na PAREDE da clínica (§13).
 */
final class MovimentacaoDaAgenda implements Relatorio
{
    /** @var list<string> */
    public const TIPOS = ['criado', 'remarcado', 'desmarcado', 'status'];

    private const ROTULO_DO_TIPO = [
        'criado' => 'Criado',
        'remarcado' => 'Remarcado',
        'desmarcado' => 'Desmarcado',
        'status' => 'Troca de situação',
    ];

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS,
    ) {}

    public function slug(): string
    {
        return 'movimentacao-da-agenda';
    }

    public function titulo(): string
    {
        return 'Movimentação da agenda';
    }

    /**
     * `auditoria.ver` E `agenda.ver` (`SEC-REL-03`).
     *
     * `auditoria.ver` sozinha entregava a AGENDA NOMINAL de todo o período: o relatório
     * preenche o nome da criança pela foto ATUAL de `agendamentos` (e pelo instantâneo do
     * `excluiu`, para o horário que não existe mais), então ele diz mais do que a tela
     * `/auditoria` — que serve o diff, não a agenda. Quem só audita fica com a trilha; ler a
     * agenda continua exigindo a permissão da agenda.
     *
     * @return list<string>
     */
    public function permissoes(): array
    {
        return ['auditoria.ver', 'agenda.ver'];
    }

    public function eixo(): ?string
    {
        return null;
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
            'tipo' => ['sometimes', Rule::in(self::TIPOS)],
            'profissional_id' => ['sometimes', 'integer', Rule::exists('profissionais', 'id')],
        ];
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        $fuso = (string) $this->configuracoes->get('clinica.timezone');
        [$classificacao, $bindings] = $this->expressaoDoTipo();

        $consulta = Auditoria::query()
            ->where('auditoria.entidade', 'agendamentos')
            ->whereBetween('auditoria.criado_em', [
                Carbon::parse("{$parametros['de']} 00:00:00", $fuso)->utc()->format('Y-m-d H:i:s'),
                Carbon::parse("{$parametros['ate']} 23:59:59", $fuso)->utc()->format('Y-m-d H:i:s'),
            ])
            // só o que É movimentação: o `atualizou` de obs/sala/lembrete fica de fora
            ->whereRaw("({$classificacao}) IS NOT NULL", $bindings)
            ->when($parametros['tipo'] ?? null, fn (Builder $q, string $tipo) => $q
                ->whereRaw("({$classificacao}) = ?", [...$bindings, $tipo]))
            // o profissional DONO hoje, ou o que o diff cita (o excluído já não está em
            // `agendamentos`; o `excluiu` guarda o dono no instantâneo `antes`)
            ->when($parametros['profissional_id'] ?? null, fn (Builder $q, $id) => $q->where(fn (Builder $w) => $w
                ->whereIn('auditoria.entidade_id', Agendamento::where('profissional_id', $id)->select('id'))
                ->orWhere('diff_json->antes->profissional_id', $id)
                ->orWhere('diff_json->depois->profissional_id', $id)));

        $brutas = (clone $consulta)
            ->select('auditoria.*')
            ->selectRaw("({$classificacao}) as tipo_movimento", $bindings)
            ->with('usuario:id,nome')
            ->orderBy('auditoria.criado_em')
            ->orderBy('auditoria.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;
        $quantidade = $truncado ? (clone $consulta)->count() : $brutas->count();
        $registros = $brutas->take($this->limiteDeLinhas);

        $fotos = $this->fotosDosAgendamentos($registros);
        $resolvedor = new ResolvedorDeValores(array_values(array_unique([
            ...ResolvedorDeValores::pacienteIdsDe($registros),
            ...$fotos->pluck('paciente_id')->filter()->map(fn ($id): int => (int) $id)->all(),
        ])));

        // whitelist explícita (lição WHITELIST-do-menor): do diff só saem os campos rotulados
        $linhas = $registros->map(fn (Auditoria $registro): array => $this->linha($registro, $fotos[$registro->entidade_id] ?? [], $resolvedor, $fuso))
            ->values()->all();

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: ['de' => $parametros['de'], 'ate' => $parametros['ate']],
            filtrosAplicados: $this->filtrosAplicados($parametros),
            colunas: [
                ['chave' => 'data', 'rotulo' => 'Data', 'tipo' => 'data'],
                ['chave' => 'hora', 'rotulo' => 'Hora', 'tipo' => 'hora'],
                ['chave' => 'tipo', 'rotulo' => 'Movimentação', 'tipo' => 'texto'],
                ['chave' => 'paciente', 'rotulo' => 'Paciente', 'tipo' => 'texto'],
                ['chave' => 'profissional', 'rotulo' => 'Profissional', 'tipo' => 'texto'],
                ['chave' => 'antes', 'rotulo' => 'Antes', 'tipo' => 'texto'],
                ['chave' => 'depois', 'rotulo' => 'Depois', 'tipo' => 'texto'],
                ['chave' => 'por', 'rotulo' => 'Por', 'tipo' => 'texto'],
            ],
            linhas: $linhas,
            grupos: null,
            totais: ['quantidade' => $quantidade],
            truncado: $truncado,
        );
    }

    /**
     * A expressão SQL que classifica um registro da trilha (ou NULL quando não é movimentação).
     * Uma só, com bindings, usada no filtro E na coluna. Os ids dos status que NÃO ocupam
     * horário vêm do cadastro da clínica — a flag, nunca o nome.
     *
     * **A trilha HISTÓRICA é classificada com o conjunto ATUAL de status** (`CRR-18`), e isso
     * é uma escolha, não um descuido: a lista `naoOcupam` é lida agora, não na data do registro.
     * Se a clínica ligar/desligar `ocupa_horario` num status, movimentações antigas mudam de
     * rótulo retroativamente — um "troca de situação" de junho pode virar "desmarcado". A trilha
     * guarda o `status_id`, não a flag que ele tinha naquele dia; classificar como era exigiria
     * versionar o catálogo de status, que é migration e change própria. Para o uso real
     * (conferência do mês corrente) a foto atual é a certa; para auditoria de anos, saiba disto.
     *
     * @return array{0: string, 1: list<mixed>}
     */
    private function expressaoDoTipo(): array
    {
        $naoOcupam = StatusAgendamento::where('ocupa_horario', false)->pluck('id')->all();

        $statusDepois = "JSON_UNQUOTE(JSON_EXTRACT(auditoria.diff_json, '$.depois.status_id'))";
        $mudouHorario = "JSON_EXTRACT(auditoria.diff_json, '$.depois.inicio') IS NOT NULL"
            ." OR JSON_EXTRACT(auditoria.diff_json, '$.depois.fim') IS NOT NULL"
            ." OR JSON_EXTRACT(auditoria.diff_json, '$.depois.profissional_id') IS NOT NULL";

        $ramos = ["WHEN auditoria.acao = 'criou' THEN 'criado'", "WHEN auditoria.acao = 'excluiu' THEN 'desmarcado'"];
        $bindings = [];
        if ($naoOcupam !== []) {
            $marcadores = implode(', ', array_fill(0, count($naoOcupam), '?'));
            $ramos[] = "WHEN auditoria.acao = 'atualizou' AND {$statusDepois} IN ({$marcadores}) THEN 'desmarcado'";
            $bindings = $naoOcupam;
        }
        $ramos[] = "WHEN auditoria.acao = 'atualizou' AND ({$mudouHorario}) THEN 'remarcado'";
        $ramos[] = "WHEN auditoria.acao = 'atualizou' AND {$statusDepois} IS NOT NULL THEN 'status'";

        return ['CASE '.implode(' ', $ramos).' ELSE NULL END', $bindings];
    }

    /**
     * A FOTO de cada agendamento citado: a atual (`agendamentos`) e, para os já excluídos, o
     * instantâneo `antes` que o `excluiu` gravou — é o que dá nome à criança de um horário que
     * não existe mais. Só os campos que o relatório usa.
     *
     * @param  Collection<int, Auditoria>  $registros
     * @return Collection<int, array{paciente_id: int|null, profissional_id: int|null, inicio: string|null, status_id: int|null}>
     */
    private function fotosDosAgendamentos(Collection $registros): Collection
    {
        $ids = $registros->pluck('entidade_id')->unique()->values();
        if ($ids->isEmpty()) {
            return collect();
        }

        $fotos = Agendamento::whereIn('id', $ids)
            ->get(['id', 'paciente_id', 'profissional_id', 'inicio', 'status_id'])
            ->mapWithKeys(fn (Agendamento $a): array => [$a->id => [
                'paciente_id' => $a->paciente_id,
                'profissional_id' => $a->profissional_id,
                'inicio' => $a->inicio?->format('Y-m-d H:i:s'),
                'status_id' => $a->status_id,
            ]]);

        $excluidos = $ids->diff($fotos->keys());
        if ($excluidos->isNotEmpty()) {
            Auditoria::query()
                ->where('entidade', 'agendamentos')
                ->where('acao', 'excluiu')
                ->whereIn('entidade_id', $excluidos)
                ->orderBy('id')
                ->get(['entidade_id', 'diff_json'])
                ->each(function (Auditoria $registro) use (&$fotos): void {
                    $antes = $registro->diff_json['antes'] ?? [];
                    $fotos[$registro->entidade_id] = [
                        'paciente_id' => $antes['paciente_id'] ?? null,
                        'profissional_id' => $antes['profissional_id'] ?? null,
                        'inicio' => $antes['inicio'] ?? null,
                        'status_id' => $antes['status_id'] ?? null,
                    ];
                });
        }

        return $fotos;
    }

    /**
     * @param  array{paciente_id?: int|null, profissional_id?: int|null, inicio?: string|null, status_id?: int|null}  $foto
     * @return array<string, string>
     */
    private function linha(Auditoria $registro, array $foto, ResolvedorDeValores $resolvedor, string $fuso): array
    {
        $tipo = (string) $registro->tipo_movimento;
        $antes = $registro->diff_json['antes'] ?? [];
        $depois = $registro->diff_json['depois'] ?? [];
        $quando = $registro->criado_em->copy()->timezone($fuso);

        $pacienteId = $depois['paciente_id'] ?? $antes['paciente_id'] ?? $foto['paciente_id'] ?? null;
        $profissionalId = $depois['profissional_id'] ?? $foto['profissional_id'] ?? $antes['profissional_id'] ?? null;

        [$textoAntes, $textoDepois] = match ($tipo) {
            'criado' => [
                '—',
                $this->horarioComProfissional($resolvedor, $depois['inicio'] ?? null, $depois['profissional_id'] ?? null),
            ],
            'remarcado' => [
                $this->horarioComProfissional(
                    $resolvedor,
                    $antes['inicio'] ?? $foto['inicio'] ?? null,
                    $antes['profissional_id'] ?? $foto['profissional_id'] ?? null,
                ),
                $this->horarioComProfissional(
                    $resolvedor,
                    $depois['inicio'] ?? $foto['inicio'] ?? null,
                    $depois['profissional_id'] ?? $foto['profissional_id'] ?? null,
                ),
            ],
            'desmarcado' => [
                $this->nomeDoStatus($resolvedor, $antes['status_id'] ?? $foto['status_id'] ?? null),
                $registro->acao === 'excluiu' ? 'Excluído' : $this->nomeDoStatus($resolvedor, $depois['status_id'] ?? null),
            ],
            default => [
                $this->nomeDoStatus($resolvedor, $antes['status_id'] ?? null),
                $this->nomeDoStatus($resolvedor, $depois['status_id'] ?? null),
            ],
        };

        return [
            'data' => $quando->format('Y-m-d'),
            'hora' => $quando->format('H:i'),
            'tipo' => self::ROTULO_DO_TIPO[$tipo],
            'paciente' => $pacienteId === null ? '—' : (string) $resolvedor->valor('paciente_id', $pacienteId),
            'profissional' => $profissionalId === null ? '—' : (string) $resolvedor->valor('profissional_id', $profissionalId),
            'antes' => $textoAntes,
            'depois' => $textoDepois,
            // os três autores da trilha, como o `AuditoriaResource` os nomeia
            'por' => OrigemDaOperacao::rotulo($registro->autor_tipo, $registro->usuario?->nome),
        ];
    }

    /** "dd/mm/aaaa às HH:MM · Profissional" — o horário pelo resolvedor da auditoria. */
    private function horarioComProfissional(ResolvedorDeValores $resolvedor, mixed $inicio, mixed $profissionalId): string
    {
        $horario = $inicio === null ? '—' : (string) $resolvedor->valor('inicio', $inicio);
        $profissional = $profissionalId === null ? '—' : (string) $resolvedor->valor('profissional_id', $profissionalId);

        return "{$horario} · {$profissional}";
    }

    private function nomeDoStatus(ResolvedorDeValores $resolvedor, mixed $statusId): string
    {
        return $statusId === null ? '—' : (string) $resolvedor->valor('status_id', $statusId);
    }

    /**
     * @param  array<string, mixed>  $parametros
     * @return list<array{rotulo: string, valor: string}>
     */
    private function filtrosAplicados(array $parametros): array
    {
        $filtros = [];

        if (isset($parametros['profissional_id'])) {
            $filtros[] = ['rotulo' => 'Profissional', 'valor' => (string) Profissional::whereKey($parametros['profissional_id'])->value('nome')];
        }
        if (isset($parametros['tipo'])) {
            $filtros[] = ['rotulo' => 'Movimentação', 'valor' => self::ROTULO_DO_TIPO[$parametros['tipo']]];
        }

        return $filtros;
    }
}
