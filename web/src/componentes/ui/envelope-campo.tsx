import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

/** Props comuns aos campos do design system (design-system.md §5.3). */
export interface BaseCampo {
  rotulo: string
  /** Liga aria-invalid + aria-describedby + mensagem com role="alert" */
  erro?: string
  /**
   * Dica persistente — vira `aria-describedby` do controle.
   *
   * É `ReactNode`, e não `string`, porque a dica às vezes precisa de um LINK: quando um
   * catálogo obrigatório vem vazio, o próximo passo é "Cadastrar em Cadastros › Contas",
   * e essa frase tem de ser DESCRIÇÃO do campo — não um parágrafo solto ao lado. Sem
   * isso, quem usa leitor de tela chega a um campo obrigatório sem opção e nunca ouve o
   * porquê (achado A11Y-CF-04 do gate). Mantenha curta: ela é lida junto do rótulo.
   */
  ajuda?: ReactNode
  /** Sufixo visual "(obrigatório)" — texto, não só asterisco — + required */
  obrigatorio?: boolean
}

/**
 * "Existe ajuda?" — UMA definição.
 *
 * Desde que `ajuda` virou `ReactNode`, `undefined` deixou de ser o único jeito de dizer
 * "sem ajuda": `null` e `false` são os idiomas naturais de um ternário em JSX. Havia DUAS
 * decisões sobre isso no design system (o `EnvelopeCampo` e o render próprio do
 * `CampoCheckbox`) e só uma aprendeu a resposta nova — o checkbox renderizava um
 * parágrafo VAZIO com o id da ajuda (achado I4 do gate). Um predicado, três usos.
 */
export function temAjuda(ajuda: ReactNode): boolean {
  // `''` entra na lista porque o React não renderiza nada para string vazia — e o
  // parágrafo sairia VAZIO com o id apontado pelo `aria-describedby`, que é o mesmo
  // defeito que este predicado nasceu para matar.
  return ajuda !== undefined && ajuda !== null && ajuda !== false && ajuda !== ''
}

/**
 * Monta o valor de aria-describedby do controle a partir de ajuda/erro.
 * @param id - id base do controle
 * @returns String para aria-describedby, ou undefined se não houver descrição
 */
export function descreverCampo(id: string, { ajuda, erro }: Pick<BaseCampo, 'ajuda' | 'erro'>): string | undefined {
  const ids = [temAjuda(ajuda) ? `${id}-ajuda` : null, erro !== undefined ? `${id}-erro` : null]
    .filter((valor): valor is string => valor !== null)
    .join(' ')
  return ids === '' ? undefined : ids
}

interface EnvelopeCampoProps extends BaseCampo {
  /** id do controle (liga o <label htmlFor>) */
  id: string
  /**
   * Continuação do rótulo SÓ para leitor de tela (`sr-only`, dentro do `<label>`): quando o
   * rótulo visível é um NOME ("Aluguel") e o nome acessível precisa dizer o que o campo é
   * ("Aluguel: linha do DRE"). O texto visível continua no começo do nome (2.5.3).
   */
  complementoDoRotulo?: string
  /** O controle em si (input/select) */
  children: ReactNode
  /**
   * Uma ação NA LINHA do controle (o "Salvar" das configurações): o rótulo fica acima da linha e a
   * ajuda e o erro abaixo dela, então o botão acompanha o CAMPO — nunca o rótulo de duas linhas nem a
   * ajuda (gate r3 de inicio-dos-indicadores: alinhar por fora do envelope desalinhava 11 linhas).
   */
  acaoAoLado?: ReactNode
  /**
   * Uma peça NA LINHA do controle, ANTES dele: o país do telefone (change telefone-estrangeiro). O
   * rótulo fica acima da linha inteira, e a ajuda e o erro abaixo dela, na largura inteira — o aviso
   * do telefone fala do número com o país. Só o que o próprio controle desenha embaixo dele (o
   * contador do teto) fica na coluna do controle. Sem ela, a anatomia é a de sempre.
   */
  antesDoControle?: ReactNode
  className?: string
}

/**
 * Anatomia comum dos campos, em ordem fixa: rótulo → controle (com a `antesDoControle` e a `acaoAoLado`,
 * se houver) → ajuda → erro.
 * A borda de erro nunca é o único sinal (1.4.1): a mensagem tem ícone + texto.
 */
export function EnvelopeCampo({
  id,
  rotulo,
  complementoDoRotulo,
  erro,
  ajuda,
  obrigatorio = false,
  children,
  acaoAoLado,
  antesDoControle,
  className,
}: EnvelopeCampoProps) {
  const controle =
    antesDoControle === undefined || antesDoControle === null ? (
      children
    ) : (
      <div className="flex items-start gap-2">
        {antesDoControle}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    )

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-rotulo font-medium text-texto">
        {rotulo}
        {complementoDoRotulo === undefined ? null : <span className="sr-only">{complementoDoRotulo}</span>}
        {obrigatorio ? <span className="text-texto-suave"> (obrigatório)</span> : null}
      </label>
      {acaoAoLado === undefined || acaoAoLado === null ? (
        controle
      ) : (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">{controle}</div>
          {acaoAoLado}
        </div>
      )}
      {temAjuda(ajuda) ? (
        <p id={`${id}-ajuda`} className="text-meta text-texto-suave">
          {ajuda}
        </p>
      ) : null}
      {erro !== undefined ? (
        <p id={`${id}-erro`} role="alert" className="flex items-center gap-1 text-meta text-perigo-texto">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {erro}
        </p>
      ) : null}
    </div>
  )
}
