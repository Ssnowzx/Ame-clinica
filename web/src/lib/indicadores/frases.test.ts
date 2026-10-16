import { describe, expect, it } from 'vitest'

import {
  avisoDeSemComparacao,
  celulaMaisVazia,
  comparadoAntesDoHistorico,
  compararContagem,
  compararMoeda,
  compararTaxa,
  formatarMoeda,
  formatarMoedaCompacta,
  formatarPontos,
  formatarTaxa,
  fraseDaParteDasPassadas,
  fraseDasConfirmadas,
  fraseDasEvolucoes,
  fraseDasSaidasEPacotes,
  fraseDoCartaoDaAgenda,
  fraseDoCartaoDaOcupacao,
  fraseDoCartaoDeAtrasadas,
  fraseDoCartaoDoDinheiro,
  fraseDoCartaoDosPacientes,
  fraseDoPeriodo,
  intervaloEmPalavras,
  linhaDosNovos,
  plural,
  taxaOuSemDados,
  tituloDaTendenciaDoRecebido,
  tituloDasFaltasPorDia,
  tituloDoMapa,
  tituloDosConvenios,
  tituloDosNovos,
  type Frase,
} from '@/lib/indicadores/frases'
import {
  painelDaAgendaFicticio,
  painelDaEquipeFicticio,
  painelDoDinheiroFicticio,
  painelDosPacientesFicticio,
  periodoFicticio,
  semAsChavesProtegidas,
} from '@/test/dados-paineis'

const PERIODO = periodoFicticio()

/** A frase como texto corrido, para comparar com o esperado — só os testes precisam dela. */
function textoDaFrase(frase: Frase): string {
  return frase.map((trecho) => trecho.texto).join('')
}

describe('helpers únicos — plural, moeda e porcentagem', () => {
  it.each([
    [0, '0 sessões'],
    [1, '1 sessão'],
    [2, '2 sessões'],
    [1024, '1.024 sessões'],
  ])('deve concordar o plural de %s → "%s"', (n, esperado) => {
    // ARRANGE + ACT
    const texto = plural(n, 'sessão', 'sessões')

    // ASSERT
    expect(texto).toBe(esperado)
  })

  it.each([
    ['7560.60', 'R$ 7.560,60'],
    ['21300.00', 'R$ 21.300'],
    ['0.00', 'R$ 0'],
    ['85.5', 'R$ 85,50'],
    ['lixo', 'R$ 0'],
  ])('deve formatar a moeda %s como "%s" (exata, sem o ,00 de ruído)', (valor, esperado) => {
    // ARRANGE + ACT + ASSERT
    expect(formatarMoeda(valor)).toBe(esperado)
  })

  it.each([
    ['14500.00', 'R$ 14,5 mil'],
    ['7560.60', 'R$ 7,6 mil'],
    ['15000.00', 'R$ 15 mil'],
    ['850.49', 'R$ 850'],
    ['850.50', 'R$ 851'],
    ['1234567.00', 'R$ 1,2 mi'],
    ['-2500.00', '-R$ 2,5 mil'],
  ])('deve compactar a moeda %s como "%s" (rótulo de gráfico)', (valor, esperado) => {
    // ARRANGE + ACT + ASSERT
    expect(formatarMoedaCompacta(valor)).toBe(esperado)
  })

  it('deve compactar sem o símbolo quando o gráfico já diz "em reais"', () => {
    // ARRANGE + ACT + ASSERT
    expect(formatarMoedaCompacta('14500.00', { semSimbolo: true })).toBe('14,5 mil')
    expect(formatarMoedaCompacta('-850.00', { semSimbolo: true })).toBe('-850')
  })

  it.each([
    [0.87, '87%'],
    [0.0602, '6%'],
    [0.045, '4,5%'],
    [0.625, '63%'],
    [0, '0%'],
    [1, '100%'],
  ])('deve escrever a taxa %s como "%s"', (taxa, esperado) => {
    // ARRANGE + ACT + ASSERT
    expect(formatarTaxa(taxa)).toBe(esperado)
  })

  it.each([
    [0.87, '87%'],
    [0, '0%'],
    [null, 'sem dados'],
  ])('deve escrever a taxa que pode faltar (%s) como "%s" — nulo nunca vira 0%%', (taxa, esperado) => {
    // ARRANGE + ACT + ASSERT — o servidor manda nulo quando não há base para a conta
    expect(taxaOuSemDados(taxa)).toBe(esperado)
  })

  it.each([
    [0.0147, '1,5 p.p.'],
    [-0.04, '4 p.p.'],
    [0.0002, '0 p.p.'],
  ])('deve escrever a diferença %s em pontos como "%s"', (diferenca, esperado) => {
    // ARRANGE + ACT + ASSERT
    expect(formatarPontos(diferenca)).toBe(esperado)
  })
})

describe('o período em palavras', () => {
  it.each([
    ['2026-09-01', '2026-09-05', undefined, '1º a 5 de setembro de 2026'],
    ['2026-09-01', '2026-09-05', '2026', '1º a 5 de setembro'],
    ['2026-09-01', '2026-09-30', '2026', 'setembro'],
    ['2026-02-01', '2026-02-28', undefined, 'fevereiro de 2026'],
    ['2026-09-01', '2026-09-01', '2026', '1º de setembro'],
    ['2025-12-01', '2025-12-05', '2026', '1º a 5 de dezembro de 2025'],
  ])('deve escrever %s a %s (ano de referência %s) como "%s"', (de, ate, ano, esperado) => {
    // ARRANGE + ACT + ASSERT
    expect(intervaloEmPalavras(de, ate, ano)).toBe(esperado)
  })

  it('deve abrir a aba com o período medido e o comparado', () => {
    // ARRANGE
    const base = { periodo: PERIODO, inicio_historico: '2026-09', inicio_historico_dia: '2026-09-01' }

    // ACT + ASSERT
    expect(fraseDoPeriodo(base)).toBe('De 1º a 5 de outubro de 2026, até hoje, comparado com 1º a 5 de setembro de 2026.')
  })

  it('deve dizer que não há comparação quando o comparado é anterior ao histórico', () => {
    // ARRANGE — o primeiro mês do sistema
    const base = { periodo: PERIODO, inicio_historico: '2026-10', inicio_historico_dia: '2026-10-02' }

    // ACT + ASSERT
    expect(fraseDoPeriodo(base)).toBe(
      'De 1º a 5 de outubro de 2026, até hoje, sem comparação: os indicadores contam a partir de 2 de outubro de 2026.',
    )
  })

  it('deve nomear o mês fechado inteiro', () => {
    // ARRANGE
    const fechado = periodoFicticio('2026-09', {
      ate: '2026-09-30',
      parcial: false,
      comparado_de: '2026-08-01',
      comparado_ate: '2026-08-31',
    })

    // ACT + ASSERT
    expect(fraseDoPeriodo({ periodo: fechado, inicio_historico: '2026-08', inicio_historico_dia: '2026-08-01' })).toBe(
      'Setembro de 2026, comparado com agosto de 2026.',
    )
  })
})

describe('o início do histórico por DIA — o comparado precisa estar inteiro dentro dele (contrato 1)', () => {
  const SETEMBRO_FECHADO = periodoFicticio('2026-09', {
    ate: '2026-09-30',
    parcial: false,
    comparado_de: '2026-08-01',
    comparado_ate: '2026-08-31',
  })

  it.each([
    // [caso, sem comparação?, período, início (mês, dia)]
    ['setembro × agosto, sistema desde 21/08', true, SETEMBRO_FECHADO, '2026-08', '2026-08-21'],
    ['setembro × agosto, sistema desde 1º/08', false, SETEMBRO_FECHADO, '2026-08', '2026-08-01'],
    ['outubro (1–5) × 1–5/09, sistema desde 21/08', false, PERIODO, '2026-08', '2026-08-21'],
    ['outubro (1–5) × 1–5/09, sistema desde 3/09', true, PERIODO, '2026-09', '2026-09-03'],
    ['outubro × setembro, sistema desde outubro', true, PERIODO, '2026-10', '2026-10-01'],
  ] as const)('deve decidir a comparação em %s → sem comparação = %s', (_caso, esperado, periodo, mes, dia) => {
    // ARRANGE
    const base = { periodo, inicio_historico: mes, inicio_historico_dia: dia }

    // ACT + ASSERT
    expect(comparadoAntesDoHistorico(base)).toBe(esperado)
  })

  it('deve dizer a data dos indicadores quando eles começaram NO MEIO do período comparado', () => {
    // ARRANGE — o exemplo do contrato: setembro fechado contra agosto, com o sistema desde 21/08
    const base = { periodo: SETEMBRO_FECHADO, inicio_historico: '2026-08', inicio_historico_dia: '2026-08-21' }

    // ACT + ASSERT
    expect(fraseDoPeriodo(base)).toBe(
      'Setembro de 2026, sem comparação: os indicadores contam a partir de 21 de agosto de 2026.',
    )
  })

  it('deve dizer a data dos indicadores quando eles começaram DEPOIS do período comparado', () => {
    // ARRANGE — outubro (1–5) contra 1–5 de setembro, com o sistema desde 21 de setembro (CR-IND-19)
    const base = { periodo: PERIODO, inicio_historico: '2026-09', inicio_historico_dia: '2026-09-21' }

    // ACT + ASSERT
    expect(fraseDoPeriodo(base)).toBe(
      'De 1º a 5 de outubro de 2026, até hoje, sem comparação: os indicadores contam a partir de 21 de setembro de 2026.',
    )
  })

  it('deve dizer a data configurada, e não setembro, quando os indicadores contam a partir de 1º de outubro', () => {
    // ARRANGE — o caso da produção (change inicio-dos-indicadores): primeiro agendamento em agosto,
    // data configurada em 1º/10; o servidor manda o início já resolvido
    const base = { periodo: PERIODO, inicio_historico: '2026-10', inicio_historico_dia: '2026-10-01' }

    // ACT + ASSERT
    expect(fraseDoPeriodo(base)).toBe(
      'De 1º a 5 de outubro de 2026, até hoje, sem comparação: os indicadores contam a partir de 1º de outubro de 2026.',
    )
  })

  it('deve titular a tendência e os novos sem chamar setembro de "primeiro mês" quando o sistema começou em agosto', () => {
    // ARRANGE — o servidor manda todo `anterior` nulo
    const historico = { inicio_historico: '2026-08', inicio_historico_dia: '2026-08-21', periodo: SETEMBRO_FECHADO }
    const dinheiro = painelDoDinheiroFicticio({ ...historico, recebido: { atual: '9000.00', anterior: null } })
    const pacientes = painelDosPacientesFicticio({ ...historico, novos: { atual: 12, anterior: null } })

    // ACT + ASSERT
    // o título diz a CONCLUSÃO (DQ-21); o aviso vai para o subtítulo
    expect(tituloDaTendenciaDoRecebido(dinheiro)).toBe('Setembro, primeiro mês inteiro dos indicadores, recebeu R$ 9 mil')
    expect(tituloDosNovos(pacientes)).toBe('Setembro, primeiro mês inteiro dos indicadores, teve 12 cadastros novos')
    expect(avisoDeSemComparacao(dinheiro)).toBe(' Sem comparação: os indicadores contam a partir de 21 de agosto de 2026.')
    expect(avisoDeSemComparacao(painelDoDinheiroFicticio())).toBe('')
  })
})

describe('a comparação — sem comparação, igual, alta e queda', () => {
  it('deve dizer "sem comparação", sem direção, quando o anterior é nulo', () => {
    // ARRANGE + ACT
    const comparacao = compararContagem({ atual: 24, anterior: null }, PERIODO, 'subir-e-bom')

    // ASSERT — nenhuma seta tem o que mostrar
    expect(comparacao.direcao).toBeNull()
    expect(comparacao.variacao).toBe('sem comparação')
  })

  it.each([
    [{ atual: 24, anterior: 20 }, 'subir-e-bom', 'alta', 'bom', '4 a mais'],
    [{ atual: 15, anterior: 20 }, 'subir-e-bom', 'queda', 'ruim', '5 a menos'],
    [{ atual: 20, anterior: 20 }, 'subir-e-bom', 'igual', 'neutro', 'o mesmo'],
    [{ atual: 3, anterior: 1 }, 'subir-e-ruim', 'alta', 'ruim', '2 a mais'],
    // a base pequena: em porcentagem seria "517% a mais"
    [{ atual: 37, anterior: 6 }, 'subir-e-bom', 'alta', 'bom', '31 a mais'],
    [{ atual: 0, anterior: 4 }, 'subir-e-bom', 'queda', 'ruim', '4 a menos'],
    [{ atual: 1001, anterior: 1000 }, 'neutra', 'alta', 'neutro', '1 a mais'],
    [{ atual: 1000, anterior: 2500 }, 'neutra', 'queda', 'neutro', '1.500 a menos'],
  ] as const)('deve comparar a contagem %o (%s) → %s/%s: "%s"', (par, valencia, direcao, tom, variacao) => {
    // ARRANGE + ACT
    const comparacao = compararContagem(par, PERIODO, valencia)

    // ASSERT — a seta, o tom e a variação que o cartão escreve, contra o MESMO período
    expect(comparacao.direcao).toBe(direcao)
    expect(comparacao.tom).toBe(tom)
    expect(comparacao.variacao).toBe(variacao)
    expect(comparacao.referencia).toBe('1º a 5 de setembro')
  })

  it('deve marcar a comparação contra zero, que o cartão escreve sem repetir o valor (DQ-09)', () => {
    // ARRANGE + ACT
    const comparacao = compararContagem({ atual: 5, anterior: 0 }, PERIODO, 'subir-e-bom')

    // ASSERT
    expect(comparacao.direcao).toBe('alta')
    expect(comparacao.anteriorZero).toBe(true)
  })

  it.each([
    [{ atual: '7560.60', anterior: '6400.00' }, 'alta', '18% a mais'],
    [{ atual: '80.00', anterior: '85.00' }, 'queda', '6% a menos'],
    [{ atual: '100.10', anterior: '100.10' }, 'igual', 'o mesmo'],
    [{ atual: '150.00', anterior: '0.00' }, 'alta', 'antes era zero'],
    [{ atual: null, anterior: '80.00' }, null, 'sem comparação'],
  ] as const)('deve comparar dinheiro %o sem ponto flutuante → %s "%s"', (par, direcao, variacao) => {
    // ARRANGE + ACT
    const comparacao = compararMoeda(par, PERIODO, 'subir-e-bom')

    // ASSERT
    expect(comparacao.direcao).toBe(direcao)
    expect(comparacao.variacao).toBe(variacao)
  })

  it.each([
    [0.87, 0.91, 'subir-e-bom', 'queda', 'ruim', '4 p.p. a menos'],
    [0.0602, 0.0455, 'subir-e-ruim', 'alta', 'ruim', '1,5 p.p. a mais'],
    [0.0602, 0.06, 'subir-e-ruim', 'igual', 'neutro', 'o mesmo'],
    [0.625, null, 'subir-e-bom', null, 'neutro', 'sem comparação'],
    [0.05, 0, 'subir-e-ruim', 'alta', 'ruim', 'antes era zero'],
  ] as const)('deve comparar as taxas %s × %s em pontos (%s) → %s/%s "%s"', (atual, anterior, valencia, direcao, tom, variacao) => {
    // ARRANGE + ACT
    const comparacao = compararTaxa(atual, anterior, PERIODO, valencia)

    // ASSERT
    expect(comparacao.direcao).toBe(direcao)
    expect(comparacao.tom).toBe(tom)
    expect(comparacao.variacao).toBe(variacao)
  })
})

describe('as frases de cada frente', () => {
  it.each([
    [4, 'Ainda estão previstos R$ 21.300 até o fim do mês. R$ 1.240 a receber estão em atraso, em 4 lançamentos.'],
    [1, 'Ainda estão previstos R$ 21.300 até o fim do mês. R$ 1.240 a receber está em atraso, em 1 lançamento.'],
    [0, 'Ainda estão previstos R$ 21.300 até o fim do mês. Nenhuma receita em atraso.'],
  ])('deve escrever o atraso no cartão com %s lançamentos', (quantidade, esperado) => {
    // ARRANGE
    const painel = painelDoDinheiroFicticio({ em_atraso: { valor: '1240.00', quantidade } })

    // ACT + ASSERT
    expect(textoDaFrase(fraseDoCartaoDoDinheiro(painel))).toBe(esperado)
  })

  it('deve dizer no cartão da agenda sobre quantos profissionais a ocupação vale', () => {
    // ARRANGE + ACT
    const frase = textoDaFrase(fraseDoCartaoDaAgenda(painelDaAgendaFicticio()))

    // ASSERT
    expect(frase).toBe(
      'Faltas em 6% e desmarques em 9% das sessões que já passaram, acima de 1º a 5 de setembro. A ocupação foi calculada sobre 9 de 12 profissionais, os que têm horário e especialidade cadastrados.',
    )
  })

  it('deve pôr a comparação dos NOVOS na frase do cartão, nunca junto dos ativos', () => {
    // ARRANGE + ACT — a linha "+24 novos no período" vem antes; a frase diz contra o quê
    const frase = textoDaFrase(fraseDoCartaoDosPacientes(painelDosPacientesFicticio()))

    // ASSERT
    expect(frase).toBe('Os novos são 4 a mais que em 1º a 5 de setembro. 3 saíram no período. 9 pacotes estão no fim.')
  })

})

describe('as evoluções — atrasadas E sem evolução, juntas, sem parecer contradição', () => {
  it.each([
    // [atrasadas, profissionais, sem_evolucao, prazo, frase do cartão da Visão geral]
    [0, 0, 255, 3, '255 sessões ainda sem evolução; nenhuma passou do prazo de 3 dias.'],
    [6, 3, 255, 3, '6 sessões passaram do prazo de 3 dias, de 3 profissionais; 255 ainda sem evolução no total.'],
    [1, 1, 1, 1, '1 sessão passou do prazo de 1 dia, de 1 profissional; 1 ainda sem evolução no total.'],
    [0, 0, 1, 2, '1 sessão ainda sem evolução; nenhuma passou do prazo de 2 dias.'],
    [0, 0, 0, 3, 'Todas as sessões realizadas têm evolução.'],
  ])('deve escrever as evoluções com %s atrasadas de %s profissionais, %s sem evolução e prazo de %s dias', (atrasadas, profissionais, semEvolucao, prazo, esperado) => {
    // ARRANGE
    const painel = painelDaEquipeFicticio({
      evolucoes: { em_dia: { atual: 0.94, anterior: 0.9 }, atrasadas, profissionais_com_atraso: profissionais, sem_evolucao: semEvolucao, prazo_dias: prazo },
    })

    // ACT + ASSERT
    expect(textoDaFrase(fraseDasEvolucoes(painel))).toBe(esperado)
  })

  it.each([
    [6, 3, 255, 'De 3 profissionais. 255 sessões ainda sem evolução no total.'],
    [0, 0, 255, '255 sessões ainda sem evolução, todas dentro do prazo.'],
    [0, 0, 0, 'Todas as sessões realizadas têm evolução.'],
  ])('deve escrever o cartão "Evoluções atrasadas" com %s atrasadas e %s sem evolução', (atrasadas, profissionais, semEvolucao, esperado) => {
    // ARRANGE
    const painel = painelDaEquipeFicticio({
      evolucoes: { em_dia: { atual: 0.94, anterior: 0.9 }, atrasadas, profissionais_com_atraso: profissionais, sem_evolucao: semEvolucao, prazo_dias: 3 },
    })

    // ACT + ASSERT
    expect(textoDaFrase(fraseDoCartaoDeAtrasadas(painel))).toBe(esperado)
  })

})

describe('os títulos que dizem a conclusão', () => {
  it.each([
    [[{ dia: 1, sessoes: 10, faltas: 2, taxa: 0.2 }, { dia: 2, sessoes: 10, faltas: 1, taxa: 0.1 }], 'As faltas se concentram na segunda-feira'],
    [[{ dia: 6, sessoes: 10, faltas: 3, taxa: 0.3 }, { dia: 2, sessoes: 10, faltas: 1, taxa: 0.1 }], 'As faltas se concentram no sábado'],
    [[{ dia: 1, sessoes: 10, faltas: 2, taxa: 0.2 }, { dia: 5, sessoes: 10, faltas: 2, taxa: 0.2 }], 'As faltas se concentram na segunda e na sexta'],
    [[{ dia: 1, sessoes: 10, faltas: 0, taxa: 0 }], 'Nenhuma falta no período'],
  ])('deve titular as faltas por dia %#', (linhas, esperado) => {
    // ARRANGE + ACT + ASSERT
    expect(tituloDasFaltasPorDia(linhas)).toBe(esperado)
  })

  it('deve titular o mapa pela célula mais vazia, ignorando as sem grade', () => {
    // ARRANGE + ACT + ASSERT — o sábado à tarde não tem capacidade: não é "0%", é sem medida
    expect(tituloDoMapa(painelDaAgendaFicticio().ocupacao_por_periodo)).toBe('A sexta à tarde é o horário mais vazio')
  })

  it('deve dizer "Nenhum horário ocupado" quando todas as células com grade ficaram em 0% (DQ-22)', () => {
    // ARRANGE — com grade em todas, e nenhuma marcação: não existe "o horário mais vazio"
    const celulas = [
      { dia: 1, periodo: 'manha', marcadas: 0, capacidade: 40, taxa: 0 },
      { dia: 5, periodo: 'tarde', marcadas: 0, capacidade: 40, taxa: 0 },
      { dia: 6, periodo: 'tarde', marcadas: 0, capacidade: 0, taxa: null },
    ] as const

    // ACT + ASSERT
    expect(tituloDoMapa([...celulas])).toBe('Nenhum horário ocupado no período')
    expect(celulaMaisVazia([...celulas])).toBeNull()
  })

  it('deve titular os convênios pelo pior, sem contar a linha "Outros"', () => {
    // ARRANGE + ACT + ASSERT
    expect(tituloDosConvenios(painelDaAgendaFicticio().por_convenio)).toBe(
      'Convênio Fictício Beta tem a maior taxa de faltas e desmarques',
    )
  })

  it.each([
    [{ atual: '6600.00', anterior: '6400.00' }, true, 'O recebido de outubro está no ritmo de setembro'],
    [{ atual: '7560.60', anterior: '6400.00' }, true, 'O recebido de outubro está acima do ritmo de setembro'],
    [{ atual: '3000.00', anterior: '6400.00' }, true, 'O recebido de outubro está abaixo do ritmo de setembro'],
    [{ atual: '7560.60', anterior: '6400.00' }, false, 'Outubro recebeu mais que setembro'],
  ])('deve titular a tendência pela comparação JUSTA %#', (recebido, parcial, esperado) => {
    // ARRANGE
    const painel = painelDoDinheiroFicticio({ recebido, periodo: periodoFicticio(undefined, { parcial }) })

    // ACT + ASSERT
    expect(tituloDaTendenciaDoRecebido(painel)).toBe(esperado)
  })
})

describe('o primeiro mês do histórico', () => {
  it('deve titular o mês do início pela conclusão: "primeiro mês dos indicadores" e quanto recebeu', () => {
    // ARRANGE — o sistema começou em 2 de outubro: não há setembro para comparar
    const painel = painelDoDinheiroFicticio({
      inicio_historico: '2026-10',
      inicio_historico_dia: '2026-10-02',
      recebido: { atual: '7560.60', anterior: null },
    })

    // ACT + ASSERT
    expect(tituloDaTendenciaDoRecebido(painel)).toBe('Outubro, primeiro mês dos indicadores, recebeu R$ 7,6 mil até hoje')
  })
})

describe('frases com 0 e com 1 — nada de "Das 1 sessão que já passaram" (DQ-09)', () => {
  it.each([
    [28, 288, '28 de 288 sessões que já passaram.'],
    [1, 1, '1 de 1 sessão que já passou.'],
    [0, 0, 'Nenhuma sessão do período já passou.'],
  ])('deve dizer de quantas passadas é a parte %s de %s', (quantidade, passadas, esperado) => {
    // ARRANGE
    const painel = painelDaAgendaFicticio({ sessoes_passadas: { atual: passadas, anterior: 900 } })

    // ACT + ASSERT
    expect(textoDaFrase(fraseDaParteDasPassadas(quantidade, painel))).toBe(esperado)
  })

  it.each([
    [0, 'nenhum paciente novo no período'],
    [1, '+1 novo no período'],
    [37, '+37 novos no período'],
  ])('deve escrever a linha dos novos com %s', (novos, esperado) => {
    // ARRANGE + ACT + ASSERT — sem seta: o número do cartão são os ativos
    expect(linhaDosNovos(painelDosPacientesFicticio({ novos: { atual: novos, anterior: 5 } }))).toBe(esperado)
  })

  it.each([
    [{ atual: 24, anterior: 24 }, 'Os novos são tantos quanto em 1º a 5 de setembro. 3 saíram no período. 9 pacotes estão no fim.'],
    [{ atual: 24, anterior: 0 }, 'Em 1º a 5 de setembro, nenhum paciente novo. 3 saíram no período. 9 pacotes estão no fim.'],
    [{ atual: 24, anterior: null }, '3 saíram no período. 9 pacotes estão no fim.'],
  ])('deve comparar os novos do cartão %o sem repetir o número', (novos, esperado) => {
    // ARRANGE + ACT + ASSERT
    expect(textoDaFrase(fraseDoCartaoDosPacientes(painelDosPacientesFicticio({ novos })))).toBe(esperado)
  })

  it.each([
    [0, 0, 'Ninguém saiu no período. Nenhum pacote no fim.'],
    [1, 1, '1 saiu no período. 1 pacote está no fim.'],
  ])('deve escrever %s saída(s) e %s pacote(s) no fim', (sairam, pacotes, esperado) => {
    // ARRANGE
    const painel = painelDosPacientesFicticio({ sairam: { atual: sairam, anterior: 0 }, pacotes_no_fim: pacotes })

    // ACT + ASSERT
    expect(textoDaFrase(fraseDasSaidasEPacotes(painel))).toBe(esperado)
  })

  it.each([
    [0, 0, 'Nenhum lembrete enviado no período.'],
    [1, 1, '1 de 1 lembrete enviado, confirmados pela família ou pela recepção.'],
    [180, 288, '180 de 288 lembretes enviados, confirmados pela família ou pela recepção.'],
  ])('deve escrever as confirmadas %s de %s', (confirmadas, enviados, esperado) => {
    // ARRANGE
    const painel = painelDaAgendaFicticio({ confirmadas: { atual: { confirmadas, enviados, taxa: null }, anterior: null } })

    // ACT + ASSERT
    expect(textoDaFrase(fraseDasConfirmadas(painel))).toBe(esperado)
  })

  it.each([
    [9, 12, 'A ocupação foi calculada sobre 9 de 12 profissionais, os que têm horário e especialidade cadastrados.'],
    [10, 10, 'Calculada sobre os 10 profissionais com sessão, todos com horário e especialidade cadastrados.'],
    [1, 1, 'Calculada sobre o único profissional com sessão, que tem horário e especialidade cadastrados.'],
    [0, 0, 'Nenhum profissional com sessão no período.'],
  ])('deve dizer no cartão Ocupação sobre %s de %s profissionais', (comGrade, profissionais, esperado) => {
    // ARRANGE
    const painel = painelDaAgendaFicticio({ ocupacao: { atual: 0.8, anterior: 0.7, profissionais_com_grade: comGrade, profissionais } })

    // ACT + ASSERT
    expect(textoDaFrase(fraseDoCartaoDaOcupacao(painel))).toBe(esperado)
  })
})

describe('pacotes no fim e fila de espera AUSENTES — ausente não é zero (SEC-IND-01)', () => {
  it('não deve falar de pacotes quando o servidor não manda a chave', () => {
    // ARRANGE — sem `tratamentos.ver`, a chave vem AUSENTE: "nenhum pacote no fim" seria mentira
    const painel = semAsChavesProtegidas(painelDosPacientesFicticio())

    // ACT
    const frase = textoDaFrase(fraseDasSaidasEPacotes(painel))

    // ASSERT
    expect(frase).not.toMatch(/pacote/i)
  })
})
