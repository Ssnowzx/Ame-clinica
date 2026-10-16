<?php

namespace App\Support\Relatorios;

use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Profissional;
use App\Models\Tratamento;
use App\Support\Clinica\RealceDoPacote;
use App\Support\Rbac\Escopo;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Validation\Rule;

/**
 * Relatório `sessoes-dos-tratamentos` (change `area-de-relatorios`, task 2.6): por tratamento,
 * criança, especialidade, convênio, profissional, vendidas × realizadas × saldo e situação.
 * Cobre, no ClinicaÁgil, "Sessões Vendidas × Realizadas" e "Planos Próximos do Fim".
 *
 * É de CONFERÊNCIA (AP-09): sai com o nome da criança — só o nome. Sob `tratamentos.ver`, no
 * eixo AGENDA (D11 — ver `eixo()`) pela coluna dona `tratamentos.profissional_id`; sem vínculo e sem
 * `agenda.ver_todos`, vazio (fail-closed pelo `Escopo`).
 *
 * A situação recorta pelo período:
 *  - `em_andamento` (default): status `andamento` aberto até `ate` (retrato da data final);
 *  - `finalizados`: status `finalizado` cuja última gravação (`updated_at`) cai no período —
 *    `tratamentos` não tem `finalizado_em`, e coluna nova é migration fora desta change;
 *  - `proximos_do_encerramento`: em andamento com saldo ≤ limiar do alerta de fim de pacote,
 *    que é DADO (`tratamentos.saldo_alerta_sessoes`) — e o recorte vem da FONTE ÚNICA
 *    `RealceDoPacote::escopoDoFimDePacote`, a MESMA que a fila do centro de notificações
 *    (`PacotesAcabando`) usa: contador, card, painel e este relatório não podem divergir.
 *
 * `consultaBase()` e `sessoes()` são a BASE e a CONTA compartilhadas com o GET antigo
 * `sessoes-vendidas-realizadas` (task 2.10): um número só, nunca dois.
 */
final class SessoesDosTratamentos implements Relatorio
{
    /** @var list<string> */
    public const SITUACOES = ['em_andamento', 'finalizados', 'proximos_do_encerramento'];

    private const ROTULO_DA_SITUACAO = [
        'em_andamento' => 'Em andamento',
        'finalizados' => 'Finalizados no período',
        'proximos_do_encerramento' => 'Próximos do encerramento',
    ];

    /** O status do tratamento como a clínica lê — a coluna `situacao` da linha. */
    private const ROTULO_DO_STATUS = [
        'andamento' => 'Em andamento',
        'parado' => 'Parado',
        'finalizado' => 'Finalizado',
    ];

    /** O corte do analítico é injetável (teste) e por padrão o teto comum do envelope. */
    public function __construct(
        private readonly RealceDoPacote $realce,
        private readonly PeriodoDoTratamento $periodo,
        private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS,
    ) {}

    public function slug(): string
    {
        return 'sessoes-dos-tratamentos';
    }

    public function titulo(): string
    {
        return 'Sessões dos tratamentos';
    }

    public function permissoes(): array
    {
        return ['tratamentos.ver'];
    }

    /**
     * Eixo AGENDA (D11) — corrigido no gate desta change (`SEC-REL-01`/`CRR-01`).
     *
     * `tratamentos` e `pacientes` são do eixo AGENDA em TODAS as outras portas da casa
     * (`TratamentoController::index`/`::show`, `PacienteController`, `PacotesAcabando` e o
     * `RelatorioController::sessoesVendidasRealizadas`, que é onde mora o `SEC-VP-45`), e §12 é
     * explícita: *"o alcance do eixo AGENDA é operacional — pacotes, faturamento de sessão,
     * relatório por criança"* e *"posse de registro existente decide pelo eixo agenda"*. O eixo
     * CLÍNICO governa prontuário (atendimento, evolução, anamnese) — não é o dado daqui.
     *
     * Declarar `clinico` produzia DOIS defeitos ao mesmo tempo:
     *  (a) Secretaria e Faturista (AP-10: `agenda.ver_todos`, SEM `clinico.ver_todos` e SEM
     *      vínculo) caíam em `nenhum` e recebiam FOLHA EM BRANCO — justamente nos relatórios
     *      que a clínica nomeou como deles;
     *  (b) um papel com `clinico.ver_todos` e sem `agenda.ver_todos` saía PLANO aqui e escopado
     *      na porta antiga do MESMO dado — contornando o `SEC-VP-45` por dentro do relatório.
     *
     * `RelatoriosEixoDoEscopoTest` amarra os dois lados: papel a papel, o conjunto devolvido
     * por este relatório é o MESMO que a porta dona do dado devolve.
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
        return true;
    }

    public function regras(): array
    {
        // ids de filtro existem na base (id inexistente → 422)
        return [
            'situacao' => ['sometimes', Rule::in(self::SITUACOES)],
            'profissional_id' => ['sometimes', 'integer', Rule::exists('profissionais', 'id')],
            'convenio_id' => ['sometimes', 'integer', Rule::exists('convenios', 'id')],
            'especialidade_id' => ['sometimes', 'integer', Rule::exists('especialidades', 'id')],
        ];
    }

    /**
     * A BASE compartilhada com o GET antigo (2.10): tratamentos da clínica sob o
     * escopo, pela coluna dona — qualificada porque o analítico faz join.
     *
     * @return Builder<Tratamento>
     */
    public function consultaBase(Escopo $escopo): Builder
    {
        return $escopo->aplicar(Tratamento::query(), 'tratamentos.profissional_id');
    }

    /**
     * A CONTA — vendidas × realizadas × saldo — num lugar só (2.10): o GET antigo e este
     * relatório não podem divergir num número.
     *
     * @return array{vendidas: int, realizadas: int, saldo: int}
     */
    public function sessoes(Tratamento $tratamento): array
    {
        return [
            'vendidas' => (int) $tratamento->sessoes_total,
            'realizadas' => (int) $tratamento->sessoes_realizadas,
            'saldo' => (int) $tratamento->sessoes_saldo,
        ];
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        $situacao = $parametros['situacao'] ?? 'em_andamento';
        $consulta = $this->consulta($parametros, $situacao, $escopo);

        // ordem: saldo crescente (o mais urgente primeiro), criança pelo NOME — daí o join, com
        // `tratamentos.*` para não sobrescrever coluna
        // do model — e id como desempate estável. Saldo por CAST: as colunas são UNSIGNED.
        $brutas = (clone $consulta)
            ->join('pacientes', fn (JoinClause $join) => $join
                ->on('pacientes.id', '=', 'tratamentos.paciente_id'))
            ->select('tratamentos.*')
            ->with(['paciente:id,nome', 'especialidade:id,nome', 'convenio:id,nome', 'profissional:id,nome'])
            ->orderByRaw('CAST(tratamentos.sessoes_total AS SIGNED) - CAST(tratamentos.sessoes_realizadas AS SIGNED) asc')
            ->orderBy('pacientes.nome')
            ->orderBy('tratamentos.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;

        // totais somados NO BANCO (lição CR-04) e sobre o RECORTE inteiro — com corte, o papel
        // mostra 2000 linhas e diz quantas sessões o recorte tem de verdade
        $agregado = (clone $consulta)
            ->selectRaw('COUNT(*) as quantidade, COALESCE(SUM(tratamentos.sessoes_total), 0) as vendidas, '
                .'COALESCE(SUM(tratamentos.sessoes_realizadas), 0) as realizadas')
            ->first();
        $vendidas = (int) $agregado->vendidas;
        $realizadas = (int) $agregado->realizadas;

        // whitelist explícita no transform (lição WHITELIST-do-menor): nunca toArray() do model
        $linhas = $brutas->take($this->limiteDeLinhas)->map(fn (Tratamento $t): array => [
            'paciente' => $t->paciente?->nome,
            'especialidade' => $t->especialidade?->nome ?? 'Sem especialidade',
            'convenio' => $t->convenio?->nome ?? 'Sem convênio',
            'profissional' => $t->profissional?->nome,
            ...$this->sessoes($t),
            'situacao' => self::ROTULO_DO_STATUS[$t->status] ?? (string) $t->status,
        ])->values()->all();

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: ['de' => $parametros['de'], 'ate' => $parametros['ate']],
            filtrosAplicados: $this->filtrosAplicados($parametros, $situacao),
            colunas: [
                ['chave' => 'paciente', 'rotulo' => 'Paciente', 'tipo' => 'texto'],
                ['chave' => 'especialidade', 'rotulo' => 'Especialidade', 'tipo' => 'texto'],
                ['chave' => 'convenio', 'rotulo' => 'Convênio', 'tipo' => 'texto'],
                ['chave' => 'profissional', 'rotulo' => 'Profissional', 'tipo' => 'texto'],
                ['chave' => 'vendidas', 'rotulo' => 'Vendidas', 'tipo' => 'numero'],
                ['chave' => 'realizadas', 'rotulo' => 'Realizadas', 'tipo' => 'numero'],
                ['chave' => 'saldo', 'rotulo' => 'Saldo', 'tipo' => 'numero'],
                ['chave' => 'situacao', 'rotulo' => 'Situação', 'tipo' => 'texto'],
            ],
            linhas: $linhas,
            grupos: null,
            totais: [
                'quantidade' => (int) $agregado->quantidade,
                'vendidas' => $vendidas,
                'realizadas' => $realizadas,
                'saldo' => $vendidas - $realizadas,
            ],
            truncado: $truncado,
        );
    }

    /**
     * O recorte: base escopada + filtros em AND + a situação, NA MESMA query (interseção por
     * construção). A situação vem de um `match` fechado sobre `SITUACOES` (validado).
     *
     * @param  array<string, mixed>  $parametros
     * @return Builder<Tratamento>
     */
    private function consulta(array $parametros, string $situacao, Escopo $escopo): Builder
    {
        $consulta = $this->consultaBase($escopo)
            ->when($parametros['profissional_id'] ?? null, fn (Builder $q, $id) => $q->where('tratamentos.profissional_id', $id))
            ->when($parametros['convenio_id'] ?? null, fn (Builder $q, $id) => $q->where('tratamentos.convenio_id', $id))
            ->when($parametros['especialidade_id'] ?? null, fn (Builder $q, $id) => $q->where('tratamentos.especialidade_id', $id));

        $abertura = $this->periodo->expressaoDeAbertura();

        return match ($situacao) {
            'em_andamento' => $consulta
                ->where('tratamentos.status', 'andamento')
                ->whereRaw("{$abertura} <= ?", [$parametros['ate']]),
            'finalizados' => $consulta
                ->where('tratamentos.status', 'finalizado')
                ->whereBetween('tratamentos.updated_at', $this->periodo->limitesUtc($parametros['de'], $parametros['ate'])),
            // o recorte de "no fim" pela FONTE ÚNICA (`CRR-08`): o predicado estava COPIADO de
            // `PacotesAcabando::consulta()`, e o `RealceDoPacote` promete que não há segunda
            // conta — contador do centro, card, painel e este relatório leem o mesmo veredito
            'proximos_do_encerramento' => $this->realce->escopoDoFimDePacote(
                $consulta
                    ->where('tratamentos.status', 'andamento')
                    ->whereRaw("{$abertura} <= ?", [$parametros['ate']])
            ),
        };
    }

    /**
     * Os filtros usados, com o NOME legível — o que o papel imprime no cabeçalho para dizer de
     * que recorte ele é. Os ids já passaram por `exists`.
     *
     * @param  array<string, mixed>  $parametros
     * @return list<array{rotulo: string, valor: string}>
     */
    private function filtrosAplicados(array $parametros, string $situacao): array
    {
        $filtros = [['rotulo' => 'Situação', 'valor' => self::ROTULO_DA_SITUACAO[$situacao]]];

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
