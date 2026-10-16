import type { CardAgendamento, ConfirmacaoDoCard, EstadoDaConfirmacao } from '@/tipos'

/**
 * A resposta da família ao lembrete, em PALAVRAS (change lembrete-com-botoes-de-resposta).
 *
 * O estado vem decidido do servidor (design D8); aqui mora só o que a tela diz sobre ele. Uma fonte
 * para o ícone do cartão, a faixa do topo e o que o leitor de tela lê: se cada um escrevesse a sua
 * frase, o cartão e a faixa acabariam chamando o mesmo estado por nomes diferentes.
 */

/** A ORDEM da faixa: do que já está resolvido ao que pede alguém ligar para a família. */
export const ESTADOS_DA_CONFIRMACAO: readonly EstadoDaConfirmacao[] = [
  'confirmado',
  'aguardando',
  'pediu_desmarque',
  'nao_entregue',
  // por último: não houve lembrete a responder — a recepção corrige o cadastro e liga
  'nao_enviado',
]

export type ContagemDasConfirmacoes = Record<EstadoDaConfirmacao, number>

/**
 * "HH:MM" do toque, no relógio do NAVEGADOR, de propósito: quem abre a agenda está na clínica, no
 * mesmo fuso dela, e é assim que a conversa do WhatsApp já mostra a hora da mesma mensagem. `em` é
 * um INSTANTE (ISO com fuso), não a parede da clínica — por isso não passa por `dataHoraLegivel`.
 * Instante ilegível devolve `null`, e a frase segue sem hora em vez de dizer "às Invalid Date".
 */
function horaDoToque(em: string | null): string | null {
  if (em === null) {
    return null
  }
  const instante = new Date(em)
  if (Number.isNaN(instante.getTime())) {
    return null
  }

  return instante.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** O estado em palavras — é o nome acessível do ícone e o texto ao passar o mouse. */
export function descreverConfirmacao(confirmacao: ConfirmacaoDoCard): string {
  switch (confirmacao.estado) {
    case 'aguardando':
      return 'Lembrete enviado, sem resposta da família'
    case 'confirmado': {
      // sem `por` (a resposta de antes da change confirmacao-pela-clinica, ainda em cache), quem
      // confirmou foi a família — era o único jeito de confirmar
      const quem = confirmacao.por === 'clinica' ? 'pela clínica' : 'pela família'
      const hora = horaDoToque(confirmacao.em)
      return hora === null ? `Confirmado ${quem}` : `Confirmado ${quem} às ${hora}`
    }
    case 'pediu_desmarque':
      return 'A família pediu para desmarcar'
    case 'nao_entregue':
      return 'Lembrete não entregue — ligue para a família'
    case 'nao_enviado':
      return confirmacao.motivo === undefined || confirmacao.motivo === ''
        ? 'Lembrete não enviado'
        : `Lembrete não enviado: ${confirmacao.motivo}`
  }
}

/** Quantos cartões em cada estado. Cartão sem lembrete (`null`/ausente) não entra em nenhum. */
export function contarConfirmacoes(cards: readonly CardAgendamento[]): ContagemDasConfirmacoes {
  const contagem: ContagemDasConfirmacoes = {
    confirmado: 0,
    aguardando: 0,
    pediu_desmarque: 0,
    nao_entregue: 0,
    nao_enviado: 0,
  }
  for (const card of cards) {
    const estado = card.confirmacao?.estado
    if (estado !== undefined) {
      contagem[estado] += 1
    }
  }

  return contagem
}

/** O número da faixa com a palavra que concorda com ele: "1 confirmado", "2 pediram para desmarcar". */
export function rotuloDaContagem(estado: EstadoDaConfirmacao, quantidade: number): string {
  const um = quantidade === 1
  switch (estado) {
    case 'confirmado':
      return `${quantidade} ${um ? 'confirmado' : 'confirmados'}`
    case 'aguardando':
      return `${quantidade} sem resposta`
    case 'pediu_desmarque':
      return `${quantidade} ${um ? 'pediu' : 'pediram'} para desmarcar`
    case 'nao_entregue':
      return `${quantidade} ${um ? 'não entregue' : 'não entregues'}`
    case 'nao_enviado':
      return `${quantidade} sem lembrete`
  }
}

/**
 * O que o destaque da faixa faz, em palavras — anunciado com educação (`role="status"`) quando a
 * pessoa toca num número: o botão diz que ficou pressionado, mas não diz QUANTAS sessões a grade
 * passou a mostrar em destaque (achado A11Y-BT-07 do gate).
 */
export function fraseDoDestaque(estado: EstadoDaConfirmacao, quantidade: number): string {
  const sessoes = quantidade === 1 ? '1 sessão' : `${quantidade} sessões`
  switch (estado) {
    case 'confirmado':
      return `Destacando ${sessoes} ${quantidade === 1 ? 'confirmada' : 'confirmadas'}`
    case 'aguardando':
      return `Destacando ${sessoes} sem resposta`
    case 'pediu_desmarque':
      return `Destacando ${sessoes} com pedido de desmarque`
    case 'nao_entregue':
      return `Destacando ${sessoes} com lembrete não entregue`
    case 'nao_enviado':
      return `Destacando ${sessoes} sem lembrete`
  }
}
