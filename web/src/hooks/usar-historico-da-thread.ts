import { useLayoutEffect, useRef, useState } from 'react'

import { abrirConversa } from '@/servicos/mensageria'
import type { Mensagem } from '@/tipos'

/** Junta listas de mensagens numa só, sem repetir id e em ordem de chegada (o id é crescente). */
function juntar(...listas: Mensagem[][]): Mensagem[] {
  const porId = new Map<number, Mensagem>()
  // a lista que vem DEPOIS vence: a janela recente traz o status mais novo da mesma mensagem
  listas.flat().forEach((mensagem) => porId.set(mensagem.id, mensagem))
  return [...porId.values()].sort((a, b) => a.id - b.id)
}

/**
 * A janela nova SALTOU a velha — nenhuma mensagem em comum, com um intervalo entre as duas que
 * nenhuma delas cobre (chegaram mais mensagens que o tamanho da janela entre duas leituras).
 */
function saltou(anterior: Mensagem[] | undefined, nova: Mensagem[] | undefined): boolean {
  const ultimaDaAnterior = anterior?.at(-1)?.id
  const primeiraDaNova = nova?.[0]?.id
  return ultimaDaAnterior !== undefined && primeiraDaNova !== undefined && ultimaDaAnterior < primeiraDaNova
}

/** As mensagens da janela anterior que saíram pelo TOPO da janela nova. */
function saidasPeloTopo(anterior: Mensagem[] | undefined, nova: Mensagem[] | undefined): Mensagem[] {
  const primeiraDaNova = nova?.[0]?.id
  if (anterior === undefined || primeiraDaNova === undefined) {
    return []
  }
  return anterior.filter((mensagem) => mensagem.id < primeiraDaNova)
}

interface JanelaVista {
  conversaId: number | null
  janela: Mensagem[] | undefined
}

/**
 * O histórico da thread: o que foi carregado para trás + a janela recente (change
 * mensageria-whatsapp; conversa-legivel).
 *
 * Dois defeitos que moravam na página, e que este gancho fecha:
 *
 * - **A resposta de outra família.** "Carregar mensagens anteriores" gravava a resposta depois
 *   do `await` sem conferir a conversa: trocar de conversa durante a requisição punha mensagens
 *   da família A na thread da família B. A GERAÇÃO muda a cada troca, e a resposta de uma geração
 *   velha é descartada.
 * - **O buraco.** A janela é das N mais RECENTES: com mensagem nova, a mais antiga dela sai pelo
 *   topo. Sem histórico carregado, tudo bem (ela volta com "Carregar anteriores"); com histórico,
 *   ela sumia entre as anteriores e a janela nova. A que sai pelo topo passa para o histórico.
 *   Se a janela nova SALTOU a velha (sem nada em comum), o que ficou entre as duas nunca foi lido:
 *   guardar o histórico deixaria um buraco que ninguém vê. Ele é descartado, e a pessoa volta a
 *   "Carregar anteriores" a partir da janela nova (CRL2-03).
 *
 * Trocar de conversa zera o histórico no MESMO render (estado ajustado durante o render, e não
 * num efeito): nem um quadro com as anteriores de uma família na conversa de outra.
 */
function useHistoricoDaThread(conversaId: number | null, janela: Mensagem[] | undefined) {
  const [anteriores, setAnteriores] = useState<Mensagem[]>([])
  const [vista, setVista] = useState<JanelaVista>({ conversaId, janela })
  const geracao = useRef(0)

  if (vista.conversaId !== conversaId) {
    setVista({ conversaId, janela })
    setAnteriores([])
  } else if (vista.janela !== janela) {
    setVista({ conversaId, janela })
    const saidas = saidasPeloTopo(vista.janela, janela)
    if (anteriores.length > 0 && saltou(vista.janela, janela)) {
      setAnteriores([])
    } else if (anteriores.length > 0 && saidas.length > 0) {
      setAnteriores(juntar(anteriores, saidas))
    }
  }

  // `useLayoutEffect`: roda na mesma volta do commit — nenhuma resposta pendente chega antes dele
  useLayoutEffect(() => {
    geracao.current += 1
  }, [conversaId])

  const mensagens = juntar(anteriores, janela ?? [])
  const naTela = useRef(mensagens)
  useLayoutEffect(() => {
    naTela.current = mensagens
  })

  const carregarAnteriores = async () => {
    const maisAntiga = mensagens[0]?.id
    if (conversaId === null || maisAntiga === undefined) return
    const pedido = geracao.current
    const resposta = await abrirConversa(conversaId, maisAntiga)
    // trocou de conversa enquanto a resposta vinha: ela é de OUTRA família — descarta
    if (geracao.current !== pedido) return
    // o bloco que chegou termina LOGO ANTES da mensagem em que o pedido se ancorou. Se ela já não
    // está na tela — a janela SALTOU, ou andou e a levou embora —, juntar abriria um buraco entre
    // o bloco e o resto (CRL3-02). Descarta; a pessoa pede de novo a partir do que vê
    if (!naTela.current.some((mensagem) => mensagem.id === maisAntiga)) return
    setAnteriores((atual) => juntar(resposta.mensagens, atual))
  }

  return { mensagens, carregarAnteriores, temHistorico: anteriores.length > 0 }
}

export { useHistoricoDaThread as usarHistoricoDaThread }
