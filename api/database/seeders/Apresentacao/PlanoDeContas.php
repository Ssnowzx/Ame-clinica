<?php

namespace Database\Seeders\Apresentacao;

use Illuminate\Support\Facades\DB;

/**
 * O plano de contas com TODAS as linhas do DRE ocupadas (categoria sem linha faz o
 * relatório mostrar o aviso de "linha não configurada"), as contas, as maquininhas, a
 * folha (funcionários) e os fornecedores que as despesas citam.
 */
final class PlanoDeContas
{
    /** categoria → [tipo, linha_dre, [subcategoria → linha_dre|null]] */
    private const CATEGORIAS = [
        'Atendimentos' => ['receita', 'servicos', ['Sessões particulares' => null, 'Faturamento de convênios' => null, 'Avaliações' => null]],
        'Receitas financeiras' => ['receita', 'receitas_financeiras', ['Rendimento de aplicação' => null]],
        'Outras receitas' => ['receita', 'outras_receitas', ['Aluguel de sala' => null]],
        'Despesas da clínica' => ['despesa', 'administrativas', ['Aluguel e condomínio' => null, 'Energia, água e internet' => null,
            'Contabilidade' => null, 'Software e sistemas' => null, 'Manutenção e limpeza' => null]],
        'Pessoal' => ['despesa', 'pessoal', ['Salários' => null, 'Encargos e benefícios' => null]],
        'Repasse aos profissionais' => ['despesa', 'repasse', ['Repasse mensal' => null]],
        'Impostos' => ['despesa', 'impostos', ['Simples Nacional' => null]],
        'Materiais terapêuticos' => ['despesa', 'insumos', ['Brinquedos e jogos' => null, 'Material de consumo' => null]],
        'Marketing' => ['despesa', 'comerciais', ['Anúncios on-line' => null]],
        'Despesas bancárias' => ['despesa', 'despesas_financeiras', ['Tarifas e taxas de cartão' => null]],
        'Investimentos' => ['despesa', 'investimentos', ['Equipamentos' => null]],
    ];

    public function __construct(private readonly Contexto $ctx) {}

    public function semear(): void
    {
        $this->categorias();
        $this->contas();
        $this->pessoasDoFinanceiro();
    }

    private function categorias(): void
    {
        foreach (self::CATEGORIAS as $nome => [$tipo, $linha, $subcategorias]) {
            $existente = DB::table('categorias')->where('nome', $nome)->value('id');
            if ($existente !== null) {
                DB::table('categorias')->where('id', $existente)->update(['linha_dre' => $linha]);
                $id = (int) $existente;
            } else {
                $id = $this->ctx->inserir('categorias', ['nome' => $nome, 'tipo' => $tipo, 'linha_dre' => $linha]);
            }
            $this->ctx->ids["categoria:{$nome}"] = $id;
            foreach ($subcategorias as $sub => $linhaSub) {
                $this->ctx->ids["sub:{$sub}"] = $this->ctx->inserir('subcategorias', [
                    'categoria_id' => $id, 'nome' => $sub, 'linha_dre' => $linhaSub,
                ]);
            }
        }
        foreach (DB::table('tipos_pagamento')->pluck('id', 'nome') as $nome => $id) {
            $this->ctx->ids["pagamento:{$nome}"] = (int) $id;
        }
    }

    private function contas(): void
    {
        $inicio = $this->ctx->inicio->subDay()->toDateString();
        $caixa = (int) DB::table('contas')->orderBy('id')->value('id');
        DB::table('contas')->where('id', $caixa)->update(['nome' => 'Caixa da recepção', 'saldo_inicial' => 800, 'saldo_inicial_em' => $inicio]);
        $this->ctx->ids['conta:caixa'] = $caixa;
        $this->ctx->ids['conta:banco'] = $this->ctx->inserir('contas', ['nome' => 'Conta corrente · Banco Horizonte',
            'codigo_contabil' => '1.1.02', 'saldo_inicial' => 42000, 'saldo_inicial_em' => $inicio, 'ativo' => true]);
        $this->ctx->ids['conta:aplicacao'] = $this->ctx->inserir('contas', ['nome' => 'Aplicação · Reserva',
            'codigo_contabil' => '1.1.03', 'saldo_inicial' => 60000, 'saldo_inicial_em' => $inicio, 'ativo' => true]);

        $this->ctx->inserir('cartoes', ['nome' => 'Maquininha · Crédito', 'tipo' => 'credito', 'bandeira' => 'visa',
            'pct_a_vista' => 3.19, 'pct_parcelas' => json_encode(['2' => '4.49', '3' => '5.19', '4' => '5.89', '6' => '7.29', '10' => '10.09']),
            'dias_recebimento' => 30, 'conta_id' => $this->ctx->ids['conta:banco'], 'liquidar_auto' => true, 'antecipacao_credito' => false]);
        $this->ctx->inserir('cartoes', ['nome' => 'Maquininha · Débito', 'tipo' => 'debito', 'bandeira' => 'mastercard',
            'pct_a_vista' => 1.39, 'dias_recebimento' => 1, 'conta_id' => $this->ctx->ids['conta:banco'], 'liquidar_auto' => true]);
    }

    private function pessoasDoFinanceiro(): void
    {
        $elenco = new Elenco($this->ctx);
        foreach ([['Gisele Moreira Lima', 'Coordenadora administrativa'], ['Larissa Mendes Costa', 'Recepcionista'],
            ['Bruno Alves Pereira', 'Recepcionista'], ['Rosângela Dias Batista', 'Auxiliar de limpeza']] as $indice => [$nome, $funcao]) {
            $this->ctx->funcionarios[] = $this->ctx->inserir('funcionarios', [
                'nome' => $nome, 'funcao' => $funcao, 'nascimento' => (1978 + $indice * 5).'-0'.($indice + 3).'-1'.$indice,
                'contatos_json' => json_encode([['tipo' => 'celular', 'valor' => $elenco->celular()]]),
                'endereco_json' => json_encode($elenco->endereco()), 'ativo' => true,
            ]);
        }

        $fornecedores = [
            ['Horizonte Administradora de Imóveis Ltda', 'Horizonte Imóveis', 'Despesas da clínica', 'Aluguel e condomínio'],
            ['Companhia Paulista de Energia (exemplo)', 'Energia', 'Despesas da clínica', 'Energia, água e internet'],
            ['Conecta Fibra Telecom Ltda', 'Conecta Fibra', 'Despesas da clínica', 'Energia, água e internet'],
            ['Exata Contabilidade S/S', 'Exata Contabilidade', 'Despesas da clínica', 'Contabilidade'],
            ['Brincar e Aprender Materiais Pedagógicos Ltda', 'Brincar e Aprender', 'Materiais terapêuticos', 'Brinquedos e jogos'],
            ['Sensorial Kids Equipamentos Ltda', 'Sensorial Kids', 'Investimentos', 'Equipamentos'],
            ['Limpa Bem Serviços Ltda', 'Limpa Bem', 'Despesas da clínica', 'Manutenção e limpeza'],
        ];
        foreach ($fornecedores as $indice => [$razao, $fantasia, $categoria, $sub]) {
            $this->ctx->fornecedores[$fantasia] = $this->ctx->inserir('fornecedores', [
                'razao_social' => $razao, 'nome_fantasia' => $fantasia,
                'cpf_cnpj' => sprintf('%08d0001%02d', 11222333 + $indice * 104729, 10 + $indice),
                'contatos_json' => json_encode([['tipo' => 'email', 'valor' => 'financeiro@'.strtolower(str_replace(' ', '', $fantasia)).'.exemplo.com.br']]),
                'endereco_json' => json_encode($elenco->endereco()),
                'categoria_id' => $this->ctx->ids["categoria:{$categoria}"], 'subcategoria_id' => $this->ctx->ids["sub:{$sub}"],
                'centro_custo' => 'Clínica', 'ativo' => true,
            ]);
        }
    }
}
