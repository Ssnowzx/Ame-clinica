<?php

namespace App\Support\Relatorios;

use App\Models\Auditoria;
use App\Models\Conta;
use App\Models\LancamentoCaixa;
use App\Models\Transferencia;
use App\Models\Usuario;
use App\Support\Auditoria\OrigemDaOperacao;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Financeiro\NomesDosInteressados;
use App\Support\Rbac\Escopo;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Relatório `movimentacao-do-financeiro` (change `relatorios-do-caixa`): quem criou, alterou,
 * deu baixa, estornou ou excluiu lançamentos e transferências, e quando — lido da TRILHA DE
 * AUDITORIA. No ClinicaÁgil, "Histórico de Movimentação do Financeiro". Molde:
 * `MovimentacaoDaAgenda`.
 *
 * O TIPO sai do diff (D5), numa expressão SQL única — a mesma que filtra, que sai na linha e que
 * agrupa, para filtro e coluna nunca divergirem:
 *   - `criou` com `pago_em` preenchido → **criado e pago** (o "já foi pago" de
 *     `caixa-do-dia-a-dia`); o filtro "criado" e o filtro "pago" o trazem;
 *   - `criou` → **criado**; `excluiu` → **excluído**;
 *   - `atualizou` com `pago_em` de vazio a preenchido → **pago**;
 *   - `atualizou` com `pago_em` de preenchido a vazio → **estornado**;
 *   - qualquer outro `atualizou` → **alterado**.
 * O `pago_em` que some do diff (JSON ausente) e o que é JSON `null` são coisas diferentes: só o
 * segundo é um estorno — por isso `JSON_TYPE`, não `IS NULL`.
 *
 * A pessoa e o valor saem do estado ATUAL do registro; o excluído, que não existe mais, sai do
 * `antes` que o próprio `excluiu` gravou. As OBSERVAÇÕES NUNCA saem: nem o `diff_json` é
 * selecionado — as fotos leem do JSON só os caminhos da whitelist, no SQL (a `obs` da
 * transferência vai CRUA para a trilha; a do lançamento já vai mascarada). Os valores de
 * dinheiro saem em claro, como na tela de auditoria.
 *
 * Exige `auditoria.ver` E `lancamentos.ver` (a linha nomeia a criança e o valor, que é o que a
 * lista de lançamentos mostra). Sai com o nome da criança (AP-09). Sem eixo: a trilha é da
 * clínica. `criado_em` é UTC; o período e as colunas data/hora são na parede da clínica.
 */
final class MovimentacaoDoFinanceiro implements Relatorio
{
    /** @var list<string> */
    public const RESULTADOS = ['analitico', 'sintetico'];

    /** @var list<string> */
    public const DIVISOES = ['pessoa', 'tipo'];

    /** Os tipos do FILTRO — e os tipos derivados que cada um traz. */
    public const TIPOS = [
        'criado' => ['criado', 'criado_e_pago'],
        'alterado' => ['alterado'],
        'pago' => ['pago', 'criado_e_pago'],
        'estornado' => ['estornado'],
        'excluido' => ['excluido'],
    ];

    public const BASE = 'Pela data da ação';

    /** O rótulo de cada tipo derivado, na ordem em que o sintético por tipo os lista. */
    private const ROTULO_DO_TIPO = [
        'criado' => 'Criado',
        'criado_e_pago' => 'Criado e pago',
        'alterado' => 'Alterado',
        'pago' => 'Pago',
        'estornado' => 'Estornado',
        'excluido' => 'Excluído',
    ];

    private const ENTIDADES = ['lancamentos_caixa', 'transferencias'];

    private const ROTULO_DA_DIVISAO = ['pessoa' => 'Quem fez', 'tipo' => 'Tipo'];

    /** `pago_em` com valor (nem ausente, nem JSON null) no lado do diff. */
    private const PAGO_DEPOIS = "COALESCE(JSON_TYPE(JSON_EXTRACT(auditoria.diff_json, '$.depois.pago_em')), 'NULL') <> 'NULL'";

    private const PAGO_ANTES = "COALESCE(JSON_TYPE(JSON_EXTRACT(auditoria.diff_json, '$.antes.pago_em')), 'NULL') <> 'NULL'";

    /** `pago_em` PRESENTE no diff e JSON null — ausente não é estorno. */
    private const ESVAZIADO_DEPOIS = "JSON_TYPE(JSON_EXTRACT(auditoria.diff_json, '$.depois.pago_em')) = 'NULL'";

    /** Quem fez, como chave de grupo: o usuário, ou a origem sem usuário (sistema, formulário). */
    private const AUTOR = "CASE WHEN auditoria.autor_tipo = 'usuario' THEN CONCAT('usuario#', auditoria.usuario_id) ELSE auditoria.autor_tipo END";

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS,
    ) {}

    public function slug(): string
    {
        return 'movimentacao-do-financeiro';
    }

    public function titulo(): string
    {
        return 'Movimentação do financeiro';
    }

    /**
     * `auditoria.ver` E `lancamentos.ver`: quem só audita não lê, por aqui, a criança e o valor de
     * cada lançamento — a mesma lição de `SEC-REL-03` na movimentação da agenda.
     *
     * @return list<string>
     */
    public function permissoes(): array
    {
        return ['auditoria.ver', 'lancamentos.ver'];
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
            'resultado' => ['sometimes', Rule::in(self::RESULTADOS)],
            'dividir_por' => ['required_if:resultado,sintetico', Rule::in(self::DIVISOES)],
            'tipo' => ['sometimes', Rule::in(array_keys(self::TIPOS))],
        ];
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        $fuso = (string) $this->configuracoes->get('clinica.timezone');
        $tipo = self::expressaoDoTipo();

        $consulta = Auditoria::query()
            ->whereIn('auditoria.entidade', self::ENTIDADES)
            ->whereBetween('auditoria.criado_em', [
                Carbon::parse("{$parametros['de']} 00:00:00", $fuso)->utc()->format('Y-m-d H:i:s'),
                Carbon::parse("{$parametros['ate']} 23:59:59", $fuso)->utc()->format('Y-m-d H:i:s'),
            ])
            ->whereRaw("({$tipo}) IS NOT NULL")
            ->when($parametros['tipo'] ?? null, fn (Builder $q, string $filtro) => $q->whereRaw(
                "({$tipo}) IN (".implode(', ', array_fill(0, count(self::TIPOS[$filtro]), '?')).')',
                self::TIPOS[$filtro],
            ));

        $periodo = ['de' => $parametros['de'], 'ate' => $parametros['ate']];
        $filtros = $this->filtrosAplicados($parametros);

        if (($parametros['resultado'] ?? 'analitico') === 'sintetico') {
            return $this->sintetico($consulta, $parametros['dividir_por'], $periodo, $filtros);
        }

        return $this->analitico($consulta, $fuso, $periodo, $filtros);
    }

    /** A expressão que deriva o tipo da ação a partir da `acao` e do diff (ver o docblock da classe). */
    private static function expressaoDoTipo(): string
    {
        return 'CASE'
            ." WHEN auditoria.acao = 'criou' AND ".self::PAGO_DEPOIS." THEN 'criado_e_pago'"
            ." WHEN auditoria.acao = 'criou' THEN 'criado'"
            ." WHEN auditoria.acao = 'excluiu' THEN 'excluido'"
            ." WHEN auditoria.acao = 'atualizou' AND ".self::PAGO_DEPOIS.' AND NOT ('.self::PAGO_ANTES.") THEN 'pago'"
            ." WHEN auditoria.acao = 'atualizou' AND ".self::ESVAZIADO_DEPOIS.' AND '.self::PAGO_ANTES." THEN 'estornado'"
            ." WHEN auditoria.acao = 'atualizou' THEN 'alterado'"
            .' ELSE NULL END';
    }

    /**
     * Uma linha por ação, em ordem cronológica. As colunas da trilha são uma whitelist: o
     * `diff_json` não é selecionado (é onde a `obs` da transferência mora em claro).
     *
     * @param  Builder<Auditoria>  $consulta
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function analitico(Builder $consulta, string $fuso, array $periodo, array $filtros): Envelope
    {
        $brutas = (clone $consulta)
            ->select(['auditoria.id', 'auditoria.entidade', 'auditoria.entidade_id', 'auditoria.autor_tipo', 'auditoria.usuario_id', 'auditoria.criado_em'])
            ->selectRaw('('.self::expressaoDoTipo().') as tipo_derivado')
            ->with('usuario:id,nome')
            ->orderBy('auditoria.criado_em')
            ->orderBy('auditoria.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;
        $quantidade = $truncado ? (clone $consulta)->count() : $brutas->count();
        $registros = $brutas->take($this->limiteDeLinhas);
        $lancamentos = $this->fotosDosLancamentos($registros->where('entidade', 'lancamentos_caixa')->pluck('entidade_id')->unique()->values());
        $transferencias = $this->fotosDasTransferencias($registros->where('entidade', 'transferencias')->pluck('entidade_id')->unique()->values());
        $pessoas = NomesDosInteressados::de($lancamentos->values());
        $contas = Conta::whereIn('id', $transferencias->flatMap(fn (array $t): array => [$t['conta_origem_id'], $t['conta_destino_id']])->filter()->unique()->values())->pluck('nome', 'id');

        $linhas = $registros->map(function (Auditoria $registro) use ($fuso, $lancamentos, $transferencias, $pessoas, $contas): array {
            $quando = $registro->criado_em->copy()->timezone($fuso);

            return [
                'data' => $quando->format('Y-m-d'),
                'hora' => $quando->format('H:i'),
                'tipo' => self::ROTULO_DO_TIPO[$registro->tipo_derivado],
                ...($registro->entidade === 'transferencias'
                    ? self::daTransferencia($registro->entidade_id, $transferencias[$registro->entidade_id] ?? null, $contas)
                    : self::doLancamento($registro->entidade_id, $lancamentos[$registro->entidade_id] ?? null, $pessoas)),
                'por' => self::autor($registro->autor_tipo, $registro->usuario?->nome),
            ];
        })->values()->all();

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            colunas: [
                ['chave' => 'data', 'rotulo' => 'Data', 'tipo' => 'data'],
                ['chave' => 'hora', 'rotulo' => 'Hora', 'tipo' => 'hora'],
                ['chave' => 'tipo', 'rotulo' => 'Movimentação', 'tipo' => 'texto'],
                ['chave' => 'registro', 'rotulo' => 'Registro', 'tipo' => 'texto'],
                ['chave' => 'natureza', 'rotulo' => 'Natureza', 'tipo' => 'texto'],
                ['chave' => 'pessoa', 'rotulo' => 'Pessoa ou contas', 'tipo' => 'texto'],
                ['chave' => 'valor', 'rotulo' => 'Valor', 'tipo' => 'dinheiro'],
                ['chave' => 'por', 'rotulo' => 'Por', 'tipo' => 'texto'],
            ],
            linhas: $linhas,
            grupos: null,
            // SEM total de `valor`, por decisão: somar criação, alteração e exclusão do mesmo
            // lançamento não é dinheiro de ninguém. Só a contagem do recorte inteiro, como na
            // movimentação da agenda (não é coluna: a tela não a desenha; o papel diz "N linhas")
            totais: ['quantidade' => $quantidade],
            truncado: $truncado,
        );
    }

    /**
     * Por quem fez ou por tipo — a contagem de ações de cada grupo, do mesmo GROUP BY.
     *
     * @param  Builder<Auditoria>  $consulta
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function sintetico(Builder $consulta, string $dimensao, array $periodo, array $filtros): Envelope
    {
        // a expressão vem de um `match` fechado sobre `DIVISOES` (validado) — nunca do payload
        $expressao = $dimensao === 'tipo' ? self::expressaoDoTipo() : self::AUTOR;

        $agregado = (clone $consulta)
            ->selectRaw("({$expressao}) as chave, COUNT(*) as acoes")
            // pelo ALIAS: o MariaDB não reconhece o CASE sobre JSON repetido no GROUP BY como a
            // mesma expressão do SELECT (ONLY_FULL_GROUP_BY), e reprova `auditoria.acao`
            ->groupBy('chave')
            ->toBase()
            ->get()
            ->mapWithKeys(fn (object $linha): array => [(string) $linha->chave => (int) $linha->acoes]);

        $grupos = ($dimensao === 'tipo' ? self::gruposPorTipo($agregado) : self::gruposPorAutor($agregado))
            ->map(fn (array $grupo): array => ['titulo' => $grupo['titulo'], 'linhas' => [], 'totais' => ['acoes' => $grupo['acoes']]])
            ->values()->all();
        $filtros[] = ['rotulo' => 'Dividido por', 'valor' => self::ROTULO_DA_DIVISAO[$dimensao]];

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            colunas: [
                ['chave' => 'grupo', 'rotulo' => self::ROTULO_DA_DIVISAO[$dimensao], 'tipo' => 'texto'],
                ['chave' => 'acoes', 'rotulo' => 'Ações', 'tipo' => 'numero'],
            ],
            linhas: [],
            grupos: $grupos,
            totais: ['acoes' => (int) $agregado->sum()],
        );
    }

    /**
     * Na ordem fixa dos tipos (criado → excluído), só os que aconteceram.
     *
     * @param  Collection<string, int>  $agregado
     * @return Collection<int, array{titulo: string, acoes: int}>
     */
    private static function gruposPorTipo(Collection $agregado): Collection
    {
        return collect(self::ROTULO_DO_TIPO)
            ->filter(fn (string $rotulo, string $tipo): bool => $agregado->has($tipo))
            ->map(fn (string $rotulo, string $tipo): array => ['titulo' => $rotulo, 'acoes' => $agregado[$tipo]])
            ->values();
    }

    /**
     * Os usuários pelo nome (só `id,nome`), em ordem alfabética, e depois as
     * origens sem usuário (sistema, formulário público) — o resto, não o primeiro da lista.
     *
     * @param  Collection<string, int>  $agregado
     * @return Collection<int, array{titulo: string, acoes: int}>
     */
    private static function gruposPorAutor(Collection $agregado): Collection
    {
        $prefixo = 'usuario#';
        $ids = $agregado->keys()->filter(fn (string $chave): bool => str_starts_with($chave, $prefixo))
            ->map(fn (string $chave): int => (int) substr($chave, strlen($prefixo)))->values();
        $nomes = Usuario::whereIn('id', $ids)->pluck('nome', 'id');

        $grupos = $agregado->map(fn (int $acoes, string $chave): array => str_starts_with($chave, $prefixo)
            ? ['titulo' => (string) ($nomes[(int) substr($chave, strlen($prefixo))] ?? 'Usuário removido'), 'acoes' => $acoes, 'origem' => false]
            : ['titulo' => self::autor($chave, null), 'acoes' => $acoes, 'origem' => true]);

        return $grupos
            ->sortBy(fn (array $grupo): string => ($grupo['origem'] ? "\u{FFFF}" : '').mb_strtolower($grupo['titulo']))
            ->map(fn (array $grupo): array => ['titulo' => $grupo['titulo'], 'acoes' => $grupo['acoes']])
            ->values();
    }

    /**
     * A foto de cada lançamento citado: a ATUAL, e para o excluído a do `antes` do `excluiu`.
     * Só os campos da whitelist — lidos no SQL, a `obs` nunca é carregada.
     *
     * @param  Collection<int, int>  $ids
     * @return Collection<int, array{tipo: string|null, interessado_tipo: string|null, interessado_id: int|null, liquido: string|null}>
     */
    private function fotosDosLancamentos(Collection $ids): Collection
    {
        if ($ids->isEmpty()) {
            return collect();
        }

        $fotos = LancamentoCaixa::whereIn('id', $ids)
            ->get(['id', 'tipo', 'interessado_tipo', 'interessado_id', 'valor', 'juros', 'multa', 'desconto'])
            ->mapWithKeys(fn (LancamentoCaixa $l): array => [$l->id => [
                'tipo' => $l->tipo, 'interessado_tipo' => $l->interessado_tipo,
                'interessado_id' => $l->interessado_id, 'liquido' => $l->liquido,
            ]]);

        $this->excluidos('lancamentos_caixa', $ids->diff($fotos->keys()), [
            'tipo', 'interessado_tipo', 'interessado_id', 'valor', 'juros', 'multa', 'desconto',
        ])->each(function (object $antes) use (&$fotos): void {
            $fotos[(int) $antes->entidade_id] = [
                'tipo' => $antes->tipo,
                'interessado_tipo' => $antes->interessado_tipo,
                'interessado_id' => $antes->interessado_id === null ? null : (int) $antes->interessado_id,
                'liquido' => self::liquidoDoInstantaneo($antes),
            ];
        });

        return $fotos;
    }

    /**
     * @param  Collection<int, int>  $ids
     * @return Collection<int, array{conta_origem_id: int|null, conta_destino_id: int|null, valor: string|null}>
     */
    private function fotosDasTransferencias(Collection $ids): Collection
    {
        if ($ids->isEmpty()) {
            return collect();
        }

        $fotos = Transferencia::whereIn('id', $ids)
            ->get(['id', 'conta_origem_id', 'conta_destino_id', 'valor'])
            ->mapWithKeys(fn (Transferencia $t): array => [$t->id => [
                'conta_origem_id' => $t->conta_origem_id, 'conta_destino_id' => $t->conta_destino_id, 'valor' => (string) $t->valor,
            ]]);

        $this->excluidos('transferencias', $ids->diff($fotos->keys()), ['conta_origem_id', 'conta_destino_id', 'valor'])
            ->each(function (object $antes) use (&$fotos): void {
                $fotos[(int) $antes->entidade_id] = [
                    'conta_origem_id' => $antes->conta_origem_id === null ? null : (int) $antes->conta_origem_id,
                    'conta_destino_id' => $antes->conta_destino_id === null ? null : (int) $antes->conta_destino_id,
                    'valor' => is_numeric($antes->valor) ? bcadd((string) $antes->valor, '0', 2) : null,
                ];
            });

        return $fotos;
    }

    /**
     * O instantâneo `antes` que o `excluiu` gravou, só com os `$campos` pedidos — cada um lido do
     * JSON no SQL (`JSON_VALUE`: o JSON null e o ausente viram NULL). Os nomes de campo vêm das
     * listas fixas acima, nunca do payload.
     *
     * @param  Collection<int, int>  $ids
     * @param  list<string>  $campos
     * @return Collection<int, object>
     */
    private function excluidos(string $entidade, Collection $ids, array $campos): Collection
    {
        if ($ids->isEmpty()) {
            return collect();
        }

        $colunas = implode(', ', array_map(
            fn (string $campo): string => "JSON_VALUE(auditoria.diff_json, '$.antes.{$campo}') as {$campo}",
            $campos,
        ));

        return Auditoria::query()
            ->where('auditoria.entidade', $entidade)
            ->where('auditoria.acao', 'excluiu')
            ->whereIn('auditoria.entidade_id', $ids->values())
            ->select('auditoria.entidade_id')
            ->selectRaw($colunas)
            ->orderBy('auditoria.id')
            ->toBase()
            ->get();
    }

    /** O líquido do instantâneo, em decimal; sem valor legível, nulo (a tela mostra "—"). */
    private static function liquidoDoInstantaneo(object $antes): ?string
    {
        if (! is_numeric($antes->valor)) {
            return null;
        }
        $parcela = fn (mixed $valor): string => is_numeric($valor) ? (string) $valor : '0';

        return bcsub(bcadd(bcadd($parcela($antes->valor), $parcela($antes->juros), 2), $parcela($antes->multa), 2), $parcela($antes->desconto), 2);
    }

    /**
     * @param  array{tipo: string|null, interessado_tipo: string|null, interessado_id: int|null, liquido: string|null}|null  $foto
     * @param  Collection<string, string>  $pessoas
     * @return array{registro: string, natureza: string, pessoa: string, valor: string|null}
     */
    private static function doLancamento(int $id, ?array $foto, Collection $pessoas): array
    {
        if ($foto === null) {
            // apagado sem deixar o instantâneo (antes da trilha existir): diz isso, não inventa
            return ['registro' => "Lançamento nº {$id}", 'natureza' => LancamentosNoRelatorio::SEM_VALOR, 'pessoa' => 'Lançamento excluído', 'valor' => null];
        }

        return [
            'registro' => "Lançamento nº {$id}",
            'natureza' => match ($foto['tipo']) {
                'receita' => 'Receita',
                'despesa' => 'Despesa',
                default => LancamentosNoRelatorio::SEM_VALOR,
            },
            'pessoa' => LancamentosNoRelatorio::pessoa($pessoas, $foto['interessado_tipo'], $foto['interessado_id']),
            'valor' => $foto['liquido'],
        ];
    }

    /**
     * @param  array{conta_origem_id: int|null, conta_destino_id: int|null, valor: string|null}|null  $foto
     * @param  Collection<int, string>  $contas
     * @return array{registro: string, natureza: string, pessoa: string, valor: string|null}
     */
    private static function daTransferencia(int $id, ?array $foto, Collection $contas): array
    {
        if ($foto === null) {
            return ['registro' => "Transferência nº {$id}", 'natureza' => 'Transferência', 'pessoa' => 'Transferência excluída', 'valor' => null];
        }

        $conta = fn (?int $contaId): string => (string) ($contas[$contaId] ?? LancamentosNoRelatorio::SEM_VALOR);

        return [
            'registro' => "Transferência nº {$id}",
            'natureza' => 'Transferência',
            'pessoa' => $conta($foto['conta_origem_id']).' → '.$conta($foto['conta_destino_id']),
            'valor' => $foto['valor'],
        ];
    }

    /** Os três autores da trilha, como o `AuditoriaResource` os nomeia. */
    private static function autor(string $autorTipo, ?string $nomeDoUsuario): string
    {
        return OrigemDaOperacao::rotulo($autorTipo, $nomeDoUsuario);
    }

    /**
     * @param  array<string, mixed>  $parametros
     * @return list<array{rotulo: string, valor: string}>
     */
    private function filtrosAplicados(array $parametros): array
    {
        $filtros = [['rotulo' => 'Base', 'valor' => self::BASE]];

        if (isset($parametros['tipo'])) {
            $filtros[] = ['rotulo' => 'Movimentação', 'valor' => self::ROTULO_DO_TIPO[$parametros['tipo']]];
        }

        return $filtros;
    }
}
