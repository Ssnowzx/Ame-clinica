import { describe, expect, it } from 'vitest'

import {
  agruparPorColuna,
  planejarMovimento,
  separarEtiquetas,
  tarefaAtrasada,
} from '@/lib/quadro-de-tarefas'
import type { Tarefa } from '@/tipos'

function tarefa(sobrescritas: Partial<Tarefa> & Pick<Tarefa, 'id'>): Tarefa {
  return {
    titulo: `Tarefa fictícia ${sobrescritas.id}`,
    descricao: null,
    coluna: 'a_fazer',
    prioridade: 'media',
    prazo: null,
    etiquetas: null,
    posicao: 0,
    concluida_em: null,
    arquivada_em: null,
    responsaveis: [],
    comentarios_count: 0,
    comentarios_nao_lidos_count: 0,
    updated_at: '2026-07-26T10:00:00.000000Z',
    ...sobrescritas,
  }
}

describe('agruparPorColuna', () => {
  it('deve agrupar por coluna na ordem de posição, com desempate por id', () => {
    // ARRANGE — posições fora de ordem e um empate
    const tarefas = [
      tarefa({ id: 3, posicao: 1 }),
      tarefa({ id: 1, posicao: 0 }),
      tarefa({ id: 2, posicao: 1 }),
      tarefa({ id: 4, coluna: 'aguardando', posicao: 0 }),
    ]

    // ACT
    const grupos = agruparPorColuna(tarefas)

    // ASSERT — 1 (pos 0), depois o empate 2/3 por id; toda coluna existe
    expect(grupos.a_fazer.map((t) => t.id)).toEqual([1, 2, 3])
    expect(grupos.aguardando.map((t) => t.id)).toEqual([4])
    expect(grupos.em_andamento).toEqual([])
    expect(grupos.concluida).toEqual([])
  })
})

describe('planejarMovimento', () => {
  const quadro = [
    tarefa({ id: 1, posicao: 0 }),
    tarefa({ id: 2, posicao: 1 }),
    tarefa({ id: 3, posicao: 2 }),
    tarefa({ id: 4, coluna: 'em_andamento', posicao: 0 }),
  ]

  it('deve reindexar denso as DUAS colunas ao mover entre colunas', () => {
    // ACT — o cartão 2 vai para o topo de em_andamento
    const plano = planejarMovimento(quadro, 2, 'em_andamento', 0)

    // ASSERT — destino [2, 4] e origem [1, 3], ambos 0..n-1
    expect(plano).not.toBeNull()
    expect(plano?.itens).toEqual(
      expect.arrayContaining([
        { id: 2, coluna: 'em_andamento', posicao: 0 },
        { id: 4, coluna: 'em_andamento', posicao: 1 },
        { id: 1, coluna: 'a_fazer', posicao: 0 },
        { id: 3, coluna: 'a_fazer', posicao: 1 },
      ]),
    )
    const movida = plano?.tarefas.find((t) => t.id === 2)
    expect(movida?.coluna).toBe('em_andamento')
    expect(movida?.posicao).toBe(0)
  })

  it('deve mover para o FIM quando o índice não é informado', () => {
    // ACT
    const plano = planejarMovimento(quadro, 1, 'em_andamento')

    // ASSERT
    expect(plano?.itens).toEqual(
      expect.arrayContaining([
        { id: 4, coluna: 'em_andamento', posicao: 0 },
        { id: 1, coluna: 'em_andamento', posicao: 1 },
      ]),
    )
  })

  it('deve reordenar dentro da mesma coluna sem tocar as outras', () => {
    // ACT — o cartão 3 sobe para o topo da própria coluna
    const plano = planejarMovimento(quadro, 3, 'a_fazer', 0)

    // ASSERT — só a_fazer no lote
    expect(plano?.itens).toEqual([
      { id: 3, coluna: 'a_fazer', posicao: 0 },
      { id: 1, coluna: 'a_fazer', posicao: 1 },
      { id: 2, coluna: 'a_fazer', posicao: 2 },
    ])
  })

  it('deve devolver null quando soltar no MESMO lugar (não-evento)', () => {
    // ACT + ASSERT — mesma coluna, mesma posição: nenhum request
    expect(planejarMovimento(quadro, 2, 'a_fazer', 1)).toBeNull()
    expect(planejarMovimento(quadro, 3, 'a_fazer')).toBeNull() // fim = onde já está
  })

  it('deve devolver null para id que não está no quadro', () => {
    // ACT + ASSERT — DOM/URL é entrada não confiável (mesmo contrato do lerAlvoDoSlot)
    expect(planejarMovimento(quadro, 999, 'a_fazer', 0)).toBeNull()
  })

  it('deve engolir índice fora do teto sem quebrar (clamp no fim)', () => {
    // ACT
    const plano = planejarMovimento(quadro, 4, 'a_fazer', 99)

    // ASSERT — entra na última posição válida
    expect(plano?.itens).toEqual(
      expect.arrayContaining([{ id: 4, coluna: 'a_fazer', posicao: 3 }]),
    )
  })
})

describe('tarefaAtrasada', () => {
  it('deve marcar atraso só com prazo vencido FORA de concluída', () => {
    // ARRANGE
    const hoje = '2026-07-26'

    // ACT + ASSERT
    expect(tarefaAtrasada({ prazo: '2026-07-25', coluna: 'a_fazer' }, hoje)).toBe(true)
    expect(tarefaAtrasada({ prazo: '2026-07-25', coluna: 'concluida' }, hoje)).toBe(false)
    expect(tarefaAtrasada({ prazo: '2026-07-26', coluna: 'a_fazer' }, hoje)).toBe(false)
    expect(tarefaAtrasada({ prazo: null, coluna: 'a_fazer' }, hoje)).toBe(false)
  })
})

describe('separarEtiquetas', () => {
  it('deve separar por vírgula, aparar espaço e sumir com o vazio', () => {
    // ACT + ASSERT
    expect(separarEtiquetas(' recepção , compras ,, ')).toEqual(['recepção', 'compras'])
    expect(separarEtiquetas(null)).toEqual([])
    expect(separarEtiquetas('')).toEqual([])
  })
})
