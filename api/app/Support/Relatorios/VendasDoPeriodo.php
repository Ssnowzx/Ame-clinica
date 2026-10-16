<?php

namespace App\Support\Relatorios;

use App\Models\Categoria;
use App\Models\LancamentoCaixa;
use App\Models\Profissional;
use App\Models\Servico;
use App\Support\Rbac\Escopo;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Relatório `vendas-do-periodo` — "Vendas do período" (change `relatorios-do-caixa`): quanto a
 * clínica vendeu. As RECEITAS cuja COMPETÊNCIA (o mês do serviço) cai no período, pagas ou não
 * (D1). No ClinicaÁgil, "Vendas" e "Resultado Mês" — o mesmo relatório com duas colunas a mais.
 *
 * O profissional da venda é o MESMO do "Recebido por profissional" (D4): quem atendeu a sessão
 * faturada, senão o dono do tratamento vinculado. A regra não é reescrita — a expressão e os
 * joins vêm de `RecebidoPorProfissional` (`PROFISSIONAL_ATRIBUIDO`, `comAtribuicao()`). O serviço
 * vem do tratamento; as sessões são `sessoes_realizadas/sessoes_total` do pacote.
 *
 * As colunas de dinheiro são as chaves dos totais: vendido (tudo), recebido (o que já tem
 * `pago_em`) e em aberto (o resto). Somas no banco pelo líquido (D2).
 *
 * Exige `lancamentos.ver`, `fluxo_caixa.ver` (total da clínica) E `tratamentos.ver` (a linha
 * nomeia serviço e terapeuta de cada criança, como o Recebido por profissional — SEC-RPP-10). Sai
 * com o nome da criança (AP-09). Sem eixo: quem vê o total da clínica vê todos os profissionais.
 */
final class VendasDoPeriodo implements Relatorio
{
    /** @var list<string> */
    public const RESULTADOS = ['analitico', 'sintetico'];

    /** @var list<string> */
    public const DIVISOES = ['servico', 'profissional', 'categoria'];

    public const BASE = 'Pela competência (o mês do serviço), pago ou não';

    private const ROTULO_DA_DIVISAO = ['servico' => 'Serviço', 'profissional' => 'Profissional', 'categoria' => 'Categoria'];

    /** As colunas de dinheiro — chave da coluna = chave do total. */
    private const DINHEIRO = ['vendido' => 'Vendido', 'recebido' => 'Recebido', 'em_aberto' => 'Em aberto'];

    public function __construct(private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS) {}

    public function slug(): string
    {
        return 'vendas-do-periodo';
    }

    public function titulo(): string
    {
        return 'Vendas do período';
    }

    public function permissoes(): array
    {
        return ['lancamentos.ver', 'fluxo_caixa.ver', 'tratamentos.ver'];
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
            'categoria_id' => LancamentosNoRelatorio::regrasDeContaECategoria()['categoria_id'],
            'profissional_id' => ['sometimes', 'integer', Rule::exists('profissionais', 'id')],
            'servico_id' => ['sometimes', 'integer', Rule::exists('servicos', 'id')],
        ];
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        // venda é receita: uma categoria de despesa aqui é pedido incoerente (422, não folha vazia)
        LancamentosNoRelatorio::assegurarCategoriaDaNatureza($parametros, 'receita');

        $consulta = $this->consulta($parametros);
        $periodo = ['de' => $parametros['de'], 'ate' => $parametros['ate']];
        $filtros = $this->filtrosAplicados($parametros);

        if (($parametros['resultado'] ?? 'analitico') === 'sintetico') {
            return $this->sintetico($consulta, $parametros['dividir_por'], $periodo, $filtros);
        }

        return $this->analitico($consulta, $periodo, $filtros);
    }

    /**
     * O recorte: receitas com competência no período, com os joins da atribuição (os do Recebido
     * por profissional). O filtro de profissional usa a MESMA
     * expressão que atribui — filtrar pela coluna do tratamento daria ao dono do pacote a sessão
     * que outra pessoa atendeu (CR-RPP-01).
     *
     * @param  array<string, mixed>  $parametros
     * @return Builder<LancamentoCaixa>
     */
    private function consulta(array $parametros): Builder
    {
        return RecebidoPorProfissional::comAtribuicao(LancamentoCaixa::query())
            ->where('lancamentos_caixa.tipo', 'receita')
            ->whereBetween('lancamentos_caixa.competencia', [$parametros['de'], $parametros['ate']])
            ->when($parametros['categoria_id'] ?? null, fn (Builder $q, $id) => $q->where('lancamentos_caixa.categoria_id', $id))
            ->when($parametros['profissional_id'] ?? null, fn (Builder $q, $id) => $q
                ->whereRaw(RecebidoPorProfissional::PROFISSIONAL_ATRIBUIDO.' = ?', [$id]))
            ->when($parametros['servico_id'] ?? null, fn (Builder $q, $id) => $q->where('tratamentos.servico_id', $id));
    }

    /** As somas de UMA query, pelo líquido: tudo o que foi vendido, o pago e o em aberto. */
    private function somas(): string
    {
        $liquido = LancamentoCaixa::LIQUIDO_SQL;

        return "COALESCE(SUM({$liquido}), 0) as vendido, "
            ."COALESCE(SUM(CASE WHEN lancamentos_caixa.pago_em IS NOT NULL THEN {$liquido} ELSE 0 END), 0) as recebido, "
            ."COALESCE(SUM(CASE WHEN lancamentos_caixa.pago_em IS NULL THEN {$liquido} ELSE 0 END), 0) as em_aberto, "
            .'COUNT(*) as vendas';
    }

    /**
     * Uma linha por venda. Colunas lidas em whitelist no SQL (`obs`/`documento` nunca entram);
     * nomes em lote, um `whereIn` por cadastro.
     *
     * @param  Builder<LancamentoCaixa>  $consulta
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function analitico(Builder $consulta, array $periodo, array $filtros): Envelope
    {
        $brutas = (clone $consulta)
            ->select(LancamentosNoRelatorio::COLUNAS)
            ->selectRaw(RecebidoPorProfissional::PROFISSIONAL_ATRIBUIDO.' as profissional_ref')
            ->selectRaw('tratamentos.servico_id as servico_ref, tratamentos.sessoes_realizadas as sessoes_realizadas_ref, tratamentos.sessoes_total as sessoes_total_ref')
            ->orderBy('lancamentos_caixa.competencia')
            ->orderBy('lancamentos_caixa.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;
        $brutas = $brutas->take($this->limiteDeLinhas);
        $nomes = LancamentosNoRelatorio::nomes($brutas);
        $profissionais = Profissional::whereIn('id', $brutas->pluck('profissional_ref')->filter()->unique()->values())->pluck('nome', 'id');
        $servicos = self::nomesDosServicos($brutas->pluck('servico_ref')->filter()->unique()->values());

        $linhas = $brutas->map(fn (LancamentoCaixa $l): array => [
            'competencia' => $l->competencia->format('Y-m-d'),
            'pessoa' => LancamentosNoRelatorio::pessoa($nomes['pessoas'], $l->interessado_tipo, $l->interessado_id),
            'servico' => (string) ($servicos[$l->servico_ref] ?? LancamentosNoRelatorio::SEM_VALOR),
            'profissional' => (string) ($profissionais[$l->profissional_ref] ?? LancamentosNoRelatorio::SEM_VALOR),
            'sessoes' => $l->sessoes_total_ref === null ? null : "{$l->sessoes_realizadas_ref}/{$l->sessoes_total_ref} sessões",
            'situacao' => $l->pago_em === null ? 'Em aberto' : 'Pago em '.$l->pago_em->format('d/m'),
            'vendido' => $l->liquido,
            'recebido' => $l->pago_em === null ? null : $l->liquido,
            'em_aberto' => $l->pago_em === null ? $l->liquido : null,
        ])->values()->all();

        $somas = (clone $consulta)->selectRaw($this->somas())->toBase()->first();

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            colunas: [
                ['chave' => 'competencia', 'rotulo' => 'Competência', 'tipo' => 'data'],
                ['chave' => 'pessoa', 'rotulo' => 'Pessoa', 'tipo' => 'texto'],
                ['chave' => 'servico', 'rotulo' => 'Serviço', 'tipo' => 'texto'],
                ['chave' => 'profissional', 'rotulo' => 'Profissional', 'tipo' => 'texto'],
                ['chave' => 'sessoes', 'rotulo' => 'Sessões do pacote', 'tipo' => 'texto'],
                ['chave' => 'situacao', 'rotulo' => 'Situação', 'tipo' => 'texto'],
                ...LancamentosNoRelatorio::colunasDeDinheiro(self::DINHEIRO),
            ],
            linhas: $linhas,
            grupos: null,
            totais: LancamentosNoRelatorio::totaisDeDinheiro($somas, array_keys(self::DINHEIRO)),
            truncado: $truncado,
        );
    }

    /**
     * Por serviço, profissional (a MESMA atribuição) ou categoria — grupos e total do mesmo
     * GROUP BY. O serviço é "Procedimento (Convênio)", porque o serviço é a dupla.
     *
     * @param  Builder<LancamentoCaixa>  $consulta
     * @param  array{de: string, ate: string}  $periodo
     * @param  list<array{rotulo: string, valor: string}>  $filtros
     */
    private function sintetico(Builder $consulta, string $dimensao, array $periodo, array $filtros): Envelope
    {
        // a expressão vem de um `match` fechado sobre `DIVISOES` (validado) — nunca do payload
        [$expressao, $titulos, $semValor] = match ($dimensao) {
            'servico' => ['tratamentos.servico_id', fn (Collection $ids): Collection => self::nomesDosServicos($ids), 'Sem serviço'],
            'profissional' => [RecebidoPorProfissional::PROFISSIONAL_ATRIBUIDO, fn (Collection $ids): Collection => Profissional::whereIn('id', $ids)->pluck('nome', 'id'), 'Sem profissional'],
            'categoria' => ['lancamentos_caixa.categoria_id', fn (Collection $ids): Collection => Categoria::whereIn('id', $ids)->pluck('nome', 'id'), 'Sem categoria'],
        };

        $sintetico = LancamentosNoRelatorio::sintetico(
            $consulta, $expressao, $this->somas(), [], array_keys(self::DINHEIRO), 'vendas', $titulos, $semValor,
        );
        $filtros[] = ['rotulo' => 'Dividido por', 'valor' => self::ROTULO_DA_DIVISAO[$dimensao]];

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: $periodo,
            filtrosAplicados: $filtros,
            colunas: [
                ['chave' => 'grupo', 'rotulo' => self::ROTULO_DA_DIVISAO[$dimensao], 'tipo' => 'texto'],
                ...LancamentosNoRelatorio::colunasDeDinheiro(self::DINHEIRO),
                ['chave' => 'vendas', 'rotulo' => 'Vendas', 'tipo' => 'numero'],
            ],
            linhas: [],
            grupos: $sintetico['grupos'],
            totais: $sintetico['totais'],
        );
    }

    /**
     * @param  array<string, mixed>  $parametros
     * @return list<array{rotulo: string, valor: string}>
     */
    private function filtrosAplicados(array $parametros): array
    {
        $filtros = [
            ['rotulo' => 'Base', 'valor' => self::BASE],
            ...LancamentosNoRelatorio::filtrosDeContaECategoria($parametros),
        ];

        if (isset($parametros['profissional_id'])) {
            $filtros[] = ['rotulo' => 'Profissional', 'valor' => (string) Profissional::whereKey($parametros['profissional_id'])->value('nome')];
        }
        if (isset($parametros['servico_id'])) {
            $filtros[] = ['rotulo' => 'Serviço', 'valor' => (string) Servico::whereKey($parametros['servico_id'])->value('procedimento')];
        }

        return $filtros;
    }

    /**
     * O nome do serviço COM o convênio — o mesmo no analítico e no sintético: o serviço é por
     * convênio, e "Sessão" de dois convênios não pode sair igual (nit do gate CR-API2).
     *
     * @param  Collection<int, mixed>  $ids
     * @return Collection<int, string>
     */
    private static function nomesDosServicos(Collection $ids): Collection
    {
        return Servico::whereIn('id', $ids)->with('convenio:id,nome')->get(['id', 'procedimento', 'convenio_id'])
            ->mapWithKeys(fn (Servico $s): array => [$s->id => $s->convenio === null ? $s->procedimento : "{$s->procedimento} ({$s->convenio->nome})"]);
    }
}
