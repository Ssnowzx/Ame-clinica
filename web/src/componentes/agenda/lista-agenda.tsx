import {
  AvisoDeUltimasSessoes,
  HorarioDoCard,
  MetadadosDoCard,
  SinalDaConfirmacao,
  StatusEProgresso,
} from '@/componentes/agenda/conteudo-do-card'
import { DESTAQUE_NO_CARTAO } from '@/componentes/agenda/pele-da-confirmacao'
import { PELE_DO_REALCE } from '@/componentes/agenda/pele-do-realce'
import { derivarDoCard } from '@/lib/card-agendamento'
import { cn } from '@/lib/cn'
import { MarcadorEspecialidade } from '@/componentes/ui/marcador-especialidade'
import type { Grade } from '@/lib/grade-agenda'
import type { CardAgendamento as DadosDoCard, EstadoDaConfirmacao } from '@/tipos'

const ID_DA_LISTA = 'lista-da-agenda'

interface ListaAgendaProps {
  /** A MESMA grade que a tabela recebe — outro arranjo, nunca outro recorte. */
  grade: Grade
  legenda: string
  aoAbrirCard?: (card: DadosDoCard) => void
  /** O chip acionável de troca de status, quando o usuário pode editar. */
  chipDoCard?: (card: DadosDoCard) => React.ReactNode
  /** O estado que a faixa de respostas ao lembrete destaca — o mesmo contrato da grade. */
  destaque?: EstadoDaConfirmacao | null
}

/**
 * A VISÃO GERAL EM TELA ESTREITA: uma lista cronológica (change agenda-no-celular, D4).
 *
 * A Visão Geral é a que a recepcionista abre no celular — todos os profissionais, o dia de
 * hoje — e é a que em colunas é impossível: cada profissional ocupa 192px, e com vinte deles a
 * grade tem quase quatro mil pixels de largura. A Dia (um profissional, uma coluna) e a Semana
 * (que degrada) não passam por aqui.
 *
 * **Recebe a MESMA `Grade` que a tabela.** É o que garante que a lista e a grade não possam
 * divergir de recorte: o eixo de horários (janelas e granularidade da clínica), quais cards
 * entram e onde eles começam já vêm decididos. O que muda aqui é só como se desenha.
 *
 * O profissional vira RÓTULO dentro do item, porque na lista não há coluna que o diga — é a
 * informação que a grade dá pelo cabeçalho e que aqui se perderia em silêncio.
 *
 * Arrastar para remarcar NÃO existe aqui, por decisão declarada: é gesto de mouse, e a versão
 * por toque tem risco próprio (arrastar sem querer remarca a criança errada).
 */
export function ListaAgenda({ grade, legenda, aoAbrirCard, chipDoCard, destaque = null }: ListaAgendaProps) {
  /*
   * Só os horários que TÊM agendamento. A grade desenha o eixo inteiro porque a célula vazia é
   * onde se clica para marcar; a lista não tem esse papel, e um dia inteiro de horários vazios
   * seria uma rolagem de dezenas de linhas dizendo "nada aqui".
   */
  const horarios = grade.linhas
    .map((linha) => ({
      horario: linha.horario,
      itens: linha.celulas.flatMap((celula, indice) =>
        celula.cards.map((card) => ({ card, coluna: grade.colunas[indice] })),
      ),
    }))
    .filter((linha) => linha.itens.length > 0)

  if (horarios.length === 0) {
    return null
  }

  return (
    // `group/destaque` + `data-destaque`: o destaque da faixa pinta pelo CSS, como na grade
    <section
      aria-labelledby={ID_DA_LISTA}
      data-destaque={destaque ?? undefined}
      className="group/destaque flex flex-col gap-4"
    >
      {/*
        O `h2` da seção, invisível.

        Sem ele os horários (`h3`) penduravam direto no `h1` da página — salto de nível, que o
        `axe` reprova com `heading-order`. A legenda já era o nome acessível da região; agora
        ela é também o degrau que falta na árvore. Foi a célula de `axe` que achou.
      */}
      <h2 id={ID_DA_LISTA} className="sr-only">
        {legenda}
      </h2>

      {horarios.map((linha) => (
        <div key={linha.horario} className="flex flex-col gap-2">
          {/*
            O horário ANCORA o grupo. É `h3` e não um `<li>` decorado: quem navega por
            cabeçalho salta de horário em horário, que é como se lê uma agenda.
          */}
          <h3 className="text-rotulo font-semibold tabular-nums text-texto-suave">
            {linha.horario}
          </h3>

          <ul className="flex flex-col gap-2">
            {linha.itens.map(({ card, coluna }) => {
              const { nomeDoPaciente, realce } = derivarDoCard(card)
              const rotulo = card.tipo === 'bloqueio' ? (card.obs ?? 'Bloqueio') : nomeDoPaciente

              return (
                <li
                  key={card.id}
                  data-confirmacao={card.tipo === 'bloqueio' ? undefined : card.confirmacao?.estado}
                  className={cn(
                    'flex gap-2 rounded-campo border p-3',
                    card.tipo !== 'bloqueio' && DESTAQUE_NO_CARTAO,
                    /*
                      O MESMO realce do card da grade, pela MESMA pele (D3/D3-bis).

                      A lista só tinha a linha de aviso, e o item ficava com a cara de todos
                      os outros. Isto é a agenda do CELULAR — onde a recepção confere o dia de
                      pé, e a que menos perdoa sinal fraco.

                      `tipo !== 'bloqueio'` não é zelo: o aviso em TEXTO só renderiza para
                      agendamento (abaixo), então um bloqueio tingido ficaria colorido SEM
                      ícone e SEM texto — cor como canal único, que 1.4.1 proíbe. Na grade é
                      impossível (o bloqueio sai antes); aqui não era, e foi o `a11y-auditor`
                      quem pegou. O `Request` barra `tratamento_id` em bloqueio, mas a
                      importação da virada escreve fora dele.
                    */
                    card.tipo === 'bloqueio'
                      ? 'border-linha-forte bg-superficie'
                      : PELE_DO_REALCE[realce],
                  )}
                >
                  {card.especialidade !== null ? (
                    <MarcadorEspecialidade cor={card.especialidade.cor} />
                  ) : null}

                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex min-w-0 items-baseline gap-2">
                      {/*
                        A HORA DO AGENDAMENTO, não a do slot.

                        O `h3` acima ancora o GRUPO e traz o horário do slot; o card entra no
                        slot que o CONTÉM (`grade-agenda`: um encaixe às 08:15 numa grade de 40
                        min mora no slot das 08:00). Sem esta linha, a lista dizia "08:00" para
                        um atendimento das 08:15 — e a grade, no mesmo dado, dizia 08:15.

                        Duas superfícies discordando sobre a hora de uma criança, na tela que a
                        recepção usa de pé no balcão para avisar a família. A API não valida a
                        janela na escrita: encaixe fora do passo é criável hoje pela recepção.

                        Vale também para BLOQUEIO, embora o card de bloqueio da grade não
                        traga hora (§6: ele é enxuto). Não é divergência: na grade o bloqueio
                        não afirma horário nenhum, e aqui o `h3` do grupo afirma — sem a hora
                        própria, um bloqueio das 08:30 herdaria "08:00" do cabeçalho, que é o
                        mesmo defeito noutra roupa.

                        A MESMA peça do card da grade (`HorarioDoCard`): início e término, "08:40 às
                        09:20" (change horario-de-termino-no-card) — no celular o card não tem altura
                        proporcional, e o término era o que a lista não dizia de jeito nenhum.
                      */}
                      <HorarioDoCard card={card} />
                      {card.tipo === 'bloqueio' ? null : <SinalDaConfirmacao card={card} />}

                      {/*
                        `min-h-6` no alvo: 24px é o piso de 2.5.8, e num telefone o dedo é o
                        ponteiro. O card da grade se dá ao luxo de um alvo menor porque lá o
                        ponteiro é o mouse.
                      */}
                      {aoAbrirCard !== undefined ? (
                        <button
                          type="button"
                          onClick={() => {
                            aoAbrirCard(card)
                          }}
                          className="flex min-h-6 min-w-0 items-center truncate rounded-controle text-left text-corpo font-medium text-texto underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
                        >
                          {rotulo}
                        </button>
                      ) : (
                        <span className="truncate text-corpo font-medium text-texto">{rotulo}</span>
                      )}
                    </div>

                    {card.tipo === 'bloqueio' ? null : (
                      <>
                        <StatusEProgresso card={card} chip={chipDoCard?.(card)} />
                        {/*
                          O PROFISSIONAL entra nos metadados: na grade ele é o cabeçalho da
                          coluna, e aqui não há coluna. Sem isto, dois agendamentos no mesmo
                          horário ficariam indistinguíveis.
                        */}
                        <MetadadosDoCard card={card} extras={[coluna?.rotulo ?? '']} />
                        <AvisoDeUltimasSessoes card={card} />
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}
