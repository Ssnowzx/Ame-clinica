import { describe, expect, it } from 'vitest'

import { relatorioDoCatalogo, relatorioParaOUsuario, type RelatorioDoCatalogo } from '@/lib/relatorios/catalogo'
import {
  lerParametrosDaUrl,
  parametrosDaConsulta,
  parametrosParaUrl,
  prontidaoDoRelatorio,
  recorteDoRelatorio,
  temFiltroRemovivel,
} from '@/lib/relatorios/parametros'

function relatorio(slug: string): RelatorioDoCatalogo {
  const achado = relatorioDoCatalogo(slug)
  if (achado === undefined) throw new Error(`fixture: ${slug} não está no catálogo`)
  return achado
}

describe('Parâmetros na URL — entrada não confiável, saneada', () => {
  it('deve ler só o que o relatório declara, descartando id que não é inteiro positivo', () => {
    // ARRANGE — `sessoes-dos-tratamentos` não tem filtro de status; o id de convênio é lixo
    const url = new URLSearchParams('de=2026-06-01&ate=2026-06-30&profissional_id=3&convenio_id=abc&status_id=2')

    // ACT
    const lidos = lerParametrosDaUrl(url, relatorio('sessoes-dos-tratamentos'))

    // ASSERT
    expect(lidos).toEqual({
      de: '2026-06-01',
      ate: '2026-06-30',
      profissional_id: '3',
      convenio_id: undefined,
      especialidade_id: undefined,
      situacao: undefined,
    })
    expect('status_id' in lidos).toBe(false)
  })

  it('deve aceitar resultado e divisão só entre os que o relatório oferece', () => {
    // ARRANGE
    const agendamentos = relatorio('agendamentos')

    // ACT
    const valido = lerParametrosDaUrl(new URLSearchParams('resultado=sintetico&dividir_por=status'), agendamentos)
    const divisaoDesconhecida = lerParametrosDaUrl(new URLSearchParams('resultado=sintetico&dividir_por=cor'), agendamentos)
    const semSintetico = lerParametrosDaUrl(new URLSearchParams('resultado=analitico&dividir_por=status'), agendamentos)

    // ASSERT — a divisão só existe no sintético
    expect(valido.resultado).toBe('sintetico')
    expect(valido.dividir_por).toBe('status')
    expect(divisaoDesconhecida.dividir_por).toBeUndefined()
    expect('dividir_por' in semSintetico).toBe(false)
  })

  it('deve recusar o sintético sem divisão — o servidor o exige (`required_if`)', () => {
    // ARRANGE
    const periodo = { de: '2026-06-01', ate: '2026-06-30' } as const

    // ACT
    const semDivisao = prontidaoDoRelatorio(relatorio('agendamentos'), { ...periodo, resultado: 'sintetico' })
    const comDivisao = prontidaoDoRelatorio(relatorio('agendamentos'), { ...periodo, resultado: 'sintetico', dividir_por: 'status' })

    // ASSERT
    expect(semDivisao).toEqual({ pronto: false, razao: 'Escolha por onde dividir o resultado sintético.' })
    expect(comDivisao).toEqual({ pronto: true })
  })

  it('deve ler o serviço só junto do convênio — a tabela de serviços é por convênio', () => {
    // ARRANGE
    const recebido = relatorio('recebido-por-profissional')

    // ACT
    const comConvenio = lerParametrosDaUrl(new URLSearchParams('de=2026-09-01&ate=2026-09-30&convenio_id=3&servico_id=12'), recebido)
    const semConvenio = lerParametrosDaUrl(new URLSearchParams('de=2026-09-01&ate=2026-09-30&servico_id=12'), recebido)
    const servicoLixo = lerParametrosDaUrl(new URLSearchParams('convenio_id=3&servico_id=12abc'), recebido)

    // ASSERT — sem convênio, o serviço seria um filtro que o formulário não mostra
    expect(comConvenio.servico_id).toBe('12')
    expect(comConvenio.convenio_id).toBe('3')
    expect(semConvenio.servico_id).toBeUndefined()
    expect(servicoLixo.servico_id).toBeUndefined()
  })

  it('deve ignorar `servico_id` em relatório que não declara o filtro', () => {
    // ACT
    const lidos = lerParametrosDaUrl(new URLSearchParams('convenio_id=3&servico_id=12'), relatorio('agendamentos'))

    // ASSERT
    expect('servico_id' in lidos).toBe(false)
  })

  it('deve escrever na URL só o que tem valor', () => {
    // ACT
    const url = parametrosParaUrl({ de: '2026-06-01', ate: '2026-06-30', profissional_id: undefined, status_id: '' })

    // ASSERT
    expect(url.toString()).toBe('de=2026-06-01&ate=2026-06-30')
  })

  it('deve exigir o paciente no extrato e dizer isso como razão', () => {
    // ACT
    const semPaciente = prontidaoDoRelatorio(relatorio('extrato-do-paciente'), { de: '2026-06-01', ate: '2026-06-30' })
    const comPaciente = prontidaoDoRelatorio(relatorio('extrato-do-paciente'), { de: '2026-06-01', ate: '2026-06-30', paciente_id: '7' })

    // ASSERT
    expect(semPaciente).toEqual({ pronto: false, razao: 'Escolha o paciente.' })
    expect(comPaciente).toEqual({ pronto: true })
  })

  it('deve ficar pronto só com o período válido e dentro do teto', () => {
    // ACT + ASSERT
    expect(prontidaoDoRelatorio(relatorio('agendamentos'), {})).toMatchObject({ pronto: false })
    expect(prontidaoDoRelatorio(relatorio('agendamentos'), { de: '2025-01-01', ate: '2026-02-05' })).toEqual({
      pronto: false,
      razao: 'O período tem 401 dias; o máximo é 366 dias (um ano).',
    })
    expect(prontidaoDoRelatorio(relatorio('agendamentos'), { de: '2026-06-01', ate: '2026-06-30' })).toEqual({ pronto: true })
  })
})

describe('Movimentação da agenda — o parâmetro é `tipo`, não `situacao`', () => {
  it('deve ler o tipo declarado e descartar o desconhecido', () => {
    // ARRANGE
    const movimentacao = relatorio('movimentacao-da-agenda')

    // ACT
    const valido = lerParametrosDaUrl(new URLSearchParams('de=2026-06-01&ate=2026-06-30&tipo=remarcado'), movimentacao)
    const invalido = lerParametrosDaUrl(new URLSearchParams('de=2026-06-01&ate=2026-06-30&tipo=inventado'), movimentacao)

    // ASSERT
    expect(valido.tipo).toBe('remarcado')
    expect(invalido.tipo).toBeUndefined()
    expect('situacao' in valido).toBe(false)
  })

  it('deve mandar o tipo na URL — e gerar sem ele, que o servidor traz todas', () => {
    // ARRANGE
    const movimentacao = relatorio('movimentacao-da-agenda')
    const recorte = { de: '2026-06-01', ate: '2026-06-30', tipo: 'desmarcado' }

    // ACT
    const url = parametrosParaUrl(recorteDoRelatorio(movimentacao, recorte))

    // ASSERT
    expect(url.get('tipo')).toBe('desmarcado')
    expect(url.has('situacao')).toBe(false)
    expect(prontidaoDoRelatorio(movimentacao, { de: '2026-06-01', ate: '2026-06-30' })).toEqual({ pronto: true })
  })
})

describe('Serviços — a ordenação é `ordenar`', () => {
  it('deve mandar `ordenar` na URL e descartar a ordenação que a API não conhece', () => {
    // ARRANGE
    const servicos = relatorio('servicos')

    // ACT
    const lidos = lerParametrosDaUrl(new URLSearchParams('de=2026-06-01&ate=2026-06-30&ordenar=valor'), servicos)
    const invalido = lerParametrosDaUrl(new URLSearchParams('de=2026-06-01&ate=2026-06-30&ordenar=alfabetica'), servicos)
    const url = parametrosParaUrl(recorteDoRelatorio(servicos, lidos))

    // ASSERT
    expect(lidos.ordenar).toBe('valor')
    expect(invalido.ordenar).toBeUndefined()
    expect(url.toString()).toBe('de=2026-06-01&ate=2026-06-30&ordenar=valor')
    // o convênio saiu do relatório: a API de `servicos` não aceita `convenio_id`
    expect('convenio_id' in lidos).toBe(false)
  })
})

describe('Pacientes — o período, o mês e os dias são da SITUAÇÃO', () => {
  const pacientes = () => relatorio('pacientes')

  it('deve gerar as ativas SEM período — nem exigido, nem na URL', () => {
    // ARRANGE — a situação padrão do servidor é "ativos"
    const semSituacao = lerParametrosDaUrl(new URLSearchParams('de=2026-06-01&ate=2026-06-30'), pacientes())

    // ACT
    const prontidao = prontidaoDoRelatorio(pacientes(), { situacao: 'ativos' })
    const url = parametrosParaUrl(recorteDoRelatorio(pacientes(), { situacao: 'ativos', de: '2026-06-01', ate: '2026-06-30' }))

    // ASSERT — o `de=` do link é ignorado na leitura e não é reescrito na volta
    expect(semSituacao.de).toBeUndefined()
    expect(prontidao).toEqual({ pronto: true })
    expect(url.toString()).toBe('situacao=ativos')
  })

  it('deve desabilitar "Gerar" nas cadastradas no período sem datas, dizendo o que falta', () => {
    // ACT
    const semDatas = prontidaoDoRelatorio(pacientes(), { situacao: 'cadastrados_no_periodo' })
    const comDatas = prontidaoDoRelatorio(pacientes(), { situacao: 'cadastrados_no_periodo', de: '2026-06-01', ate: '2026-06-30' })

    // ASSERT
    expect(semDatas).toEqual({ pronto: false, razao: 'Informe o início e o fim do período.' })
    expect(comDatas).toEqual({ pronto: true })
  })

  it('deve exigir o mês nas aniversariantes, e só aceitar `AAAA-MM`', () => {
    // ARRANGE
    const url = new URLSearchParams('situacao=aniversariantes&mes=setembro')

    // ACT
    const mesInvalido = lerParametrosDaUrl(url, pacientes())
    const semMes = prontidaoDoRelatorio(pacientes(), { situacao: 'aniversariantes' })
    const comMes = prontidaoDoRelatorio(pacientes(), { situacao: 'aniversariantes', mes: '2026-09' })

    // ASSERT
    expect(mesInvalido.mes).toBeUndefined()
    expect(semMes).toEqual({ pronto: false, razao: 'Escolha o mês.' })
    expect(comMes).toEqual({ pronto: true })
  })

  it('deve manter os dias só em "sem atendimento", dentro do teto de 365', () => {
    // ARRANGE
    const comDias = new URLSearchParams('situacao=sem_atendimento&dias=90')
    const acimaDoTeto = new URLSearchParams('situacao=sem_atendimento&dias=400')

    // ACT
    const lidos = lerParametrosDaUrl(comDias, pacientes())
    const estourado = lerParametrosDaUrl(acimaDoTeto, pacientes())
    const emOutraSituacao = parametrosParaUrl(recorteDoRelatorio(pacientes(), { situacao: 'ativos', dias: '90' }))

    // ASSERT — sem atendimento tem padrão no servidor (60): a falta não bloqueia
    expect(lidos.dias).toBe('90')
    expect(estourado.dias).toBeUndefined()
    expect(prontidaoDoRelatorio(pacientes(), { situacao: 'sem_atendimento' })).toEqual({ pronto: true })
    expect(emOutraSituacao.has('dias')).toBe(false)
  })

  it('deve descartar o mês e o período quando a situação não é a deles', () => {
    // ARRANGE — link antigo, com tudo dentro
    const url = new URLSearchParams('situacao=sem_atendimento&mes=2026-09&de=2026-06-01&ate=2026-06-30&dias=30')

    // ACT
    const lidos = lerParametrosDaUrl(url, pacientes())

    // ASSERT
    expect(lidos.mes).toBeUndefined()
    expect(lidos.de).toBeUndefined()
    expect(lidos.ate).toBeUndefined()
    expect(lidos.dias).toBe('30')
  })
})

describe('prontidaoDoRelatorio — a faixa dos dias (CRR-16)', () => {
  const pacientes = relatorioDoCatalogo('pacientes')!

  it('deve barrar com a razão escrita quando os dias saem da faixa do servidor', () => {
    // ARRANGE + ACT — o saneamento da URL DESCARTA o inválido, e o servidor aplicaria o padrão
    // dele: sem esta trava o relatório sairia com outro recorte, calado
    const fora = prontidaoDoRelatorio(pacientes, { situacao: 'sem_atendimento', dias: '999' })
    const zero = prontidaoDoRelatorio(pacientes, { situacao: 'sem_atendimento', dias: '0' })

    // ASSERT
    expect(fora).toEqual({ pronto: false, razao: 'Os dias sem atendimento vão de 1 a 365.' })
    expect(zero.pronto).toBe(false)
  })

  it('deve aceitar as duas bordas e o campo vazio (o servidor tem padrão)', () => {
    // ARRANGE + ACT + ASSERT
    expect(prontidaoDoRelatorio(pacientes, { situacao: 'sem_atendimento', dias: '1' }).pronto).toBe(true)
    expect(prontidaoDoRelatorio(pacientes, { situacao: 'sem_atendimento', dias: '365' }).pronto).toBe(true)
    expect(prontidaoDoRelatorio(pacientes, { situacao: 'sem_atendimento' }).pronto).toBe(true)
  })

  it('deve ignorar os dias na situação que não os usa', () => {
    // ARRANGE + ACT + ASSERT — "Ativas" não tem campo de dias; um `dias` na URL é ruído
    expect(prontidaoDoRelatorio(pacientes, { situacao: 'ativos', dias: '999' }).pronto).toBe(true)
  })
})

describe('Relatórios do caixa — Conta e Categoria na URL', () => {
  it('deve ler conta e categoria como inteiros positivos e descartar o resto', () => {
    // ARRANGE — o link colado é entrada não confiável
    const recebido = relatorio('recebido-e-pago')

    // ACT
    const validos = lerParametrosDaUrl(new URLSearchParams('de=2026-09-01&ate=2026-09-30&conta_id=4&categoria_id=12'), recebido)
    const lixo = lerParametrosDaUrl(new URLSearchParams('de=2026-09-01&ate=2026-09-30&conta_id=1.5&categoria_id=-3'), recebido)
    const zero = lerParametrosDaUrl(new URLSearchParams('conta_id=0&categoria_id=abc'), recebido)

    // ASSERT
    expect(validos.conta_id).toBe('4')
    expect(validos.categoria_id).toBe('12')
    expect(lixo.conta_id).toBeUndefined()
    expect(lixo.categoria_id).toBeUndefined()
    expect(zero.conta_id).toBeUndefined()
    expect(zero.categoria_id).toBeUndefined()
  })

  it('deve ignorar conta e categoria em relatório que não as declara', () => {
    // ACT — a movimentação do financeiro lê a auditoria: não há conta nem categoria a filtrar
    const lidos = lerParametrosDaUrl(new URLSearchParams('conta_id=4&categoria_id=12'), relatorio('movimentacao-do-financeiro'))

    // ASSERT
    expect('conta_id' in lidos).toBe(false)
    expect('categoria_id' in lidos).toBe(false)
  })

  it('deve contar conta e categoria entre os filtros que "Gerar sem os filtros" tira', () => {
    // ARRANGE
    const contas = relatorio('contas-em-aberto')

    // ACT + ASSERT
    expect(temFiltroRemovivel(contas, { de: '2026-09-01', ate: '2026-09-30', conta_id: '4' })).toBe(true)
    expect(temFiltroRemovivel(contas, { de: '2026-09-01', ate: '2026-09-30', categoria_id: '12' })).toBe(true)
    expect(temFiltroRemovivel(contas, { de: '2026-09-01', ate: '2026-09-30' })).toBe(false)
  })

  it('deve descartar a ordenação por valor de um link colado por quem não a tem', () => {
    // ARRANGE — o catálogo da recepção: sem a ordenação que a API recusa
    const daRecepcao = relatorioParaOUsuario(relatorio('servicos'), (permissao) => permissao !== 'fluxo_caixa.ver')

    // ACT
    const lidos = lerParametrosDaUrl(new URLSearchParams('de=2026-09-01&ate=2026-09-30&ordenar=valor'), daRecepcao)

    // ASSERT — o link colado não monta o 422: o servidor usa o padrão, a quantidade
    expect(lidos.ordenar).toBeUndefined()
    expect(prontidaoDoRelatorio(daRecepcao, lidos).pronto).toBe(true)
  })
})

describe('Vendas — o convênio só acha o serviço', () => {
  it('deve tirar o convênio do que vai ao servidor, mantendo o serviço', () => {
    // ARRANGE — a tabela de serviços é por convênio, mas as vendas não se filtram por convênio
    const parametros = { de: '2026-09-01', ate: '2026-09-30', convenio_id: '1', servico_id: '12' }

    // ACT
    const dasVendas = parametrosDaConsulta(relatorio('vendas-do-periodo'), parametros)
    const doRecebido = parametrosDaConsulta(relatorio('recebido-por-profissional'), parametros)

    // ASSERT — no Recebido por profissional o convênio É filtro, e continua indo
    expect(dasVendas.convenio_id).toBeUndefined()
    expect(dasVendas.servico_id).toBe('12')
    expect(doRecebido.convenio_id).toBe('1')
  })
})

describe('DRE — "Somente lançamentos contábeis" na URL', () => {
  it('deve aceitar só o 1 — a API valida boolean, e "true" seria 422', () => {
    // ARRANGE
    const dre = relatorio('dre-gerencial')

    // ACT
    const ligado = lerParametrosDaUrl(new URLSearchParams('de=2026-01-01&ate=2026-12-31&somente_contabeis=1'), dre)
    const texto = lerParametrosDaUrl(new URLSearchParams('de=2026-01-01&ate=2026-12-31&somente_contabeis=true'), dre)

    // ASSERT
    expect(ligado.somente_contabeis).toBe('1')
    expect(texto.somente_contabeis).toBeUndefined()
  })

  it('deve contar "somente contábeis" entre os filtros que "Gerar sem os filtros" tira', () => {
    // ACT + ASSERT
    expect(temFiltroRemovivel(relatorio('dre-gerencial'), { somente_contabeis: '1' })).toBe(true)
  })
})
