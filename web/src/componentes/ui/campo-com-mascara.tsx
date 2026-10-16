import { cva } from 'class-variance-authority'
import { useId, useLayoutEffect, useRef } from 'react'
import type { InputHTMLAttributes, Ref } from 'react'

import { cn } from '@/lib/cn'
import { EnvelopeCampo, descreverCampo, type BaseCampo } from '@/componentes/ui/envelope-campo'
import { aplicarMascara, digitosDaMascara } from '@/lib/mascara'

const controle = cva(
  [
    'w-full bg-superficie text-texto text-corpo-lg px-3 h-10',
    'border border-borda-campo rounded-campo',
    'placeholder:text-texto-suave transition-colors duration-(--duracao-1)',
    'focus-visible:border-foco',
    'disabled:bg-neutro-desativado disabled:text-texto-desativado disabled:cursor-not-allowed',
  ],
  {
    variants: { comErro: { true: 'border-perigo-texto', false: '' } },
    defaultVariants: { comErro: false },
  },
)

export interface CampoComMascaraProps
  extends BaseCampo,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Formato fixo: `0` é dígito, o resto é separador (`'00000-000'`). */
  formato: string
  /** Controlado, em DÍGITOS — o formulário nunca vê o separador. */
  value: string
  /** Recebe DÍGITOS, já cortados no que o formato comporta. */
  onChangeValor: (digitos: string) => void
  /**
   * Anúncio de estado do campo (`role="status"`), para quando ele provoca o preenchimento de
   * OUTROS campos: quem enxerga vê quatro campos mudarem de uma vez; quem usa leitor de tela
   * não vê nada acontecer e continuaria tabulando por campos que já não precisam ser digitados.
   */
  anuncio?: string
  ref?: Ref<HTMLInputElement>
}

/**
 * Campo de texto com máscara de formato fixo (design system §5.3, contribuição da change
 * `cep-preenche-o-endereco`).
 *
 * A máscara **não briga com quem digita**: apagar funciona (o separador não volta sozinho),
 * colar um valor já formatado funciona (o que não é dígito é descartado antes), e navegar com o
 * teclado é o comportamento nativo do `input` — nada aqui mexe em seleção ou em cursor.
 */
export function CampoComMascara({
  rotulo,
  erro,
  ajuda,
  obrigatorio = false,
  formato,
  value,
  onChangeValor,
  anuncio,
  className,
  id: idExterno,
  ref: refExterno,
  ...props
}: CampoComMascaraProps) {
  const idGerado = useId()
  const id = idExterno ?? idGerado
  const idAnuncio = `${id}-anuncio`

  /*
   * O campo ANUNCIA quando o consumidor declara a prop — mesmo que ela esteja vazia agora.
   *
   * A primeira versão só criava o `<p role="status">` junto com o texto, e o code review
   * apontou o defeito: região viva que nasce **com** o conteúdo tipicamente não é anunciada
   * por leitor de tela — a região precisa preexistir e ter o texto trocado. É o oposto do
   * precedente que o design cita, o contador do `CampoTextoLongo`, onde a região persiste.
   *
   * O `aria-describedby` continua condicional ao texto: assim a região existe para o leitor
   * anunciar, sem virar a descrição VAZIA do campo — que é o defeito que o `temAjuda` do
   * envelope existe para matar.
   */
  const anuncia = anuncio !== undefined

  /*
   * O CARET NÃO PULA PARA O FIM AO EDITAR NO MEIO (achado A11Y-CEP-04).
   *
   * Campo controlado por valor derivado: o React reescreve o `value` inteiro e o navegador
   * põe o cursor no fim. Corrigir um dígito no meio do CEP exigia re-navegar a cada tecla, e
   * o caminho prático virava apagar tudo e redigitar — custo que cai desproporcionalmente em
   * quem usa teclado.
   *
   * A posição se conta em DÍGITOS, não em caracteres: é o que sobrevive à máscara mudando de
   * tamanho (`88501` → `88501-0` acrescenta um separador antes do caret).
   */
  const campo = useRef<HTMLInputElement>(null)
  const digitosAntesDoCaret = useRef<number | null>(null)

  useLayoutEffect(() => {
    const alvo = campo.current
    const digitos = digitosAntesDoCaret.current
    // consumir SEMPRE, antes de qualquer saída: ref que sobrevive a um render é ref que será
    // usada no render seguinte, que a pessoa não causou — e o cursor dela viaja sozinho
    digitosAntesDoCaret.current = null

    if (alvo === null || digitos === null) return

    // reencontra a posição contando dígitos da esquerda para a direita
    let vistos = 0
    let posicao = alvo.value.length
    for (let i = 0; i < alvo.value.length; i += 1) {
      if (vistos === digitos) {
        posicao = i
        break
      }
      if (/\d/.test(alvo.value[i])) vistos += 1
    }

    alvo.setSelectionRange(posicao, posicao)
  })

  return (
    <EnvelopeCampo id={id} rotulo={rotulo} erro={erro} ajuda={ajuda} obrigatorio={obrigatorio} className={className}>
      <input
        // o espalhamento vem ANTES do que o componente governa: depois, um consumidor que
        // passasse `aria-describedby` derrubaria em silêncio a associação do anúncio
        {...props}
        // o ref interno (caret) e o do consumidor convivem: espalhar `...props` engoliria um
        // dos dois em silêncio
        ref={(no) => {
          campo.current = no
          if (typeof refExterno === 'function') refExterno(no)
          else if (refExterno != null) refExterno.current = no
        }}
        id={id}
        value={aplicarMascara(formato, value)}
        onChange={(evento) => {
          const alvo = evento.target
          // quantos DÍGITOS existem à esquerda do cursor agora — a âncora que sobrevive à
          // máscara se reescrever
          digitosAntesDoCaret.current = (alvo.value.slice(0, alvo.selectionStart ?? alvo.value.length).match(/\d/g) ?? []).length
          onChangeValor(digitosDaMascara(formato, alvo.value))
        }}
        inputMode="numeric"
        maxLength={formato.length}
        required={obrigatorio}
        aria-invalid={erro !== undefined ? true : undefined}
        aria-describedby={
          [descreverCampo(id, { ajuda, erro }), anuncio !== undefined && anuncio !== '' ? idAnuncio : null]
            .filter((valor): valor is string => valor != null)
            .join(' ') || undefined
        }
        className={cn(controle({ comErro: erro !== undefined }))}
      />
      {/*
        `min-h`: a região existe sempre, mas com altura 0 quando vazia — e as frases novas têm
        até três linhas, o que fazia os campos de baixo saltarem 48 px no caminho
        repouso → buscando → preenchido (achado A11Y-CEP-07, que a rodada 2 mediu triplicado).
      */}
      {anuncia ? (
        <p id={idAnuncio} role="status" className="min-h-8 text-meta text-texto-suave">
          {anuncio}
        </p>
      ) : null}
    </EnvelopeCampo>
  )
}
