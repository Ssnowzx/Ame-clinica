import { cva } from 'class-variance-authority'
import { useId, useRef, useState } from 'react'
import type { InputHTMLAttributes, ReactNode, Ref } from 'react'

import { cn } from '@/lib/cn'
import { EnvelopeCampo, descreverCampo, type BaseCampo } from '@/componentes/ui/envelope-campo'

const controle = cva(
  [
    'w-full bg-superficie text-texto text-corpo-lg px-3',
    'border border-borda-campo rounded-campo',
    'placeholder:text-texto-suave transition-colors duration-(--duracao-1)',
    'focus-visible:border-foco',
    'disabled:bg-neutro-desativado disabled:text-texto-desativado disabled:cursor-not-allowed',
  ],
  {
    variants: {
      tamanho: { md: 'h-10', lg: 'h-11' },
      comErro: { true: 'border-perigo-texto', false: '' },
    },
    defaultVariants: { tamanho: 'md', comErro: false },
  },
)

export interface CampoTextoProps extends BaseCampo, InputHTMLAttributes<HTMLInputElement> {
  tamanho?: 'md' | 'lg'
  /** Ação na linha do controle (o "Salvar" das configurações) — ver `EnvelopeCampo`. */
  acaoAoLado?: ReactNode
  /** Peça na linha do controle, antes dele (o país do telefone) — ver `EnvelopeCampo`. */
  antesDoControle?: ReactNode
  /**
   * Teto de caracteres do servidor. Com ele, o campo **impede** o excesso e diz quanto ainda
   * cabe — em vez de deixar a pessoa preencher a ficha inteira e perder tudo no salvar.
   */
  limite?: number
  ref?: Ref<HTMLInputElement>
}

/**
 * A partir de quando o contador aparece.
 *
 * Num `input` de linha única ele NÃO é permanente: quinze contadores numa ficha viram ruído, e
 * ruído que ninguém lê não avisa ninguém. O campo de texto longo, que vive perto do limite,
 * mantém o dele sempre visível — a diferença é deliberada.
 */
function limiarDoAviso(limite: number): number {
  return Math.max(10, Math.floor(limite * 0.1))
}

function perigoDeEstourar(limite: number, escrito: number): boolean {
  return limite - escrito <= limiarDoAviso(limite)
}

/**
 * O QUE O LEITOR DE TELA OUVE — e por que não é o mesmo texto que se vê.
 *
 * O contador visível muda a cada tecla. Medido pelo gate (achado TETO-01): a região mudava a
 * cada ~100 ms digitando devagar e a cada ~52 ms digitando rápido, enquanto falar "dez
 * caracteres restantes" leva cerca de 1,5 s — e `role="status"` é `aria-atomic`, então cada
 * mudança relê a frase inteira. A fila enchia muito mais rápido do que drenava, competindo com
 * o eco de tecla justamente quando a pessoa mais precisa dele: encostando no teto.
 *
 * A saída é anunciar por MARCO, não por tecla. O texto abaixo só muda três vezes na vida do
 * campo, e o número exato continua na tela para quem enxerga.
 */
function anuncioDoMarco(limite: number, restantes: number): string {
  // excedido NÃO é "atingido": dizer que coube exatamente quando sobra texto é a mentira que o
  // aviso de corte combate no colar (achado MENOR 5)
  if (restantes < 0) {
    return `${String(-restantes)} ${restantes === -1 ? 'caractere a mais' : 'caracteres a mais'} do que o limite de ${String(limite)}.`
  }
  if (restantes <= 0) return `Limite de ${String(limite)} caracteres atingido.`
  if (restantes <= 5) return 'Faltam 5 caracteres ou menos para o limite.'
  if (restantes <= 10) return 'Faltam 10 caracteres ou menos para o limite.'
  /*
   * O MARCO DE ENTRADA é o mesmo instante em que o contador acende na tela (achado TETO-07).
   *
   * Sem ele, quem enxerga era avisado com 50 caracteres de folga num campo de 500, e quem usa
   * leitor de tela só com 10 — um quinto da antecedência. Agora os dois canais começam juntos.
   *
   * O número vem do LIMIAR, não do que resta: assim ele é exato como fronteira e nunca fica
   * velho. Anunciar o número exato do que resta é justamente o que não se pode fazer — ou ele
   * muda a cada tecla (o defeito original) ou congela e passa a mentir.
   */
  const limiar = limiarDoAviso(limite)
  if (restantes <= limiar) return `Faltam ${String(limiar)} caracteres ou menos para o limite.`

  return ''
}

/**
 * Campo de texto do design system (design-system.md §5.3). Rótulo sempre via
 * <label htmlFor> — placeholder nunca substitui o rótulo (3.3.2). Campos de
 * senha: passar type="password" + autocomplete correto (parecer T-ds-04).
 */
export function CampoTexto({
  rotulo,
  erro,
  ajuda,
  obrigatorio = false,
  tamanho,
  limite,
  acaoAoLado,
  antesDoControle,
  className,
  id: idExterno,
  ...props
}: CampoTextoProps) {
  const idGerado = useId()
  const id = idExterno ?? idGerado
  const idContador = `${id}-contador`

  /*
   * DUAS RÉGUAS PARA O MESMO NÚMERO, e a direção importa (achado MENOR 2 do gate).
   *
   * Aqui e no `maxLength` do HTML a contagem é em unidades UTF-16; o servidor conta caracteres
   * (`mb_strlen`). Um emoji vale 2 aqui e 1 lá. A tela é portanto sempre igual ou MAIS
   * restritiva — o servidor nunca recusa o que ela aceitou, que é a direção segura. Igualar as
   * duas exigiria contar code points e brigar com o `maxLength` nativo, o que custa mais do que
   * resolve.
   */
  const escrito = typeof props.value === 'string' ? props.value.length : 0
  /*
   * Valor GRAVADO maior que o teto — dado legado, ou teto que encolheu. O `maxLength` impede
   * DIGITAR além, não trunca o que já veio do banco.
   *
   * O piso em 0 que a primeira versão usava trocava um número feio ("-12 caracteres
   * restantes") por uma frase que MENTE: "0 caracteres restantes" e "limite atingido" dizem
   * "coube exatamente", que é o mesmo mal-entendido que o aviso de corte combate no colar —
   * enquanto o salvar responde "tem 512 caracteres; o limite é 500" (achado MENOR 5 da rodada
   * 2). O caminho é inalcançável hoje, mas o rollback previsto no plano de migração é
   * justamente o que aperta um teto sobre dado já gravado.
   */
  const restantes = limite !== undefined ? limite - escrito : undefined
  const excedeu = restantes !== undefined && restantes < 0
  const avisando = limite !== undefined && restantes !== undefined && perigoDeEstourar(limite, escrito)

  /*
   * COLAR CORTA EM SILÊNCIO — e o gate mediu (achado TETO-02): colar 600 caracteres num campo
   * de 500 sumia com 100 sem nada na tela dizer. Num campo de uma linha a perda é invisível
   * para quem enxerga, e quem não vê ouvia "0 caracteres restantes", que soa como "coube
   * exatamente". Colar é justamente como a recepção transfere endereço vindo do WhatsApp.
   */
  const [cortou, setCortou] = useState(false)
  /**
   * O `input` do próprio colar chega LOGO DEPOIS do `paste` — e limpava o aviso no mesmo
   * instante em que ele nascia. Esta marca deixa passar exatamente essa mudança.
   */
  const mudancaDoColar = useRef(false)

  const textoDoAnuncio =
    limite === undefined || restantes === undefined
      ? ''
      : cortou
        ? `Texto cortado no limite de ${String(limite)} caracteres.`
        : anuncioDoMarco(limite, restantes)

  return (
    <EnvelopeCampo
      id={id}
      rotulo={rotulo}
      erro={erro}
      ajuda={ajuda}
      obrigatorio={obrigatorio}
      acaoAoLado={acaoAoLado}
      antesDoControle={antesDoControle}
      className={className}
    >
      <input
        // o espalhamento vem ANTES do que o componente governa: depois, um consumidor que
        // passasse `aria-describedby` ou `maxLength` derrubaria em silêncio o teto e o contador
        {...props}
        id={id}
        required={obrigatorio}
        /*
         * `?? props.maxLength` — e a falta disso foi REGRESSÃO (achado TETO-03 do gate).
         *
         * Com o espalhamento vindo antes, escrever `maxLength={limite}` sobrescrevia com
         * `undefined` o teto que o consumidor passou por props. QUATRO campos fora do cadastro
         * perderam a trava que tinham (a primeira redação deste comentário dizia dois, e a
         * auditoria de segurança completou a lista): o motivo da evolução (500, que vai para a
         * TRILHA DE AUDITORIA), o título da tarefa (200), o outro campo da tarefa (255) e o
         * documento do lançamento (60). Numa change que existe para impedir o estouro, tirar a
         * trava de quem já a tinha é o defeito mais irônico possível.
         */
        maxLength={limite ?? props.maxLength}
        aria-invalid={erro !== undefined ? true : undefined}
        onPaste={(evento) => {
          if (limite !== undefined) {
            const colado = evento.clipboardData.getData('text').length
            const alvo = evento.currentTarget
            const selecionado = (alvo.selectionEnd ?? 0) - (alvo.selectionStart ?? 0)
            const truncou = alvo.value.length - selecionado + colado > limite
            setCortou(truncou)
            mudancaDoColar.current = truncou
          }
          props.onPaste?.(evento)
        }}
        onChange={(evento) => {
          // qualquer digitação DEPOIS do corte tira o aviso: ele fala do colar, não do estado
          if (mudancaDoColar.current) mudancaDoColar.current = false
          else if (cortou) setCortou(false)
          props.onChange?.(evento)
        }}
        aria-describedby={
          /*
           * A referência segue o TEXTO, não o limiar (achado TETO-06). Os dois limiares eram
           * diferentes, e na faixa entre eles o campo apontava para uma região VAZIA — que é
           * exatamente o defeito que o `temAjuda` do envelope nasceu para matar.
           */
          [descreverCampo(id, { ajuda, erro }), textoDoAnuncio !== '' ? idContador : null]
            .filter((valor): valor is string => valor != null)
            .join(' ') || undefined
        }
        className={cn(controle({ tamanho, comErro: erro !== undefined }))}
      />
      {/*
        A região existe desde a MONTAGEM quando há teto, vazia enquanto o texto está longe
        dele. Região viva criada junto com a mensagem tipicamente não é anunciada por leitor de
        tela — foi o achado A11Y-CEP-02, e a lição vale para toda peça nova do design system.
      */}
      {limite !== undefined ? (
        <>
          {/*
            O VISÍVEL: número exato, a cada tecla, `aria-hidden` — quem não vê ouve o marco
            abaixo, e ouvir os dois seria a mesma frase duas vezes.
            `min-h`: a linha é reservada mesmo vazia, senão os campos de baixo saltam 16 px no
            instante em que o contador acende (achado TETO-05).
          */}
          <p aria-hidden="true" className="mt-1 min-h-4 text-right text-meta text-texto-suave">
            {cortou
              ? `Texto cortado no limite de ${String(limite)} caracteres.`
              : excedeu && restantes !== undefined
                ? `${String(-restantes)} ${restantes === -1 ? 'caractere a mais' : 'caracteres a mais'} do que o limite.`
                : avisando && restantes !== undefined
                  ? `${String(restantes)} ${restantes === 1 ? 'caractere restante' : 'caracteres restantes'}`
                  : ''}
          </p>
          {/* O ANUNCIADO: só muda em marco, e a região existe desde a montagem */}
          <p id={idContador} role="status" className="sr-only">
            {textoDoAnuncio}
          </p>
        </>
      ) : null}
    </EnvelopeCampo>
  )
}
