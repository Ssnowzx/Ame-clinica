import { ChevronDown, Globe } from 'lucide-react'

import { cn } from '@/lib/cn'
import {
  bandeira,
  OUTRO_PAIS,
  OUTROS_PAISES,
  PAISES_PROVAVEIS,
  paisPelaSigla,
  type PaisDoTelefone,
} from '@/lib/paises-do-telefone'

export interface SeletorDoPaisProps {
  /** A sigla do país escolhido, ou `OUTRO_PAIS` */
  sigla: string
  aoEscolher: (sigla: string) => void
  disabled?: boolean
  /** A altura do campo do número, para os dois ficarem na mesma linha */
  tamanho?: 'md' | 'lg'
}

/** "Reino Unido +44": o NOME primeiro, porque é por ele que o teclado procura na lista. */
function rotuloDaOpcao(pais: PaisDoTelefone): string {
  return `${pais.nome} +${pais.codigo}`
}

function OpcoesDosPaises({ paises }: { paises: readonly PaisDoTelefone[] }) {
  return paises.map((pais) => (
    <option key={pais.sigla} value={pais.sigla}>
      {rotuloDaOpcao(pais)}
    </option>
  ))
}

/**
 * A escolha do país antes do número (change telefone-estrangeiro, tarefa 1.3b).
 *
 * É o `<select>` NATIVO, transparente por cima de uma caixa que mostra a bandeira e o código — o
 * mesmo par dos cadastros que a clínica conhece. Do nativo vem de graça o que um menu feito à mão
 * teria de refazer: teclado (setas, Home/End, digitar o começo do nome), a lista do sistema no
 * celular e o anúncio do leitor de tela ("País do telefone, Reino Unido +44").
 *
 * Três decisões de acessibilidade, para não voltarem:
 *
 * - **A opção começa pelo NOME**, não pela bandeira. Na lista nativa, digitar "R" leva ao primeiro
 *   país com R; com o emoji na frente, a busca pelo teclado não acha nada. A bandeira fica na caixa
 *   visível, onde o dono a pediu: antes do número.
 * - **A caixa visível é `aria-hidden`.** Quem usa leitor de tela ouve o `<select>`; ouvir a caixa
 *   também seria o país duas vezes.
 * - **O anel de foco é da caixa** (`peer-focus-visible`): o `<select>` transparente pinta o anel
 *   universal, mas transparente junto com ele (2.4.7) — o mesmo caso do rádio recortado da
 *   identidade da clínica.
 *
 * A bandeira em emoji vira letras no Windows ("GB"); por isso o código vai sempre escrito ao lado
 * dela, e a lista diz o nome e o código.
 */
export function SeletorDoPais({ sigla, aoEscolher, disabled = false, tamanho = 'md' }: SeletorDoPaisProps) {
  const pais = paisPelaSigla(sigla)

  return (
    <div className={cn('relative w-28 shrink-0', tamanho === 'lg' ? 'h-11' : 'h-10')}>
      <select
        aria-label="País do telefone"
        value={sigla}
        disabled={disabled}
        onChange={(evento) => {
          aoEscolher(evento.target.value)
        }}
        // a letra de 16 px também no transparente: abaixo disso o iPhone aproxima a tela ao tocar
        className="peer absolute inset-0 size-full cursor-pointer appearance-none text-corpo-lg opacity-0 disabled:cursor-not-allowed"
      >
        <optgroup label="Mais comuns">
          <OpcoesDosPaises paises={PAISES_PROVAVEIS} />
        </optgroup>
        <optgroup label="Outros países, de A a Z">
          <OpcoesDosPaises paises={OUTROS_PAISES} />
        </optgroup>
        <optgroup label="Fora da lista">
          <option value={OUTRO_PAIS}>Outro país (digite o + e o código)</option>
        </optgroup>
      </select>
      <span
        aria-hidden="true"
        className={cn(
          'flex size-full items-center gap-1.5 rounded-campo border border-borda-campo bg-superficie pl-3 pr-8',
          'text-corpo-lg text-texto transition-colors duration-(--duracao-1)',
          'peer-focus-visible:border-foco peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foco',
          'peer-disabled:bg-neutro-desativado peer-disabled:text-texto-desativado',
        )}
      >
        {pais === undefined ? (
          <>
            <Globe className="size-4 shrink-0 text-texto-suave" />
            <span>Outro</span>
          </>
        ) : (
          <>
            <span>{bandeira(pais.sigla)}</span>
            <span className="tabular-nums">+{pais.codigo}</span>
          </>
        )}
      </span>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-texto-suave"
      />
    </div>
  )
}
