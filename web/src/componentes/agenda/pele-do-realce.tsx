import type { RealceDoPacote } from '@/tipos'

/**
 * A pele do realce de pacote, por nível — **uma definição**, consumida pelo card da grade e
 * pelo item da lista do celular (change alerta-de-fim-de-pacote, D3/D3-bis).
 *
 * A COR diz QUAL dos dois fatos é, e essa distinção nasceu de um achado do gate: o card
 * pintava de vermelho tanto "faltam 2 sessões, cobre a família" quanto "sem saldo, não pode
 * atender", enquanto a lista de tratamentos já separava as duas. Uma tela ensinava uma coisa
 * e a outra ensinava o contrário sobre a mesma criança.
 *
 * **Vive num módulo só dela, e isso é deliberado.** Nem no card nem na lista: módulo que
 * exporta componente E constante perde o fast refresh do Vite. E não vai para `lib/` porque
 * são classes do design system — a fiscalização do DS (`design-system.contrato.test.tsx`) só
 * varre `.tsx`, e classe de Tailwind escondida num `.ts` sai do alcance da guarda que reprova
 * valor mágico e classe-fantasma.
 */
export const PELE_DO_REALCE: Record<RealceDoPacote, string> = {
  // âmbar: "ligue e ofereça o próximo pacote" — a MESMA cor que o selo da lista de tratamentos
  acabando: 'border-alerta-texto bg-alerta-suave',
  // vermelho: "não pode ser atendida até renovar" — o que bloqueia, como no resto do sistema
  'sem-saldo': 'border-perigo-texto bg-perigo-suave',
  nenhum: 'border-linha-forte bg-superficie',
}
