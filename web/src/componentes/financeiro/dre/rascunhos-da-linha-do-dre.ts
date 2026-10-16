import { createContext, useCallback, useContext, useMemo, useState } from 'react'

import type { ConfiguracaoDoDre } from '@/tipos'

import { idDoSeletor } from '@/componentes/financeiro/dre/linha-do-dre'

/** Uma escolha feita no seletor da linha do DRE e ainda não aplicada. */
export interface RascunhoDaLinha {
  /** A linha escolhida (`''` = sem escolha). */
  valor: string
  /**
   * A base da escolha — a natureza e o gravado quando ela foi feita (`baseDoRascunho`): se
   * qualquer um mudar por fora, o rascunho é descartado.
   */
  base: string
}

/** Os rascunhos de uma página inteira, pelo `id` do seletor (`idDoSeletor`). */
export interface RascunhosDaLinha {
  rascunhos: ReadonlyMap<string, RascunhoDaLinha>
  guardar: (id: string, rascunho: RascunhoDaLinha) => void
  descartar: (id: string) => void
}

/**
 * Onde a página guarda os rascunhos dos seus seletores (CR-WEB-R2-01). Em Configurar DRE a
 * subcategoria que segue a mãe é desenhada DENTRO do item da mãe: quando a mãe muda de cartão, a
 * filha remonta, e um rascunho que fosse estado do seletor sumiria calado. Sem provedor (o
 * cadastro da categoria, onde nada muda de lugar), cada seletor guarda o seu.
 */
export const ContextoDosRascunhos = createContext<RascunhosDaLinha | null>(null)

/**
 * A base de um rascunho: a NATUREZA e a linha gravada (CR-WEB-R3-02). Só a linha não bastava — a
 * API deixa trocar a natureza da categoria sem uso e zera a linha; se ela já era nula, o gravado não
 * mudava, e o rascunho sobrevivia com uma linha da natureza antiga, que a tela nem oferece mais.
 *
 * @param natureza - A natureza da categoria (a da mãe, para a subcategoria)
 * @param gravada - A linha gravada (`''` = sem escolha)
 */
export function baseDoRascunho(natureza: string, gravada: string): string {
  return `${natureza}|${gravada}`
}

/** A base de cada seletor da configuração, pelo `id` do seletor. */
function basesDaConfiguracao(configuracao: ConfiguracaoDoDre): Map<string, string> {
  const bases = new Map<string, string>()
  for (const categoria of configuracao.categorias) {
    bases.set(idDoSeletor('categoria', categoria.id), baseDoRascunho(categoria.tipo, categoria.linha_dre ?? ''))
    for (const subcategoria of categoria.subcategorias) {
      bases.set(idDoSeletor('subcategoria', subcategoria.id), baseDoRascunho(categoria.tipo, subcategoria.linha_dre ?? ''))
    }
  }

  return bases
}

/**
 * Os rascunhos que ainda valem: os feitos sobre a base de HOJE. Com o gravado mudado por fora (a
 * troca aplicada, o 409 reconsultado, outra pessoa), "Aplicar" sairia com a versão NOVA e gravaria
 * por cima da outra pessoa sem 409 — o rascunho é descartado; com a natureza mudada, a escolha nem
 * é mais oferecida. O item que sumiu da configuração leva o seu junto.
 */
function semOsVencidos(
  rascunhos: ReadonlyMap<string, RascunhoDaLinha>,
  configuracao: ConfiguracaoDoDre,
): ReadonlyMap<string, RascunhoDaLinha> {
  const bases = basesDaConfiguracao(configuracao)
  const vivos = [...rascunhos].filter(([id, rascunho]) => bases.get(id) === rascunho.base)

  return vivos.length === rascunhos.size ? rascunhos : new Map(vivos)
}

/**
 * O estado dos rascunhos da página — o valor do `ContextoDosRascunhos`. A cada configuração nova os
 * vencidos são DESCARTADOS durante o render (o padrão do React para estado derivado de prop): o
 * descartado não volta, nem se o gravado voltar ao de antes.
 *
 * @param configuracao - A configuração que a página desenha (`undefined` enquanto carrega)
 */
function useRascunhosDaLinha(configuracao: ConfiguracaoDoDre | undefined): RascunhosDaLinha {
  const [rascunhos, setRascunhos] = useState<ReadonlyMap<string, RascunhoDaLinha>>(() => new Map())
  const [configuracaoVista, setConfiguracaoVista] = useState(configuracao)
  if (configuracaoVista !== configuracao) {
    setConfiguracaoVista(configuracao)
    if (configuracao !== undefined) {
      setRascunhos(semOsVencidos(rascunhos, configuracao))
    }
  }

  const guardar = useCallback((id: string, rascunho: RascunhoDaLinha) => {
    setRascunhos((atuais) => new Map(atuais).set(id, rascunho))
  }, [])

  const descartar = useCallback((id: string) => {
    setRascunhos((atuais) => {
      if (!atuais.has(id)) return atuais
      const restantes = new Map(atuais)
      restantes.delete(id)

      return restantes
    })
  }, [])

  return useMemo(() => ({ rascunhos, guardar, descartar }), [rascunhos, guardar, descartar])
}

/**
 * O rascunho de UM seletor e como trocá-lo: o da página quando há provedor (que já descartou os
 * vencidos), o do próprio seletor quando não há.
 *
 * @param id - O `id` do seletor (`idDoSeletor`)
 * @param gravada - A linha gravada hoje (`''` = sem escolha)
 * @param natureza - A natureza da categoria (a da mãe, para a subcategoria)
 * @returns O rascunho em vigor e a troca dele (trocar para o gravado é descartar)
 */
function useRascunhoDaLinha(id: string, gravada: string, natureza: string): [string, (valor: string) => void] {
  const daPagina = useContext(ContextoDosRascunhos)
  const base = baseDoRascunho(natureza, gravada)

  // sem provedor: estado do seletor. A base mudou por fora (a troca aplicada, o 409 reconsultado,
  // a natureza trocada): o rascunho volta ao gravado — ajuste DURANTE o render, o padrão do React
  // para estado derivado de prop
  const [local, setLocal] = useState(gravada)
  const [baseVista, setBaseVista] = useState(base)
  if (baseVista !== base) {
    setBaseVista(base)
    setLocal(gravada)
  }

  if (daPagina === null) {
    return [local, setLocal]
  }

  return [
    daPagina.rascunhos.get(id)?.valor ?? gravada,
    (valor) => (valor === gravada ? daPagina.descartar(id) : daPagina.guardar(id, { valor, base })),
  ]
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração
export { useRascunhoDaLinha as usarRascunhoDaLinha, useRascunhosDaLinha as usarRascunhosDaLinha }
