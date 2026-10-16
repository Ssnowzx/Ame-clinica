import { Botao } from '@/componentes/ui/botao'
import { Dialog } from '@/componentes/ui/dialog'
import { ListaDescricao, type ItemDescricao } from '@/componentes/ui/lista-descricao'
import { dataHoraLegivel } from '@/lib/datas'
import { useAuthStore } from '@/stores/auth-store'
import type { CardAgendamento } from '@/tipos'

interface PainelBloqueioProps {
  aberto: boolean
  card: CardAgendamento | null
  aoFechar: () => void
  aoEditar: (card: CardAgendamento) => void
}

/**
 * Card de LEITURA do BLOQUEIO (change detalhe-do-agendamento) — enxuto: sem
 * paciente, sem status clínico, sem contador, sem seção de atendimento. Rótulo,
 * quando, profissional e sala; a ação primária é Editar (com `agenda.editar`).
 *
 * A recorrência é INFORMAÇÃO de leitura, não toggle — mas o dado "faz parte de
 * série" ainda não é exposto para bloqueio, então o slot NÃO renderiza (nunca
 * uma pílula vazia — Decisão 6).
 */
export function PainelBloqueio({ aberto, card, aoFechar, aoEditar }: PainelBloqueioProps) {
  const podeEditar = useAuthStore((estado) => estado.temPermissao('agenda.editar'))

  if (card === null) {
    return null
  }

  const rotulo = card.obs ?? 'Bloqueio'
  const detalhes: ItemDescricao[] = [
    { rotulo: 'Quando', valor: `${dataHoraLegivel(card.inicio)} · ${card.duracao_minutos} min` },
    ...(card.profissional !== null ? [{ rotulo: 'Profissional', valor: card.profissional.nome }] : []),
    ...(card.sala !== null ? [{ rotulo: 'Sala', valor: card.sala.nome }] : []),
  ]

  return (
    <Dialog
      aberto={aberto}
      aoMudarAberto={(estaAberto) => {
        if (!estaAberto) {
          aoFechar()
        }
      }}
      titulo="Detalhes do bloqueio"
      rodape={
        podeEditar ? (
          <div className="flex justify-end">
            <Botao
              onClick={() => {
                aoEditar(card)
              }}
            >
              Editar
            </Botao>
          </div>
        ) : undefined
      }
    >
      <p className="text-subtitulo font-semibold text-texto">{rotulo}</p>
      <ListaDescricao itens={detalhes} className="mt-4" />
    </Dialog>
  )
}
