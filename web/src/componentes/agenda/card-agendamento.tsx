import { CalendarClock } from 'lucide-react'
import { memo, type ReactNode } from 'react'

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
import { MarcadorEspecialidade } from '@/componentes/ui/marcador-especialidade'
import { cn } from '@/lib/cn'
import type { CardAgendamento as DadosDoCard } from '@/tipos'

interface CardAgendamentoProps {
  card: DadosDoCard
  /** Abre a edição — ausente deixa o card apenas legível */
  aoAbrir?: (card: DadosDoCard) => void
  /**
   * Alternativa por TECLADO do arrasto (WCAG 2.2 AA, 2.5.7 — change
   * arrastar-para-remarcar): entra no modo "Remarcar para…". Só chega aqui com
   * a config da clínica ligada + `agenda.editar` — as MESMAS condições do gesto.
   */
  aoRemarcar?: (card: DadosDoCard) => void
  /**
   * O chip do status: um nó pronto OU uma função `(card) => nó`. A função é o que segura o
   * `memo` (perf-engineer PERF-AV-01): um elemento criado no `map` da grade era prop nova a
   * cada render, e os 320 cards redesenhavam a cada tique do relógio do agora.
   */
  chip?: ReactNode | ((card: DadosDoCard) => ReactNode)
}

/**
 * O card da grade (§6). Memoizado: a grade cheia tem ~330 deles (§16), e um
 * re-render de hover não pode repintar todos.
 *
 * Regras que ele encarna:
 * - cor NUNCA é canal único (1.4.1): status traz ícone+nome, especialidade vem
 *   em texto ao lado do fio de 3px;
 * - o realce das 2 últimas sessões é ESTÁTICO (o "piscar" da referência é
 *   anti-padrão §2 e custaria paint em 330 cards);
 * - convênio é identificação operacional (dado nosso, §14) — guia/autorização/
 *   glosa pertencem ao gestao_de_convenios e entrariam nesta mesma linha de
 *   metadados na Fase 2.
 */
function CardAgendamentoBase({ card, aoAbrir, aoRemarcar, chip: chipOuFabrica }: CardAgendamentoProps) {
  const chip = typeof chipOuFabrica === 'function' ? chipOuFabrica(card) : chipOuFabrica
  // conteúdo compartilhado com a lista de tela estreita (D5): o que MUDA entre os dois é o
  // arranjo, não o que se diz sobre o agendamento
  const { nomeDoPaciente, realce } = derivarDoCard(card)

  // Bloqueio/evento não-clínico: sem paciente, a obs é o rótulo da faixa.
  if (card.tipo === 'bloqueio') {
    const rotulo = card.obs ?? 'Bloqueio'
    const conteudo = <span className="truncate text-meta text-texto-suave">{rotulo}</span>
    const classeBase =
      'flex h-full w-full items-center gap-2 rounded-campo border border-dashed border-linha-forte bg-neutro-100 px-2 py-1.5'
    // A faixa é um GATILHO ACESSÍVEL (botão nomeado pelo rótulo), não um <div> inerte.
    return aoAbrir !== undefined ? (
      <button
        type="button"
        onClick={() => {
          aoAbrir(card)
        }}
        aria-label={`Bloqueio: ${rotulo}`}
        className={cn(
          classeBase,
          'text-left hover:bg-neutro-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
        )}
      >
        {conteudo}
      </button>
    ) : (
      <div className={classeBase}>{conteudo}</div>
    )
  }

  return (
    // `data-card-id` é o gancho da DELEGAÇÃO do arrasto (camada-de-arrasto):
    // o gesto não adiciona handler nem prop por card — o memo dos ~330 fica
    // intacto. Bloqueio NÃO leva o atributo (não é arrastável nesta versão).
    // O cursor de arrasto só aparece quando o contêiner da grade declara
    // `data-arrastavel` (config da clínica + `agenda.editar`).
    <article
      data-card-id={card.id}
      // o gancho do DESTAQUE da faixa (lembrete-com-botoes-de-resposta): quem pinta é o CSS, pelo
      // `data-destaque` do contêiner — tocar na faixa não re-renderiza os cartões memoizados
      data-confirmacao={card.confirmacao?.estado}
      className={cn(
        // `@container/card`: o rótulo "Remarcar" aparece pela largura do PRÓPRIO card, não da
        // viewport — em 1440 a Dia tem cards de ~450px e a Visão Geral com 20 colunas, de ~60px
        'group/card @container/card flex h-full gap-2 overflow-hidden rounded-campo border py-1.5 pr-2',
        // um degrau de sombra ao passar o mouse: o card responde antes do clique (§2.8: e1 = hover)
        'transition-shadow duration-(--duracao-1) hover:shadow-e1 motion-reduce:transition-none',
        'group-data-[arrastavel=true]:cursor-grab',
        /*
          O CARD INTEIRO tingido — e a COR diz QUAL dos dois fatos é
          (change alerta-de-fim-de-pacote, D3 revisado 2× pelo usuário).

          1ª versão: só a BORDA, com o argumento de que vermelho preenchido dilui o vermelho
          de erro. O usuário voltou: num dia cheio o fio de 1px se perde, e quem precisa ver
          isto está de pé, no balcão, com a família na frente.

          2ª versão: card inteiro vermelho — e aí o `design-qa` mostrou o preço. Vermelho
          passou a significar DUAS coisas no mesmo card: "faltam 2, cobre" e "sem saldo, não
          pode atender". A lista de tratamentos já separava as duas, então uma tela ensinava
          uma coisa e a outra ensinava o contrário. Agora o card copia a escada da lista.

          O preenchimento é sempre o tom SUAVE, nunca o sólido, e a razão é medida: sobre o
          `perigo` sólido o nome do paciente dá 2,74:1, os metadados 1,14:1 e o aviso 1,38:1 —
          piso 4,5 de 1.4.3. Só branco passa lá, e virar tudo branco incluiria o CHIP DE
          STATUS, cuja cor vem do banco da clínica.

          A BORDA CONTINUA, e não é enfeite: o preenchimento sozinho dá 1,08:1 contra o papel
          da grade — invisível por 1.4.11. Quem separa o card do fundo é a borda (7,86:1).
        */
        PELE_DO_REALCE[realce],
        DESTAQUE_NO_CARTAO,
      )}
    >
      {card.especialidade !== null ? <MarcadorEspecialidade cor={card.especialidade.cor} /> : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* `flex-wrap` + o nome `basis-full` no card estreito (change horario-de-termino-no-card): o
            horário completo ocupa a coluna da Visão geral, e o nome desce em vez de ser espremido até
            sumir. No card largo o nome é `flex-1 basis-0`: ele ocupa o que sobra e ENCOLHE (truncate),
            em vez de descer de linha — com a base de conteúdo, o `flex-wrap` o mandava para baixo antes
            de encolher, e o card médio ganhava uma linha (code-reviewer r1). */}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <HorarioDoCard card={card} />
          <SinalDaConfirmacao card={card} />
          {/* o nome abre a edição — alvo real, com teclado (o card inteiro seria
              um botão gigante engolindo o chip de status, que também é acionável) */}
          {aoAbrir !== undefined ? (
            <button
              type="button"
              onClick={() => {
                aoAbrir(card)
              }}
              className="truncate rounded-controle text-left text-corpo font-medium text-texto underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco min-w-0 flex-1 basis-0 @max-[14rem]/card:order-last @max-[14rem]/card:basis-full"
            >
              {nomeDoPaciente}
            </button>
          ) : (
            <span className="min-w-0 flex-1 basis-0 truncate text-corpo font-medium text-texto @max-[14rem]/card:order-last @max-[14rem]/card:basis-full">
              {nomeDoPaciente}
            </span>
          )}

          {/* A alternativa de TECLADO do arrasto (2.5.7): alvo real e nomeado,
              revelado no hover do card e no foco — o padrão do slot livre.
              p-1 + size-4 = 24×24 (piso do 2.5.8; p-0.5+size-3.5 dava 18×18).

              Com a PALAVRA (change botoes-com-nome-na-agenda): o ícone de calendário
              sozinho não dizia o que faz a quem está de pé no balcão. O texto entra
              quando o card é largo (container query); no card estreito fica o ícone
              com o `title` nativo — a `DicaVisual` da casa NÃO entra aqui porque
              pendura ouvintes no `document` por instância, e a grade cheia tem ~330.
              Em ponteiro grosseiro não existe hover: a ação fica sempre à vista.
              O `aria-label` continua o nome completo; "Remarcar" é parte dele (2.5.3). */}
          {aoRemarcar !== undefined ? (
            <button
              type="button"
              onClick={() => {
                aoRemarcar(card)
              }}
              aria-label={`Remarcar ${nomeDoPaciente ?? 'agendamento'} para outro horário`}
              title="Remarcar"
              className="ml-auto flex shrink-0 items-center gap-1 rounded-controle p-1 text-texto-suave opacity-0 transition-opacity duration-(--duracao-1) hover:bg-acento-suave hover:text-acento focus:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco group-hover/card:opacity-100 pointer-coarse:opacity-100 @min-[20rem]/card:px-1.5"
            >
              <CalendarClock aria-hidden="true" className="size-4" />
              <span className="hidden text-meta font-medium @min-[20rem]/card:inline">Remarcar</span>
            </button>
          ) : null}
        </div>

        <StatusEProgresso card={card} chip={chip} />

        <MetadadosDoCard card={card} />

        <AvisoDeUltimasSessoes card={card} />
      </div>
    </article>
  )
}

export const CardAgendamento = memo(CardAgendamentoBase)
