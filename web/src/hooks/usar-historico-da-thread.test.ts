import { act, renderHook } from '@testing-library/react'
import { HttpResponse, http as msw } from 'msw'
import { describe, expect, it } from 'vitest'

import { usarHistoricoDaThread } from '@/hooks/usar-historico-da-thread'
import { servidor } from '@/test/servidor-msw'
import type { Mensagem } from '@/tipos'

/** Dados 100% FICTÍCIOS (LGPD — menores). */
function mensagem(id: number): Mensagem {
  return {
    id,
    direcao: 'recebida',
    tipo: 'texto',
    corpo: `Mensagem fictícia ${id}`,
    template_nome: null,
    status: 'recebida',
    erro_motivo: null,
    automatica: false,
    enviada_por: null,
    expurgada: false,
    midia: null,
    mapa_url: null,
    tipo_original: null,
    em: '2026-09-29T12:00:00.000Z',
  }
}

function ids(mensagens: Mensagem[]): number[] {
  return mensagens.map((item) => item.id)
}

/** O servidor devolve as anteriores de `?antes=`: aqui, sempre a mensagem 5. */
function servidorComAnteriores() {
  servidor.use(
    msw.get('/api/mensagens/conversas/:id', () =>
      HttpResponse.json({ conversa: null, tem_anteriores: false, mensagens: [mensagem(5)] }),
    ),
  )
}

describe('usarHistoricoDaThread', () => {
  it('deve guardar no histórico a mensagem que sai pelo topo da janela', async () => {
    // ARRANGE — histórico carregado (5), janela 10–11; chega a 12 e a janela vira 11–12
    servidorComAnteriores()
    const { result, rerender } = renderHook(({ janela }) => usarHistoricoDaThread(1, janela), {
      initialProps: { janela: [mensagem(10), mensagem(11)] },
    })
    await act(() => result.current.carregarAnteriores())

    // ACT
    rerender({ janela: [mensagem(11), mensagem(12)] })

    // ASSERT — a 10 fica entre a 5 e a 11
    expect(ids(result.current.mensagens)).toEqual([5, 10, 11, 12])
  })

  it('deve descartar o histórico quando a janela nova SALTA a velha, em vez de deixar buraco', async () => {
    // ARRANGE — entre duas leituras chegaram mais mensagens que a janela: a nova (30–31) não
    // encosta na velha (10–11), e o que ficou entre as duas nunca foi lido (CRL2-03)
    servidorComAnteriores()
    const { result, rerender } = renderHook(({ janela }) => usarHistoricoDaThread(1, janela), {
      initialProps: { janela: [mensagem(10), mensagem(11)] },
    })
    await act(() => result.current.carregarAnteriores())

    // ACT
    rerender({ janela: [mensagem(30), mensagem(31)] })

    // ASSERT — só a janela nova; a pessoa volta a "Carregar anteriores" a partir dela. Prova por
    // mutação: sem a regra do salto, o histórico vira 5, 10, 11 … 30, 31, com o buraco 12–29
    expect(ids(result.current.mensagens)).toEqual([30, 31])
    expect(result.current.temHistorico).toBe(false)
  })

  it('deve descartar as anteriores que chegam DEPOIS de a janela saltar', async () => {
    // ARRANGE — o pedido sai ancorado na 10 (janela 10–11); com ele no ar, a janela salta para
    // 30–31; aí chega a 5. Juntar daria 5, 30, 31 — com o buraco 6–29 escondido (CRL3-02)
    let liberar: () => void = () => undefined
    const portao = new Promise<void>((resolver) => {
      liberar = resolver
    })
    servidor.use(
      msw.get('/api/mensagens/conversas/:id', async () => {
        await portao
        return HttpResponse.json({ conversa: null, tem_anteriores: false, mensagens: [mensagem(5)] })
      }),
    )
    const { result, rerender } = renderHook(({ janela }) => usarHistoricoDaThread(1, janela), {
      initialProps: { janela: [mensagem(10), mensagem(11)] },
    })

    // ACT
    let pedido: Promise<void> = Promise.resolve()
    act(() => {
      pedido = result.current.carregarAnteriores()
    })
    rerender({ janela: [mensagem(30), mensagem(31)] })
    liberar()
    await act(() => pedido)

    // ASSERT — prova por mutação: sem conferir a âncora, a 5 entra e o buraco fica
    expect(ids(result.current.mensagens)).toEqual([30, 31])
  })

  it('deve zerar o histórico ao trocar de conversa', async () => {
    // ARRANGE
    servidorComAnteriores()
    const { result, rerender } = renderHook(({ conversa, janela }) => usarHistoricoDaThread(conversa, janela), {
      initialProps: { conversa: 1, janela: [mensagem(10)] },
    })
    await act(() => result.current.carregarAnteriores())

    // ACT
    rerender({ conversa: 2, janela: [mensagem(20)] })

    // ASSERT
    expect(ids(result.current.mensagens)).toEqual([20])
  })
})
