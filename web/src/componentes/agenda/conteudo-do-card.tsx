import { TriangleAlert } from 'lucide-react'

import { PELE_DA_CONFIRMACAO } from '@/componentes/agenda/pele-da-confirmacao'
import { ChipStatus } from '@/componentes/ui/chip-status'
import { cn } from '@/lib/cn'
import { avisoDeSaldo, derivarDoCard } from '@/lib/card-agendamento'
import { descreverConfirmacao } from '@/lib/confirmacao-do-lembrete'
import type { CardAgendamento as DadosDoCard } from '@/tipos'

/**
 * O CONTEÚDO do card, separado do ARRANJO dele (change agenda-no-celular, D5).
 *
 * A grade e a lista de tela estreita mostram as mesmas coisas sobre um agendamento — quem é a
 * criança, em que pé está o tratamento, qual o convênio — e mostram de formas diferentes: na
 * grade o card tem altura proporcional à duração e largura de coluna; na lista ele tem largura
 * total e altura de conteúdo.
 *
 * Espremer o card da grade em `w-full` manteria a altura proporcional, e uma sessão de 40min
 * viraria um bloco alto e vazio no telefone. Por isso o que se compartilha é o CONTEÚDO, e não
 * o componente.
 *
 * O custo aceito é ter dois lugares para acertar quando o conteúdo mudar. É por isso que estas
 * peças vivem aqui e não duplicadas: mudar o texto do aviso de saldo, ou o que entra na linha
 * de metadados, muda nos dois de uma vez.
 */

/**
 * Status + progresso do pacote.
 *
 * O `chip` entra por fora quando a tela oferece troca de status — o chip acionável é
 * responsabilidade de quem sabe se o usuário pode editar.
 */
export function StatusEProgresso({
  card,
  chip,
}: {
  card: DadosDoCard
  chip?: React.ReactNode
}) {
  const { realizadas } = derivarDoCard(card)

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {chip ??
        (card.status !== null ? (
          <ChipStatus
            nome={card.status.nome}
            cor={card.status.cor}
            corBorda={card.status.cor_borda}
            tipo={card.status.tipo}
            tamanho="sm"
          />
        ) : null)}

      {realizadas !== null ? (
        <span className="text-meta tabular-nums text-texto-suave">
          {realizadas}/{card.tratamento_total} sessões
        </span>
      ) : null}
    </div>
  )
}

/**
 * Especialidade · convênio · sala.
 *
 * A especialidade vem em TEXTO porque o fio colorido sozinho não carrega significado (1.4.1).
 * É aqui que o status de guia do `gestao_de_convenios` entra na Fase 2 (§14).
 *
 * `extras` deixa a lista acrescentar o PROFISSIONAL — na grade ele é o cabeçalho da coluna, e
 * na lista não há coluna que o diga.
 */
export function MetadadosDoCard({ card, extras = [] }: { card: DadosDoCard; extras?: string[] }) {
  const partes = [
    ...extras,
    card.especialidade?.nome,
    card.convenio !== null ? (card.convenio.particular ? 'Particular' : card.convenio.nome) : null,
    card.sala?.nome,
  ].filter((parte): parte is string => parte != null && parte !== '')

  return <p className="truncate text-meta text-texto-suave">{partes.join(' · ')}</p>
}

/**
 * A resposta da família ao lembrete (change lembrete-com-botoes-de-resposta): um ícone pequeno ao
 * lado da hora, na PRIMEIRA linha do cartão — o cartão de 40 minutos corta as linhas de baixo
 * (`overflow-hidden`), e é justamente o dia cheio de cartões curtos que a recepção confere.
 *
 * `role="img"` com o estado em palavras: é o que o leitor de tela lê. O `title` nativo é o nome e dá a
 * mesma frase ao passar o mouse — a `DicaVisual` da casa não entra aqui pelo motivo do botão Remarcar:
 * ela pendura ouvintes no `document` por instância, e a grade cheia tem ~330 cartões.
 *
 * Sem estado (sessão sem lembrete, ou que não está mais marcada), nada é desenhado.
 */
export function SinalDaConfirmacao({ card }: { card: DadosDoCard }) {
  const confirmacao = card.confirmacao
  if (confirmacao == null) return null

  const pele = PELE_DA_CONFIRMACAO[confirmacao.estado]
  const descricao = descreverConfirmacao(confirmacao)

  return (
    // só o `title`: ele é o nome do `role="img"` e a dica do mouse. Com o `aria-label` igual ao lado,
    // o Chromium expunha a mesma frase como nome E como descrição, e o leitor de tela a lia duas
    // vezes (gate r2 da change telefone-que-chega-no-whatsapp, A11Y-TEL-06)
    <span
      role="img"
      title={descricao}
      className={cn('inline-flex shrink-0 self-center p-0.5', pele.corDoIcone, pele.fundoDoIcone)}
    >
      <pele.icone aria-hidden="true" className="size-3.5" />
    </span>
  )
}

/**
 * O horário do card: início E término, "08:40 às 09:20" (change horario-de-termino-no-card, pedido da
 * clínica). Só a hora de início escondia a duração, que a altura do card não diz na lista do celular
 * nem quando a sessão não bate com a granularidade da grade (50 min numa grade de 40).
 *
 * É tela da EQUIPE: as mensagens às famílias são montadas no servidor por modelo próprio e continuam
 * só com o início. `shrink-0` + `tabular-nums`: o horário nunca é o que se corta, e os dígitos não
 * dançam entre linhas.
 */
export function HorarioDoCard({ card }: { card: DadosDoCard }) {
  return (
    <span className="shrink-0 text-meta font-semibold tabular-nums text-texto">
      <time dateTime={card.inicio}>{card.inicio.slice(11, 16)}</time> às{' '}
      <time dateTime={card.fim}>{card.fim.slice(11, 16)}</time>
    </span>
  )
}

/** O realce das últimas sessões — estático, nunca piscando (§2, e 330 cards não repintam). */
export function AvisoDeUltimasSessoes({ card }: { card: DadosDoCard }) {
  const { realce } = derivarDoCard(card)
  if (realce === 'nenhum') return null

  return (
    // o texto acompanha a COR do card: âmbar avisa, vermelho bloqueia. Se ficasse fixo em
    // vermelho, o card âmbar teria dentro de si o tom do outro fato.
    <p
      className={cn(
        'flex items-center gap-1 text-meta font-medium',
        realce === 'sem-saldo' ? 'text-perigo-texto' : 'text-alerta-texto',
      )}
    >
      <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
      {avisoDeSaldo(card.tratamento_saldo ?? 0)}
    </p>
  )
}
