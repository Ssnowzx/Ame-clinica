import { RefreshCw } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { Botao } from '@/componentes/ui/botao'
import { mensagemDaFalhaDeAtualizacao } from '@/hooks/usar-agenda-viva'

interface AvisoDeAtualizacaoProps {
  /** O instante (ms) em que o dado que está na tela chegou — `dataUpdatedAt` da consulta. */
  carregadoEm: number
  /** O instante (ms) da última falha — `errorUpdatedAt` da consulta. */
  falhouEm: number
  tentando: boolean
  aoTentarDeNovo: () => void
  /**
   * O aviso saiu da tela com o FOCO dentro dele (o "Tentar de novo" deu certo): quem o monta leva o
   * foco a um lugar com sentido — sem isso ele cairia no `body` (achado A11Y-BT-12 do gate).
   */
  aoSairComFoco: () => void
  /**
   * Um MODO (marcar retorno) ocupa a região viva da página: ela diz o texto do modo, e não a falha.
   * Aí quem anuncia a falha é a região DAQUI (achado A11Y-BT-18 do gate).
   */
  regiaoDaPaginaOcupada: boolean
}

/**
 * A busca de FUNDO falhou (redeploy, 502, Wi-Fi caindo) e a grade CONTINUA na tela com o que já
 * tinha (achado CRB-01 / A11Y-BT-03 do gate). Antes a falha de uma busca que ninguém pediu trocava a
 * agenda inteira por "Não foi possível carregar", jogava o foco no `body` e perdia a rolagem.
 *
 * Discreto de propósito: âmbar de aviso, não vermelho de erro — nada foi perdido, só está velho. O
 * ANÚNCIO da falha sai pela região viva permanente da página (`pagina-agenda`), que já existe antes
 * dela; este bloco é o que se VÊ e o botão que resolve, descrito pela mesma frase.
 *
 * A região viva DAQUI dentro só fala de uma coisa: o "Tentar de novo" que falhou OUTRA vez (achado
 * A11Y-BT-13). Sem ela, o clique não teria resposta nenhuma — a página continua em falha, e a região
 * dela não muda de texto.
 */
export function AvisoDeAtualizacao({
  carregadoEm,
  falhouEm,
  tentando,
  aoTentarDeNovo,
  aoSairComFoco,
  regiaoDaPaginaOcupada,
}: AvisoDeAtualizacaoProps) {
  const idDaFrase = useId()
  const refBloco = useRef<HTMLDivElement>(null)
  const refAoSairComFoco = useRef(aoSairComFoco)
  refAoSairComFoco.current = aoSairComFoco

  // o instante do clique em "Tentar de novo": a falha que vier DEPOIS dele é a resposta ao clique
  const [tentouEm, setTentouEm] = useState<number | null>(null)
  const [anuncio, setAnuncio] = useState('')
  if (tentouEm !== null && falhouEm >= tentouEm) {
    setTentouEm(null)
    setAnuncio('Ainda não foi possível atualizar.')
  }

  /*
   * A falha dita AQUI quando a região da página está com o texto de um modo — senão, no modo retorno,
   * a busca de fundo falharia em silêncio para quem usa leitor de tela.
   *
   * Num efeito, e não no primeiro render: a região nasce VAZIA num commit e recebe a frase no
   * seguinte — região criada já com o texto dentro não é anunciada de forma confiável. Só na
   * montagem: se o modo começar depois, a página já disse a falha antes dele.
   */
  const regiaoOcupadaAoMontar = useRef(regiaoDaPaginaOcupada)
  const fraseAoMontar = useRef(mensagemDaFalhaDeAtualizacao(carregadoEm))
  useEffect(() => {
    if (regiaoOcupadaAoMontar.current) {
      setAnuncio(fraseAoMontar.current)
    }
  }, [])

  // Na limpeza de LAYOUT o bloco ainda está no DOM (o React desmonta os efeitos antes de tirar o nó):
  // é o último instante em que dá para saber se o foco estava aqui dentro.
  useLayoutEffect(() => {
    const bloco = refBloco.current
    return () => {
      if (bloco !== null && bloco.contains(document.activeElement)) {
        refAoSairComFoco.current()
      }
    }
  }, [])

  return (
    <div
      ref={refBloco}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-campo bg-alerta-suave px-3 py-2"
    >
      <p id={idDaFrase} className="flex items-center gap-2 text-rotulo text-alerta-texto">
        <RefreshCw aria-hidden="true" className="size-4 shrink-0" />
        {mensagemDaFalhaDeAtualizacao(carregadoEm)}
      </p>
      <Botao
        variante="secundario"
        tamanho="sm"
        aria-describedby={idDaFrase}
        // `aria-disabled`, e não `disabled`/`carregando`: desabilitar o botão focado tira o foco dele
        // e o joga no `body` no meio da tentativa — o que este bloco existe para evitar
        aria-disabled={tentando || undefined}
        onClick={() => {
          if (tentando) {
            return
          }
          setTentouEm(Date.now())
          setAnuncio('')
          aoTentarDeNovo()
        }}
      >
        Tentar de novo
      </Botao>
      {/* nasce com o aviso, VAZIA: região criada já com o texto não é anunciada de forma confiável */}
      <p role="status" className="sr-only">
        {anuncio}
      </p>
    </div>
  )
}
