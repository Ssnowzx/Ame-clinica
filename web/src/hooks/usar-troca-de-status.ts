import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { usarToast } from '@/componentes/ui/toast'
import { usarMutacaoDeAgendamento } from '@/hooks/usar-mutacao-de-agendamento'
import { chaves } from '@/lib/chaves-query'
import { ErroDeApi } from '@/lib/http'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { buscarAgendamento, buscarSelecaoDaAgenda } from '@/servicos/agenda'
import type { RespostaDaTrocaDeStatus } from '@/lib/card-agendamento'
import type { CardAgendamento, DetalheDoAgendamento, SelecaoDaAgenda } from '@/tipos'

export type StatusDaSelecao = SelecaoDaAgenda['status'][number]

/** Uma troca pedida: o status-alvo e de onde ela veio. */
interface EscolhaDeStatus {
  alvo: StatusDaSelecao
  /**
   * A FAMÍLIA pediu o desmarque pelo botão do lembrete (change lembrete-com-botoes-de-resposta).
   * Nunca manda o aviso de "a clínica cancelou": seria dizer à família o contrário do que ela fez.
   */
  daFamilia: boolean
  /**
   * Chamado quando o servidor aceitou a troca, com o que ele DEVOLVEU (os escalares), o status
   * escolhido e se ela passou pelo DIÁLOGO de confirmação — quem mostra uma foto do cartão (o painel)
   * a atualiza com `cartaoDepoisDaTroca`, e quem cuida do foco precisa saber se ainda há um diálogo
   * fechando depois dela (ele devolve o foco por último).
   */
  aoConcluir?: (resposta: RespostaDaTrocaDeStatus, alvo: StatusDaSelecao, peloDialogo: boolean) => void
}

/**
 * A troca de status pelo cartão — o fluxo do dia (confirmar → aguardando → finalizar), sem abrir o
 * formulário. Saiu de dentro do `MenuDeStatus` para o "Desmarcar (a família pediu)" do painel usar
 * o MESMO caminho de escrita (change lembrete-com-botoes-de-resposta): duas cópias da troca seriam
 * duas regras de confirmação que um dia divergem.
 *
 * Duas regras do parecer:
 * - **Leitura FRESCA antes de enviar** (T-aes-06): o `PUT` exige `inicio` e `profissional_id`.
 *   Reenviar os do cache **desfaria em silêncio** o reagendamento que outra pessoa acabou de fazer.
 * - **Confirma quando a FLAG manda** (§2/D11): status que desconta sessão mexe no saldo do
 *   tratamento — e o estorno também, na direção oposta. Flag desconhecida ⇒ confirma (fail-safe:
 *   nunca assume "não desconta").
 */
function useTrocaDeStatus(card: CardAgendamento, podeEditar: boolean) {
  const [confirmando, setConfirmando] = useState<EscolhaDeStatus | null>(null)
  // o desmarque pela clínica pergunta ANTES, com a caixa já marcada (SEC-AV-02): um clique
  // errado no status não pode, sozinho, mandar "cancelado" à família
  const [avisarFamilia, setAvisarFamilia] = useState(true)
  const { atualizar, gravando } = usarMutacaoDeAgendamento()
  const { notificar } = usarToast()

  const selecao = useQuery({
    queryKey: chaves.selecaoDaAgenda(),
    queryFn: buscarSelecaoDaAgenda,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: podeEditar,
  })

  const statusDaClinica = selecao.data?.status ?? []
  const statusAtualNaSelecao = statusDaClinica.find((item) => item.id === card.status_id)

  /** Mexe no saldo do tratamento? Vale nos dois sentidos (consumo e estorno). */
  function mexeNoSaldo(alvo: StatusDaSelecao): boolean {
    const saindoDeDescontante = statusAtualNaSelecao?.desconta_sessao ?? true // fail-safe
    return alvo.desconta_sessao || saindoDeDescontante
  }

  /**
   * O status escolhido é o desmarque da clínica, num agendamento de criança que ESTÁ marcado: a
   * família pode ser avisada. Escolher o mesmo status de novo, ou partir de uma sessão já desmarcada
   * pela família, não é cancelamento pela clínica (CR3-02/SEC-AV-16) — o servidor recusaria, e a
   * caixa marcada prometeria um aviso que não sai. Status atual desconhecido: o servidor decide.
   */
  function avisaAFamilia({ alvo, daFamilia }: EscolhaDeStatus): boolean {
    return (
      !daFamilia &&
      alvo.desmarque_da_clinica === true &&
      alvo.id !== card.status_id &&
      statusAtualNaSelecao?.sessao_marcada !== false &&
      card.tipo !== 'bloqueio' &&
      card.paciente !== null
    )
  }

  async function trocar(escolha: EscolhaDeStatus, peloDialogo = true): Promise<void> {
    // O card em mãos pode estar velho: relê antes de mandar o PUT, que exige
    // `inicio`/`profissional_id` — senão desfaz o reagendamento de outra pessoa
    let fresco: DetalheDoAgendamento
    try {
      fresco = await buscarAgendamento(card.id)
    } catch (erro) {
      // a leitura pode falhar (rede, ou outra pessoa excluiu o agendamento):
      // sem isto a rejeição sumiria e o usuário ficaria sem resposta (I-04)
      notificar({
        tom: 'erro',
        titulo:
          erro instanceof ErroDeApi ? erro.message : 'Não foi possível ler o agendamento. Tente novamente.',
      })
      throw erro
    }

    // Produção em período fechado (SEC-TS): a leitura FRESCA que este fluxo já faz é a
    // porta — o gesto explica e NADA é enviado (o servidor recusaria com 422
    // `ciclo_fechado`; se a corrida com um fechamento concorrente passar por aqui, a
    // recusa dele continua sendo dita pelo onError abaixo).
    if (fresco.em_ciclo_fechado === true) {
      notificar({
        tom: 'erro',
        titulo: 'A produção deste período já foi fechada; a reabertura é do administrador.',
      })
      throw new Error('ciclo_fechado')
    }

    // A promessa REJEITA na recusa: sem isso o dialog fecharia sozinho e a
    // recusa do servidor sumiria da tela (SEC-A1)
    return new Promise<void>((resolver, rejeitar) => {
      atualizar.mutate(
        {
          id: card.id,
          // token da leitura FRESCA que este fluxo já faz (SEC-OCC/C8) — nunca do card em cache
          versao: fresco.updated_at,
          payload: {
            inicio: fresco.inicio,
            profissional_id: fresco.profissional_id,
            status_id: escolha.alvo.id,
            ...(avisaAFamilia(escolha) && avisarFamilia ? { avisar_familia: true } : {}),
          },
        },
        {
          onSuccess: (resposta) => {
            setConfirmando(null)
            escolha.aoConcluir?.(resposta, escolha.alvo, peloDialogo)
            resolver()
          },
          onError: () => {
            rejeitar(new Error('recusado'))
          },
        },
      )
    })
  }

  /**
   * Pede a troca: confirma antes quando mexe no saldo ou pode avisar a família; senão, grava direto.
   * A recusa já foi anunciada por toast (o hook de mutação); o caminho sem diálogo só evita a
   * rejeição solta.
   */
  function escolher(alvo: StatusDaSelecao, opcoes: Omit<EscolhaDeStatus, 'alvo'> = { daFamilia: false }): void {
    const escolha: EscolhaDeStatus = { alvo, ...opcoes }
    if ((card.tratamento_id !== null && mexeNoSaldo(alvo)) || avisaAFamilia(escolha)) {
      setAvisarFamilia(true)
      setConfirmando(escolha)
      return
    }
    void trocar(escolha, false).catch(() => undefined)
  }

  const consequencia = (() => {
    if (confirmando === null) {
      return ''
    }
    const alvo = confirmando.alvo
    // sem pacote em jogo, só o aviso à família abre este dialog — e liberar ou não o horário é do
    // status configurado (`ocupa_horario`), que a tela não recebe: não afirmar o que não sabe
    if (card.tratamento_id === null || !mexeNoSaldo(alvo)) {
      return 'Confira abaixo se a família deve ser avisada.'
    }
    const saldo = card.tratamento_saldo

    if (alvo.desconta_sessao) {
      if (saldo === null) {
        return 'A sessão será descontada do tratamento.'
      }
      // não prometer aritmética impossível: com saldo zerado o servidor RECUSA
      // (SEC-A3) — dizer "0 → -1" seria mentir duas vezes
      if (saldo <= 0) {
        return 'O tratamento está sem saldo de sessões: o servidor pode recusar esta mudança.'
      }
      return `A sessão será descontada do tratamento (saldo: ${saldo} → ${saldo - 1}).`
    }

    return saldo !== null
      ? `A sessão volta para o tratamento (saldo: ${saldo} → ${saldo + 1}).`
      : 'A sessão volta para o tratamento.'
  })()

  return {
    selecao,
    statusDaClinica,
    confirmando,
    cancelarConfirmacao: () => {
      setConfirmando(null)
    },
    avisarFamilia,
    setAvisarFamilia,
    avisaAFamilia,
    escolher,
    trocar,
    consequencia,
    gravando,
  }
}

export type TrocaDeStatus = ReturnType<typeof useTrocaDeStatus>

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração (mesmo padrão do `usarToast`)
export { useTrocaDeStatus as usarTrocaDeStatus }
