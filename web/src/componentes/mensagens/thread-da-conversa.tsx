import {
  AlertCircle,
  Bot,
  Contact,
  ExternalLink,
  EyeOff,
  FileX,
  ListChecks,
  MapPin,
  MousePointerClick,
  Paperclip,
  PencilLine,
  PhoneForwarded,
  RotateCcw,
  SmilePlus,
  Sticker,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef } from 'react'

import { Botao } from '@/componentes/ui/botao'
import { cn } from '@/lib/cn'
import { urlDaMidia } from '@/servicos/mensageria'
import type { Mensagem } from '@/tipos'

/*
 * As tabelas desta tela indexadas por dado do SERVIDOR (status, tipo, subtipo cru) são `Map`, e
 * não objeto literal: `objeto['constructor']`, `['__proto__']` ou `['toString']` acham o que
 * vem HERDADO do `Object.prototype` — uma função onde se esperava um rótulo —, e a thread caía
 * inteira com um subtipo novo que a Meta inventasse com esse nome (SEC-CL2-02).
 */
const ROTULO_DO_STATUS = new Map<string, string>([
  ['pendente', 'Enviando…'],
  ['enviada', 'Enviada'],
  ['entregue', 'Entregue'],
  ['lida', 'Lida'],
  ['falhou', 'Falhou'],
])

/** O que a bolha diz de uma mensagem que não é texto digitado. */
interface Leitura {
  /** A frase que conta o que aconteceu ("Reagiu com 👍"); nula quando o corpo fala por si. */
  rotulo: string | null
  icone: LucideIcon | null
  /** O que a família escreveu ou mandou, mostrado como veio. */
  corpo: string | null
  /** O que fazer quando o WhatsApp não entrega o conteúdo — em tom suave, abaixo do rótulo. */
  explicacao: string | null
}

/**
 * O que o WhatsApp não entrega ao sistema, pelo subtipo cru (`tipo_original`, change
 * conversa-legivel). O subtipo desconhecido — e a mensagem de antes de o sistema guardá-lo —
 * cai no texto genérico.
 */
const NAO_ENTREGUE = new Map<string, Omit<Leitura, 'corpo'>>([
  [
    'unsupported:edit',
    {
      rotulo: 'A família editou uma mensagem.',
      icone: PencilLine,
      explicacao: 'O WhatsApp não mostra a edição ao sistema; a versão anterior continua acima.',
    },
  ],
  [
    'unsupported:poll_creation',
    {
      rotulo: 'A família enviou uma enquete.',
      icone: ListChecks,
      explicacao: 'O WhatsApp não mostra enquetes ao sistema. Se for importante, peça a resposta em texto.',
    },
  ],
  // o aviso de sistema da Meta quando a família troca de número. O corpo NÃO é gravado (traz os
  // dois números): a tela só diz o que fazer
  [
    'system:user_changed_number',
    {
      rotulo: 'A família trocou de número no WhatsApp.',
      icone: PhoneForwarded,
      explicacao: 'Confira o telefone no cadastro: os lembretes continuam indo para o número antigo.',
    },
  ],
])

const NAO_ENTREGUE_GENERICO: Omit<Leitura, 'corpo'> = {
  rotulo: 'O WhatsApp não mostra esta mensagem ao sistema.',
  icone: EyeOff,
  explicacao:
    'Pode ser enquete, foto de visualização única ou mensagem temporária. Se for importante, peça à família para mandar em texto, foto ou áudio.',
}

function preenchido(texto: string | null): texto is string {
  return texto !== null && texto !== ''
}

/**
 * O não suportado tem DUAS origens, e elas pedem frases diferentes:
 * - a família mandou um arquivo que o SISTEMA recusou (vem com `erro_motivo`): o que houve e
 *   o porquê, mais a legenda, se houver — nada de "enquete";
 * - o WhatsApp não entregou o conteúdo: a frase sai do subtipo cru (edição, enquete, genérico).
 */
function lerNaoSuportado(mensagem: Mensagem): Leitura {
  if (mensagem.erro_motivo !== null) {
    return {
      rotulo: 'A família mandou um arquivo que o sistema não aceita.',
      icone: FileX,
      corpo: mensagem.corpo,
      explicacao: mensagem.erro_motivo,
    }
  }
  const naoEntregue = NAO_ENTREGUE.get(mensagem.tipo_original ?? '') ?? NAO_ENTREGUE_GENERICO
  return { ...naoEntregue, corpo: null }
}

/**
 * O que cada tipo vira em palavras (change conversa-legivel, D1).
 *
 * O RÓTULO é da tela, nunca gravado: o servidor guarda o que a família mandou (o emoji, o
 * endereço, o contato) e a frase que explica nasce aqui.
 *
 * O `default` é a rede do "tipo que a tela ainda não conhece": servidor novo com tela velha
 * mostra o corpo, se houver, e senão a explicação do não suportado — bolha vazia NUNCA.
 */
function lerMensagem(mensagem: Mensagem): Leitura {
  const { corpo } = mensagem
  const semRotulo = { rotulo: null, icone: null, corpo, explicacao: null }

  switch (mensagem.tipo) {
    case 'texto':
    case 'imagem':
    case 'audio':
    case 'documento':
    case 'video':
    case 'template':
      return semRotulo
    // o toque num botão do lembrete (lembrete-com-botoes-de-resposta): o corpo é o TEXTO do
    // botão, e sozinho ("✅ Confirmo") pareceria que a família digitou
    case 'botao':
      return {
        rotulo: preenchido(corpo) ? `Tocou em: ${corpo}` : 'Tocou num botão da mensagem.',
        icone: MousePointerClick,
        corpo: null,
        explicacao: null,
      }
    case 'reacao':
      return {
        rotulo: preenchido(corpo) ? `Reagiu com ${corpo}` : 'Tirou a reação',
        icone: SmilePlus,
        corpo: null,
        explicacao: null,
      }
    case 'figurinha':
      return { rotulo: 'Enviou uma figurinha', icone: Sticker, corpo, explicacao: null }
    case 'localizacao':
      return { rotulo: 'Enviou uma localização', icone: MapPin, corpo, explicacao: null }
    case 'contato':
      return { rotulo: 'Enviou um contato', icone: Contact, corpo, explicacao: null }
    case 'nao_suportado':
      return lerNaoSuportado(mensagem)
    default:
      // o tipo desconhecido: o que veio legível é mostrado como veio
      return preenchido(corpo) || mensagem.midia !== null ? semRotulo : lerNaoSuportado(mensagem)
  }
}

/**
 * O link do mapa só sai para o endereço que o servidor MONTA — o do Google Maps. Qualquer outro
 * (outro domínio, `http:`, `javascript:`) não vira link: defesa a mais sobre o servidor (SEC-CL-03).
 */
const PREFIXO_DO_MAPA = 'https://www.google.com/maps/'

function linkDoMapa(mensagem: Mensagem): string | null {
  const url = mensagem.mapa_url ?? null
  return mensagem.tipo === 'localizacao' && url !== null && url.startsWith(PREFIXO_DO_MAPA) ? url : null
}

/** O que o anexo é, dito ao leitor de tela — "Abrir anexo" três vezes seguidas não diz nada. */
const NATUREZA_DO_ANEXO = new Map<string, string>([
  ['imagem', 'foto'],
  ['audio', 'áudio'],
  ['video', 'vídeo'],
  ['documento', 'documento'],
])

function classeDoLink(daClinica: boolean): string {
  return cn(
    'inline-flex items-center gap-1 underline underline-offset-2',
    'focus-visible:outline-2 focus-visible:outline-offset-2',
    // o anel padrão usa o token `--foco`, que é o MESMO tom do `--acento` da bolha enviada:
    // 1,00:1, anel invisível. Sobre acento, o anel tem de ser claro — e com `!`, porque a
    // regra global `:focus-visible` do `index.css` mora FORA de camada e vence qualquer
    // utilitário sem ele (A11Y-CL-02)
    daClinica ? 'focus-visible:outline-sobre-acento!' : 'focus-visible:outline-foco',
  )
}

/**
 * O miolo da bolha: o rótulo do que aconteceu, a explicação, o anexo, o que a família mandou
 * e, na localização, o link do mapa.
 *
 * Os links ("Abrir figurinha", "Abrir no mapa") são DESCRITOS pelo rótulo da bolha: na lista
 * de links do leitor de tela, fora da bolha, eles diriam só "Abrir" (A11Y-CL-10).
 */
function ConteudoDaMensagem({ mensagem, daClinica }: { mensagem: Mensagem; daClinica: boolean }) {
  const leitura = lerMensagem(mensagem)
  const tomSuave = daClinica ? 'text-sobre-acento/80' : 'text-texto-suave'
  const mapa = linkDoMapa(mensagem)
  const Icone = leitura.icone
  const idDoRotulo = useId()
  const descricaoDoLink = leitura.rotulo !== null ? idDoRotulo : undefined
  const natureza = NATUREZA_DO_ANEXO.get(mensagem.tipo)

  return (
    // `space-y-1`: o mesmo respiro de 4 px entre rótulo, anexo, corpo e link, qualquer que seja
    // a combinação que o tipo trouxer
    <div className="space-y-1">
      {leitura.rotulo !== null && (
        <p className="flex items-start gap-1.5 font-medium">
          {Icone !== null && <Icone className={cn('mt-0.5 size-4 shrink-0', tomSuave)} aria-hidden />}
          <span id={idDoRotulo} className="min-w-0 whitespace-pre-wrap break-words">
            {leitura.rotulo}
          </span>
        </p>
      )}
      {leitura.explicacao !== null && <p className={cn('whitespace-pre-wrap break-words', tomSuave)}>{leitura.explicacao}</p>}
      {mensagem.midia !== null && (
        <p>
          {mensagem.midia.disponivel ? (
            <a
              href={urlDaMidia(mensagem.midia.id)}
              target="_blank"
              rel="noreferrer"
              aria-describedby={descricaoDoLink}
              className={classeDoLink(daClinica)}
            >
              <Paperclip className="size-3.5" aria-hidden />
              {mensagem.tipo === 'figurinha' ? 'Abrir figurinha' : 'Abrir anexo'}
              {/* entre parênteses, com o espaço FORA do `sr-only`: o nome sai "Abrir anexo (foto)".
                  Com dois-pontos, o Chrome separava o trecho escondido (bloco, por ser absoluto)
                  por um espaço — "Abrir anexo : foto" (A11Y-CL2-05) */}
              {natureza !== undefined && (
                <>
                  {' '}
                  <span className="sr-only">({natureza})</span>
                </>
              )}
            </a>
          ) : (
            <span className={cn('inline-flex items-center gap-1', tomSuave)}>
              <Paperclip className="size-3.5" aria-hidden /> Anexo indisponível
            </span>
          )}
        </p>
      )}
      {preenchido(leitura.corpo) && <p className="whitespace-pre-wrap break-words">{leitura.corpo}</p>}
      {mapa !== null && (
        <p>
          {/* `noreferrer`: o endereço da thread (com o id da conversa) não vai para o mapa */}
          <a
            href={mapa}
            target="_blank"
            rel="noreferrer"
            aria-describedby={descricaoDoLink}
            className={classeDoLink(daClinica)}
          >
            <ExternalLink className="size-3.5" aria-hidden /> Abrir no mapa
          </a>
        </p>
      )}
    </div>
  )
}

/** Quantos px antes do fim ainda contam como "no fim" (quem está ali acompanha a conversa). */
const FOLGA_DO_FIM = 80

/** Onde a pessoa estava na thread — medido a cada rolagem e a cada reposicionamento. */
interface PosicaoNaThread {
  noFim: boolean
  /** A primeira mensagem à vista e a distância dela ao topo da caixa. */
  ancora: { id: number; deslocamento: number } | null
}

/**
 * Mede a posição. A âncora é a primeira mensagem que aparece, ainda que pela metade.
 *
 * `offsetTop` é relativo à PRÓPRIA caixa porque ela é `relative` (o `offsetParent` das bolhas):
 * sem isso, a conta misturaria a posição da página com a rolagem da thread.
 */
function medirPosicao(caixa: HTMLElement): PosicaoNaThread {
  const visivel = [...caixa.querySelectorAll<HTMLElement>('[data-mensagem]')].find(
    (bolha) => bolha.offsetTop + bolha.offsetHeight > caixa.scrollTop,
  )

  return {
    noFim: caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < FOLGA_DO_FIM,
    ancora:
      visivel === undefined
        ? null
        : { id: Number(visivel.dataset.mensagem), deslocamento: visivel.offsetTop - caixa.scrollTop },
  }
}

/** Só escreve quando muda: escrever o mesmo `scrollTop` interrompe a rolagem por inércia do iOS. */
function rolarPara(caixa: HTMLElement, alvo: number) {
  if (Math.abs(caixa.scrollTop - alvo) >= 1) {
    caixa.scrollTop = alvo
  }
}

/**
 * A rolagem da thread (change conversa-legivel).
 *
 * - ABRIR uma conversa leva à mensagem mais NOVA: era o topo da janela, e no celular a
 *   recepção via as mais antigas e tinha de rolar até a resposta da família.
 * - Depois disso, só acompanha quem JÁ ESTAVA NO FIM. Rolar sempre rouba a leitura de quem subiu
 *   para reler o histórico — e a spec proíbe em letras. "Estava no fim" é medido ANTES de a
 *   mensagem nova entrar (na rolagem): medir depois confundia "estava no fim" com "a mensagem
 *   nova é alta".
 * - Quem subiu fica na MESMA mensagem, entre o que for que entre em cima: "Carregar mensagens
 *   anteriores" e o poll de 8 s (a janela é das N mais recentes — com mensagem nova, a mais
 *   antiga dela sai do topo). A âncora devolve a mensagem que estava à vista ao mesmo lugar.
 *
 * `scrollTop` da PRÓPRIA caixa, nunca `scrollIntoView`, que sobe pela árvore e rola a página
 * junto. `useLayoutEffect`: reposicionar antes da pintura, sem o quadro do salto.
 */
function useRolagemDaThread(conversaId: number, mensagens: Mensagem[]) {
  const rolagem = useRef<HTMLDivElement>(null)
  const posicao = useRef<PosicaoNaThread>({ noFim: true, ancora: null })
  // a conversa já aberta no fim — outra conversa volta a abrir no fim
  const conversaAberta = useRef<number | null>(null)
  const primeiraId = mensagens[0]?.id ?? null
  const ultimaId = mensagens.at(-1)?.id ?? null

  useLayoutEffect(() => {
    const caixa = rolagem.current
    if (caixa === null || ultimaId === null) return

    const alvo =
      conversaAberta.current === conversaId && !posicao.current.noFim
        ? posicaoDaAncora(caixa, posicao.current)
        : caixa.scrollHeight
    conversaAberta.current = conversaId
    if (alvo !== null) {
      rolarPara(caixa, alvo)
    }
    posicao.current = medirPosicao(caixa)
  }, [conversaId, primeiraId, ultimaId, mensagens.length])

  // A caixa muda de tamanho SEM a pessoa rolar: os contadores do topo chegam depois e o cabeçalho
  // do shell cresce (a moldura medida encolhe a conversa), o teclado do celular abre, a fonte
  // termina de carregar e a última bolha cresce. Quem estava no fim continua no fim — medido em
  // produção: a conversa abria na última mensagem e, 16px de cabeçalho depois, não estava mais.
  useEffect(() => {
    const caixa = rolagem.current
    if (caixa === null || typeof ResizeObserver === 'undefined') return

    const observador = new ResizeObserver(() => {
      if (posicao.current.noFim) {
        rolarPara(caixa, caixa.scrollHeight)
        posicao.current = medirPosicao(caixa)
      }
    })
    observador.observe(caixa)
    const ultimaBolha = caixa.lastElementChild
    if (ultimaBolha !== null) {
      observador.observe(ultimaBolha)
    }

    return () => {
      observador.disconnect()
    }
  }, [ultimaId])

  const aoRolar = () => {
    if (rolagem.current !== null) {
      posicao.current = medirPosicao(rolagem.current)
    }
  }

  return { rolagem, aoRolar }
}

/** O `scrollTop` que devolve a mensagem-âncora ao lugar em que estava; `null` se ela saiu. */
function posicaoDaAncora(caixa: HTMLElement, { ancora }: PosicaoNaThread): number | null {
  const bolha = ancora === null ? null : caixa.querySelector<HTMLElement>(`[data-mensagem="${ancora.id}"]`)
  return ancora === null || bolha === null ? null : bolha.offsetTop - ancora.deslocamento
}

/**
 * A thread (change mensageria-whatsapp).
 *
 * Uma mensagem que FALHOU nunca some daqui: fica visível, com o motivo e o botão de tentar
 * de novo. Silêncio é o pior resultado possível para quem acha que avisou a família.
 */
export function ThreadDaConversa({
  conversaId,
  mensagens,
  podeReenviar,
  onReenviar,
}: {
  /** A conversa aberta — trocar de conversa (ou abrir a primeira) leva à mensagem mais nova. */
  conversaId: number
  mensagens: Mensagem[]
  /** `false` com o canal desconectado — botão que erra ao clicar é o que a spec proíbe. */
  podeReenviar: boolean
  onReenviar: (id: number) => void
}) {
  const { rolagem, aoRolar } = useRolagemDaThread(conversaId, mensagens)

  return (
    <div
      ref={rolagem}
      onScroll={aoRolar}
      // região rolável precisa ser alcançável por teclado (WCAG 2.1.1) — sem `tabIndex`,
      // quem não usa mouse não rola o histórico
      tabIndex={0}
      role="log"
      aria-label="Mensagens da conversa"
      // `!` no recuo do anel: sem ele, a regra global `:focus-visible` (fora de camada) põe o anel
      // PARA FORA, onde o `overflow-hidden` do painel o corta (A11Y-CL-07)
      className="relative min-h-0 flex-1 space-y-3 overflow-y-auto p-4 focus-visible:outline-2 focus-visible:-outline-offset-2! focus-visible:outline-foco"
    >
      {mensagens.map((mensagem) => {
        const daClinica = mensagem.direcao === 'enviada'

        return (
          <div
            key={mensagem.id}
            data-mensagem={mensagem.id}
            className={cn('flex', daClinica ? 'justify-end' : 'justify-start')}
          >
            {/* quem não vê o alinhamento e a cor não saberia quem falou (WCAG 1.3.1/1.4.1) */}
            <span className="sr-only">
              {daClinica
                ? `Enviada pela clínica${mensagem.automatica ? ' automaticamente' : ''}:`
                : 'Recebida da família:'}
            </span>
            <div
              className={cn(
                'max-w-[75%] rounded-superficie px-3 py-2 text-corpo shadow-e1',
                daClinica ? 'bg-acento text-sobre-acento' : 'bg-superficie text-texto ring-1 ring-linha',
              )}
            >
              {mensagem.automatica && (
                <p className={cn('mb-1 flex items-center gap-1 text-meta', daClinica ? 'text-sobre-acento/80' : 'text-texto-suave')}>
                  <Bot className="size-3" aria-hidden /> Mensagem automática
                </p>
              )}

              {mensagem.expurgada ? (
                // `opacity-70` sobre `bg-acento` dava 4,09:1 (piso 4,5). O papel com
                // opacidade declarada dá 4,82:1 e é o mesmo dos metadados da bolha.
                <p className={cn('italic', daClinica ? 'text-sobre-acento/80' : 'text-texto-suave')}>
                  Conteúdo removido pelo prazo de retenção.
                </p>
              ) : (
                <ConteudoDaMensagem mensagem={mensagem} daClinica={daClinica} />
              )}

              <p className={cn('mt-1 text-meta', daClinica ? 'text-sobre-acento/80' : 'text-texto-suave')}>
                {mensagem.em !== null &&
                  new Date(mensagem.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                {daClinica && ROTULO_DO_STATUS.has(mensagem.status) && ` · ${ROTULO_DO_STATUS.get(mensagem.status) ?? ''}`}
              </p>

              {mensagem.status === 'falhou' && (
                <div className="mt-2 rounded-campo bg-superficie p-2 text-meta text-perigo-texto ring-1 ring-perigo-suave">
                  <p className="flex items-start gap-1">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>{mensagem.erro_motivo ?? 'Não foi possível entregar.'}</span>
                  </p>
                  {podeReenviar && (
                    <Botao
                      variante="fantasma"
                      tamanho="sm"
                      className="mt-1"
                      onClick={() => onReenviar(mensagem.id)}
                    >
                      <RotateCcw className="size-3" aria-hidden /> Tentar novamente
                    </Botao>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
