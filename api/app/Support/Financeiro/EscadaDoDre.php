<?php

namespace App\Support\Financeiro;

/**
 * A escada do DRE gerencial (change `dre-gerencial`, D1): padrão contábil, IGUAL para toda
 * clínica — mudá-la por clínica quebraria a leitura do contador. A escolha de qual linha recebe
 * cada categoria é dado da clínica (`categorias.linha_dre`, `subcategorias.linha_dre`).
 *
 * Nenhuma categoria fica fora (D2): sem escolha, vale o padrão da natureza. É o que o DRE do
 * ClinicaÁgil não fazia — sem configurar, ficava zerado sem dizer por quê, e a clínica nunca o usou.
 */
final class EscadaDoDre
{
    /**
     * As linhas de VALOR: código → rótulo, natureza que aceita e a frase do que entra nela.
     *
     * @var array<string, array{rotulo: string, natureza: string, explicacao: string}>
     */
    public const LINHAS = [
        'servicos' => ['rotulo' => 'Prestação de serviços', 'natureza' => 'receita', 'explicacao' => 'O que as famílias e os convênios pagam pelos atendimentos.'],
        'outras_receitas' => ['rotulo' => 'Outras receitas operacionais', 'natureza' => 'receita', 'explicacao' => 'Aluguel de sala, venda de material e o que mais a clínica receber que não é atendimento.'],
        'impostos' => ['rotulo' => 'Impostos sobre o faturamento', 'natureza' => 'despesa', 'explicacao' => 'Simples Nacional, ISS e os outros impostos calculados sobre o que a clínica fatura.'],
        'repasse' => ['rotulo' => 'Repasse a profissionais', 'natureza' => 'despesa', 'explicacao' => 'O que a clínica paga aos profissionais pelos atendimentos.'],
        'insumos' => ['rotulo' => 'Material e insumos do atendimento', 'natureza' => 'despesa', 'explicacao' => 'Material terapêutico e o que se gasta dentro da sessão.'],
        'pessoal' => ['rotulo' => 'Despesas com pessoal', 'natureza' => 'despesa', 'explicacao' => 'Salários, encargos e benefícios da equipe fixa: recepção, limpeza, administração.'],
        'administrativas' => ['rotulo' => 'Despesas administrativas', 'natureza' => 'despesa', 'explicacao' => 'Aluguel, luz, água, internet, sistema, contador e manutenção.'],
        'comerciais' => ['rotulo' => 'Despesas comerciais e de divulgação', 'natureza' => 'despesa', 'explicacao' => 'Anúncios, redes sociais e material de divulgação.'],
        'receitas_financeiras' => ['rotulo' => 'Receitas financeiras', 'natureza' => 'receita', 'explicacao' => 'Rendimento de aplicação e juros recebidos.'],
        'despesas_financeiras' => ['rotulo' => 'Despesas financeiras', 'natureza' => 'despesa', 'explicacao' => 'Tarifas bancárias, taxas de cartão e juros pagos.'],
        'investimentos' => ['rotulo' => 'Investimentos', 'natureza' => 'despesa', 'explicacao' => 'Equipamento, móveis e reforma — o que dura mais de um ano.'],
        'emprestimos' => ['rotulo' => 'Empréstimos e financiamentos', 'natureza' => 'despesa', 'explicacao' => 'Parcelas de empréstimo e de financiamento pagas.'],
    ];

    /** Sem escolha, a linha da natureza (D2). */
    public const PADRAO = ['receita' => 'servicos', 'despesa' => 'administrativas'];

    /**
     * A escada, na ordem: grupos (com as suas linhas de valor) e subtotais. O subtotal é a soma COM
     * SINAL de tudo o que veio antes — Receita líquida = bruta − deduções, e assim por diante. O
     * rótulo do subtotal NÃO começa com "=" (CR-API1-06): a planilha neutraliza texto que parece
     * fórmula, e o contador receberia "'= Receita líquida"; o realce vem da marca `destaque`.
     *
     * @var list<array{tipo: 'grupo'|'subtotal', codigo: string, rotulo: string, linhas?: list<string>, explicacao: string}>
     */
    public const ESCADA = [
        ['tipo' => 'grupo', 'codigo' => 'receita_bruta', 'rotulo' => 'Receita bruta', 'linhas' => ['servicos', 'outras_receitas'], 'explicacao' => 'Tudo o que entrou pela atividade da clínica.'],
        ['tipo' => 'grupo', 'codigo' => 'deducoes', 'rotulo' => '(−) Deduções', 'linhas' => ['impostos'], 'explicacao' => 'O que sai do faturamento antes de qualquer custo: os impostos sobre ele.'],
        ['tipo' => 'subtotal', 'codigo' => 'receita_liquida', 'rotulo' => 'Receita líquida', 'explicacao' => 'O que sobra do faturamento depois dos impostos.'],
        ['tipo' => 'grupo', 'codigo' => 'custos', 'rotulo' => '(−) Custos do atendimento', 'linhas' => ['repasse', 'insumos'], 'explicacao' => 'O que a clínica gasta para cada atendimento acontecer.'],
        ['tipo' => 'subtotal', 'codigo' => 'lucro_bruto', 'rotulo' => 'Lucro bruto', 'explicacao' => 'Quanto o atendimento deixa para a clínica pagar a estrutura.'],
        ['tipo' => 'grupo', 'codigo' => 'despesas_operacionais', 'rotulo' => '(−) Despesas operacionais', 'linhas' => ['pessoal', 'administrativas', 'comerciais'], 'explicacao' => 'O custo de manter a clínica aberta, com ou sem atendimento.'],
        ['tipo' => 'subtotal', 'codigo' => 'resultado_operacional', 'rotulo' => 'Resultado operacional', 'explicacao' => 'O lucro (ou prejuízo) da operação da clínica.'],
        ['tipo' => 'grupo', 'codigo' => 'resultado_financeiro', 'rotulo' => '(±) Resultado financeiro', 'linhas' => ['receitas_financeiras', 'despesas_financeiras'], 'explicacao' => 'O que o dinheiro rendeu menos o que custou (tarifas, juros, taxas).'],
        ['tipo' => 'subtotal', 'codigo' => 'resultado_liquido', 'rotulo' => 'Resultado líquido', 'explicacao' => 'O lucro (ou prejuízo) do período.'],
        ['tipo' => 'grupo', 'codigo' => 'investimentos_emprestimos', 'rotulo' => '(−) Investimentos e empréstimos', 'linhas' => ['investimentos', 'emprestimos'], 'explicacao' => 'O que saiu do caixa para o futuro da clínica ou para pagar dívidas.'],
        ['tipo' => 'subtotal', 'codigo' => 'resultado_final', 'rotulo' => 'Resultado final', 'explicacao' => 'Quanto sobrou (ou faltou) no caixa depois de tudo.'],
    ];

    public static function existe(string $linha): bool
    {
        return isset(self::LINHAS[$linha]);
    }

    /** A linha aceita categoria desta natureza? (D5 — despesa nunca entra numa linha de receita) */
    public static function aceita(string $linha, string $natureza): bool
    {
        return (self::LINHAS[$linha]['natureza'] ?? null) === $natureza;
    }

    /** O valor da linha COM o sinal da escada: receita soma, despesa subtrai. */
    public static function comSinal(string $linha, string $valor): string
    {
        return self::LINHAS[$linha]['natureza'] === 'despesa' ? bcmul($valor, '-1', 2) : bcadd($valor, '0', 2);
    }

    /** A linha efetiva: a da subcategoria, senão a da categoria, senão o padrão da natureza. */
    public static function efetiva(?string $daSubcategoria, ?string $daCategoria, string $natureza): string
    {
        return $daSubcategoria ?? $daCategoria ?? self::PADRAO[$natureza];
    }

    /**
     * A linha escolhida em SQL — a da subcategoria, senão a da categoria, senão o padrão pela
     * natureza do LANÇAMENTO (CR-API1-01: a do lançamento, nunca a da categoria, que pode ter sido
     * corrigida depois). Quem soma confere com `aceita()` e cai no padrão se não casar.
     */
    public static function efetivaSql(): string
    {
        return "COALESCE(subcategorias.linha_dre, categorias.linha_dre, CASE lancamentos_caixa.tipo WHEN 'receita' THEN '"
            .self::PADRAO['receita']."' ELSE '".self::PADRAO['despesa']."' END)";
    }

    /**
     * A linha que o valor de fato ocupa: a escolhida, se existe e aceita a natureza do lançamento;
     * senão o padrão dessa natureza. Uma despesa NUNCA soma numa linha de receita — nem com a
     * linha gravada antes de a natureza da categoria mudar, nem com um código que saiu da escada.
     */
    public static function linhaParaSomar(string $escolhida, string $natureza): string
    {
        return self::aceita($escolhida, $natureza) ? $escolhida : self::PADRAO[$natureza];
    }
}
