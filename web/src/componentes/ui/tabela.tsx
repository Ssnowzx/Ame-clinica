import { createContext, useContext } from 'react'
import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'

import { cn } from '@/lib/cn'

interface ConfiguracaoTabela {
  densidade: 'compacta' | 'confortavel'
  cabecalhoFixo: boolean
}

const ContextoTabela = createContext<ConfiguracaoTabela>({ densidade: 'confortavel', cabecalhoFixo: false })

export interface TabelaProps extends TableHTMLAttributes<HTMLTableElement> {
  /** compacta: linha 36px (grades/tabelas grandes) · confortavel: 48px (design-system.md §2.6) */
  densidade?: 'compacta' | 'confortavel'
  /** Cabeçalho sticky em z-(--z-fixo) */
  cabecalhoFixo?: boolean
  /** <caption class="sr-only"> obrigatória — total/página para AT */
  legenda: string
  /**
   * Quem rola a tabela larga. `propria` (padrão): o invólucro tem `overflow-x-auto` e a
   * página nunca rola de lado (1.4.10). `externa`: o invólucro cresce até o conteúdo e
   * quem rola é o pai — o `RoladorHorizontal`, que acrescenta o véu "há mais para o lado"
   * e o foco por teclado que uma região rolável exige (2.1.1). Dois roladores aninhados
   * anulam o de fora (o de dentro rola primeiro), por isso a escolha é explícita.
   */
  rolagem?: 'propria' | 'externa'
}

/**
 * Tabela semântica do design system (design-system.md §5.7). O wrapper tem
 * scroll próprio — a página nunca rola horizontal (1.4.10). Sem sombra por
 * linha (§16); células numéricas usam `numerica` (tabular-nums + text-right).
 */
function TabelaRaiz({
  densidade = 'confortavel',
  cabecalhoFixo = false,
  legenda,
  rolagem = 'propria',
  className,
  children,
  ...props
}: TabelaProps) {
  return (
    <ContextoTabela.Provider value={{ densidade, cabecalhoFixo }}>
      <div
        className={cn(
          'rounded-superficie border border-linha-forte bg-superficie',
          // `print:w-full`: `w-max` é largura de CONTEÚDO, e no papel isso empurra a tabela
          // para fora da folha (a folha de impressão solta o overflow, mas não encolhe o
          // invólucro). Na tela continua sendo o conteúdo que manda, para o rolador funcionar.
          rolagem === 'propria' ? 'w-full overflow-x-auto' : 'w-max min-w-full print:w-full',
        )}
      >
        <table className={cn('w-full border-collapse text-corpo text-texto', className)} {...props}>
          <caption className="sr-only">{legenda}</caption>
          {children}
        </table>
      </div>
    </ContextoTabela.Provider>
  )
}

function Cabecalho({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={className} {...props} />
}

function Corpo({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  // content-visibility poupa paint em corpos longos (§16)
  return <tbody className={cn('[content-visibility:auto]', className)} {...props} />
}

export interface TabelaLinhaProps extends HTMLAttributes<HTMLTableRowElement> {
  /** bg-selecao + aria-selected */
  selecionada?: boolean
}

function Linha({ selecionada = false, className, ...props }: TabelaLinhaProps) {
  const { densidade } = useContext(ContextoTabela)
  return (
    <tr
      aria-selected={selecionada || undefined}
      className={cn(
        'border-b border-linha transition-colors duration-(--duracao-1)',
        densidade === 'compacta' ? 'h-9' : 'h-12',
        selecionada ? 'bg-selecao' : 'hover:bg-hover-de-linha',
        className,
      )}
      {...props}
    />
  )
}

export interface TabelaCelulaProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** Célula de dado numérico: tabular-nums + alinhamento à direita (§2.5) */
  numerica?: boolean
}

function Celula({ numerica = false, className, ...props }: TabelaCelulaProps) {
  const { densidade } = useContext(ContextoTabela)
  return (
    <td
      className={cn(
        densidade === 'compacta' ? 'px-3 py-2' : 'px-4 py-3',
        numerica && 'text-right tabular-nums',
        className,
      )}
      {...props}
    />
  )
}

export interface TabelaCelulaCabecalhoProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /**
   * `cabecalho` (padrão): a pele do cabeçalho de coluna. `corpo`: o `<th scope="row">` que NOMEIA
   * a linha e se veste como as outras células dela — tamanho, peso e cor vêm da linha (o subtotal
   * em negrito, a linha mais leve); muda só a semântica, nunca o desenho (1.3.1).
   */
  pele?: 'cabecalho' | 'corpo'
}

function CelulaCabecalho({ pele = 'cabecalho', className, ...props }: TabelaCelulaCabecalhoProps) {
  const { densidade, cabecalhoFixo } = useContext(ContextoTabela)
  return (
    <th
      scope="col"
      className={cn(
        pele === 'cabecalho'
          ? 'border-b border-linha-forte bg-cabecalho-tabela text-left text-rotulo font-medium text-texto-suave'
          : // o `<th>` nasce em negrito e centrado no navegador: aqui ele herda o peso da linha
            'text-left [font-weight:inherit]',
        densidade === 'compacta' ? 'px-3 py-2' : 'px-4 py-3',
        pele === 'cabecalho' && cabecalhoFixo && 'sticky top-0 z-(--z-fixo)',
        className,
      )}
      {...props}
    />
  )
}

export const Tabela = Object.assign(TabelaRaiz, { Cabecalho, Corpo, Linha, Celula, CelulaCabecalho })
