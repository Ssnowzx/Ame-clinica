import { DropdownMenu } from 'radix-ui'
import { useRef } from 'react'

import { DialogoDaTrocaDeStatus } from '@/componentes/agenda/dialogo-troca-de-status'
import { ChipStatus } from '@/componentes/ui/chip-status'
import { usarTrocaDeStatus, type StatusDaSelecao } from '@/hooks/usar-troca-de-status'
import { nomeCurtoDoAgendamento, type RespostaDaTrocaDeStatus } from '@/lib/card-agendamento'
import type { CardAgendamento } from '@/tipos'

interface MenuDeStatusProps {
  card: CardAgendamento
  /** O usuário pode editar? Sem isso, o chip continua sendo só texto */
  podeEditar: boolean
  /**
   * Menu CONTROLADO por fora — só o painel usa: o "Desmarcar (a família pediu)" sem status
   * configurado abre este menu (change lembrete-com-botoes-de-resposta). Ausente, o Radix controla.
   */
  menuAberto?: boolean
  aoMudarMenuAberto?: (aberto: boolean) => void
  /**
   * A troca foi aceita — o painel atualiza a FOTO do cartão, e o chip deixa de mostrar o status
   * antigo (achado A11Y-BT-04 do gate).
   */
  aoConcluirTroca?: (resposta: RespostaDaTrocaDeStatus, alvo: StatusDaSelecao, peloDialogo: boolean) => void
  /**
   * Para onde o foco volta quando o menu fecha. Só o painel usa: o menu aberto POR FORA (o
   * "Desmarcar (a família pediu)" sem status configurado) devolve o foco a quem o abriu, e não ao
   * chip (achado A11Y-BT-14). `null` mantém o padrão do Radix (o chip).
   */
  focoAoFecharMenu?: () => HTMLElement | null
  /**
   * Destino do foco com PRIORIDADE quando o diálogo da troca fecha — só o painel usa: a troca que
   * resolveu o pedido da família tira da tela quem a começou, e o foco tem de terminar na linha que
   * diz o que aconteceu (achado A11Y-BT-19). `null` segue a ordem normal: origem externa, chip.
   */
  focoAoFecharDialogo?: () => HTMLElement | null
}

/**
 * Troca de status pelo card — o fluxo do dia (confirmar → aguardando → finalizar), sem abrir o
 * formulário. A regra da troca (leitura fresca, confirmação quando mexe no saldo, aviso à família)
 * mora em `usarTrocaDeStatus`, que o painel também usa; aqui ficam o chip e o menu.
 */
export function MenuDeStatus({
  card,
  podeEditar,
  menuAberto,
  aoMudarMenuAberto,
  aoConcluirTroca,
  focoAoFecharMenu,
  focoAoFecharDialogo,
}: MenuDeStatusProps) {
  const troca = usarTrocaDeStatus(card, podeEditar)
  const refChip = useRef<HTMLButtonElement>(null)
  // quem abriu o menu POR FORA, guardado quando ele fecha: é para lá que o diálogo da troca devolve o
  // foco se a pessoa desistir dele (A11Y-BT-16)
  const refOrigemExterna = useRef<HTMLElement | null>(null)

  const statusAtual = card.status

  if (!podeEditar || statusAtual === null) {
    return statusAtual !== null ? (
      <ChipStatus
        nome={statusAtual.nome}
        cor={statusAtual.cor}
        corBorda={statusAtual.cor_borda}
        tipo={statusAtual.tipo}
        tamanho="sm"
      />
    ) : null
  }

  return (
    <>
      <DropdownMenu.Root open={menuAberto} onOpenChange={aoMudarMenuAberto}>
        {/* asChild direto no chip: com um <span> no meio, o aria-haspopup e o
            aria-expanded iam parar no span não-focável, e o botão que recebe o
            foco não anunciava que abre menu (I-06) */}
        <DropdownMenu.Trigger asChild>
          <ChipStatus
            ref={refChip}
            nome={statusAtual.nome}
            cor={statusAtual.cor}
            corBorda={statusAtual.cor_borda}
            tipo={statusAtual.tipo}
            tamanho="sm"
            aoAcionar={() => undefined}
            // o nome acessível CONTÉM o rótulo visível (2.5.3 Label in Name):
            // "clicar em Em Aberto" por voz precisa encontrar este alvo
            rotuloDaAcao={`${statusAtual.nome} — mudar status de ${nomeCurtoDoAgendamento(card)}`}
          />
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            onCloseAutoFocus={(evento) => {
              const alvo = focoAoFecharMenu?.() ?? null
              refOrigemExterna.current = alvo
              if (alvo !== null) {
                evento.preventDefault()
                alvo.focus()
              }
            }}
            className="z-(--z-menu) min-w-48 rounded-campo border border-linha-forte bg-superficie-elevada p-1 shadow-e2"
          >
            {troca.statusDaClinica.map((status) => (
              <DropdownMenu.Item
                key={status.id}
                onSelect={() => {
                  troca.escolher(status, { daFamilia: false, aoConcluir: aoConcluirTroca })
                }}
                className="flex cursor-pointer items-center gap-2 rounded-controle px-2 py-1.5 text-corpo text-texto outline-none data-[highlighted]:bg-acento-suave data-[highlighted]:text-acento"
              >
                <ChipStatus
                  nome={status.nome}
                  cor={status.cor}
                  corBorda={status.cor_borda}
                  tipo={status.tipo}
                  tamanho="sm"
                />
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/*
        O diálogo abre a partir de um ITEM do menu, que o Radix tira do DOM ao fechar o menu — e o
        `DialogConfirmacao` devolveria o foco a esse nó morto, isto é, ao `body` (achado A11Y-BT-16,
        anterior a esta change). O destino é dito aqui, em ordem de prioridade: o de quem monta o
        menu (o painel, quando a troca resolveu o pedido da família — A11Y-BT-19); quem abriu o menu
        por fora, se ainda estiver na tela; senão, o chip. O Radix aplica este foco num
        `setTimeout(0)` DEPOIS dos efeitos da troca, então ele é o ÚLTIMO a falar — e por isso a
        prioridade tem de estar aqui, e não num efeito de quem monta.
      */}
      <DialogoDaTrocaDeStatus
        card={card}
        troca={troca}
        focoAoFechar={() => {
          const prioritario = focoAoFecharDialogo?.() ?? null
          if (prioritario !== null) {
            return prioritario
          }
          const origem = refOrigemExterna.current
          return origem !== null && origem.isConnected ? origem : refChip.current
        }}
      />
    </>
  )
}
