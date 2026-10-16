import { CircleCheck, CircleX, Hourglass, MessageSquareOff, MessageSquareWarning, type LucideIcon } from 'lucide-react'

import type { EstadoDaConfirmacao } from '@/tipos'

/**
 * A pele da resposta ao lembrete, por estado — **uma definição**, consumida pelo ícone do cartão,
 * pelo item da lista do celular e pela faixa do topo (change lembrete-com-botoes-de-resposta).
 *
 * Vive num módulo só de constantes pelo mesmo motivo do `PELE_DO_REALCE`: módulo que exporta
 * componente E constante perde o fast refresh, e classe de Tailwind escondida num `.ts` sai do
 * alcance da fiscalização do design system (que só varre `.tsx`).
 *
 * O ícone nunca é o único sinal (1.4.1): cada estado tem FORMA própria além da cor, e o nome
 * acessível diz o estado em palavras (`descreverConfirmacao`).
 */
interface PeleDaConfirmacao {
  icone: LucideIcon
  /** A cor do ícone — tom de texto do DS, que passa 4,5:1 sobre a superfície do cartão. */
  corDoIcone: string
  /** O ícone num fundo próprio: só o pedido de desmarque, que é o que pede ação da recepção. */
  fundoDoIcone: string
  /** O botão da faixa quando o estado está em destaque (`aria-pressed`). */
  botaoMarcado: string
}

export const PELE_DA_CONFIRMACAO: Record<EstadoDaConfirmacao, PeleDaConfirmacao> = {
  // neutro: saiu e ninguém respondeu ainda — não é problema, é o que a recepção acompanha
  aguardando: {
    icone: Hourglass,
    corDoIcone: 'text-texto-suave',
    fundoDoIcone: '',
    botaoMarcado: 'border-texto-suave bg-neutro-100 text-texto',
  },
  confirmado: {
    icone: CircleCheck,
    corDoIcone: 'text-sucesso-texto',
    fundoDoIcone: '',
    botaoMarcado: 'border-sucesso-texto bg-sucesso-suave text-sucesso-texto',
  },
  // o mais importante do cartão: vermelho de perigo e um fundo próprio, para saltar da grade
  pediu_desmarque: {
    icone: CircleX,
    corDoIcone: 'text-perigo-texto',
    fundoDoIcone: 'rounded-pilula bg-perigo-suave',
    botaoMarcado: 'border-perigo-texto bg-perigo-suave text-perigo-texto',
  },
  // âmbar: a mensagem não chegou — alguém precisa ligar
  nao_entregue: {
    icone: MessageSquareWarning,
    corDoIcone: 'text-alerta-texto',
    fundoDoIcone: '',
    botaoMarcado: 'border-alerta-texto bg-alerta-suave text-alerta-texto',
  },
  // âmbar também — alguém precisa ligar —, mas com FORMA própria: aqui a mensagem nem saiu, e o
  // conserto começa no cadastro (change telefone-que-chega-no-whatsapp)
  nao_enviado: {
    icone: MessageSquareOff,
    corDoIcone: 'text-alerta-texto',
    fundoDoIcone: '',
    botaoMarcado: 'border-alerta-texto bg-alerta-suave text-alerta-texto',
  },
}

/**
 * O DESTAQUE da faixa no cartão, em CSS puro: o contêiner da grade (ou da lista) leva
 * `data-destaque` com o estado escolhido e cada cartão leva `data-confirmacao` com o seu.
 *
 * É CSS, e não prop, por causa do piso da grade cheia (§16): uma prop nova faria os ~330 cartões
 * memoizados redesenharem a cada toque na faixa. Assim o toque muda UM atributo e o navegador
 * repinta.
 *
 * ATENUAR é tirar a cor, não a opacidade: `opacity` derrubaria o texto dos metadados abaixo de
 * 4,5:1 (1.4.3), e o cartão atenuado continua sendo conteúdo que se lê. Os do estado destacado
 * mantêm a cor e ganham um anel no tom do estado — o mesmo tom do botão marcado na faixa.
 *
 * O `\_` nos estados com sublinhado é OBRIGATÓRIO: dentro de colchetes o Tailwind troca `_` por
 * espaço, e a regra saía `[data-confirmacao="nao entregue"]`, que nenhum cartão tem — a grade
 * inteira ficava cinza, sem contorno (achado na change telefone-que-chega-no-whatsapp). E ele vai
 * em `String.raw`, nunca em `'…\\_…'`: o build lê o TEXTO do arquivo, e com duas barras no texto
 * não gera regra nenhuma. A guarda é `pele-da-confirmacao.contrato.test.ts`, que faz o caminho do
 * build (scanner + compilador) sobre este arquivo.
 */
export const DESTAQUE_NO_CARTAO = [
  'group-data-[destaque]/destaque:grayscale',
  'group-data-[destaque=aguardando]/destaque:data-[confirmacao=aguardando]:grayscale-0',
  'group-data-[destaque=aguardando]/destaque:data-[confirmacao=aguardando]:ring-2',
  'group-data-[destaque=aguardando]/destaque:data-[confirmacao=aguardando]:ring-texto-suave',
  'group-data-[destaque=confirmado]/destaque:data-[confirmacao=confirmado]:grayscale-0',
  'group-data-[destaque=confirmado]/destaque:data-[confirmacao=confirmado]:ring-2',
  'group-data-[destaque=confirmado]/destaque:data-[confirmacao=confirmado]:ring-sucesso-texto',
  String.raw`group-data-[destaque=pediu\_desmarque]/destaque:data-[confirmacao=pediu\_desmarque]:grayscale-0`,
  String.raw`group-data-[destaque=pediu\_desmarque]/destaque:data-[confirmacao=pediu\_desmarque]:ring-2`,
  String.raw`group-data-[destaque=pediu\_desmarque]/destaque:data-[confirmacao=pediu\_desmarque]:ring-perigo-texto`,
  String.raw`group-data-[destaque=nao\_entregue]/destaque:data-[confirmacao=nao\_entregue]:grayscale-0`,
  String.raw`group-data-[destaque=nao\_entregue]/destaque:data-[confirmacao=nao\_entregue]:ring-2`,
  String.raw`group-data-[destaque=nao\_entregue]/destaque:data-[confirmacao=nao\_entregue]:ring-alerta-texto`,
  String.raw`group-data-[destaque=nao\_enviado]/destaque:data-[confirmacao=nao\_enviado]:grayscale-0`,
  String.raw`group-data-[destaque=nao\_enviado]/destaque:data-[confirmacao=nao\_enviado]:ring-2`,
  String.raw`group-data-[destaque=nao\_enviado]/destaque:data-[confirmacao=nao\_enviado]:ring-alerta-texto`,
].join(' ')
