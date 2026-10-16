import { ArrowDown, ArrowUp, Info, Minus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import type { Definicao } from '@/lib/indicadores/definicoes'
import type { Comparacao, Frase } from '@/lib/indicadores/frases'

import { MolduraDoCartao } from '@/componentes/indicadores/moldura-dos-indicadores'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Popover } from '@/componentes/ui/popover'
import { cn } from '@/lib/cn'

/**
 * O CARTÃO DO INDICADOR (change indicadores-profissionais, D6) — a peça que se repete nas cinco
 * abas: o rótulo, o número, a comparação com o período comparado, a frase que explica e o "i" com a
 * definição exata da conta. "Tudo grudado sem explicação" era a crítica; aqui todo número chega
 * com o contexto dele.
 *
 * A comparação é SETA + TEXTO ("18% a mais que em 1º a 5 de setembro"), nunca só a cor (1.4.1): a
 * seta diz para onde o número foi; a cor, se isso é bom ou ruim (faltas subindo é vermelho).
 */

/** A frase com os números em negrito — o texto corrido é o mesmo que o leitor de tela lê. */
export function TextoDaFrase({ frase }: { frase: Frase }) {
  return (
    <>
      {frase.map((trecho, indice) =>
        trecho.destaque === true ? (
          // a chave é a posição: a frase é imutável e os trechos podem repetir texto
          <strong key={indice} className="font-semibold text-texto">
            {trecho.texto}
          </strong>
        ) : (
          <span key={indice}>{trecho.texto}</span>
        ),
      )}
    </>
  )
}

/**
 * O "i": a definição da conta num Popover do design system — abre por teclado (é um botão), o
 * leitor de tela anuncia o título e o texto (o corpo é a descrição do painel), Esc e clique fora
 * fecham e o foco VOLTA ao "i". Tudo do Radix, nada à mão. Fora do papel: no PDF não há onde clicar.
 */
export function DefinicaoDoIndicador({ rotulo, definicao }: { rotulo: string; definicao: Definicao }) {
  const [aberto, setAberto] = useState(false)
  const nome = `Como se calcula: ${rotulo}`

  return (
    <span data-nao-imprimir className="-my-1 -mr-1 shrink-0">
      <Popover
        aberto={aberto}
        aoMudarAberto={setAberto}
        titulo={nome}
        descreverPeloCorpo
        gatilho={
          // 24px de alvo (2.5.8): o ícone tem 16, o resto é o círculo de toque
          <button
            type="button"
            aria-label={nome}
            className="inline-flex size-6 items-center justify-center rounded-pilula text-texto-suave transition-colors duration-(--duracao-1) hover:bg-hover-de-linha hover:text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
          >
            <Info aria-hidden="true" className="size-4" />
          </button>
        }
      >
        <div className="flex flex-col gap-2 text-texto">
          {definicao.map((paragrafo) => (
            <p key={paragrafo}>{paragrafo}</p>
          ))}
        </div>
      </Popover>
    </span>
  )
}

const TOM_DA_COMPARACAO: Record<Comparacao['tom'], string> = {
  bom: 'text-sucesso-texto',
  ruim: 'text-perigo-texto',
  neutro: 'text-texto',
}

/**
 * O JUÍZO da comparação, para quem não vê a cor (A11Y-IND-04): a cor diz "melhorou" ou "piorou" — e
 * a mesma palavra vai em texto para o leitor de tela. Faltas subindo é "piora", recebido subindo é
 * "melhora"; neutro não ganha juízo nenhum.
 */
const JUIZO_DA_COMPARACAO: Record<Comparacao['tom'], string | null> = {
  bom: '(melhora)',
  ruim: '(piora)',
  neutro: null,
}

/** A comparação: seta + variação (na cor que diz se é bom) + o período comparado, em texto. */
function Comparativo({ comparacao }: { comparacao: Comparacao }) {
  // SEM comparação não tem seta: uma seta "para o lado" ainda sugeriria que houve medida
  if (comparacao.direcao === null) {
    return <span data-comparacao="sem">sem comparação</span>
  }
  const Seta = comparacao.direcao === 'alta' ? ArrowUp : comparacao.direcao === 'queda' ? ArrowDown : Minus
  const juizo = JUIZO_DA_COMPARACAO[comparacao.tom]

  return (
    <>
      <span
        data-comparacao={comparacao.direcao}
        className={cn('inline-flex items-center gap-0.5 self-center font-semibold', TOM_DA_COMPARACAO[comparacao.tom])}
      >
        <Seta aria-hidden="true" className="size-3.5 shrink-0" />
        {comparacao.variacao}
        {juizo === null ? null : <span className="sr-only"> {juizo}</span>}
      </span>
      <span>
        {comparacao.conector} {comparacao.referencia}
      </span>
    </>
  )
}

export interface PortaDoCartao {
  para: string
  rotulo: string
}

export interface CartaoDoIndicadorProps {
  rotulo: string
  /**
   * O número JÁ formatado (pelos helpers únicos de `frases.ts`). `null` = o servidor não tinha base
   * para a conta (nenhuma sessão passou, nenhum lembrete saiu): o cartão diz "Sem dados", nunca 0%.
   */
  valor: string | null
  /** O que o número é, quando o rótulo não diz sozinho ("recebido", "ocupação") */
  legenda?: string
  /**
   * A comparação. Com `direcao: null` = não há período comparado com dados — o cartão diz "sem
   * comparação", em texto e sem seta.
   */
  comparacao?: Comparacao
  /**
   * A linha NEUTRA no lugar da comparação, para a grandeza que não se compara por natureza (uma foto
   * do momento, como os pacientes ativos): "situação de hoje", "+24 novos no período". Sem seta e sem
   * cor. Todo cartão de uma linha tem comparação OU esta linha — a mesma anatomia lado a lado (DQ-05).
   */
  contexto?: string
  /** A frase que explica o número, em linguagem da clínica */
  frase?: Frase
  definicao: Definicao
  /** A caixa como porta: só passe com a permissão do DESTINO */
  porta?: PortaDoCartao
}

export function CartaoDoIndicador({ rotulo, valor, legenda, comparacao, contexto, frase, definicao, porta }: CartaoDoIndicadorProps) {
  return (
    <MolduraDoCartao rotulo={rotulo} acessorio={<DefinicaoDoIndicador rotulo={rotulo} definicao={definicao} />}>
      {/* sem `tabular-nums`: número grande sozinho fica frouxo com dígitos de largura igual */}
      {valor === null ? (
        <p className="mt-2 font-display text-titulo font-semibold text-texto-suave">Sem dados</p>
      ) : (
        <p className="mt-2 font-display text-display font-semibold text-texto">{valor}</p>
      )}

      {/* as faixas vazias ficam no lugar (`div`): cada cartão ocupa as seis linhas da grade da linha */}
      {legenda === undefined ? <div /> : <p className="mt-1 text-pretty text-meta text-texto-suave">{legenda}</p>}

      {/* a comparação em linha PRÓPRIA: junto da legenda, com um "·" no meio, ela quebrava e o
          separador ficava sozinho no começo da linha seguinte */}
      <LinhaDaComparacao comparacao={comparacao} contexto={contexto} />

      {frase === undefined || frase.length === 0 ? (
        <div />
      ) : (
        <p className="mt-4 border-t border-linha pt-3 text-pretty text-corpo text-texto-suave">
          <TextoDaFrase frase={frase} />
        </p>
      )}

      {porta === undefined ? (
        <div />
      ) : (
        // `text-meta` no invólucro: a linha da porta tem a altura do link, e não a do texto do corpo
        <div data-nao-imprimir className="self-end pt-3 text-meta">
          <Link
            to={porta.para}
            className="rounded-controle text-meta font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
          >
            {porta.rotulo}
          </Link>
        </div>
      )}
    </MolduraDoCartao>
  )
}

/** A faixa da comparação: a variação com seta, a linha neutra no lugar dela, ou vazia. */
function LinhaDaComparacao({ comparacao, contexto }: { comparacao?: Comparacao; contexto?: string }) {
  if (comparacao !== undefined) {
    return (
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-meta text-texto-suave">
        <Comparativo comparacao={comparacao} />
      </p>
    )
  }

  return contexto === undefined ? (
    <div />
  ) : (
    <p data-contexto className="mt-1.5 text-pretty text-meta font-semibold text-texto">
      {contexto}
    </p>
  )
}

/** ERRO: só deste cartão, com tentar de novo — os outros seguem com os números deles. */
export function CartaoComErro({
  rotulo,
  mensagem,
  aoTentarNovamente,
}: {
  rotulo: string
  mensagem: string
  aoTentarNovamente: () => void
}) {
  return (
    <MolduraDoCartao rotulo={rotulo}>
      <EstadoErro className="mt-3 p-4" mensagem={mensagem} aoTentarNovamente={aoTentarNovamente} />
    </MolduraDoCartao>
  )
}

/**
 * SEM DADOS: o mês é anterior ao histórico da clínica. Nunca um zero — "R$ 0,00 recebido" num mês
 * em que o sistema não existia é a mesma mentira das colunas zeradas de maio a agosto. O PORQUÊ é
 * dito uma vez só, na linha do período, com a saída para o primeiro mês que existe; os cartões não o repetem
 * quatro vezes (DQ-14).
 */
export function CartaoSemDados({ rotulo, definicao }: { rotulo: string; definicao: Definicao }) {
  return (
    <MolduraDoCartao rotulo={rotulo} acessorio={<DefinicaoDoIndicador rotulo={rotulo} definicao={definicao} />}>
      <p className="mt-2 font-display text-titulo font-semibold text-texto-suave">Sem dados</p>
    </MolduraDoCartao>
  )
}
