import { Lightbulb, TriangleAlert } from 'lucide-react'
import { Realce } from '@/componentes/ui/realce'
import { CAPTURAS } from '@/lib/manual/capturas'
import type { BlocoDoManual as Bloco } from '@/lib/manual/tipos'

/**
 * Um bloco do manual, desenhado conforme o `tipo` (change `manual-do-operador`, design D1).
 *
 * O `switch` é EXAUSTIVO: o `never` no final faz um bloco novo sem renderizador virar erro de
 * compilação, e não uma seção que some da tela em silêncio.
 */
export function BlocoDoManual({ bloco }: { bloco: Bloco }) {
  switch (bloco.tipo) {
    case 'paragrafo':
      return <p className="text-corpo-lg leading-relaxed text-texto-suave">{bloco.texto}</p>

    case 'subtitulo':
      return (
        <h3
          id={bloco.id}
          // focável (fora da ordem de Tab) só quando é endereço: o índice manda o foco para cá
          tabIndex={bloco.id === undefined ? undefined : -1}
          className="mt-2 scroll-mt-16 text-subtitulo font-semibold text-texto focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foco"
        >
          {bloco.texto}
        </h3>
      )

    case 'passos':
      return (
        // `list-decimal` com `marker:` — o número é do navegador, então leitor de tela ouve
        // "lista de 6 itens" e não um texto com dígitos colados
        <ol className="ml-5 flex list-decimal flex-col gap-2 text-corpo-lg leading-relaxed text-texto-suave marker:font-semibold marker:text-acento">
          {bloco.passos.map((passo) => (
            <li key={passo} className="pl-1">
              {passo}
            </li>
          ))}
        </ol>
      )

    case 'lista':
      return (
        <dl className="flex flex-col gap-2.5">
          {bloco.itens.map((item) => (
            <div key={item.termo} className="flex flex-col gap-0.5 border-l-2 border-linha pl-3">
              <dt className="text-corpo font-semibold text-texto">{item.termo}</dt>
              <dd className="text-corpo leading-relaxed text-texto-suave">{item.descricao}</dd>
            </div>
          ))}
        </dl>
      )

    case 'captura':
      return <Captura id={bloco.id} />

    case 'dica':
      return (
        <Realce
          tom="dica"
          rotulo="Dica"
          icone={<Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info-texto" />}
          texto={bloco.texto}
        />
      )

    case 'atencao':
      return (
        <Realce
          tom="atencao"
          rotulo="Atenção"
          icone={<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-alerta-texto" />}
          texto={bloco.texto}
        />
      )

    default: {
      // exaustividade: bloco novo sem renderizador não compila
      const naoTratado: never = bloco
      return naoTratado
    }
  }
}

/**
 * Uma captura de tela do sistema.
 *
 * `width`/`height` do manifesto: sem eles o navegador não reserva o espaço e a página PULA
 * enquanto as figuras chegam — num manual de rolagem longa, o leitor perde a linha.
 * `loading="lazy"`: as figuras abaixo da dobra só baixam quando chegam perto dela.
 */
function Captura({ id }: { id: keyof typeof CAPTURAS }) {
  const captura = CAPTURAS[id]

  return (
    <figure className="flex flex-col gap-2">
      {/* o teto é a largura NATURAL do arquivo, que vem do dado: esticar um recorte estreito
          (a barra lateral tem 250px) até a coluna inteira devolve uma figura borrada e gigante,
          mais difícil de ler que a tela de verdade */}
      <img
        src={`/capturas-do-manual/${captura.arquivo}`}
        alt={captura.alt}
        width={captura.largura}
        height={captura.altura}
        loading="lazy"
        decoding="async"
        style={{ maxWidth: captura.largura }}
        className="h-auto w-full rounded-superficie border border-linha bg-superficie shadow-e1"
      />
      <figcaption className="text-meta text-texto-suave">{captura.legenda}</figcaption>
    </figure>
  )
}
