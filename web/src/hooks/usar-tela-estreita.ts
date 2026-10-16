import { useSyncExternalStore } from 'react'

import { TELA_ABAIXO_DE_LG, TELA_EMPILHADA, TELA_ESTREITA } from '@/lib/breakpoints'

/**
 * A tela é estreita? (change agenda-no-celular, D1)
 *
 * Existe porque duas decisões desta change **não cabem em CSS**: a navegação troca de MECANISMO
 * (coluna → gaveta com foco preso), e a agenda troca de ÁRVORE (tabela → lista). `md:hidden` em
 * cima de duas árvores deixaria as duas no DOM, e o leitor de tela leria as duas.
 *
 * `useSyncExternalStore` em vez de `useState` + `useEffect`: o valor é lido no PRIMEIRO render,
 * não depois de um efeito. Com efeito, a barra nasceria como coluna e viraria gaveta um quadro
 * depois — o "pulo" que denuncia layout decidido em JS.
 *
 * `matchMedia` não existe no jsdom. O stub vive em `src/test/setup.ts`, e os testes que exercitam
 * tela estreita o controlam por lá — nunca redimensionando `window.innerWidth`, que o
 * `matchMedia` real ignora.
 */
function useTelaEstreita(): boolean {
  return useConsulta(TELA_ESTREITA)
}

/**
 * A página está EMPILHADA (abaixo do `xl`)? Diferente de `usarTelaEstreita`: ali a agenda troca
 * de árvore; aqui ela é a mesma grade numa coluna só, e o que muda é quanto do espaço vertical
 * o cromo pode tomar dela. Ver `LARGURA_DE_COLUNAS`.
 */
function useTelaEmpilhada(): boolean {
  return useConsulta(TELA_EMPILHADA)
}

/**
 * A tela está abaixo do `lg` (1024)? É onde o toast mora no topo e mostra UM por vez, em fila
 * (change conversa-legivel).
 */
function useTelaAbaixoDeLg(): boolean {
  return useConsulta(TELA_ABAIXO_DE_LG)
}

function useConsulta(consulta: string): boolean {
  return useSyncExternalStore(
    (aoMudar) => inscrever(consulta, aoMudar),
    () => window.matchMedia(consulta).matches,
    obterValorNoServidor,
  )
}

function inscrever(consulta: string, aoMudar: () => void): () => void {
  const media = window.matchMedia(consulta)
  media.addEventListener('change', aoMudar)

  return () => {
    media.removeEventListener('change', aoMudar)
  }
}

/**
 * Sem janela (SSR, ou qualquer render fora do navegador) o padrão é tela LARGA.
 *
 * É a escolha conservadora: assumir estreita renderizaria a gaveta para todo mundo até o
 * primeiro `matchMedia` responder, e um desktop que pisca como celular é pior que um celular que
 * pisca como desktop — este produto é usado majoritariamente em tela larga.
 */
function obterValorNoServidor(): boolean {
  return false
}

/*
 * Declarado com `use` e exportado em português: é a convenção de `usarPreferenciaDeLayout`
 * nesta base. A regra `react/rules-of-hooks` decide pelo NOME da função, e um hook chamado
 * `usar…` na declaração faz o lint perder a capacidade de checar as regras dos hooks dentro
 * dele — que é justamente o que ela existe para fazer.
 */
export {
  useTelaAbaixoDeLg as usarTelaAbaixoDeLg,
  useTelaEmpilhada as usarTelaEmpilhada,
  useTelaEstreita as usarTelaEstreita,
}
