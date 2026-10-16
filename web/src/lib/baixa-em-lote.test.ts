import { describe, expect, it } from 'vitest'

import {
  agruparPorMotivo,
  anuncioDaPreviaVazia,
  consequenciaDoStatus,
  diaEmPalavrasCurto,
  fraseDaPreviaVazia,
  intervaloDoAlcance,
  partesDoInicio,
  plural,
  statusAplicaveisEmLote,
  tituloDoGrupo,
  type StatusDaSelecao,
} from '@/lib/baixa-em-lote'

function status(sobrescritas: Partial<StatusDaSelecao>): StatusDaSelecao {
  return {
    id: 1,
    nome: 'Status',
    cor: '#64748B',
    cor_borda: null,
    tipo: null,
    ordem: 1,
    desconta_sessao: false,
    marca_falta: false,
    aplicavel_em_lote: false,
    ...sobrescritas,
  }
}

describe('helpers da baixa em lote', () => {
  it('deve contar os últimos 7 dias para trás a partir da data da agenda, inclusive', () => {
    // ARRANGE — quinta 10/09; a semana civil começaria em 07/09
    const escolhido = { de: '2026-01-01', ate: '2026-01-02' }

    // ACT
    const ultimos7 = intervaloDoAlcance('ultimos7', '2026-09-10', escolhido)
    const dia = intervaloDoAlcance('dia', '2026-09-10', escolhido)
    const datas = intervaloDoAlcance('datas', '2026-09-10', escolhido)

    // ASSERT
    expect(ultimos7).toEqual({ de: '2026-09-04', ate: '2026-09-10' })
    expect(dia).toEqual({ de: '2026-09-10', ate: '2026-09-10' })
    expect(datas).toEqual(escolhido)
  })

  it('deve oferecer só os aplicáveis em lote, na ordem do cadastro', () => {
    // ARRANGE — a ordem da lista NÃO é a ordem do cadastro
    const lista = [
      status({ id: 5, nome: 'Não Compareceu', ordem: 5, aplicavel_em_lote: false }),
      status({ id: 4, nome: 'Falta Justificada', ordem: 4, aplicavel_em_lote: true }),
      status({ id: 3, nome: 'Finalizado', ordem: 3, aplicavel_em_lote: true }),
    ]

    // ACT
    const aplicaveis = statusAplicaveisEmLote(lista)

    // ASSERT — o primeiro é o que nasce marcado
    expect(aplicaveis.map((item) => item.nome)).toEqual(['Finalizado', 'Falta Justificada'])
  })

  it('deve derivar a consequência das FLAGS, nunca do nome', () => {
    // ARRANGE / ACT / ASSERT
    expect(consequenciaDoStatus({ desconta_sessao: true, marca_falta: false })).toBe(
      'Desconta uma sessão do pacote de cada criança.',
    )
    expect(consequenciaDoStatus({ desconta_sessao: false, marca_falta: true })).toBe('Conta como falta para a criança.')
    expect(consequenciaDoStatus({ desconta_sessao: false, marca_falta: false })).toBe('Só muda o status.')
  })

  it('deve escrever a data e a hora do recusado sem passar pelo fuso do navegador', () => {
    // ARRANGE / ACT
    const partes = partesDoInicio('2026-09-10 14:10')

    // ASSERT
    expect(partes).toEqual({ data: '2026-09-10', dia: 'qui 10/09', hora: '14:10' })
    expect(diaEmPalavrasCurto('2026-09-10')).toBe('quinta, 10 de setembro')
    expect(diaEmPalavrasCurto('2026-10-01')).toBe('quinta, 1º de outubro')
  })

  it('deve agrupar por motivo mantendo as linhas, e traduzir a constante com a contagem', () => {
    // ARRANGE
    const recusados = [
      { id: 1, inicio: '2026-09-10 19:00', motivo: 'ainda_nao_comecou' },
      { id: 2, inicio: '2026-09-10 19:40', motivo: 'ainda_nao_comecou' },
      { id: 3, inicio: '2026-09-09 09:00', motivo: 'Frase crua do domínio.' },
    ]

    // ACT
    const grupos = agruparPorMotivo(recusados)

    // ASSERT — a frase crua vira título do grupo, sem tradução
    expect([...grupos.keys()]).toEqual(['ainda_nao_comecou', 'Frase crua do domínio.'])
    expect(grupos.get('ainda_nao_comecou')?.map((item) => item.id)).toEqual([1, 2])
    expect(tituloDoGrupo('ainda_nao_comecou', 2)).toBe('Ainda não começou (2)')
    expect(tituloDoGrupo('Frase crua do domínio.', 1)).toBe('Frase crua do domínio. (1)')
  })

  it('deve concordar em número explicitamente, nunca "(s)"', () => {
    // ARRANGE / ACT / ASSERT
    expect(plural(1, 'criança', 'crianças')).toBe('1 criança')
    expect(plural(9, 'criança', 'crianças')).toBe('9 crianças')
    expect(plural(0, 'criança', 'crianças')).toBe('0 crianças')
  })

  it('deve dizer "já está com baixa" SÓ quando não sobrou nenhum em aberto recusado', () => {
    // ARRANGE / ACT / ASSERT — zero elegíveis com recusados é agenda em aberto, não agenda fechada
    expect(fraseDaPreviaVazia(0)).toBe('Nada em aberto nesse alcance — a agenda já está com baixa, ou escolha outra data.')
    expect(fraseDaPreviaVazia(1)).toBe(
      'O único agendamento em aberto nesse alcance não pode receber a baixa agora — veja o motivo em “Ficam de fora”.',
    )
    expect(fraseDaPreviaVazia(4)).toBe(
      'Nenhum dos 4 agendamentos em aberto nesse alcance pode receber a baixa agora — veja os motivos em “Ficam de fora”.',
    )
    expect(fraseDaPreviaVazia(4)).not.toMatch(/já está com baixa/)
  })

  it('deve anunciar o número de recusados na região viva quando a prévia conta zero', () => {
    // ARRANGE / ACT / ASSERT — quem só ouve recebe o mesmo número que quem lê "Ficam de fora"
    expect(anuncioDaPreviaVazia(0)).toBe(fraseDaPreviaVazia(0))
    expect(anuncioDaPreviaVazia(1)).toBe('Prévia: nenhum agendamento pode receber a baixa agora, 1 fica de fora')
    expect(anuncioDaPreviaVazia(2)).toBe('Prévia: nenhum agendamento pode receber a baixa agora, 2 ficam de fora')
  })
})
