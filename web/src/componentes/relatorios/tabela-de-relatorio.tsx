import { RoladorHorizontal } from '@/componentes/ui/rolador-horizontal'
import { Tabela } from '@/componentes/ui/tabela'
import { cn } from '@/lib/cn'
import { ehColunaNumerica, formatarCelula } from '@/lib/relatorios/formatacao'
import type { ColunaDeRelatorio, LinhaDeRelatorio, TotaisDeRelatorio, ValorDeCelula } from '@/tipos'

/** O recuo da primeira célula por `nivel` (DRE): a linha da escada e, mais para dentro, a categoria. */
const RECUO_POR_NIVEL: Readonly<Record<number, string>> = { 1: 'pl-7', 2: 'pl-12' }

/**
 * Na escada (DRE) a 1ª coluna fica à vista ao rolar de lado (A11Y-FIN-05): sem ela, os meses
 * seguintes são números sem nome. Um degrau acima das outras células — e acima do véu de "há
 * mais" do rolador, que desbotaria o começo do rótulo.
 *
 * Fixa SÓ com espaço (A11Y-FIN-R2-01, 1.4.10): a coluna tem ~290 px ("Despesas comerciais e de
 * divulgação" com o recuo), e a 320 CSS px o rolador tem ~272 — fixa, ela cobria os meses e o
 * Total, que nunca apareciam. Abaixo de `sm` ela rola junto, como as outras.
 */
const PRIMEIRA_FIXA = 'sm:sticky sm:left-0 sm:z-(--z-fixo) transition-colors duration-(--duracao-1)'

/** O canto "DRE" do cabeçalho: fixo como a coluna, um degrau acima dela — com o mesmo limite. */
const CANTO_FIXO = 'sm:sticky sm:left-0 sm:z-(--z-fixo-canto)'

/**
 * As MARCAS da linha que não são coluna (change `dre-gerencial`, D4): quem não as manda — todos
 * os outros relatórios — sai exatamente como antes.
 */
function marcasDaLinha(linha: LinhaDeRelatorio): { nivel: number | null; destaque: boolean } {
  return {
    nivel: typeof linha.nivel === 'number' ? linha.nivel : null,
    destaque: linha.destaque === true,
  }
}

/** A célula, sem as marcas: um booleano nunca é valor de coluna. */
function valorDaCelula(linha: LinhaDeRelatorio, chave: string): ValorDeCelula {
  const valor = linha[chave]

  return typeof valor === 'boolean' || valor === undefined ? null : valor
}

/**
 * A pele da linha pelas marcas: o subtotal realçado (fundo e fio acima, na tela E no papel), o
 * grupo em negrito, a categoria mais leve que a linha da escada que ela compõe.
 */
function classesDaLinha({ nivel, destaque }: { nivel: number | null; destaque: boolean }): string | undefined {
  if (destaque) {
    return 'border-t-2 border-t-linha-forte bg-fundo font-semibold hover:bg-fundo'
  }
  if (nivel === 0) {
    return 'font-semibold'
  }

  return nivel === 2 ? 'text-texto-suave' : undefined
}

/**
 * A célula fixa cobre o que rola por baixo, então tem fundo PRÓPRIO — o mesmo da linha: o realce
 * do subtotal, e nas demais o da superfície com o hover da linha (`group/linha`). Só quando fixa
 * (`sm`): abaixo dela a célula rola com a linha e o fundo é o da própria linha.
 */
function fundoDaPrimeiraFixa(destaque: boolean): string {
  return destaque ? 'sm:bg-fundo' : 'sm:bg-superficie sm:group-hover/linha:bg-hover-de-linha'
}

interface LeituraDaLinha {
  /** Antes do rótulo: "Subtotal:" no subtotal. */
  antes: string | null
  /** Depois do rótulo: ", dentro de <grupo>" na linha da escada, ", dentro de <linha>" na categoria. */
  depois: string | null
}

/**
 * O que o DESENHO diz e o leitor de tela não ouvia (A11Y-FIN-01 e R2-02, 1.3.1): o subtotal é
 * subtotal, a linha da escada (nível 1) compõe o grupo (nível 0) acima dela, e a categoria (nível
 * 2) compõe a linha da escada. Anda as linhas na ORDEM do servidor guardando o último grupo e a
 * última linha de nível 1. Todo nível 0 esquece a linha — a categoria nunca é anunciada dentro da
 * linha de outro grupo —, e o subtotal (nível 0 em destaque) não é grupo: esquece o grupo também.
 */
function leiturasDasLinhas(linhas: readonly LinhaDeRelatorio[], primeira: ColunaDeRelatorio | undefined): LeituraDaLinha[] {
  let grupo: string | null = null
  let linhaMae: string | null = null

  return linhas.map((linha) => {
    const { nivel, destaque } = marcasDaLinha(linha)
    const rotulo = primeira === undefined ? '' : formatarCelula(valorDaCelula(linha, primeira.chave), primeira.tipo)
    if (nivel === 0) {
      grupo = destaque ? null : rotulo
      linhaMae = null
    }
    const mae = nivel === 1 ? grupo : nivel === 2 ? linhaMae : null
    if (nivel === 1) {
      linhaMae = rotulo
    }

    return { antes: destaque ? 'Subtotal:' : null, depois: mae === null ? null : `, dentro de ${mae}` }
  })
}

/**
 * Texto só para leitor de tela: não muda o desenho e não vai ao papel. `select-none`
 * (A11Y-FIN-R2-05): o Ctrl+C da tabela não leva "Subtotal:" nem ", dentro de…" para a planilha.
 */
function SoParaLeitor({ texto }: { texto: string | null }) {
  return texto === null ? null : <span className="sr-only select-none print:hidden">{texto}</span>
}

/** O rótulo da linha da escada, com o que só o leitor de tela ouve antes e depois dele. */
function RotuloDaEscada({ texto, leitura }: { texto: string; leitura: LeituraDaLinha | undefined }) {
  const antes = leitura?.antes ?? null

  return (
    <>
      <SoParaLeitor texto={antes} />
      {/* o espaço fica FORA do trecho oculto: o cálculo do nome apara o texto de cada filho, e
          "Subtotal:" colaria no rótulo. Na tela ele não desenha — é espaço no começo da linha */}
      {antes === null ? null : ' '}
      {texto}
      <SoParaLeitor texto={leitura?.depois ?? null} />
    </>
  )
}

export interface TabelaDeRelatorioProps {
  colunas: ColunaDeRelatorio[]
  linhas: LinhaDeRelatorio[]
  /** A linha de totais (`<tfoot>`): só as chaves que existem em `totais` ganham valor. */
  totais?: TotaisDeRelatorio
  /** `<caption>` só para leitor de tela — o que é e quantas linhas tem. */
  legenda: string
  rotuloDoTotal?: string
}

/**
 * A tabela GENÉRICA dos relatórios (design D2): renderiza as colunas que a API declarou,
 * formatando cada célula pelo `tipo` — a tela não conhece o formato de relatório nenhum,
 * e acrescentar uma coluna é mudança de UM arquivo na API.
 *
 * Larga, ela rola DENTRO do `RoladorHorizontal` (véu de "há mais" + foco por teclado);
 * a `Tabela` da casa fica com a rolagem externa para não haver dois roladores aninhados.
 *
 * A ESCADA (as linhas com `nivel`, só o DRE manda): a 1ª célula é o cabeçalho da linha
 * (`<th scope="row">`, com a pele do corpo), diz ao leitor de tela o subtotal e onde cada linha
 * mora, e a 1ª coluna fica fixa ao rolar de lado quando há espaço (`sm`). Sem `nivel`, nada disso
 * muda.
 */
export function TabelaDeRelatorio({ colunas, linhas, totais, legenda, rotuloDoTotal = 'Total' }: TabelaDeRelatorioProps) {
  const [primeira, ...demais] = colunas
  const temTotais = totais !== undefined && colunas.some((coluna) => coluna.chave in totais)
  const escada = linhas.some((linha) => marcasDaLinha(linha).nivel !== null)
  const leituras = escada ? leiturasDasLinhas(linhas, primeira) : []

  return (
    <RoladorHorizontal rotulo={`${legenda} — role para ver todas as colunas`}>
      <Tabela legenda={legenda} densidade="compacta" rolagem="externa">
        <Tabela.Cabecalho>
          <Tabela.Linha>
            {colunas.map((coluna, posicao) => (
              <Tabela.CelulaCabecalho
                key={coluna.chave}
                scope="col"
                className={cn(ehColunaNumerica(coluna.tipo) && 'text-right', escada && posicao === 0 && CANTO_FIXO)}
              >
                {coluna.rotulo}
              </Tabela.CelulaCabecalho>
            ))}
          </Tabela.Linha>
        </Tabela.Cabecalho>
        <Tabela.Corpo>
          {linhas.map((linha, indice) => {
            const marcas = marcasDaLinha(linha)
            const leitura = leituras[indice]

            return (
              // as linhas de um relatório não têm identidade própria: a ordem é a do servidor
              // e a lista nunca é reordenada na tela — o índice é a chave honesta
              <Tabela.Linha key={indice} className={cn(escada && 'group/linha', classesDaLinha(marcas))}>
                {colunas.map((coluna, posicao) => {
                  const classes = cn(
                    (coluna.tipo === 'data' || coluna.tipo === 'hora') && 'whitespace-nowrap',
                    posicao === 0 && marcas.nivel !== null && RECUO_POR_NIVEL[marcas.nivel],
                    escada && posicao === 0 && [PRIMEIRA_FIXA, fundoDaPrimeiraFixa(marcas.destaque)],
                  )
                  const conteudo = formatarCelula(valorDaCelula(linha, coluna.chave), coluna.tipo)

                  return posicao === 0 && marcas.nivel !== null ? (
                    <Tabela.CelulaCabecalho key={coluna.chave} scope="row" pele="corpo" className={classes}>
                      <RotuloDaEscada texto={conteudo} leitura={leitura} />
                    </Tabela.CelulaCabecalho>
                  ) : (
                    <Tabela.Celula key={coluna.chave} numerica={ehColunaNumerica(coluna.tipo)} className={classes}>
                      {conteudo}
                    </Tabela.Celula>
                  )
                })}
              </Tabela.Linha>
            )
          })}
        </Tabela.Corpo>
        {temTotais && primeira !== undefined ? (
          <tfoot>
            <Tabela.Linha className="bg-fundo font-semibold hover:bg-fundo">
              <Tabela.CelulaCabecalho scope="row" className={cn('text-texto', escada && PRIMEIRA_FIXA)}>
                {rotuloDoTotal}
              </Tabela.CelulaCabecalho>
              {demais.map((coluna) => (
                <Tabela.Celula key={coluna.chave} numerica={ehColunaNumerica(coluna.tipo)}>
                  {coluna.chave in totais ? formatarCelula(totais[coluna.chave] ?? null, coluna.tipo) : ''}
                </Tabela.Celula>
              ))}
            </Tabela.Linha>
          </tfoot>
        ) : null}
      </Tabela>
    </RoladorHorizontal>
  )
}
