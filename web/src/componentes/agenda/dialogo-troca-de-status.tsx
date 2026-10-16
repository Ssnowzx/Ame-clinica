import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import type { TrocaDeStatus } from '@/hooks/usar-troca-de-status'
import { nomeCurtoDoAgendamento } from '@/lib/card-agendamento'
import type { CardAgendamento } from '@/tipos'

/**
 * A confirmação da troca de status (saldo do pacote e aviso à família) — a MESMA para o chip do
 * cartão e para o "Desmarcar (a família pediu)" do painel. Mora num módulo próprio porque os dois
 * a usam, e o chip é substituído por dublê nos testes de desempenho da grade.
 */
export function DialogoDaTrocaDeStatus({
  card,
  troca,
  focoAoFechar,
}: {
  card: CardAgendamento
  troca: TrocaDeStatus
  /** Destino do foco quando a troca APAGA o gatilho (o pedido da família resolvido no painel). */
  focoAoFechar?: () => HTMLElement | null
}) {
  const escolha = troca.confirmando

  return (
    <DialogConfirmacao
      aberto={escolha !== null}
      aoMudarAberto={(aberto) => {
        if (!aberto) {
          troca.cancelarConfirmacao()
        }
      }}
      titulo={`Mudar para “${escolha?.alvo.nome ?? ''}” em ${nomeCurtoDoAgendamento(card)}?`}
      consequencia={troca.consequencia}
      rotuloConfirmar="Mudar status"
      tom="atencao"
      carregando={troca.gravando}
      focoAoFechar={focoAoFechar}
      aoConfirmar={() => {
        if (escolha !== null) {
          return troca.trocar(escolha)
        }
      }}
    >
      {escolha !== null && troca.avisaAFamilia(escolha) ? (
        <CampoCheckbox
          rotulo="Avisar a família pelo WhatsApp"
          marcado={troca.avisarFamilia}
          aoMudar={troca.setAvisarFamilia}
          ajuda="A família recebe a mensagem de cancelamento. Desmarque se foi a família que pediu para desmarcar."
        />
      ) : undefined}
    </DialogConfirmacao>
  )
}
