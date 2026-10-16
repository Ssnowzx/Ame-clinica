import { useEffect, useRef, type FocusEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { ABAS, abaVisivel, type AbaDeIndicadores } from '@/componentes/indicadores/abas-dos-indicadores'
import { RoladorHorizontal } from '@/componentes/ui/rolador-horizontal'
import { cn } from '@/lib/cn'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Navegação da área — **não** `role="tablist"`.
 *
 * Cada aba é uma URL própria: o histórico registra, o botão Voltar funciona, e o link é
 * compartilhável. `tablist`/`tabpanel` prometeria painel trocado na MESMA página, com
 * setas do teclado gerenciando o foco — mentira para quem usa leitor de tela. Então é
 * `<nav>` + links + `aria-current="page"`.
 *
 * **Também não é o `Segmento`.** Aquele é seleção de ESTADO (`aria-pressed`, botões) e a
 * casa fechou o gatilho `DS-SEGMENTO-UMA-PELE` para ter uma pele só. Duas coisas de
 * aparência igual e comportamento diferente — uma navega, outra alterna estado — é
 * justamente o risco; por isso esta barra tem desenho PRÓPRIO: sublinhado da aba corrente,
 * sem o pílula sólido do `Segmento`.
 *
 * O `mes` corrente viaja em toda aba: é o que faz "período compartilhado" ser propriedade
 * do ENDEREÇO, não promessa do código.
 */
export function BarraDeAbas({ mes }: { mes: string }) {
  const { pathname } = useLocation()
  const permissoes = useAuthStore((estado) => estado.usuario?.permissoes ?? [])
  // TODAS as permissões da aba (uma aba que cruza dois eixos só aparece para quem tem os dois),
  // salvo a Visão geral, que abre com qualquer módulo dono
  const visiveis = ABAS.filter((aba) => abaVisivel(aba, permissoes))
  const barra = useRef<HTMLElement>(null)

  // no celular a barra rola: a aba corrente fica À VISTA ao abrir a página (a Equipe, quinta, nascia
  // fora da tela). Rola só a barra — nunca a página
  useEffect(() => {
    const corrente = barra.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (corrente !== null && corrente !== undefined) {
      trazerAAbaParaAVista(corrente)
    }
  }, [pathname])

  // uma aba só não é navegação — é rótulo. Some para não virar enfeite.
  if (visiveis.length < 2) {
    return null
  }

  return (
    <nav ref={barra} aria-label="Seções dos indicadores">
      {/* UMA linha só, que rola de lado quando não cabe (DQ-06): quebrada em duas, no celular e no
          tablet, a quinta aba caía sozinha embaixo e a barra deixava de parecer uma barra. Quem rola
          é o `RoladorHorizontal` — o véu avisa que há mais abas e a região rolável é parada de teclado
          —, e a PÁGINA nunca passa da tela (1.4.10, o motivo do `flex-wrap` antigo, A11Y-01). A linha
          de base é a borda da lista, e a aba corrente desenha o traço dela POR CIMA (`-mb-px`). */}
      <RoladorHorizontal rotulo="Seções dos indicadores — role para ver todas as abas">
        <ul className="flex w-max min-w-full gap-1 border-b border-linha">
          {visiveis.map((aba) => (
            <li key={aba.rota}>
              <LinkDaAba aba={aba} mes={mes} corrente={ehCorrente(aba, pathname)} />
            </li>
          ))}
        </ul>
      </RoladorHorizontal>
    </nav>
  )
}

/**
 * A aba corrente: a raiz é só ela mesma; as outras abas cobrem as suas rotas filhas (o detalhe de um
 * profissional em /indicadores/produtividade/:id continua "na aba Equipe").
 */
function ehCorrente(aba: AbaDeIndicadores, pathname: string): boolean {
  return aba.rota === '/indicadores'
    ? pathname === aba.rota
    : [aba.rota, ...(aba.rotasFilhas ?? [])].some((rota) => pathname === rota || pathname.startsWith(`${rota}/`))
}

/** A aba que recebe o foco pelo teclado rola para a vista — fora do véu da borda (A11Y-IND-11). */
function aoFocarAAba(evento: FocusEvent<HTMLAnchorElement>): void {
  trazerAAbaParaAVista(evento.currentTarget)
}

function LinkDaAba({ aba, mes, corrente }: { aba: AbaDeIndicadores; mes: string; corrente: boolean }) {
  return (
    <Link
      to={`${aba.rota}?mes=${mes}`}
      aria-current={corrente ? 'page' : undefined}
      onFocus={aoFocarAAba}
      className={cn(
        '-mb-px inline-block whitespace-nowrap rounded-t-controle border-b-2 px-4 py-2.5 text-corpo transition-colors',
        // o anel de foco por DENTRO da aba: a região rola, e um anel por fora seria cortado pela borda
        // dela. Com `!`: a regra global `:focus-visible { outline-offset: 2px }`, fora de camada, vence
        // qualquer utilitário sem ele — e o anel saía para fora e era cortado (A11Y-IND-11)
        'focus-visible:outline-2 focus-visible:-outline-offset-2! focus-visible:outline-foco',
        corrente
          ? 'border-destaque font-semibold text-acento'
          : 'border-transparent text-texto-suave hover:border-linha-forte hover:text-texto',
      )}
    >
      {aba.rotulo}
    </Link>
  )
}

/**
 * A largura do VÉU do `RoladorHorizontal` (`w-8`, 2rem): a aba que fica embaixo dele está "à vista" só
 * pela metade. Medida no próprio véu quando ele existe; 32px antes da primeira medida.
 */
const VEU_PADRAO_PX = 32

/**
 * Rola a REGIÃO da barra (nunca a página) até a aba, quando ela está fora da vista ou sob o véu de
 * uma das bordas: a aba fica inteira na faixa livre entre os dois véus.
 */
function trazerAAbaParaAVista(aba: HTMLElement): void {
  const rolador = aba.closest('ul')?.parentElement
  if (rolador === null || rolador === undefined) {
    return
  }
  const veu = rolador.parentElement?.querySelector<HTMLElement>('[aria-hidden="true"].pointer-events-none')?.offsetWidth ?? VEU_PADRAO_PX
  const folga = veu > 0 ? veu : VEU_PADRAO_PX
  const inicio = aba.offsetLeft
  const fim = inicio + aba.offsetWidth
  const vistaDe = rolador.scrollLeft + folga
  const vistaAte = rolador.scrollLeft + rolador.clientWidth - folga
  if (inicio < vistaDe) {
    rolador.scrollLeft = Math.max(0, inicio - folga)
  } else if (fim > vistaAte) {
    rolador.scrollLeft = Math.max(0, fim - rolador.clientWidth + folga)
  }
}
