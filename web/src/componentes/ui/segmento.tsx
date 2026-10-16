import { Botao } from '@/componentes/ui/botao'
import { cn } from '@/lib/cn'

export interface OpcaoDoSegmento<V extends string> {
  valor: V
  rotulo: string
}

export interface SegmentoProps<V extends string> {
  /** Nome acessível do grupo ("Visão da agenda", "Situação"). */
  rotulo: string
  opcoes: ReadonlyArray<OpcaoDoSegmento<V>>
  valor: V
  aoMudar: (valor: V) => void
  className?: string
}

/**
 * Controle segmentado — UMA pele para a casa inteira (gatilho `DS-SEGMENTO-UMA-PELE`).
 *
 * A opção ativa usa o papel `segmento-ativo` (no Padrão, o acento sólido; num tema de clínica, uma
 * pílula clara com contorno — change tema-da-clinica): é SELEÇÃO, não a ação primária da região, e por
 * isso não conta como o "um primário por região" do `Botao`. `aria-pressed` é o sinal para quem
 * não vê a cor; o peso (`font-semibold`) acompanha.
 */
export function Segmento<V extends string>({ rotulo, opcoes, valor, aoMudar, className }: SegmentoProps<V>) {
  return (
    <div role="group" aria-label={rotulo} className={cn('flex gap-1 rounded-trilho bg-trilho p-1', className)}>
      {opcoes.map((opcao) => (
        <Botao
          key={opcao.valor}
          variante="fantasma"
          tamanho="sm"
          aria-pressed={opcao.valor === valor}
          onClick={() => {
            aoMudar(opcao.valor)
          }}
          className={cn(
            'shrink-0 whitespace-nowrap text-texto-suave hover:text-texto',
            opcao.valor === valor
              && 'bg-segmento-ativo font-semibold text-sobre-segmento-ativo shadow-e1 ring-1 ring-inset ring-segmento-ativo-borda hover:bg-segmento-ativo-hover hover:text-sobre-segmento-ativo',
          )}
        >
          {opcao.rotulo}
        </Botao>
      ))}
    </div>
  )
}
