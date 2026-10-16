<?php

namespace App\Support\Relatorios;

use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\Escopo;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Validation\Rule;

/**
 * Relatório `extrato-do-paciente` (change `area-de-relatorios`): os lançamentos de caixa de UMA
 * criança no período — data, descrição, categoria, valor, situação — com o que foi pago, o que
 * está em aberto e o saldo. Cobre, no ClinicaÁgil, "Extrato do Paciente". É a conta da família:
 * de CONFERÊNCIA (AP-09), com o nome; no eixo AGENDA, com portão por-id (ver `eixo()`).
 *
 * O vínculo é o INTERESSADO do lançamento (`interessado_tipo = paciente` + `interessado_id`) —
 * é o que o faturamento grava e o que a seção Financeiro da ficha lê. A data do extrato é o
 * VENCIMENTO, como na ficha (o fluxo de caixa, por `pago_em`, é outra vista). O valor é o
 * LÍQUIDO (valor + juros + multa − desconto), o mesmo que a ficha mostra; uma despesa em nome
 * da criança (estorno, devolução) entra NEGATIVA — o saldo é o que a família ainda deve.
 *
 * Situação: `pago_em` preenchido → Pago; senão, vencimento anterior a hoje na parede da
 * clínica → Vencido; senão, Em aberto. Totais somados NO BANCO em decimal (lição CR-04).
 */
final class ExtratoDoPaciente implements Relatorio
{
    /** O líquido com sinal: receita soma, despesa subtrai. */
    private const LIQUIDO_COM_SINAL = LancamentoCaixa::LIQUIDO_COM_SINAL_SQL;

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EscopoDoProfissional $escopos,
        private readonly int $limiteDeLinhas = Envelope::LIMITE_DE_LINHAS,
    ) {}

    public function slug(): string
    {
        return 'extrato-do-paciente';
    }

    public function titulo(): string
    {
        return 'Extrato do paciente';
    }

    /**
     * `lancamentos.ver` E `agenda.ver` (`SEC-REL-02`/`CRR-05`).
     *
     * A segunda não é enfeite: o campo de busca de paciente desta tela já depende de
     * `agenda.ver` (é `GET /agenda/selecao/pacientes` quem o alimenta), e é o eixo agenda que
     * o portão abaixo consulta. Declarando só `lancamentos.ver`, a permissão MENTIA sobre o
     * que o relatório de fato exige.
     *
     * @return list<string>
     */
    public function permissoes(): array
    {
        return ['lancamentos.ver', 'agenda.ver'];
    }

    /**
     * Eixo AGENDA (`SEC-REL-02`/`CRR-05`) — era `null`, e `null` aqui era passe livre.
     *
     * Este é o ÚNICO relatório que lê dado de UMA criança POR ID, e ele não passava por portão
     * nenhum: quem tivesse `lancamentos.ver` lia o extrato de QUALQUER criança e, pior,
     * descobria o NOME por força bruta de id — 200 com o nome no cabeçalho mesmo sem lançamento
     * nenhum, 422 quando o id não existia. O eixo agenda é o certo porque é o OPERACIONAL (§12):
     * Faturista e Secretaria têm `agenda.ver_todos` e não perdem nada; o terapeuta precisa de
     * vínculo com a criança; e quem não tem flag nem vínculo é `nenhum` e não passa.
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
        // a criança existe (id inexistente → 422)
        return [
            'paciente_id' => ['required', 'integer', Rule::exists('pacientes', 'id')],
        ];
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        // PORTÃO ANTES DE QUALQUER LEITURA (`SEC-REL-02`): criança fora do escopo responde 403 —
        // e responde 403 TAMBÉM quando ela não tem lançamento nenhum, que era o caso em que o
        // cabeçalho "Paciente: <nome>" vazava o nome com a lista vazia.
        $this->escopos->assegurarPaciente($escopo, (int) $parametros['paciente_id']);

        $hoje = now((string) $this->configuracoes->get('clinica.timezone'))->toDateString();

        $consulta = LancamentoCaixa::query()
            ->where('lancamentos_caixa.interessado_tipo', 'paciente')
            ->where('lancamentos_caixa.interessado_id', $parametros['paciente_id'])
            ->whereBetween('lancamentos_caixa.vencimento', [$parametros['de'], $parametros['ate']]);

        // os totais são do RECORTE inteiro, somados no banco — não das linhas carregadas
        $somas = (clone $consulta)->selectRaw(
            'COALESCE(SUM(CASE WHEN lancamentos_caixa.pago_em IS NOT NULL THEN '.self::LIQUIDO_COM_SINAL.' ELSE 0 END), 0) as pago, '
            .'COALESCE(SUM(CASE WHEN lancamentos_caixa.pago_em IS NULL THEN '.self::LIQUIDO_COM_SINAL.' ELSE 0 END), 0) as em_aberto'
        )->first();
        $pago = bcadd((string) $somas->pago, '0', 2);
        $emAberto = bcadd((string) $somas->em_aberto, '0', 2);

        $brutas = (clone $consulta)
            ->with(['categoria:id,nome', 'subcategoria:id,nome'])
            ->orderBy('lancamentos_caixa.vencimento')
            ->orderBy('lancamentos_caixa.id')
            ->limit($this->limiteDeLinhas + 1)
            ->get();

        $truncado = $brutas->count() > $this->limiteDeLinhas;

        // whitelist explícita: `obs` (texto livre, sensível) nunca sai; documento e parcela sim
        $linhas = $brutas->take($this->limiteDeLinhas)->map(fn (LancamentoCaixa $l): array => [
            'data' => $l->vencimento->format('Y-m-d'),
            'descricao' => $this->descricao($l),
            'categoria' => $l->subcategoria === null
                ? (string) $l->categoria?->nome
                : "{$l->categoria?->nome} › {$l->subcategoria->nome}",
            'valor' => $l->tipo === 'despesa' ? bcmul($l->liquido, '-1', 2) : $l->liquido,
            'situacao' => match (true) {
                $l->pago_em !== null => 'Pago',
                $l->vencimento->toDateString() < $hoje => 'Vencido',
                default => 'Em aberto',
            },
            'pago_em' => $l->pago_em?->format('Y-m-d') ?? '',
        ])->values()->all();

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: ['de' => $parametros['de'], 'ate' => $parametros['ate']],
            filtrosAplicados: [
                ['rotulo' => 'Paciente', 'valor' => (string) Paciente::whereKey($parametros['paciente_id'])->value('nome')],
            ],
            colunas: [
                ['chave' => 'data', 'rotulo' => 'Vencimento', 'tipo' => 'data'],
                ['chave' => 'descricao', 'rotulo' => 'Descrição', 'tipo' => 'texto'],
                ['chave' => 'categoria', 'rotulo' => 'Categoria', 'tipo' => 'texto'],
                ['chave' => 'valor', 'rotulo' => 'Valor', 'tipo' => 'dinheiro'],
                ['chave' => 'situacao', 'rotulo' => 'Situação', 'tipo' => 'texto'],
                ['chave' => 'pago_em', 'rotulo' => 'Pago em', 'tipo' => 'data'],
            ],
            linhas: $linhas,
            grupos: null,
            // saldo = o que a família ainda deve (em aberto), nunca pago − em aberto
            totais: ['pago' => $pago, 'em_aberto' => $emAberto, 'saldo' => $emAberto],
            truncado: $truncado,
        );
    }

    /**
     * O lançamento não tem "descrição" própria: ela é derivada do que ele É — a sessão
     * faturada (pela competência, que é a data da sessão), o tratamento, ou um lançamento
     * avulso —, mais o documento e a parcela quando existem.
     */
    private function descricao(LancamentoCaixa $lancamento): string
    {
        $base = match (true) {
            $lancamento->agendamento_id !== null => 'Sessão de '.$lancamento->competencia->format('d/m/Y'),
            $lancamento->tratamento_id !== null => 'Tratamento',
            default => $lancamento->tipo === 'despesa' ? 'Despesa' : 'Receita',
        };

        if ($lancamento->documento !== null && $lancamento->documento !== '') {
            $base .= " · Doc. {$lancamento->documento}";
        }
        if ($lancamento->parcelas_total !== null) {
            $base .= " ({$lancamento->parcela}/{$lancamento->parcelas_total})";
        }

        return $base;
    }
}
