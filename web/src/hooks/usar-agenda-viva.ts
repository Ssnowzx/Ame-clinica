import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { TEMPO_SINO_MS } from '@/lib/query-client'

/**
 * O RITMO da grade aberta: o mesmo minuto do sino (change lembrete-com-botoes-de-resposta, D11).
 * Constante da FERRAMENTA, não regra clínica da §13 — é o atraso que a clínica aceitou em troca de
 * não ter servidor de socket na VPS.
 */
const INTERVALO_DA_AGENDA_VIVA_MS = TEMPO_SINO_MS

function abaEstaVisivel(): boolean {
  return document.visibilityState === 'visible'
}

/** A aba do navegador está à vista? Vinte abas esquecidas no balcão não podem buscar a noite inteira. */
function useAbaVisivel(): boolean {
  const [visivel, setVisivel] = useState(abaEstaVisivel)

  useEffect(() => {
    const aoTrocar = (): void => {
      setVisivel(abaEstaVisivel())
    }
    document.addEventListener('visibilitychange', aoTrocar)
    return () => {
      document.removeEventListener('visibilitychange', aoTrocar)
    }
  }, [])

  return visivel
}

/**
 * A AGENDA QUE SE ATUALIZA SOZINHA (D11) — o pedido da Mariana: a profissional precisa ver o toque
 * da família "na hora", sem a recepção ir avisar.
 *
 * - busca a cada minuto com a aba visível, e nunca com ela escondida;
 * - busca ao voltar à aba (o `refetchOnWindowFocus` global é `false`, então é local à agenda);
 * - PAUSA com `pausada` (um cartão sendo arrastado, um formulário de edição aberto): a busca
 *   espera. Ao sair da pausa, se o minuto venceu no meio, a busca que esperou acontece;
 * - só o DADO muda: dia, profissional, rolagem, destaque e cartão aberto vivem fora da consulta.
 *
 * Devolve as opções de intervalo para a `useQuery` do período — pausar é desligar o INTERVALO, não
 * a consulta (uma consulta desabilitada perderia o dado e voltaria ao esqueleto).
 */
function useAgendaViva(chave: QueryKey, pausada: boolean) {
  const queryClient = useQueryClient()
  const visivel = useAbaVisivel()
  const podeBuscar = visivel && !pausada

  // a chave muda de identidade a cada render (é montada na página); o efeito só quer a atual
  const chaveAtual = useRef(chave)
  chaveAtual.current = chave
  const anterior = useRef({ visivel, pausada })

  useEffect(() => {
    const antes = anterior.current
    anterior.current = { visivel, pausada }
    if (!podeBuscar) {
      return
    }
    const voltouParaAAba = !antes.visivel
    const saiuDaPausa = antes.pausada
    if (!voltouParaAAba && !saiuDaPausa) {
      return
    }
    const estado = queryClient.getQueryState(chaveAtual.current)
    // sem dado ainda, quem busca é a própria consulta — buscar aqui seria a segunda requisição
    if (estado === undefined || estado.dataUpdatedAt === 0) {
      return
    }
    const minutoVenceu = Date.now() - estado.dataUpdatedAt >= INTERVALO_DA_AGENDA_VIVA_MS
    if (voltouParaAAba || minutoVenceu) {
      void queryClient.refetchQueries({ queryKey: chaveAtual.current, exact: true, type: 'active' })
    }
  }, [visivel, pausada, podeBuscar, queryClient])

  return {
    refetchInterval: podeBuscar ? INTERVALO_DA_AGENDA_VIVA_MS : false,
    refetchIntervalInBackground: false,
  } as const
}

/**
 * A frase de quando a busca de FUNDO falhou e a grade continua com o que já tinha (achado CRB-01 do
 * gate): o dado na tela é verdadeiro, mas é de antes — a pessoa precisa saber DE QUANDO.
 *
 * A hora é a do relógio do NAVEGADOR, de propósito: `dataUpdatedAt` é um instante da própria
 * máquina, e quem abre a agenda está na clínica, no mesmo fuso dela.
 */
export function mensagemDaFalhaDeAtualizacao(carregadoEm: number): string {
  const hora = new Date(carregadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return `Não foi possível atualizar agora — mostrando o que foi carregado às ${hora}.`
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração (mesmo padrão do `usarToast`)
export { useAgendaViva as usarAgendaViva }
