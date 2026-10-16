import { describe, expect, it } from 'vitest'

import { PERMISSOES_DE_RELATORIOS } from '@/lib/catalogos'
import { filtrarRelatorios, normalizarParaBusca } from '@/lib/relatorios/busca'
import {
  campoAparece,
  camposExigidos,
  CATALOGO_DE_RELATORIOS,
  CATEGORIAS_DE_RELATORIOS,
  naturezaDaCategoria,
  relatorioDoCatalogo,
  relatorioParaOUsuario,
  situacaoEmVigor,
  type RelatorioDoCatalogo,
} from '@/lib/relatorios/catalogo'

function relatorio(slug: string): RelatorioDoCatalogo {
  const achado = relatorioDoCatalogo(slug)
  if (achado === undefined) throw new Error(`fixture: ${slug} não está no catálogo`)
  return achado
}

/**
 * GUARDA DE CONTRATO — o catálogo do web é a proposta da change, letra por letra.
 *
 * As permissões de cada relatório são a fronteira de acesso (T-not-13: sem guarda-chuva); um
 * slug com a permissão errada aqui é um cartão que aparece para quem não deveria ver o dado.
 * A tabela abaixo é a da `proposal.md`; a guarda web × API (task 1.7) confere o outro lado.
 */
const PERMISSOES_DA_PROPOSTA: Record<string, string[]> = {
  agendamentos: ['agenda.ver'],
  atendimentos: ['atendimentos.ver'],
  'lista-de-presenca': ['agenda.ver'],
  evolucoes: ['evolucoes.ver', 'atendimentos.ver'],
  // as duas: sem `agenda.ver` o relatório entregava a agenda NOMINAL a quem só audita (SEC-REL-03)
  'movimentacao-da-agenda': ['auditoria.ver', 'agenda.ver'],
  pacientes: ['pacientes.ver'],
  'sessoes-dos-tratamentos': ['tratamentos.ver'],
  'tratamentos-sem-lancamento': ['tratamentos.ver', 'lancamentos.ver'],
  servicos: ['tratamentos.ver'],
  // as duas: o portão por-id do eixo agenda (SEC-REL-02) e o campo de busca da tela (CRR-05)
  'extrato-do-paciente': ['lancamentos.ver', 'agenda.ver'],
  // o módulo do repasse (que a clínica dá à faturista, decisão 2026-07-19) e o lançamento um a um;
  // o total da clínica NÃO abre a porta — ele só dispensa a escolha do profissional
  'recebido-por-profissional': ['repasse.ver', 'lancamentos.ver', 'tratamentos.ver'],
  // os relatórios do caixa (relatorios-do-caixa): totais da clínica, sob o fluxo de caixa
  'contas-em-aberto': ['lancamentos.ver', 'fluxo_caixa.ver'],
  'recebido-e-pago': ['lancamentos.ver', 'fluxo_caixa.ver'],
  // e a venda nomeia serviço e profissional de cada criança
  'vendas-do-periodo': ['lancamentos.ver', 'fluxo_caixa.ver', 'tratamentos.ver'],
  // a trilha de auditoria E o lançamento um a um — nunca só a auditoria
  'movimentacao-do-financeiro': ['auditoria.ver', 'lancamentos.ver'],
  // a conferência do caixa da clínica (financeiro-sem-faturamento-total): sob o fluxo de caixa
  'fechamento-de-caixa': ['lancamentos.ver', 'fluxo_caixa.ver'],
  // o resultado da clínica inteira (dre-gerencial): sob o fluxo de caixa
  'dre-gerencial': ['lancamentos.ver', 'fluxo_caixa.ver'],
}

describe('Catálogo de relatórios — a declaração bate com a proposta', () => {
  it('deve ter exatamente os relatórios das propostas, com as permissões delas', () => {
    // ARRANGE + ACT
    const declaradas = Object.fromEntries(
      CATALOGO_DE_RELATORIOS.map((relatorio) => [relatorio.slug, relatorio.permissoes]),
    )

    // ASSERT — slugs E permissões, os dois lados
    expect(declaradas).toEqual(PERMISSOES_DA_PROPOSTA)
  })

  it('deve manter slug único e categoria conhecida em todo relatório', () => {
    // ARRANGE + ACT
    const slugs = CATALOGO_DE_RELATORIOS.map((relatorio) => relatorio.slug)
    const categorias = new Set(CATEGORIAS_DE_RELATORIOS.map((categoria) => categoria.chave))
    const foraDeCategoria = CATALOGO_DE_RELATORIOS.filter((relatorio) => !categorias.has(relatorio.categoria))

    // ASSERT
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(foraDeCategoria).toEqual([])
  })

  it('deve dar a cada relatório uma descrição que responde algo e ao menos um nome antigo', () => {
    // ARRANGE + ACT — o cartão é a única explicação antes do clique
    const mudos = CATALOGO_DE_RELATORIOS.filter(
      (relatorio) =>
        relatorio.descricao.trim().length < 30 ||
        relatorio.descricao.toLowerCase() === relatorio.nome.toLowerCase() ||
        relatorio.nomesAntigos.length === 0,
    )

    // ASSERT
    expect(mudos.map((relatorio) => relatorio.slug)).toEqual([])
  })

  it('deve declarar divisões só junto do resultado sintético, e as opções só com o filtro que as usa', () => {
    // ARRANGE + ACT
    const inconsistentes = CATALOGO_DE_RELATORIOS.filter(
      (relatorio) =>
        (relatorio.divisoes !== undefined && !relatorio.resultados?.includes('sintetico')) ||
        (relatorio.situacoes !== undefined) !== relatorio.filtros.includes('situacao') ||
        (relatorio.tipos !== undefined) !== relatorio.filtros.includes('tipo') ||
        (relatorio.ordenacoes !== undefined) !== relatorio.filtros.includes('ordenar'),
    )

    // ASSERT — a declaração que a tela não consegue desenhar
    expect(inconsistentes.map((relatorio) => relatorio.slug)).toEqual([])
  })

  it('deve declarar como padrão a MESMA situação que o servidor assume quando ela não vem', () => {
    // ARRANGE — o `?? 'ativos'` de Pacientes.php, o `?? 'todas'` de Evolucoes.php e o
    // `?? 'em_andamento'` de SessoesDosTratamentos.php: a PRIMEIRA opção é esse padrão
    const padroesDoServidor: Record<string, string> = {
      evolucoes: 'todas',
      pacientes: 'ativos',
      'sessoes-dos-tratamentos': 'em_andamento',
      servicos: 'quantidade',
    }

    // ACT
    const primeiras = Object.fromEntries(
      CATALOGO_DE_RELATORIOS.filter((relatorio) => relatorio.situacoes !== undefined || relatorio.ordenacoes !== undefined).map(
        (relatorio) => [relatorio.slug, (relatorio.situacoes ?? relatorio.ordenacoes)?.[0]?.valor],
      ),
    )

    // ASSERT — reordenar a lista troca o recorte que a tela gera sem pedir nada
    expect(primeiras).toEqual(padroesDoServidor)
  })

  it('deve declarar entre os filtros todo campo que alguma situação exige ou oferece', () => {
    // ARRANGE + ACT — um `exige: ['mes']` sem `mes` nos filtros é um campo que nunca aparece
    const orfaos = CATALOGO_DE_RELATORIOS.flatMap((relatorio) =>
      (relatorio.situacoes ?? [])
        .flatMap((situacao) => [...(situacao.exige ?? []), ...(situacao.oferece ?? [])])
        .filter((campo) => !relatorio.filtros.includes(campo))
        .map((campo) => `${relatorio.slug}: ${campo}`),
    )

    // ASSERT
    expect(orfaos).toEqual([])
  })
})

describe('Campos da situação — o período de `pacientes` é da situação, não do relatório', () => {
  const pacientes = relatorio('pacientes')
  const agendamentos = relatorio('agendamentos')

  it('deve esconder o período nas ativas e mostrá-lo nas cadastradas no período', () => {
    // ACT + ASSERT
    expect(campoAparece(pacientes, 'periodo', 'ativos')).toBe(false)
    expect(campoAparece(pacientes, 'periodo', 'cadastrados_no_periodo')).toBe(true)
    expect(campoAparece(pacientes, 'mes', 'aniversariantes')).toBe(true)
    expect(campoAparece(pacientes, 'mes', 'ativos')).toBe(false)
    expect(campoAparece(pacientes, 'dias', 'sem_atendimento')).toBe(true)
  })

  it('deve valer a situação PADRÃO quando a URL não traz nenhuma', () => {
    // ACT + ASSERT — sem `?situacao=`, o servidor lê "ativos": nada de período
    expect(situacaoEmVigor(pacientes, undefined)?.valor).toBe('ativos')
    expect(situacaoEmVigor(pacientes, 'inventada')?.valor).toBe('ativos')
    expect(campoAparece(pacientes, 'periodo', undefined)).toBe(false)
  })

  it('deve manter o período incondicional em quem não o prende a uma situação', () => {
    // ACT + ASSERT — os outros nove relatórios não mudaram de régua
    expect(campoAparece(agendamentos, 'periodo', undefined)).toBe(true)
    expect(camposExigidos(agendamentos, undefined)).toEqual([])
    expect(camposExigidos(pacientes, 'aniversariantes')).toEqual(['mes'])
  })

  it('deve derivar as permissões do menu da união do catálogo', () => {
    // ARRANGE + ACT
    const uniao = [...new Set(CATALOGO_DE_RELATORIOS.flatMap((relatorio) => relatorio.permissoes))]

    // ASSERT — QUALQUER uma mostra o item; esquecer uma esconde a área de quem podia vê-la
    expect([...PERMISSOES_DE_RELATORIOS]).toEqual(uniao)
    expect(PERMISSOES_DE_RELATORIOS).toContain('auditoria.ver')
  })

  it('deve achar o relatório pelo slug e devolver undefined para o desconhecido', () => {
    // ACT + ASSERT
    expect(relatorioDoCatalogo('agendamentos')?.nome).toBe('Agendamentos')
    expect(relatorioDoCatalogo('nao-existe')).toBeUndefined()
  })
})

describe('Busca do catálogo — pelo nome de agora e pelo nome antigo', () => {
  it('deve achar "Agendamentos" pelo nome antigo "Agenda por Status", sem acento e sem caixa', () => {
    // ARRANGE
    const termo = 'AGENDA POR STATUS'

    // ACT
    const achados = filtrarRelatorios(CATALOGO_DE_RELATORIOS, termo)

    // ASSERT
    expect(achados.map((relatorio) => relatorio.slug)).toEqual(['agendamentos'])
  })

  it('deve ignorar acentos nos dois lados: "evolucoes" acha "Evoluções"', () => {
    // ACT
    const achados = filtrarRelatorios(CATALOGO_DE_RELATORIOS, 'evolucoes')

    // ASSERT
    expect(achados.map((relatorio) => relatorio.slug)).toContain('evolucoes')
    expect(normalizarParaBusca('Evoluções Não Preenchidas')).toBe('evolucoes nao preenchidas')
  })

  it('deve achar "Recebido por profissional" pelo nome que a clínica usa: demonstrativo e rateio', () => {
    // ACT — a Mariana pediu "o demonstrativo … tipo um rateio" (2026-09-24)
    const porDemonstrativo = filtrarRelatorios(CATALOGO_DE_RELATORIOS, 'demonstrativo')
    const porRateio = filtrarRelatorios(CATALOGO_DE_RELATORIOS, 'RATEIO')

    // ASSERT
    expect(porDemonstrativo.map((relatorio) => relatorio.slug)).toEqual(['recebido-por-profissional'])
    expect(porRateio.map((relatorio) => relatorio.slug)).toEqual(['recebido-por-profissional'])
  })

  it('deve achar os DOIS cartões pelo "Serviços Executados" do ClinicaÁgil', () => {
    // ACT — o ranking numérico e o dinheiro recebido cobrem, juntos, o que o relatório antigo fazia
    const achados = filtrarRelatorios(CATALOGO_DE_RELATORIOS, 'servicos executados')

    // ASSERT
    expect(achados.map((relatorio) => relatorio.slug).sort()).toEqual(['recebido-por-profissional', 'servicos'])
  })

  it('deve devolver tudo com o termo vazio e nada com um termo que não existe', () => {
    // ACT + ASSERT
    expect(filtrarRelatorios(CATALOGO_DE_RELATORIOS, '   ')).toHaveLength(CATALOGO_DE_RELATORIOS.length)
    expect(filtrarRelatorios(CATALOGO_DE_RELATORIOS, 'comissão de vendas')).toEqual([])
  })
})

describe('Catálogo de relatórios — o recorte que depende de quem gera', () => {
  const recebido = CATALOGO_DE_RELATORIOS.find((relatorio) => relatorio.slug === 'recebido-por-profissional')

  it('deve exigir o profissional de quem não vê o total da clínica', () => {
    // ARRANGE — a faturista: monta o repasse, não vê o total (decisão 2026-07-19)
    const semTotal = (permissao: string): boolean => permissao !== 'fluxo_caixa.ver'

    // ACT
    const paraAFaturista = relatorioParaOUsuario(recebido as RelatorioDoCatalogo, semTotal)

    // ASSERT
    expect(paraAFaturista.obrigatorios).toEqual(['profissional'])
  })

  it('deve deixar o profissional opcional para quem vê o total da clínica', () => {
    // ARRANGE
    const comTudo = (): boolean => true

    // ACT
    const paraAGestao = relatorioParaOUsuario(recebido as RelatorioDoCatalogo, comTudo)

    // ASSERT
    expect(paraAGestao.obrigatorios ?? []).toEqual([])
  })
})

describe('Relatórios do caixa — cada um com uma pergunta e uma base de data', () => {
  it.each([
    ['inadimplencia', 'contas-em-aberto'],
    ['Contas a Pagar/Receber', 'contas-em-aberto'],
    ['contas por categoria', 'recebido-e-pago'],
    ['Contas Pagas/Recebidas', 'recebido-e-pago'],
    ['historico de movimentacao do financeiro', 'movimentacao-do-financeiro'],
    ['conferência de caixa', 'fechamento-de-caixa'],
  ])('deve achar pelo nome antigo "%s" o relatório %s', (termo, slug) => {
    // ACT
    const achados = filtrarRelatorios(CATALOGO_DE_RELATORIOS, termo)

    // ASSERT — a recepção procura pelo nome que conhece do ClinicaÁgil
    expect(achados.map((relatorio) => relatorio.slug)).toEqual([slug])
  })

  it('deve achar pelo "Resultado Mês" do ClinicaÁgil as Vendas e o DRE, que responde o resultado mês a mês', () => {
    // ACT
    const achados = filtrarRelatorios(CATALOGO_DE_RELATORIOS, 'resultado mes')

    // ASSERT — o nome antigo é das Vendas; o DRE é o resultado de verdade, e a busca leva aos dois
    expect(achados.map((relatorio) => relatorio.slug).sort()).toEqual(['dre-gerencial', 'vendas-do-periodo'])
  })

  it('deve achar "Vendas" também pelo nome de antes, sem confundir com o ranking de serviços', () => {
    // ACT
    const achados = filtrarRelatorios(CATALOGO_DE_RELATORIOS, 'vendas')

    // ASSERT — "Ranking de Vendas por Serviço" também diz "vendas": os dois cartões respondem
    expect(achados.map((relatorio) => relatorio.slug).sort()).toEqual(['servicos', 'vendas-do-periodo'])
  })

  it.each([
    ['contas-em-aberto', /vencimento/],
    ['recebido-e-pago', /data em que foram pagos/],
    ['vendas-do-periodo', /competência/],
    ['movimentacao-do-financeiro', /data da ação/],
    ['fechamento-de-caixa', /data do pagamento/],
  ])('deve dizer no cartão de %s a base da data', (slug, base) => {
    // ACT + ASSERT — a base faz parte do relatório (D1): o cartão diz qual é, sem seletor
    expect(relatorio(slug).descricao).toMatch(base)
  })

  it('deve declarar a natureza das categorias só em quem filtra por categoria, e só para tipos que existem', () => {
    // ARRANGE + ACT — `porTipo` com um tipo que o relatório não oferece é regra que nunca vale
    const inconsistentes = CATALOGO_DE_RELATORIOS.filter((declarado) => {
      const natureza = declarado.categoriasDaNatureza
      if (natureza === undefined) {
        return false
      }
      const tipos = new Set((declarado.tipos ?? []).map((tipo) => tipo.valor))

      return (
        !declarado.filtros.includes('categoria') ||
        Object.keys(natureza.porTipo ?? {}).some((tipo) => !tipos.has(tipo))
      )
    })

    // ASSERT
    expect(inconsistentes.map((declarado) => declarado.slug)).toEqual([])
  })

  it('deve oferecer só receitas nas Vendas, e a natureza do Tipo nos outros', () => {
    // ACT + ASSERT — venda é receita; "A pagar" é despesa; sem Tipo, as duas
    expect(naturezaDaCategoria(relatorio('vendas-do-periodo'), undefined)).toBe('receita')
    expect(naturezaDaCategoria(relatorio('contas-em-aberto'), 'pagar')).toBe('despesa')
    expect(naturezaDaCategoria(relatorio('recebido-e-pago'), 'recebido')).toBe('receita')
    expect(naturezaDaCategoria(relatorio('fechamento-de-caixa'), 'saidas')).toBe('despesa')
    expect(naturezaDaCategoria(relatorio('contas-em-aberto'), undefined)).toBeUndefined()
    expect(naturezaDaCategoria(relatorio('agendamentos'), 'receber')).toBeUndefined()
  })

  it('deve tirar a ordenação por valor de quem não vê o caixa da clínica', () => {
    // ARRANGE — a recepção vê os tratamentos, não o total (a API responde 422 a `ordenar=valor`)
    const semTotal = (permissao: string): boolean => permissao !== 'fluxo_caixa.ver'

    // ACT
    const paraARecepcao = relatorioParaOUsuario(relatorio('servicos'), semTotal)
    const paraAGestao = relatorioParaOUsuario(relatorio('servicos'), () => true)

    // ASSERT — a primeira continua sendo a quantidade, o padrão
    expect(paraARecepcao.ordenacoes?.map((ordenacao) => ordenacao.valor)).toEqual(['quantidade'])
    expect(paraAGestao).toBe(relatorio('servicos'))
  })

  it('deve tirar os filtros Conta e Categoria de quem não lê esses catálogos', () => {
    // ARRANGE — vê o caixa, mas não o cadastro de contas nem o de categorias
    const semCatalogos = (permissao: string): boolean => permissao !== 'contas.ver' && permissao !== 'categorias.ver'
    const soContas = (permissao: string): boolean => permissao !== 'categorias.ver'

    // ACT
    const semNenhum = relatorioParaOUsuario(relatorio('recebido-e-pago'), semCatalogos)
    const comContas = relatorioParaOUsuario(relatorio('recebido-e-pago'), soContas)
    const comTudo = relatorioParaOUsuario(relatorio('recebido-e-pago'), () => true)

    // ASSERT — sem a permissão o filtro deixa de existir; com ela, o relatório é o do catálogo
    expect(semNenhum.filtros).not.toContain('conta')
    expect(semNenhum.filtros).not.toContain('categoria')
    expect(semNenhum.filtros).toContain('periodo')
    expect(comContas.filtros).toContain('conta')
    expect(comContas.filtros).not.toContain('categoria')
    expect(comTudo).toBe(relatorio('recebido-e-pago'))
  })

  it('deve fazer o fechamento nascer em hoje e levar as duas linhas de assinatura', () => {
    // ARRANGE
    const fechamento = relatorio('fechamento-de-caixa')

    // ACT + ASSERT — a gaveta é do dia; o papel é entregue e conferido
    expect(fechamento.periodoPadrao).toBe('hoje')
    expect(fechamento.assinaturas).toEqual(['Entregue por', 'Conferido por'])
  })
})

describe('DRE gerencial — a base sem "todas"', () => {
  it('deve declarar a base pelo pagamento primeiro, sem opção vazia, e nascer no ano corrente', () => {
    // ARRANGE
    const dre = relatorio('dre-gerencial')

    // ACT + ASSERT — sem `tipo`, o servidor conta pelo pagamento: a primeira opção É esse padrão
    expect(dre.tipos?.[0]?.valor).toBe('pagamento')
    expect(dre.rotulosDoTipo).toEqual({ campo: 'Base' })
    expect(dre.periodoPadrao).toBe('este-ano')
    expect(dre.resultados).toBeUndefined()
    expect(dre.filtros).toContain('contabeis')
  })
})
