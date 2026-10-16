import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { CalendarPlus, PanelRightClose, PanelRightOpen, TriangleAlert, X } from 'lucide-react'

import { Botao } from '@/componentes/ui/botao'
import { DicaVisual } from '@/componentes/ui/dica-visual'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarPreferenciaDeLayout } from '@/hooks/usar-preferencia-de-layout'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { filtrarFila, nomeDoPaciente, rotuloDaPrioridade, tempoDeEspera } from '@/lib/fila-espera'
import { listarFila } from '@/servicos/lista-espera'
import type { EntradaDaFila } from '@/tipos'

const ID_CORPO = 'corpo-lista-espera'

export interface PainelListaEsperaProps {
  /** Foco da visão — a fila mostra quem cabe nele (e quem não escolheu ninguém) */
  profissionalId?: number | null
  /** Entrada em modo encaixe (destacada); `null` fora do modo */
  encaixando?: EntradaDaFila | null
  /** Só aparece para quem pode encaixar (o servidor exige as DUAS permissões) */
  podeEncaixar?: boolean
  aoEncaixar?: (entrada: EntradaDaFila) => void
  aoCancelarEncaixe?: () => void
}

/** O contador da fila como SELO: 24px (a altura do chip md), pílula no acento suave. */
function SeloContador({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-pilula bg-chip-de-marca px-2 text-meta font-semibold tabular-nums text-sobre-chip-de-marca',
        className,
      )}
    >
      {children}
    </span>
  )
}

interface SinaisDoTrilho {
  /** `null` enquanto carrega ou quando falhou — "0" numa falha diria "fila vazia" */
  quantidade: number | null
  falhou: boolean
  encaixando: EntradaDaFila | null
  aoCancelarEncaixe?: () => void
}

/**
 * O trilho: o que a recepção NÃO pode perder de vista quando o painel recolhe.
 *
 * Número e estado — nunca NOME. O trilho é cromo permanente num balcão onde pais
 * e outros pacientes ficam encostados na tela; o nome de um menor só aparece
 * quando alguém ESCOLHE abrir o painel.
 */
function TrilhoDaFila({ quantidade, falhou, encaixando, aoCancelarEncaixe }: SinaisDoTrilho) {
  return (
    <>
      {quantidade !== null ? (
        <SeloContador>
          {quantidade}
          <span className="sr-only"> na lista de espera</span>
        </SeloContador>
      ) : null}

      {/* recolhido, o corpo (com o EstadoErro e sua nova tentativa) não é
          renderizado — o trilho tem que DIZER que a fila não carregou */}
      {falhou ? (
        <span className="relative flex text-perigo-texto">
          <TriangleAlert aria-hidden="true" className="size-4" />
          <span className="sr-only">Não foi possível carregar a lista de espera</span>
          <DicaVisual lado="esquerda">Fila não carregada</DicaVisual>
        </span>
      ) : null}

      {/* encaixe pendente não pode ficar invisível só porque o painel recolheu:
          a página está esperando um clique num horário livre da grade */}
      {encaixando !== null ? (
        <span className="flex flex-col items-center gap-1">
          <span className="flex size-8 items-center justify-center rounded-controle bg-acento-suave text-acento">
            <CalendarPlus aria-hidden="true" className="size-4" />
            <span className="sr-only">Encaixe em andamento: escolha um horário livre na grade</span>
          </span>
          <Botao
            tamanho="sm"
            variante="fantasma"
            className="px-2"
            onClick={aoCancelarEncaixe}
            aria-label="Cancelar encaixe"
          >
            <X size={16} aria-hidden="true" />
          </Botao>
        </span>
      ) : null}
    </>
  )
}

interface CorpoDaFilaProps extends Pick<PainelListaEsperaProps, 'podeEncaixar' | 'aoEncaixar' | 'aoCancelarEncaixe'> {
  entradas: EntradaDaFila[]
  encaixando: EntradaDaFila | null
  carregando: boolean
  falhou: boolean
  vazia: boolean
  aoTentarNovamente: () => void
}

/** A fila aberta: os quatro estados e quem espera, um a um. */
function CorpoDaFila({
  entradas,
  encaixando,
  carregando,
  falhou,
  vazia,
  podeEncaixar = false,
  aoEncaixar,
  aoCancelarEncaixe,
  aoTentarNovamente,
}: CorpoDaFilaProps) {
  return (
    <>
      {falhou ? (
        <EstadoErro
          mensagem="Não foi possível carregar a lista de espera."
          aoTentarNovamente={aoTentarNovamente}
        />
      ) : null}

      {encaixando !== null ? (
        <div className="flex items-start justify-between gap-2 rounded-superficie border border-acento bg-acento-suave p-3">
          <p className="text-meta text-texto">
            Escolha um horário livre na grade para encaixar{' '}
            <strong className="font-semibold">{nomeDoPaciente(encaixando)}</strong>.
          </p>
          <Botao
            tamanho="sm"
            variante="fantasma"
            onClick={aoCancelarEncaixe}
            aria-label="Cancelar encaixe"
          >
            <X size={16} aria-hidden="true" />
          </Botao>
        </div>
      ) : null}

      {carregando ? <Skeleton className="h-24 w-full" /> : null}

      {vazia ? (
        <p className="rounded-superficie border border-dashed border-linha-forte p-4 text-meta text-texto-suave">
          Ninguém esperando por esta agenda.
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {entradas.map((entrada) => (
          <li
            key={entrada.id}
            className={cn(
              'rounded-superficie border border-linha-forte bg-superficie p-3',
              encaixando?.id === entrada.id && 'border-acento ring-2 ring-acento',
            )}
          >
            <p className="text-corpo font-medium text-texto">{nomeDoPaciente(entrada)}</p>
            <p className="mt-0.5 text-meta text-texto-suave">
              {[entrada.especialidade?.nome, entrada.profissional?.nome].filter(Boolean).join(' · ')
                || 'Qualquer horário'}
            </p>
            <p className="mt-0.5 text-meta text-texto-suave">
              {rotuloDaPrioridade(entrada.prioridade)} · {tempoDeEspera(entrada.created_at)}
            </p>
            {podeEncaixar && aoEncaixar !== undefined ? (
              <Botao
                tamanho="sm"
                variante="secundario"
                className="mt-2 w-full"
                onClick={() => {
                  aoEncaixar(entrada)
                }}
              >
                <CalendarPlus size={16} aria-hidden="true" />
                Encaixar
              </Botao>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * Quem espera, ao lado da grade (§6) — é olhando o dia que a recepção descobre
 * que abriu um horário. Escolher "Encaixar" põe a página em modo encaixe: o
 * próximo slot livre clicado abre o formulário já com o paciente da fila.
 *
 * O painel RECOLHE para um trilho e devolve a largura à grade, sem que a fila
 * saia da consciência de quem atende (ver `TrilhoDaFila`). Recolher é decisão de
 * LAYOUT: não altera a fila nem cancela um encaixe em andamento.
 */
export function PainelListaEspera({
  profissionalId = null,
  encaixando = null,
  podeEncaixar = false,
  aoEncaixar,
  aoCancelarEncaixe,
}: PainelListaEsperaProps) {
  const fila = useQuery({ queryKey: chaves.listaEspera(), queryFn: listarFila })
  const [recolhido, alternarPainel] = usarPreferenciaDeLayout('filaAgenda')

  const entradas = filtrarFila(fila.data ?? [], { profissionalId })

  return (
    <section
      aria-labelledby="titulo-fila-espera"
      className={cn(
        'flex shrink-0 flex-col gap-3',
        'transition-[width] duration-(--duracao-1) motion-reduce:transition-none',
        // em tela estreita a página empilha: o painel ocupa a largura toda em vez de
        // insistir numa coluna de 288px que não cabe
        // recolhido, o trilho é uma SUPERFÍCIE (design D6): cartão com borda e sombra, e não
        // um ícone e um número soltos sobre o fundo. Em tela empilhada ele DEITA (largura
        // cheia, uma linha); a partir do xl é a coluna estreita — 56px: 32 do controle + 8 de
        // calha de cada lado + a borda.
        recolhido
          ? 'w-full rounded-superficie border border-linha bg-superficie p-2 shadow-e1 xl:w-14 xl:items-center'
          : 'w-full xl:w-72',
        // a coluna cabe na janela a partir do md (change agenda-no-mouse, D4): é ELA quem
        // esticava a página a 8290px com 60 entradas na fila. Quem ROLA é o CORPO, não esta
        // seção — o cabeçalho leva junto o contador e o botão de recolher, e rolando aqui eles
        // saíam da vista: para recolher o painel era preciso voltar ao topo (achado do gate).
        'xl:min-h-0',
      )}
    >
      <header className={cn('flex items-center gap-2', recolhido && 'xl:flex-col')}>
        <h2
          id="titulo-fila-espera"
          className={cn('text-corpo font-semibold text-texto', recolhido && 'sr-only')}
        >
          Lista de espera
        </h2>

        {/* O botão fica na MESMA posição do DOM nos dois estados: não remonta, e
            o foco de quem recolheu pelo teclado continua nele. Aberto, ele vai
            visualmente para DEPOIS do contador por `order` — trocar a ordem no
            DOM para isso custaria o foco. */}
        <Botao
          variante="secundario"
          tamanho="sm"
          className={cn('px-2', !recolhido && 'order-2')}
          aria-expanded={!recolhido}
          aria-controls={ID_CORPO}
          aria-label={recolhido ? 'Expandir a lista de espera' : 'Recolher a lista de espera'}
          onClick={alternarPainel}
        >
          {recolhido ? (
            <PanelRightOpen aria-hidden="true" className="size-4" />
          ) : (
            <PanelRightClose aria-hidden="true" className="size-4" />
          )}
          {/* o painel mora na borda direita da tela: a dica abre para a esquerda */}
          <DicaVisual lado="esquerda">
            {recolhido ? 'Expandir a lista de espera' : 'Recolher a lista de espera'}
          </DicaVisual>
        </Botao>

        {/* contador só com dado carregado: "0" numa falha de rede diria à recepção
            que a fila está VAZIA (parecer code-review §4) */}
        {!recolhido && fila.isSuccess ? (
          <SeloContador className="order-1 ml-auto">
            {entradas.length}
            <span className="sr-only"> na lista de espera</span>
          </SeloContador>
        ) : null}

        {recolhido ? (
          <>
            {/* O rótulo LEGÍVEL do trilho — `aria-hidden` porque o `h2` (sr-only) já dá o
                nome à seção; dois "Lista de espera" no leitor de tela seriam eco. Vertical
                na coluna (xl), lido de baixo para cima; na linha, texto normal. */}
            <span
              aria-hidden="true"
              className="text-meta font-semibold text-texto-suave xl:rotate-180 xl:[writing-mode:vertical-rl]"
            >
              Lista de espera
            </span>
            <TrilhoDaFila
              quantidade={fila.isSuccess ? entradas.length : null}
              falhou={fila.isError}
              encaixando={encaixando}
              aoCancelarEncaixe={aoCancelarEncaixe}
            />
          </>
        ) : null}
      </header>

      {/* O alvo do aria-controls continua EXISTINDO recolhido (vazio + hidden):
          um controle que aponta para o nada é um controle de nada. E o conteúdo
          não é só escondido, é REMOVIDO — nome de menor não fica pendurado no
          DOM de um trilho que vive aberto o dia inteiro no balcão. */}
      <div
        id={ID_CORPO}
        hidden={recolhido}
        /*
          O CORPO é quem rola, e por isso é ele quem precisa de FOCO (2.1.1, achado do gate).
          A página sempre foi rolável por teclado; ao tirar a rolagem dela e pôr aqui dentro,
          quem navega só por teclado ficou sem caminho — os itens da fila são texto puro e o
          `Encaixar` só existe para quem tem permissão. Sem ela, da ~5ª entrada em diante não
          havia como chegar. Sem handler de setas: a rolagem por seta é nativa com o foco aqui.

          `px-1`: o anel de foco é `outline-offset: 2px`, isto é 4px FORA da caixa, e
          `overflow-y:auto` faz o eixo X computar `auto` e recortar nos quatro lados. Sem calha,
          o anel dos controles internos era cortado nas laterais.
        */
        tabIndex={recolhido ? undefined : 0}
        className="flex flex-col gap-3 xl:min-h-0 xl:overflow-y-auto xl:pr-1"
      >
        {recolhido ? null : (
          <CorpoDaFila
            entradas={entradas}
            encaixando={encaixando}
            carregando={fila.isPending}
            falhou={fila.isError}
            vazia={fila.isSuccess && entradas.length === 0}
            podeEncaixar={podeEncaixar}
            aoEncaixar={aoEncaixar}
            aoCancelarEncaixe={aoCancelarEncaixe}
            aoTentarNovamente={() => {
              void fila.refetch()
            }}
          />
        )}
      </div>
    </section>
  )
}
