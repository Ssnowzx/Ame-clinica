import { Archive, ArchiveRestore, ArrowLeft, BellOff, Check, EllipsisVertical, Link2 } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useRef, type RefObject } from 'react'
import { Link } from 'react-router-dom'

import { Botao } from '@/componentes/ui/botao'
import { cn } from '@/lib/cn'
import type { Conversa } from '@/tipos'

/**
 * O item do "Mais ações": 44 px de altura porque este menu só existe abaixo de `lg`, onde quem
 * toca é um dedo (o padrão dos menus da agenda, de 33 px, foi medido para o mouse).
 */
const ITEM_DO_MENU =
  'flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-controle px-2 text-corpo text-texto outline-none data-[highlighted]:bg-acento-suave data-[highlighted]:text-acento data-[disabled]:cursor-not-allowed data-[disabled]:text-texto-desativado'

/**
 * A volta para a lista, no celular (master-detail abaixo de `lg`): sem ela, a lista fica
 * inalcançável. Só ícone — a seta é convenção de todo aplicativo de conversa —, com o nome
 * dito ao leitor de tela e alvo de 44 px.
 */
export function BotaoVoltarParaConversas({
  aoVoltar,
  className,
  refDoBotao,
}: {
  aoVoltar: () => void
  className?: string
  /** Para o foco chegar aqui quando a conversa não carrega — é a única saída da tela. */
  refDoBotao?: RefObject<HTMLButtonElement | null>
}) {
  return (
    <Botao
      ref={refDoBotao}
      variante="fantasma"
      aria-label="Voltar para as conversas"
      onClick={aoVoltar}
      className={cn('size-11 shrink-0 px-0 lg:hidden', className)}
    >
      <ArrowLeft className="size-5" aria-hidden />
    </Botao>
  )
}

interface AcoesDaConversa {
  conversa: Conversa
  silenciando: boolean
  arquivando: boolean
  aoSilenciar: (silenciar: boolean) => void
  aoArquivar: (arquivar: boolean) => void
  /** `origem` é para onde o foco volta quando o diálogo de vínculo fechar (`null` = o padrão). */
  aoVincular: (origem: HTMLElement | null) => void
}

/**
 * As ações raras da conversa num menu, no celular (change conversa-legivel, D2).
 *
 * Silenciar é `CheckboxItem`: o leitor de tela ouve "Silenciar lembretes, marcado" — o mesmo
 * contrato do `aria-pressed` do botão de tela larga, sem inverter o nome conforme o estado.
 */
function MaisAcoesDaConversa({
  conversa,
  silenciando,
  arquivando,
  aoSilenciar,
  aoArquivar,
  aoVincular,
}: AcoesDaConversa) {
  const gatilho = useRef<HTMLButtonElement>(null)

  return (
    // NÃO modal (A11Y-CL-01): o modal marca o resto da página `aria-hidden` enquanto o menu está
    // aberto, e o axe acusava o foco dentro de conteúdo escondido. Esc, setas e a devolução do
    // foco ao gatilho continuam iguais — o que sai é só a trava do resto da tela
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Botao ref={gatilho} variante="fantasma" aria-label="Mais ações" className="size-11 shrink-0 px-0 lg:hidden">
          <EllipsisVertical className="size-5" aria-hidden />
        </Botao>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          className="z-(--z-menu) min-w-56 rounded-campo border border-linha-forte bg-superficie-elevada p-1 shadow-e2"
        >
          <DropdownMenu.CheckboxItem
            className={ITEM_DO_MENU}
            checked={conversa.sem_lembretes}
            disabled={silenciando}
            onCheckedChange={(marcado) => aoSilenciar(marcado === true)}
          >
            <BellOff className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">Silenciar lembretes</span>
            <DropdownMenu.ItemIndicator>
              <Check className="size-4" aria-hidden />
            </DropdownMenu.ItemIndicator>
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.Item
            className={ITEM_DO_MENU}
            disabled={arquivando}
            onSelect={() => aoArquivar(!conversa.arquivada)}
          >
            {conversa.arquivada ? (
              <>
                <ArchiveRestore className="size-4 shrink-0" aria-hidden /> Desarquivar
              </>
            ) : (
              <>
                <Archive className="size-4 shrink-0" aria-hidden /> Arquivar
              </>
            )}
          </DropdownMenu.Item>
          {conversa.paciente === null && (
            // o item some da árvore quando o menu fecha: o diálogo precisa saber que o foco
            // volta ao GATILHO, e não ao item morto (que o jogaria no `<body>`)
            <DropdownMenu.Item className={ITEM_DO_MENU} onSelect={() => aoVincular(gatilho.current)}>
              <Link2 className="size-4 shrink-0" aria-hidden /> Vincular paciente
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** As mesmas ações, em botões à vista — em tela larga há espaço para elas. */
function AcoesVisiveis({
  conversa,
  silenciando,
  arquivando,
  aoSilenciar,
  aoArquivar,
  aoVincular,
}: AcoesDaConversa) {
  return (
    <div className="flex flex-wrap gap-2 max-lg:hidden">
      {/*
        Rótulo FIXO com `aria-pressed`: antes o nome descrevia a ação
        ("Voltar a lembrar") e o estado dizia o oposto ("pressionado"), e o
        leitor de tela anunciava a contradição inteira.
      */}
      <Botao
        variante="fantasma"
        tamanho="sm"
        carregando={silenciando}
        onClick={() => aoSilenciar(!conversa.sem_lembretes)}
        aria-pressed={conversa.sem_lembretes}
      >
        <BellOff className="size-4" aria-hidden />
        Silenciar lembretes
      </Botao>
      <Botao variante="fantasma" tamanho="sm" carregando={arquivando} onClick={() => aoArquivar(!conversa.arquivada)}>
        {conversa.arquivada ? (
          <>
            <ArchiveRestore className="size-4" aria-hidden /> Desarquivar
          </>
        ) : (
          <>
            <Archive className="size-4" aria-hidden /> Arquivar
          </>
        )}
      </Botao>
      {conversa.paciente === null && (
        <Botao variante="fantasma" tamanho="sm" onClick={() => aoVincular(null)}>
          <Link2 className="size-4" aria-hidden /> Vincular paciente
        </Botao>
      )}
    </div>
  )
}

/**
 * O cabeçalho da conversa aberta (change conversa-legivel, D2).
 *
 * Em tela larga é o de sempre: nome, ficha e as três ações à vista. Abaixo de `lg` ele cabe em
 * UMA linha — voltar, o nome truncado com a ficha embaixo, e "Mais ações" —, porque os botões
 * empilhados comiam 150 px de um celular em que sobravam 98 px para as mensagens.
 *
 * As classes de tela estreita são todas `max-lg:`: a base é a de antes, e `lg`+ não muda.
 */
export function CabecalhoDaConversa({
  podeAgir,
  aoVoltar,
  refDoTitulo,
  refDaFicha,
  ...acoes
}: AcoesDaConversa & {
  /** Quem só lê não vê ação nenhuma — nem os botões, nem o menu. */
  podeAgir: boolean
  aoVoltar: () => void
  /**
   * O título como ÂNCORA DE FOCO (2.4.3): abrir uma conversa pela lista, abaixo de `lg`, some com
   * o item clicado — e o foco iria para o `<body>`. Focável por programa, fora da ordem de Tab.
   */
  refDoTitulo?: RefObject<HTMLHeadingElement | null>
  /** O link da ficha — para onde o foco vai depois de vincular (o botão Vincular some). */
  refDaFicha?: RefObject<HTMLAnchorElement | null>
}) {
  const { conversa } = acoes

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-linha bg-superficie px-4 py-3 max-lg:flex-nowrap max-lg:justify-start max-lg:gap-1 max-lg:px-1 max-lg:py-1">
      <BotaoVoltarParaConversas aoVoltar={aoVoltar} />
      <div className="max-lg:min-w-0 max-lg:flex-1">
        {/* cabeçalho de verdade: navegar por títulos na thread só encontrava o h1 */}
        <h2
          ref={refDoTitulo}
          tabIndex={-1}
          className="text-subtitulo font-semibold text-texto max-lg:truncate max-lg:text-corpo-lg"
        >
          {conversa.paciente?.nome ?? conversa.nome_perfil ?? conversa.telefone}
        </h2>
        {conversa.paciente === null ? (
          <p className="text-meta text-texto-suave max-lg:truncate">
            <span className="lg:hidden">Sem paciente vinculado</span>
            <span className="max-lg:hidden">
              Conversa sem paciente vinculado — vincule para achar o histórico depois.
            </span>
          </p>
        ) : (
          // `block` no celular: inline, o link herdava a linha de 24 px do bloco e o cabeçalho
          // passava dos 44 px do alvo de toque
          <Link
            ref={refDaFicha}
            to={`/pacientes/${conversa.paciente.id}`}
            className="text-meta text-texto-suave underline underline-offset-2 max-lg:block max-lg:w-fit max-lg:max-w-full max-lg:truncate"
          >
            Abrir a ficha do paciente
          </Link>
        )}
      </div>

      {podeAgir && (
        <>
          <AcoesVisiveis {...acoes} />
          <MaisAcoesDaConversa {...acoes} />
        </>
      )}
    </header>
  )
}
