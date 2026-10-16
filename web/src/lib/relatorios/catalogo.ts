/**
 * O CATÁLOGO de relatórios — dado, não componente (change `area-de-relatorios`, design D4).
 *
 * Cada relatório é UMA entrada aqui e UM arquivo na API: a página do catálogo desenha um
 * cartão por entrada e a página do relatório monta o formulário pela declaração (quais
 * filtros, se tem resultado sintético, por onde divide). O ClinicaÁgil tinha 40 relatórios
 * com nomes que se sobrepõem e um formulário próprio em cada um; aqui são dez, e o nome
 * antigo fica no cartão para a recepção achar pelo nome que conhece.
 *
 * A VERDADE dos parâmetros é a API (`api/app/Support/Relatorios/*.php`): os valores e a
 * obrigatoriedade declarados aqui são os que o `regras()` de cada relatório aceita — um
 * valor a mais aqui é um 422 garantido, um a menos é um recorte que a recepção não alcança.
 *
 * `permissoes` são TODAS exigidas (T-not-13: sem permissão guarda-chuva) — o cartão só
 * aparece e a rota só abre para quem tem cada uma; o servidor decide de verdade (403).
 * `catalogo.contrato.test.ts` confere slugs e permissões contra o índice exportado pela API.
 */

import type { AtalhoDePeriodo } from '@/lib/relatorios/periodo'
import type { TipoLancamento } from '@/tipos'

export type CategoriaDeRelatorio = 'agenda' | 'atendimentos' | 'tratamentos' | 'pacientes' | 'financeiro'

export type FiltroDeRelatorio =
  | 'periodo'
  | 'profissional'
  | 'convenio'
  /** Serviço é POR convênio (o preço muda por operadora): o campo depende do convênio escolhido. */
  | 'servico'
  | 'especialidade'
  | 'status'
  | 'situacao'
  | 'tipo'
  | 'paciente'
  | 'dias'
  | 'mes'
  | 'ordenar'
  /** As contas do caixa (`conta_id`) — só com permissão de ver contas; sem ela, o campo não existe. */
  | 'conta'
  /** As categorias do caixa (`categoria_id`) — só com permissão de ver categorias. */
  | 'categoria'
  /** "Somente lançamentos contábeis" (`somente_contabeis=1`) — o DRE. */
  | 'contabeis'

/**
 * Os campos que existem só para CERTAS situações. Em `pacientes` o período é dos
 * "cadastrados no período" e o mês é das "aniversariantes": um campo que ALGUMA situação do
 * relatório nomeia é condicional — some do formulário e da URL nas outras situações.
 */
export type CampoDaSituacao = 'periodo' | 'mes' | 'dias'

export type ResultadoDeRelatorio = 'analitico' | 'sintetico'

export interface OpcaoDeclarada {
  valor: string
  rotulo: string
}

export interface OrdenacaoDeclarada extends OpcaoDeclarada {
  /**
   * A ordenação só existe para quem tem esta permissão — o ranking de serviços só ordena por valor
   * para quem vê o caixa da clínica (a API responde 422 aos outros). Ver `relatorioParaOUsuario`.
   */
  permissao?: string
}

export interface SituacaoDeclarada extends OpcaoDeclarada {
  /** Campos que só existem NESTA situação e sem os quais não há relatório: "Gerar" desabilitado, com a razão. */
  exige?: readonly CampoDaSituacao[]
  /** Campos que só existem NESTA situação, mas o servidor tem padrão: aparecem, não bloqueiam. */
  oferece?: readonly CampoDaSituacao[]
}

export interface RelatorioDoCatalogo {
  slug: string
  nome: string
  categoria: CategoriaDeRelatorio
  /** Uma linha: o que o relatório RESPONDE — não uma repetição do nome. */
  descricao: string
  /** "No ClinicaÁgil: …" — os nomes antigos que este relatório cobre; a busca acha por eles. */
  nomesAntigos: string[]
  /** TODAS exigidas. */
  permissoes: string[]
  /** Os filtros que ESTE relatório usa — o formulário só desenha estes. */
  filtros: FiltroDeRelatorio[]
  /** Filtros sem os quais não há como gerar (o extrato é de UMA criança). */
  obrigatorios?: FiltroDeRelatorio[]
  /**
   * Filtros que ficam obrigatórios para quem NÃO tem uma permissão — o recebido por profissional
   * é um profissional por vez para quem não vê o total da clínica (`fluxo_caixa.ver`). A API
   * exige o mesmo; ver `relatorioParaOUsuario`.
   */
  obrigatoriosSemPermissao?: { permissao: string; filtros: FiltroDeRelatorio[] }
  /**
   * O filtro Profissional oferece também os DESLIGADOS, marcados — o fechamento do repasse inclui
   * o último mês de quem saiu (a API só atende sob `repasse.ver`).
   */
  profissionaisComDesligados?: boolean
  /** Quando o relatório oferece "Resultado: analítico · sintético". */
  resultados?: ResultadoDeRelatorio[]
  /** "Dividir por" do resultado sintético — o sintético SEMPRE tem uma; a primeira é o padrão. */
  divisoes?: OpcaoDeclarada[]
  /** As opções do filtro "Situação" — a PRIMEIRA é o padrão do servidor (não há vazio: o servidor sempre assume uma). */
  situacoes?: readonly SituacaoDeclarada[]
  /** As opções do filtro "Tipo de movimentação" — opcional de verdade: sem escolha, o servidor traz todos. */
  tipos?: readonly OpcaoDeclarada[]
  /** As opções de "Ordenar por" — a PRIMEIRA é o padrão do servidor. */
  ordenacoes?: readonly OrdenacaoDeclarada[]
  /** O padrão do servidor de "Dias sem atendimento" — o formulário nasce com ele. */
  diasPadrao?: number
  /**
   * O rótulo do campo Tipo e o da opção sem escolha: o Tipo muda de sentido por relatório (receber ou
   * pagar, entradas ou saídas, a ação da auditoria). Sem declaração, "Tipo de movimentação" e "Todas".
   * SEM `todos`, o Tipo não tem vazio: a primeira opção é o padrão do servidor (a base do DRE).
   */
  rotulosDoTipo?: { campo: string; todos?: string }
  /**
   * De que natureza são as categorias que o filtro Categoria oferece: a FIXA do relatório (venda é
   * receita) ou a que o Tipo escolhido define (Receber → receitas). Categoria da natureza errada o
   * servidor recusa (422) — a tela nem a oferece. Ver `naturezaDaCategoria`.
   */
  categoriasDaNatureza?: { fixa?: TipoLancamento; porTipo?: Readonly<Record<string, TipoLancamento>> }
  /** O período com que o formulário nasce quando a URL não diz — sem declaração, "este mês". */
  periodoPadrao?: AtalhoDePeriodo
  /** As linhas de assinatura no rodapé do PAPEL — o fechamento de caixa é entregue e conferido. */
  assinaturas?: readonly string[]
  /**
   * O convênio só serve para ACHAR o serviço (a tabela de serviços é por convênio): o relatório não
   * filtra por convênio, então o parâmetro nunca vai ao servidor e o campo diz isso.
   */
  convenioSoParaOServico?: boolean
  /** Uma frase para quem NÃO tem a permissão — o recorte que o servidor impõe, dito antes de gerar. */
  notaSemPermissao?: { permissao: string; texto: string }
}

/** Na ordem em que a página agrupa os cartões. */
export const CATEGORIAS_DE_RELATORIOS: ReadonlyArray<{ chave: CategoriaDeRelatorio; rotulo: string }> = [
  { chave: 'agenda', rotulo: 'Agenda' },
  { chave: 'atendimentos', rotulo: 'Atendimentos' },
  { chave: 'tratamentos', rotulo: 'Tratamentos' },
  { chave: 'pacientes', rotulo: 'Pacientes' },
  { chave: 'financeiro', rotulo: 'Financeiro' },
]

const DIVISAO_POR_PROFISSIONAL: OpcaoDeclarada = { valor: 'profissional', rotulo: 'Profissional' }
const DIVISAO_POR_CONVENIO: OpcaoDeclarada = { valor: 'convenio', rotulo: 'Convênio' }
const DIVISAO_POR_ESPECIALIDADE: OpcaoDeclarada = { valor: 'especialidade', rotulo: 'Especialidade' }
const DIVISAO_POR_SERVICO: OpcaoDeclarada = { valor: 'servico', rotulo: 'Serviço' }
const DIVISAO_POR_CATEGORIA: OpcaoDeclarada = { valor: 'categoria', rotulo: 'Categoria' }
const DIVISAO_POR_CONTA: OpcaoDeclarada = { valor: 'conta', rotulo: 'Conta' }
const DIVISAO_POR_FORMA_DE_PAGAMENTO: OpcaoDeclarada = { valor: 'forma_de_pagamento', rotulo: 'Forma de pagamento' }

/** "Os dois" lê melhor que "Todas" quando o Tipo é um par (receber/pagar, recebido/pago). */
const OS_DOIS = 'Os dois'

/**
 * Os relatórios de DINHEIRO do caixa são totais da clínica: exigem ver o fluxo de caixa (decisão
 * da clínica de 2026-07-19 — quem lança não vê o total).
 */
const PERMISSOES_DO_CAIXA = ['lancamentos.ver', 'fluxo_caixa.ver']

export const CATALOGO_DE_RELATORIOS: readonly RelatorioDoCatalogo[] = [
  {
    slug: 'agendamentos',
    nome: 'Agendamentos',
    categoria: 'agenda',
    descricao: 'Tudo que foi marcado no período — dia a dia, ou em totais por status, profissional, convênio ou especialidade.',
    nomesAntigos: ['Agenda por Status', 'Agendamentos por Período'],
    permissoes: ['agenda.ver'],
    filtros: ['periodo', 'profissional', 'convenio', 'especialidade', 'status'],
    resultados: ['analitico', 'sintetico'],
    divisoes: [
      { valor: 'status', rotulo: 'Status' },
      DIVISAO_POR_PROFISSIONAL,
      DIVISAO_POR_CONVENIO,
      DIVISAO_POR_ESPECIALIDADE,
      { valor: 'dia', rotulo: 'Dia' },
    ],
  },
  {
    slug: 'lista-de-presenca',
    nome: 'Lista de presença',
    categoria: 'agenda',
    descricao: 'Os horários de cada profissional no dia, em ordem, com a coluna de assinatura em branco.',
    nomesAntigos: ['Lista de Presença'],
    permissoes: ['agenda.ver'],
    filtros: ['periodo', 'profissional'],
  },
  {
    slug: 'movimentacao-da-agenda',
    nome: 'Movimentação da agenda',
    categoria: 'agenda',
    descricao: 'O que foi criado, remarcado, desmarcado e teve status trocado no período — e por quem.',
    nomesAntigos: ['Histórico de Movimentação da Agenda', 'Histórico de Movimentação de Status'],
    // `agenda.ver` junto: o relatório preenche o nome da criança pela foto ATUAL do
    // agendamento, entregando mais que a tela de auditoria — quem só audita não recebe a
    // agenda nominal (achado SEC-REL-03 da auditoria de segurança)
    permissoes: ['auditoria.ver', 'agenda.ver'],
    // o parâmetro da API é `tipo` (não `situacao`), e sem ele o relatório traz TODAS as movimentações
    filtros: ['periodo', 'profissional', 'tipo'],
    tipos: [
      { valor: 'criado', rotulo: 'Criado' },
      { valor: 'remarcado', rotulo: 'Remarcado' },
      { valor: 'desmarcado', rotulo: 'Desmarcado' },
      { valor: 'status', rotulo: 'Troca de situação' },
    ],
  },
  {
    slug: 'atendimentos',
    nome: 'Atendimentos',
    categoria: 'atendimentos',
    descricao: 'Os atendimentos realizados no período, com a criança — ou os totais por profissional, convênio, especialidade ou mês.',
    nomesAntigos: ['Atendimentos', 'Atendimentos por Mês', 'Pacientes Atendidos'],
    permissoes: ['atendimentos.ver'],
    filtros: ['periodo', 'profissional', 'convenio', 'especialidade'],
    resultados: ['analitico', 'sintetico'],
    divisoes: [
      DIVISAO_POR_PROFISSIONAL,
      DIVISAO_POR_CONVENIO,
      DIVISAO_POR_ESPECIALIDADE,
      { valor: 'mes', rotulo: 'Mês' },
    ],
  },
  {
    slug: 'evolucoes',
    nome: 'Evoluções',
    categoria: 'atendimentos',
    descricao: 'Os atendimentos realizados com a evolução preenchida ou ainda pendente, por profissional.',
    nomesAntigos: ['Evoluções', 'Evoluções Preenchidas', 'Evoluções Não Preenchidas'],
    permissoes: ['evolucoes.ver', 'atendimentos.ver'],
    filtros: ['periodo', 'profissional', 'situacao'],
    situacoes: [
      { valor: 'todas', rotulo: 'Todas' },
      { valor: 'preenchida', rotulo: 'Preenchidas' },
      { valor: 'pendente', rotulo: 'Pendentes' },
    ],
    resultados: ['analitico', 'sintetico'],
    // o sintético deste relatório é SEMPRE por profissional — é a única divisão que a API aceita
    divisoes: [DIVISAO_POR_PROFISSIONAL],
  },
  {
    slug: 'sessoes-dos-tratamentos',
    nome: 'Sessões dos tratamentos',
    categoria: 'tratamentos',
    descricao: 'Sessões vendidas, realizadas e o saldo de cada tratamento — em andamento, finalizados ou perto do fim.',
    nomesAntigos: ['Quantidade de Sessões', 'Tratamentos Finalizados', 'Próximos do Encerramento'],
    permissoes: ['tratamentos.ver'],
    filtros: ['periodo', 'profissional', 'convenio', 'especialidade', 'situacao'],
    situacoes: [
      { valor: 'em_andamento', rotulo: 'Em andamento' },
      { valor: 'finalizados', rotulo: 'Finalizados no período' },
      { valor: 'proximos_do_encerramento', rotulo: 'Próximos do encerramento' },
    ],
  },
  {
    slug: 'servicos',
    nome: 'Serviços',
    categoria: 'tratamentos',
    descricao: 'O ranking dos serviços vendidos e executados no período, por quantidade (e por valor, para quem vê o fluxo de caixa).',
    nomesAntigos: ['Ranking de Vendas por Serviço', 'Ranking de Execução por Serviço', 'Serviços Executados'],
    permissoes: ['tratamentos.ver'],
    filtros: ['periodo', 'ordenar'],
    ordenacoes: [
      { valor: 'quantidade', rotulo: 'Quantidade' },
      // a soma dos vendidos refaz o faturamento: o valor é de quem vê o caixa (a API tira a coluna)
      { valor: 'valor', rotulo: 'Valor', permissao: 'fluxo_caixa.ver' },
    ],
    notaSemPermissao: {
      permissao: 'fluxo_caixa.ver',
      texto: 'Você vê as quantidades. O valor dos serviços fica com quem vê o fluxo de caixa.',
    },
  },
  {
    slug: 'pacientes',
    nome: 'Pacientes',
    categoria: 'pacientes',
    descricao: 'As crianças cadastradas no período, as ativas, as sem atendimento há tantos dias e as aniversariantes do mês.',
    nomesAntigos: ['Pacientes Cadastrados', 'Pacientes Ativos', 'Aniversariantes'],
    permissoes: ['pacientes.ver'],
    // aqui o período é da SITUAÇÃO, não do relatório: "Ativas" não tem recorte de data
    filtros: ['situacao', 'periodo', 'mes', 'dias'],
    situacoes: [
      { valor: 'ativos', rotulo: 'Ativas' },
      { valor: 'cadastrados_no_periodo', rotulo: 'Cadastradas no período', exige: ['periodo'] },
      { valor: 'sem_atendimento', rotulo: 'Sem atendimento há N dias', oferece: ['dias'] },
      { valor: 'aniversariantes', rotulo: 'Aniversariantes do mês', exige: ['mes'] },
    ],
    diasPadrao: 60,
    resultados: ['analitico', 'sintetico'],
    divisoes: [DIVISAO_POR_CONVENIO],
  },
  {
    slug: 'fechamento-de-caixa',
    nome: 'Fechamento de caixa',
    categoria: 'financeiro',
    descricao:
      'A conferência da gaveta no fim do dia: o que entrou e saiu pela data do pagamento, por forma de pagamento, conta ou quem deu baixa — com espaço para assinar.',
    nomesAntigos: ['Fechamento de Caixa', 'Conferência de caixa'],
    // é a conferência do caixa da CLÍNICA (change `financeiro-sem-faturamento-total`): a recepção
    // não fecha o caixa, e as baixas dela num período longo eram quase o faturamento
    permissoes: PERMISSOES_DO_CAIXA,
    filtros: ['periodo', 'tipo', 'conta', 'categoria'],
    tipos: [
      { valor: 'entradas', rotulo: 'Entradas' },
      { valor: 'saidas', rotulo: 'Saídas' },
    ],
    rotulosDoTipo: { campo: 'Entradas ou saídas', todos: 'As duas' },
    categoriasDaNatureza: { porTipo: { entradas: 'receita', saidas: 'despesa' } },
    periodoPadrao: 'hoje',
    resultados: ['analitico', 'sintetico'],
    divisoes: [
      DIVISAO_POR_FORMA_DE_PAGAMENTO,
      DIVISAO_POR_CONTA,
      { valor: 'quem_deu_baixa', rotulo: 'Quem deu baixa' },
    ],
    assinaturas: ['Entregue por', 'Conferido por'],
  },
  {
    slug: 'contas-em-aberto',
    nome: 'Contas a pagar e a receber',
    categoria: 'financeiro',
    descricao:
      'Quem deve e o que vence: as contas em aberto pela data de vencimento, com os dias de atraso — a receber, a pagar ou as duas.',
    nomesAntigos: ['Contas a Pagar/Receber', 'Inadimplência'],
    permissoes: PERMISSOES_DO_CAIXA,
    filtros: ['periodo', 'tipo', 'conta', 'categoria'],
    tipos: [
      { valor: 'receber', rotulo: 'A receber' },
      { valor: 'pagar', rotulo: 'A pagar' },
    ],
    rotulosDoTipo: { campo: 'Receber ou pagar', todos: OS_DOIS },
    categoriasDaNatureza: { porTipo: { receber: 'receita', pagar: 'despesa' } },
    resultados: ['analitico', 'sintetico'],
    divisoes: [DIVISAO_POR_CATEGORIA, { valor: 'pessoa', rotulo: 'Pessoa' }, { valor: 'mes', rotulo: 'Mês de vencimento' }],
  },
  {
    slug: 'recebido-e-pago',
    nome: 'Recebido e pago',
    categoria: 'financeiro',
    descricao:
      'Quanto entrou e saiu do caixa, e por onde: os pagamentos pela data em que foram pagos, por forma de pagamento, categoria, conta ou dia.',
    nomesAntigos: ['Contas Pagas/Recebidas', 'Contas Por Categoria'],
    permissoes: PERMISSOES_DO_CAIXA,
    filtros: ['periodo', 'tipo', 'conta', 'categoria'],
    tipos: [
      { valor: 'recebido', rotulo: 'Recebido' },
      { valor: 'pago', rotulo: 'Pago' },
    ],
    rotulosDoTipo: { campo: 'Recebido ou pago', todos: OS_DOIS },
    categoriasDaNatureza: { porTipo: { recebido: 'receita', pago: 'despesa' } },
    resultados: ['analitico', 'sintetico'],
    divisoes: [DIVISAO_POR_FORMA_DE_PAGAMENTO, DIVISAO_POR_CATEGORIA, DIVISAO_POR_CONTA, { valor: 'dia', rotulo: 'Dia' }],
  },
  {
    slug: 'vendas-do-periodo',
    nome: 'Vendas do período',
    categoria: 'financeiro',
    descricao:
      'Quanto a clínica vendeu: as receitas pela competência (o mês do serviço), pagas ou não — o que já entrou e o que falta receber.',
    nomesAntigos: ['Vendas', 'Resultado Mês'],
    // `tratamentos.ver` junto: a linha nomeia o serviço e o profissional de cada criança
    permissoes: [...PERMISSOES_DO_CAIXA, 'tratamentos.ver'],
    filtros: ['periodo', 'categoria', 'profissional', 'convenio', 'servico'],
    // venda é receita: categoria de despesa aqui é 422
    categoriasDaNatureza: { fixa: 'receita' },
    convenioSoParaOServico: true,
    resultados: ['analitico', 'sintetico'],
    divisoes: [DIVISAO_POR_SERVICO, DIVISAO_POR_PROFISSIONAL, DIVISAO_POR_CATEGORIA],
  },
  {
    slug: 'movimentacao-do-financeiro',
    nome: 'Movimentação do financeiro',
    categoria: 'financeiro',
    descricao:
      'Quem mexeu no financeiro: quem criou, alterou, deu baixa, estornou ou excluiu lançamentos e transferências, pela data da ação.',
    nomesAntigos: ['Histórico de Movimentação do Financeiro'],
    // lê a auditoria E nomeia a criança e o valor, que é o que a lista de lançamentos mostra
    permissoes: ['auditoria.ver', 'lancamentos.ver'],
    filtros: ['periodo', 'tipo'],
    tipos: [
      { valor: 'criado', rotulo: 'Criado' },
      { valor: 'alterado', rotulo: 'Alterado' },
      { valor: 'pago', rotulo: 'Baixa (pago)' },
      { valor: 'estornado', rotulo: 'Estornado' },
      { valor: 'excluido', rotulo: 'Excluído' },
    ],
    resultados: ['analitico', 'sintetico'],
    divisoes: [
      { valor: 'pessoa', rotulo: 'Quem fez' },
      { valor: 'tipo', rotulo: 'Tipo de movimentação' },
    ],
  },
  {
    slug: 'dre-gerencial',
    nome: 'DRE gerencial',
    categoria: 'financeiro',
    descricao:
      'A clínica deu lucro ou prejuízo? O resultado mês a mês, em escada — receita, impostos, custos, despesas —, pela data do pagamento ou pela competência.',
    nomesAntigos: ['DRE Gerencial', 'Demonstração do Resultado'],
    // o resultado da clínica inteira: sob o fluxo de caixa (decisão de 2026-07-19)
    permissoes: PERMISSOES_DO_CAIXA,
    filtros: ['periodo', 'tipo', 'contabeis'],
    // a PRIMEIRA é o padrão do servidor: sem `tipo`, a API conta pelo pagamento
    tipos: [
      { valor: 'pagamento', rotulo: 'Pelo pagamento (regime de caixa)' },
      { valor: 'competencia', rotulo: 'Pela competência' },
    ],
    rotulosDoTipo: { campo: 'Base' },
    periodoPadrao: 'este-ano',
  },
  {
    slug: 'recebido-por-profissional',
    nome: 'Recebido por profissional',
    categoria: 'financeiro',
    descricao: 'Quanto entrou no caixa para cada profissional no período — particulares e o que mais passou pelo caixa.',
    // a clínica chamava o fechamento de "demonstrativo" e de "rateio" (2026-09-24); no ClinicaÁgil
    // ela fazia pelo Serviços Executados, que o cartão `servicos` também cita — a busca acha os dois
    nomesAntigos: ['Serviços Executados', 'Demonstrativo', 'Rateio'],
    // `repasse.ver` é o módulo do fechamento por profissional, que a clínica dá à faturista
    // (decisão 2026-07-19); o analítico é o lançamento um a um, e a linha diz o serviço e o
    // convênio de cada criança (`tratamentos.ver`, SEC-RPP-10). Sem o total da clínica
    // (`fluxo_caixa.ver`), um profissional por vez — a faturista monta, não vê o total
    permissoes: ['repasse.ver', 'lancamentos.ver', 'tratamentos.ver'],
    filtros: ['periodo', 'profissional', 'convenio', 'servico'],
    obrigatoriosSemPermissao: { permissao: 'fluxo_caixa.ver', filtros: ['profissional'] },
    profissionaisComDesligados: true,
    resultados: ['analitico', 'sintetico'],
    divisoes: [DIVISAO_POR_PROFISSIONAL, DIVISAO_POR_CONVENIO, DIVISAO_POR_SERVICO],
  },
  {
    slug: 'tratamentos-sem-lancamento',
    nome: 'Tratamentos sem lançamento no caixa',
    categoria: 'financeiro',
    descricao: 'Os tratamentos abertos no período que ainda não têm nenhum lançamento no caixa.',
    nomesAntigos: ['Tratamentos sem Lançamento no Caixa'],
    permissoes: ['tratamentos.ver', 'lancamentos.ver'],
    filtros: ['periodo'],
    notaSemPermissao: {
      permissao: 'fluxo_caixa.ver',
      texto: 'Você vê o valor de cada pacote. O total previsto fica com quem vê o fluxo de caixa.',
    },
  },
  {
    slug: 'extrato-do-paciente',
    nome: 'Extrato do paciente',
    categoria: 'financeiro',
    descricao: 'Os lançamentos de uma criança no período — o que foi pago, o que está em aberto e o saldo.',
    nomesAntigos: ['Extrato do Paciente'],
    // `agenda.ver` junto por DUAS razões: o servidor passou a exigir o portão por-id do eixo
    // agenda (SEC-REL-02 — sem ele, quem tinha o financeiro lia o extrato de qualquer criança e
    // descobria o nome por força bruta de id), e o campo de busca de paciente desta tela já
    // dependia dessa permissão — o cartão abria e o "Gerar" ficava travado para sempre (CRR-05)
    permissoes: ['lancamentos.ver', 'agenda.ver'],
    filtros: ['periodo', 'paciente'],
    obrigatorios: ['paciente'],
  },
]

/** A entrada do catálogo pelo slug da URL — `undefined` para slug que não existe. */
export function relatorioDoCatalogo(slug: string): RelatorioDoCatalogo | undefined {
  return CATALOGO_DE_RELATORIOS.find((relatorio) => relatorio.slug === slug)
}

/**
 * A situação EM VIGOR: a escolhida quando ela existe, senão a primeira declarada — que é o
 * padrão do servidor. Sem isso, uma URL sem `situacao` decidiria "nenhuma" e o formulário
 * esconderia campos que o relatório de verdade está usando.
 */
export function situacaoEmVigor(relatorio: RelatorioDoCatalogo, escolhida: string | undefined): SituacaoDeclarada | undefined {
  const situacoes = relatorio.situacoes
  if (situacoes === undefined) {
    return undefined
  }

  return situacoes.find((situacao) => situacao.valor === escolhida) ?? situacoes[0]
}

/** Os campos que ALGUMA situação deste relatório nomeia — os condicionais dele. */
function camposCondicionais(relatorio: RelatorioDoCatalogo): CampoDaSituacao[] {
  return (relatorio.situacoes ?? []).flatMap((situacao) => [...(situacao.exige ?? []), ...(situacao.oferece ?? [])])
}

/** Os campos que a situação em vigor usa — os que ela exige mais os que ela oferece. */
function camposDaSituacao(relatorio: RelatorioDoCatalogo, escolhida: string | undefined): CampoDaSituacao[] {
  const situacao = situacaoEmVigor(relatorio, escolhida)

  return [...(situacao?.exige ?? []), ...(situacao?.oferece ?? [])]
}

/**
 * Os filtros cujo CATÁLOGO pede permissão própria: sem ela o campo não aparece e o relatório sai
 * SEM esse filtro (spec `relatorios-do-caixa`). Um `conta_id` num link colado prenderia o
 * relatório num recorte que a pessoa não vê nem consegue tirar (CR-WEB-01).
 */
const PERMISSAO_DO_FILTRO: Partial<Record<FiltroDeRelatorio, string>> = {
  conta: 'contas.ver',
  categoria: 'categorias.ver',
}

/**
 * O relatório como ESTE usuário o gera: os `obrigatoriosSemPermissao` viram obrigatórios quando
 * falta a permissão, a ordenação que pede permissão some de quem não a tem, e o filtro cujo catálogo
 * a pessoa não lê deixa de existir. Formulário, URL, prontidão e "Gerar" leem daqui — a mesma
 * régua da API.
 */
export function relatorioParaOUsuario(
  relatorio: RelatorioDoCatalogo,
  temPermissao: (permissao: string) => boolean,
): RelatorioDoCatalogo {
  const condicionais = relatorio.obrigatoriosSemPermissao
  const faltaPermissao = condicionais !== undefined && !temPermissao(condicionais.permissao)
  const ordenacoes = relatorio.ordenacoes?.filter(
    (ordenacao) => ordenacao.permissao === undefined || temPermissao(ordenacao.permissao),
  )
  const cortouOrdenacao = ordenacoes !== undefined && ordenacoes.length !== relatorio.ordenacoes?.length
  const filtros = relatorio.filtros.filter((filtro) => {
    const permissao = PERMISSAO_DO_FILTRO[filtro]

    return permissao === undefined || temPermissao(permissao)
  })
  const cortouFiltro = filtros.length !== relatorio.filtros.length
  if (!faltaPermissao && !cortouOrdenacao && !cortouFiltro) {
    return relatorio
  }

  return {
    ...relatorio,
    ...(faltaPermissao ? { obrigatorios: [...(relatorio.obrigatorios ?? []), ...condicionais.filtros] } : {}),
    ...(cortouOrdenacao ? { ordenacoes } : {}),
    ...(cortouFiltro ? { filtros } : {}),
  }
}

/**
 * A natureza das categorias que o filtro Categoria oferece AGORA: a fixa do relatório, ou a que o
 * Tipo escolhido define. `undefined` = as duas (sem Tipo, "Os dois" aceita qualquer categoria).
 */
export function naturezaDaCategoria(relatorio: RelatorioDoCatalogo, tipo: string | undefined): TipoLancamento | undefined {
  const declarada = relatorio.categoriasDaNatureza
  if (declarada === undefined) {
    return undefined
  }

  return declarada.fixa ?? (tipo === undefined ? undefined : declarada.porTipo?.[tipo])
}

/**
 * O campo aparece neste recorte? Campo que o relatório não declara nunca aparece; campo
 * que nenhuma situação nomeia aparece sempre (o período dos outros nove relatórios);
 * campo condicional aparece só nas situações que o nomeiam.
 */
export function campoAparece(relatorio: RelatorioDoCatalogo, campo: CampoDaSituacao, situacao: string | undefined): boolean {
  if (!relatorio.filtros.includes(campo)) {
    return false
  }
  if (!camposCondicionais(relatorio).includes(campo)) {
    return true
  }

  return camposDaSituacao(relatorio, situacao).includes(campo)
}

/** Os campos que a situação em vigor EXIGE — sem eles, "Gerar" fica desabilitado. */
export function camposExigidos(relatorio: RelatorioDoCatalogo, situacao: string | undefined): readonly CampoDaSituacao[] {
  return situacaoEmVigor(relatorio, situacao)?.exige ?? []
}
