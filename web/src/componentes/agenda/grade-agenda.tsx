import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CamadaDeArrasto, type DadosDoSoltar } from '@/componentes/agenda/camada-de-arrasto'
import { Botao } from '@/componentes/ui/botao'
import { CardAgendamento } from '@/componentes/agenda/card-agendamento'
import { MenuDeStatus } from '@/componentes/agenda/menu-de-status'
import { montarDataSlot, type AlvoDeRemarcacao } from '@/lib/arrastar-remarcar'
import { AvatarDoProfissional } from '@/componentes/agenda/avatar-do-profissional'
import type { AgoraNaClinica } from '@/hooks/usar-agora-na-clinica'
import { cn } from '@/lib/cn'
import type { LinhaDaGrade, ColunaDaGrade, Grade } from '@/lib/grade-agenda'
import type { CardAgendamento as DadosDoCard, EstadoDaConfirmacao } from '@/tipos'

interface GradeAgendaProps {
  grade: Grade
  legenda: string
  /** "Y-m-d" da coluna quando a visão é por profissional */
  data: string
  /**
   * Profissional da grade quando as COLUNAS são dias (visão Semana) — sem ele o
   * horário livre não teria a quem marcar, e a visão Semana ficaria sem a ação
   * (I-03).
   */
  profissionalDaVisao?: number | null
  /** Nome dele — o slot da visão Semana precisa dizer com quem se está marcando */
  nomeDoProfissionalDaVisao?: string | null
  podeCriar?: boolean
  podeEditar?: boolean
  /**
   * O cartão ABRE com `agenda.ver` — não com `agenda.editar`.
   *
   * Enquanto ele só abria para quem podia EDITAR, o único caminho até o atendimento e o
   * prontuário de uma criança era a permissão de escrever na agenda: quem tinha
   * `atendimentos.ver` e `evolucoes.ver` não alcançava nenhum dos dois. A permissão existia e
   * NÃO TINHA PORTA. Sem `agenda.editar`, o diálogo abre em modo LEITURA.
   */
  podeVer?: boolean
  aoAbrirCard?: (card: DadosDoCard) => void
  /** Slot livre acionado: profissional + "Y-m-d H:i" */
  aoMarcarNoSlot?: (dados: { profissionalId: number; inicio: string }) => void
  /**
   * Gesto de arrastar-para-remarcar LIGADO: config da clínica
   * (`agenda.arrastar_para_remarcar`) E `agenda.editar` — a página computa.
   * Desligado, o card não expõe afordância nenhuma (nem o modo teclado).
   */
  podeArrastar?: boolean
  /** Soltar num alvo válido — a página abre a CONFIRMAÇÃO (soltar nunca grava direto, D2). */
  aoSoltarCard?: (dados: DadosDoSoltar) => void
  /** Ação de teclado "Remarcar para…" no card (mesmas condições do gesto — 2.5.7). */
  aoRemarcarCard?: (card: DadosDoCard) => void
  /** Modo teclado ativo: o card em remarcação — os slots livres viram ALVO. */
  remarcando?: DadosDoCard | null
  /** Escolha do alvo no modo teclado — cai na MESMA confirmação do arrasto. */
  aoEscolherAlvo?: (alvo: AlvoDeRemarcacao) => void
  /** "Agora" na parede da clínica: desenha a linha do agora nas colunas de hoje. `null` = sem linha. */
  agora?: AgoraNaClinica | null
  /**
   * O estado que a faixa de respostas ao lembrete destaca (change lembrete-com-botoes-de-resposta).
   * Vira `data-destaque` no contêiner, e quem pinta os cartões é o CSS — nenhum cartão re-renderiza.
   */
  destaque?: EstadoDaConfirmacao | null
  /**
   * O arrasto começou (`true`) ou terminou (`false`) — a página PAUSA a atualização sozinha da
   * grade enquanto um cartão está no ar (D11). Só as bordas do gesto chamam; o `pointermove`, nunca.
   */
  aoMudarArrasto?: (arrastando: boolean) => void
}

/** Data da célula: na visão Semana a coluna É um dia; nas outras, o dia da tela. */
function dataDaCelula(coluna: ColunaDaGrade, dataDaTela: string): string {
  return coluna.data ?? dataDaTela
}

function minutosDoHorario(horario: string): number {
  const [hora = 0, minuto = 0] = horario.split(':').map(Number)

  return hora * 60 + minuto
}

/**
 * A LINHA DO AGORA: em que faixa da grade o relógio está, e a que altura dela (0–100%).
 * O passo vem da própria grade (diferença entre as duas primeiras faixas) — a grade já foi
 * montada com a granularidade da clínica, e repetir a conta aqui criaria duas fontes.
 * Fora da janela da grade (antes da primeira faixa, depois da última) não há linha.
 */
function localizarLinhaDoAgora(
  linhas: LinhaDaGrade[],
  agora: AgoraNaClinica | null,
): { horario: string; fracao: number } | null {
  if (agora === null || linhas.length === 0) {
    return null
  }
  const primeira = linhas[0]
  const segunda = linhas[1]
  if (primeira === undefined) {
    return null
  }
  const passo =
    segunda === undefined
      ? 1
      : Math.max(1, minutosDoHorario(segunda.horario) - minutosDoHorario(primeira.horario))
  const minutoAgora = minutosDoHorario(agora.hora)
  const linha = linhas.find((candidata) => {
    const inicio = minutosDoHorario(candidata.horario)

    return minutoAgora >= inicio && minutoAgora < inicio + passo
  })
  if (linha === undefined) {
    return null
  }

  return { horario: linha.horario, fracao: (minutoAgora - minutosDoHorario(linha.horario)) / passo }
}

/**
 * A grade é uma TABELA semântica (design D8): o leitor de tela navega por
 * linha/coluna e anuncia o profissional/dia junto do horário. Cabeçalho fixo;
 * sem sombra por célula (§16).
 *
 * O horário livre é um alvo real (botão com nome acessível), porque é assim que
 * a recepção marca — e sem `agenda.criar` ele nem convida.
 */
export function GradeAgenda({
  grade,
  legenda,
  data,
  profissionalDaVisao = null,
  nomeDoProfissionalDaVisao = null,
  podeCriar = false,
  podeEditar = false,
  podeVer = false,
  aoAbrirCard,
  aoMarcarNoSlot,
  podeArrastar = false,
  aoSoltarCard,
  aoRemarcarCard,
  remarcando = null,
  aoEscolherAlvo,
  agora = null,
  destaque = null,
  aoMudarArrasto,
}: GradeAgendaProps) {
  /*
   * O MARCADOR DO AGORA só existe se a grade mostra HOJE — e isso é por COLUNA: na Semana uma
   * coluna É um dia; na Dia e na Visão Geral todas são o dia da tela.
   *
   * A conta de faixa/altura nunca olhou a data: quem olhava era só a LINHA, dentro da célula.
   * O ponto na coluna de horários (e agora a hora escrita ao lado dele) apareciam em QUALQUER
   * dia — num dia de outubro a coluna dizia "agora são 08:20", com ponto verde e sem linha
   * nenhuma para ancorá-lo.
   */
  const gradeMostraHoje =
    agora !== null && grade.colunas.some((coluna) => dataDaCelula(coluna, data) === agora.data)
  const linhaDoAgora = gradeMostraHoje ? localizarLinhaDoAgora(grade.linhas, agora) : null
  // sem permissão de editar, o chip continua sendo só texto (nada de menu que não pode agir);
  // FUNÇÃO estável, não elemento no map — é o que deixa o `memo` do card segurar (PERF-AV-01)
  const chipDoCard = useCallback(
    (card: DadosDoCard) =>
      podeEditar && card.tipo === 'atendimento' && card.status !== null ? (
        <MenuDeStatus card={card} podeEditar />
      ) : undefined,
    [podeEditar],
  )
  const refConteiner = useRef<HTMLDivElement>(null)

  /*
   * O ALCANCE HORIZONTAL — quanto ainda há para cada lado (change agenda-no-mouse, D2).
   *
   * Existe porque o alcance às colunas fora da vista não pode depender de GESTO: o trackpad
   * rola de lado com dois dedos, o mouse não. Shift+roda funciona no Chrome e ninguém
   * descobre. A recepção da clínica usa Windows com mouse.
   */
  const [alcance, setAlcance] = useState({ esquerda: false, direita: false })

  /**
   * Mede quanto ainda há para cada lado.
   *
   * 1px de tolerância: `scrollWidth`/`scrollLeft` são arredondados, e sem ela a última coluna
   * ficaria eternamente "com um pixel a rolar" — botão aceso sem destino.
   *
   * Só escreve quando MUDA: `setAlcance` com objeto novo a cada evento re-renderiza uma grade
   * de 20 colunas a cada quadro de rolagem, e o piso do §16 não tem essa folga para dar.
   */
  const medirAlcance = useCallback(() => {
    const no = refConteiner.current
    if (no === null) {
      return
    }
    const medido = {
      esquerda: no.scrollLeft > 1,
      direita: no.scrollLeft + no.clientWidth < no.scrollWidth - 1,
    }
    setAlcance((atual) =>
      atual.esquerda === medido.esquerda && atual.direita === medido.direita ? atual : medido,
    )
  }, [])

  useEffect(() => {
    const no = refConteiner.current
    if (no === null) {
      return
    }
    medirAlcance()
    no.addEventListener('scroll', medirAlcance, { passive: true })
    // o alcance muda SEM rolagem: recolher um painel lateral devolve largura à grade
    const observador = new ResizeObserver(medirAlcance)
    observador.observe(no)
    return () => {
      no.removeEventListener('scroll', medirAlcance)
      observador.disconnect()
    }
  }, [grade, medirAlcance])

  /**
   * Anda DUAS COLUNAS por acionamento (decisão do usuário, revista depois de usar).
   *
   * A primeira versão andava uma TELA inteira — ~4 colunas na janela medida. Na mão, o salto
   * grande desorienta: some tudo o que estava na vista de uma vez, e achar de novo a coluna
   * que se estava lendo custa mais do que o clique economizou. Duas colunas deixam um par
   * conhecido na tela a cada passo, e a leitura acompanha.
   *
   * A largura vem do DOM — do cabeçalho da PRIMEIRA coluna de dados —, nunca de constante
   * copiada do Tailwind: a coluna declara `min-w-48`, mas quem manda é a largura real que a
   * tabela distribui depois do `min-w-0` da coluna do meio. Sem coluna de dados (grade vazia),
   * cai na largura visível, que é o comportamento antigo e nunca pior.
   */
  const COLUNAS_POR_PASSO = 2
  const rolarColunas = useCallback(
    (sentido: -1 | 1) => {
      const no = refConteiner.current
      if (no === null) {
        return
      }
      // `aria-disabled` deixa o botão FOCÁVEL de propósito (idioma do DS), e por isso ele ainda
      // dispara o clique — quem torna a ação inerte no extremo é esta guarda, não o atributo
      if (sentido === -1 ? no.scrollLeft <= 1 : no.scrollLeft + no.clientWidth >= no.scrollWidth - 1) {
        return
      }
      /*
       * `auto`, e NÃO `smooth`. Medido neste contêiner (2026-08-26): `behavior: 'smooth'`
       * **não faz nada** — 0px depois de 860ms —, enquanto `auto` move os 816px na hora. Falha
       * em SILÊNCIO: nenhum erro, o botão parece morto.
       *
       * Investiguei até onde valia: descartei o `content-visibility: auto` do `<tbody>`
       * (desligá-lo não muda nada). **A causa não está identificada** — registrado assim de
       * propósito, para ninguém "melhorar" isto de volta para `smooth` achando que foi
       * esquecimento.
       *
       * Efeito colateral bom: sem animação, `prefers-reduced-motion` fica atendido por
       * construção. E para paginar colunas, o salto instantâneo é defensável — não é um
       * deslize, é virar a página.
       */
      // [0] é o canto "Horário"; a primeira coluna de PROFISSIONAL é a [1]
      const cabecalhoDeDados = no.querySelectorAll('thead th')[1]
      const passo =
        cabecalhoDeDados === undefined
          ? no.clientWidth
          : cabecalhoDeDados.getBoundingClientRect().width * COLUNAS_POR_PASSO
      no.scrollBy({ left: sentido * passo, behavior: 'auto' })
      /*
       * Medir AQUI, e não só no evento `scroll`: o botão não pode depender de um evento
       * assíncrono para saber que chegou ao extremo. Sem isto, voltar do fim ao começo
       * deixava "Colunas anteriores" aceso em `scrollLeft = 0` — medido.
       */
      medirAlcance()
    },
    [medirAlcance],
  )
  const arrastoLigado = podeArrastar && aoSoltarCard !== undefined
  const emModoRemarcacao = remarcando !== null && aoEscolherAlvo !== undefined

  // Índice id→card para a DELEGAÇÃO do gesto (um listener no contêiner, nenhum
  // handler por card — o memo dos ~330 fica de pé). Bloqueio fica fora: a faixa
  // não é arrastável nesta versão.
  const cardsPorId = useMemo(() => {
    const indice = new Map<number, DadosDoCard>()
    for (const linha of grade.linhas) {
      for (const celula of linha.celulas) {
        for (const card of celula.cards) {
          if (card.tipo === 'atendimento') {
            indice.set(card.id, card)
          }
        }
      }
    }
    return indice
  }, [grade])
  const buscarCard = useCallback((id: number) => cardsPorId.get(id), [cardsPorId])

  // O `relative` do contêiner não é cosmético: sem ele o Chromium atribui o overflow
  // da TABELA ao scroller da PÁGINA — com 8+ profissionais a página inteira ganhava um
  // scroll horizontal fantasma (2 mil px de faixa branca) e o painel de espera parecia
  // solto no meio da tela. Posicionado, o contêiner vira o containing block e o
  // excedente rola AQUI dentro (piso do §16: 20 profissionais × dia inteiro).
  //
  // `data-arrastavel` liga a afordância visual do card (cursor) via group;
  // `data-arrastando` entra imperativamente durante o gesto (cursor + seleção
  // de texto suprimida) — nunca por estado React em pointermove.
  return (
    /* O invólucro POSICIONADO existe para os controles de coluna: dentro do contêiner que
       rola, um `absolute` se posiciona pelo CONTEÚDO e sairia da tela junto com as colunas. */
    <div className="relative flex w-full flex-col xl:min-h-0 xl:flex-1">
      {/*
        OS CONTROLES DE COLUNA — o alcance que não depende de gesto (D2).

        ANTES do contêiner no DOM, e não depois. Eles são `absolute`, então a posição visual
        não muda — mas a ordem de TABULAÇÃO muda muito: depois do contêiner, com a permissão
        real da recepção, "Colunas anteriores" era a **251ª parada de 252**, atrás de todos os
        cards e slots do dia. A leitura dizia "primeiro", o Tab dizia "último" (achado do gate,
        medido). Agora o controle vem antes do conteúdo que ele move.

        Só existem quando há o que rolar; cada um fica inerte no seu extremo. `left-20` casa
        com o `w-20` da coluna "Horário": o botão da esquerda começa onde ela termina, e não
        cobre nenhum horário.

        `aria-disabled` em vez de `disabled` é o idioma do DS desta casa: inerte, mas ainda
        focável — quem navega por teclado não perde o controle de vista ao chegar no fim.
      */}
      {alcance.esquerda || alcance.direita ? (
        <>
          <Botao
            variante="secundario"
            tamanho="sm"
            aria-label="Colunas anteriores"
            aria-disabled={!alcance.esquerda}
            onClick={() => {
              rolarColunas(-1)
            }}
            /*
              Centrado por `top-[calc(50%-1rem)]` (1rem = metade do `h-8`), NUNCA por
              `-translate-y-1/2`: o `active:translate-y-px` da base do `Botao` escreve a MESMA
              variável de translate e VENCE no clique (especificidade 0,2,0 contra 0,1,0). O
              botão despencava ~16px no `mousedown` e o `mouseup` caía fora dele — o clique era
              engolido, e só pegava mirando a borda de cima. Esta casa já tinha aprendido isso
              no controle de recolher do shell; eu repeti o erro.

              SEM alvo ampliado por `after`. A primeira versão tinha `after:-inset-2` (48×48
              invisível) e o gate mostrou que ele criava dois defeitos piores do que o conforto
              que comprava: no **Windows** cobria 48px do trilho da barra de rolagem VERTICAL —
              na plataforma para a qual esta change existe, e invisível no macOS, onde a barra é
              overlay de 0px — e engolia o clique dos ~40px de qualquer card vizinho, fazendo a
              grade pular colunas quando a recepção queria abrir um agendamento.

              O precedente da casa (`app-shell.tsx`) cresce só para o VAZIO
              (`after:left-0 after:-right-2`); eu copiei a centralização e não o formato. Aqui
              não há vazio de nenhum lado: à esquerda do botão da direita há cards, à direita
              há a barra. Então não se amplia — 32×32 já passa o piso de 24×24 de 2.5.8 e é o
              mesmo tamanho do controle de recolher do shell.
            */
            className="absolute left-20 top-[calc(50%-1rem)] z-(--z-fixo) h-8 w-8 rounded-pilula px-0 text-texto-suave shadow-e1 transition-[color,background-color,box-shadow] duration-(--duracao-1) hover:bg-acento-suave hover:text-acento hover:shadow-e2 motion-reduce:transition-none"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Botao>
          <Botao
            variante="secundario"
            tamanho="sm"
            aria-label="Próximas colunas"
            aria-disabled={!alcance.direita}
            onClick={() => {
              rolarColunas(1)
            }}
            /* `right-5` (20px) e não `right-2`: no Windows a barra de rolagem vertical é
              clássica e reserva ~15px DENTRO da caixa. Com 8px o botão ficava em cima do
              trilho, bem onde o polegar mora no meio do dia. No macOS a barra é overlay e
              isso não aparecia — foi o gate que viu. */
            className="absolute right-5 top-[calc(50%-1rem)] z-(--z-fixo) h-8 w-8 rounded-pilula px-0 text-texto-suave shadow-e1 transition-[color,background-color,box-shadow] duration-(--duracao-1) hover:bg-acento-suave hover:text-acento hover:shadow-e2 motion-reduce:transition-none"
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </Botao>
        </>
      ) : null}

      <div
        ref={refConteiner}
        data-grade-agenda
        data-arrastavel={arrastoLigado ? 'true' : undefined}
        // o destaque da faixa pinta os cartões por CSS (`group/destaque` + `data-confirmacao`)
        data-destaque={destaque ?? undefined}
        /* A região é FOCÁVEL (padrão APG para região rolável, WCAG 2.1.1): com o foco nela, as
           setas rolam nativamente nos dois eixos. Sem `tabIndex`, alcançar a coluna 24 pelo
           teclado exigia tabular por todos os cards do caminho. Não há handler de setas de
           propósito — ele reimplementaria comportamento nativo e roubaria as setas de quem
           estivesse dentro de um card. */
        tabIndex={0}
        role="region"
        aria-label={legenda}
        /*
          `max-h` ABAIXO do `xl`, `flex-1` a partir dele — e o `max-h` não é conforto, é o que
          impede a zona morta da roda de voltar.
          Abaixo do `xl` os painéis empilham e a PÁGINA volta a rolar (é a única forma de a
          linha caber; ver `pagina-agenda`). Se a grade continuasse crescendo com o conteúdo,
          voltaria a ser um contêiner que rola em X sem folga em Y — exatamente a combinação
          que prende o gesto da roda e não repassa o delta vertical ao ancestral. Com o teto,
          ela tem para onde rolar em Y, e a roda funciona nos dois arranjos.
        */
        /* `scroll-pt-20` (80px) — 2.4.11 Foco Não Obscurecido, achado do gate.
           Os cabeçalhos `sticky` só passaram a GRUDAR nesta change; antes quem rolava era a
           página e eles saíam da tela, então o critério nem se aplicava. Agora um `<th>` de
           35,2px (só o nome) a 67,6px (nome + feriado + "não atende") pode cobrir por inteiro
           um botão de slot de 32px.
           O `scroll-margin-top: 4rem` global do `index.css` dá 64px — folga NEGATIVA de 3,6px
           no pior caso — e, pior, só age quando o navegador PRECISA rolar: voltando o foco com
           Shift+Tab para um elemento que já está no scrollport, ele não rola e o alvo fica
           embaixo do cabeçalho. `scroll-padding` no scroller resolve os dois: o navegador
           passa a tratar os 80px do topo como fora da área útil.
           NÃO CONFERIDO em navegador — é o passe manual da task 4.4/7.1. */
        className="group group/destaque relative max-h-[calc(100dvh-var(--moldura-do-shell))] w-full scroll-pt-20 overflow-auto rounded-superficie border border-linha-forte bg-superficie shadow-e1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco data-[arrastando=true]:cursor-grabbing data-[arrastando=true]:select-none xl:max-h-none xl:min-h-0 xl:flex-1"
      >
        {/* O aviso do FERIADO nas visões Dia e Geral, onde as colunas são PROFISSIONAIS e o feriado
            não tem coluna onde morar. Sem ele, o feriado só aparecia na visão SEMANA — e a visão
            PADRÃO da clínica é Dia: a recepção seguia marcando sessão no Natal, que é o dano que
            esta change existe para evitar. */}
        {grade.feriadoDoDiaVisivel !== null ? (
          <p
            role="status"
            className="border-b border-linha-forte bg-alerta-suave px-3 py-2 text-rotulo font-medium text-alerta-texto"
          >
            Feriado: {grade.feriadoDoDiaVisivel} — a clínica não abre neste dia.
          </p>
        ) : null}
        <table className="w-full border-collapse text-corpo">
          <caption className="sr-only">{legenda}</caption>
          <thead>
            <tr>
              {/* canto duplamente sticky: um degrau ACIMA dos outros cabeçalhos, senão as
                  colunas (depois no DOM, mesmo z) cobrem o "Horário" ao rolar a grade */}
              <th
                scope="col"
                className="sticky left-0 top-0 z-(--z-fixo-canto) w-20 border-b border-r border-linha-forte bg-cabecalho-tabela px-3 py-2 text-left text-rotulo font-medium text-texto-suave"
              >
                Horário
              </th>
              {grade.colunas.map((coluna) => (
                <th
                  key={coluna.chave}
                  scope="col"
                  className="sticky top-0 z-(--z-fixo) min-w-48 border-b border-linha-forte bg-cabecalho-tabela px-3 py-2 text-left text-rotulo font-medium text-texto"
                >
                  {/* nome maior que a coluna: reticências + title (o §16 não deixa
                      a coluna crescer sem teto para caber o nome) */}
                  {/* na visão geral a coluna é uma PESSOA: o rosto (foto ou iniciais) vem
                      antes do nome — o mesmo avatar da lista lateral, menor */}
                  <span className="flex min-w-0 items-center gap-2">
                    {coluna.profissionalId !== undefined ? (
                      <AvatarDoProfissional
                        id={coluna.profissionalId}
                        fotoVersao={coluna.fotoVersao ?? null}
                        nome={coluna.rotulo}
                        cor={coluna.cor ?? null}
                        tamanho="sm"
                      />
                    ) : null}
                    <span title={coluna.rotulo} className="block min-w-0 truncate">
                      {coluna.rotulo}
                    </span>
                  </span>
                  {coluna.feriado !== undefined ? (
                    <span className="block truncate text-meta font-normal text-alerta-texto">
                      {coluna.feriado}
                    </span>
                  ) : null}
                  {coluna.naoAtende === true ? (
                    <span className="block truncate text-meta font-normal text-texto-suave">
                      Não atende neste dia
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[content-visibility:auto]">
            {/* `data-horario` em cada linha: é o gancho da GEOMETRIA do arrasto. A linha coberta
                por um `rowSpan` não tem `<td>`, então o alvo do gesto não pode vir da célula sob
                o cursor — vem da FAIXA em que o ponteiro caiu (change
                `arrastar-para-slot-coberto`). */}
            {grade.linhas.map((linha) => (
              <tr
                key={linha.horario}
                data-horario={linha.horario}
                data-agora={linhaDoAgora?.horario === linha.horario ? 'true' : undefined}
                // a altura da linha do agora dentro da faixa, como variável: cada célula da faixa
                // desenha o próprio trecho (a linha corre por baixo dos cards que vêm de cima)
                style={
                  linhaDoAgora?.horario === linha.horario
                    ? ({ '--agora': `${Math.round(linhaDoAgora.fracao * 100)}%` } as CSSProperties)
                    : undefined
                }
                className="group/faixa border-b border-linha last:border-b-0"
              >
                <th
                  scope="row"
                  className={cn(
                    'sticky left-0 z-(--z-fixo) border-r border-linha-forte bg-superficie px-3 py-1 text-left align-top text-meta font-medium tabular-nums text-texto-suave',
                    // o PONTO do agora na coluna de horários, sempre que a faixa é a de agora
                    // sem `relative`: `sticky` já é posicionado e serve de containing block ao ponto —
                    // um `relative` condicional VENCIA o `sticky` (mesma propriedade, variante mais
                    // específica) e a coluna de horários soltava na faixa de agora (a11y-auditor AV-01)
                    'group-data-[agora=true]/faixa:after:absolute group-data-[agora=true]/faixa:after:right-0 group-data-[agora=true]/faixa:after:top-(--agora) group-data-[agora=true]/faixa:after:size-2 group-data-[agora=true]/faixa:after:-translate-y-1/2 group-data-[agora=true]/faixa:after:translate-x-1/2 group-data-[agora=true]/faixa:after:rounded-pilula group-data-[agora=true]/faixa:after:bg-destaque',
                  )}
                >
                  {linha.horario}
                  {linhaDoAgora?.horario === linha.horario && agora !== null ? (
                    /*
                      A HORA DE AGORA ESCRITA, ao lado do ponto — "ninguém sabe o que é aquilo"
                      (o dono do produto, olhando a produção). O ponto só se explicava para
                      leitor de tela; para quem enxerga era um marcador verde sem legenda.

                      O RÓTULO DA FAIXA CEDE nesta linha, e isso é decisão medida, não acidente:
                      a coluna tem 80px (`w-20`, igual em 390 e em 1440) e dois `HH:mm` de 12px
                      não cabem lado a lado em largura nenhuma. Como a hora de agora fica na
                      ALTURA do minuto — proporcional dentro da faixa —, ela passa por cima do
                      rótulo da faixa sempre que o minuto está no começo dela, e meio rótulo
                      espiando atrás do outro é pior do que um rótulo só. Então, na faixa de
                      agora, quem aparece na coluna é a HORA DE AGORA; as faixas vizinhas
                      seguem ancorando o eixo.

                      A cobertura é de ALTURA FIXA, e isso foi aprendido medindo: a primeira
                      versão cobria "do topo até `--agora`", o que deixa de fora a metade de
                      baixo do rótulo da faixa quando o agora está no começo dela. Em 390px,
                      faixa das 13:20 com o relógio em 13:20 em ponto, lia-se o "13:20" cinza
                      espiando embaixo do verde. `h-6` (24px) cobre o rótulo inteiro
                      (`py-1` + 16,2px de linha do `text-meta` = 20,2px) em qualquer fração.

                      O rótulo da faixa CONTINUA no DOM, coberto e não removido: ele é o
                      cabeçalho de linha que o leitor de tela anuncia em cada célula ("08:00,
                      agora são 08:20") e é ele que segura a altura da faixa — com `sr-only` a
                      faixa de agora encolheria para a altura do padding numa grade sem slot
                      para marcar (usuário sem `agenda.criar`).
                    */
                    <>
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-superficie"
                      />
                      <span className="pointer-events-none absolute inset-x-0 top-(--agora) -translate-y-1/2 bg-superficie pr-2 text-right font-semibold text-acento">
                        {/* o leitor de tela não vê nem a cor nem o ponto: sem o "agora são",
                            08:20 seria mais um horário de faixa. O texto visível é o MESMO que
                            ele lê — a hora aparece uma vez só na árvore de acessibilidade. */}
                        <span className="sr-only">, agora são </span>
                        {agora.hora}
                      </span>
                    </>
                  ) : null}
                </th>
                {linha.celulas.map((celula, indice) => {
                  const coluna = grade.colunas[indice]
                  if (celula.continuacao) {
                    return null // coberta pelo rowSpan de um card acima
                  }

                  // livre é "ninguém segura o horário", não "não tem card": a célula da situação
                  // que libera continua mostrando o card e volta a aceitar marcação — é a mesma
                  // frase do servidor (change grade-conhece-ocupa-horario)
                  const livre = !celula.ocupada && !celula.indisponivel
                  // coluna-profissional (Dia/Geral) ou coluna-dia (Semana, em que
                  // o profissional é o da visão)
                  const profissionalDaCelula = coluna.profissionalId ?? profissionalDaVisao ?? undefined
                  // O alvo que a célula JÁ sabe ser: o mesmo trio do "Marcar no
                  // slot". Serializado em `data-slot`, vira o hit-test do arrasto
                  // (elementFromPoint na camada) — e o modelo puro decide validade.
                  const alvoDaCelula: AlvoDeRemarcacao | null =
                    profissionalDaCelula !== undefined
                      ? { profissionalId: profissionalDaCelula, data: dataDaCelula(coluna, data), horario: linha.horario }
                      : null
                  // No modo teclado "Remarcar para…", o slot livre EXISTENTE age
                  // como alvo — sem roving tabindex novo (D3).
                  const slotComoAlvoDeRemarcacao = emModoRemarcacao && livre && alvoDaCelula !== null
                  const slotParaMarcar =
                    !emModoRemarcacao && livre && podeCriar && aoMarcarNoSlot !== undefined && alvoDaCelula !== null

                  return (
                    <td
                      key={coluna.chave}
                      rowSpan={celula.alturaEmSlots > 1 ? celula.alturaEmSlots : undefined}
                      data-slot={alvoDaCelula !== null ? montarDataSlot(alvoDaCelula) : undefined}
                      data-slot-indisponivel={alvoDaCelula !== null && celula.indisponivel ? 'true' : undefined}
                      // `--agora` é % da FAIXA; a célula com rowSpan é N faixas de altura, então
                      // o % dela é o da faixa dividido por N (design-qa DQA-02: sem isso a linha
                      // caía quase uma faixa abaixo na coluna de uma sessão de duas faixas)
                      style={
                        linhaDoAgora?.horario === linha.horario && celula.alturaEmSlots > 1
                          ? ({ '--agora-celula': `calc(var(--agora) / ${celula.alturaEmSlots})` } as CSSProperties)
                          : undefined
                      }
                      className={cn(
                        'border-l border-linha p-1 align-top',
                        celula.indisponivel && 'bg-neutro-100',
                        // a LINHA do agora: só nas colunas de HOJE (na semana, um dia; no dia e na
                        // visão geral, todas), à altura da variável da faixa
                        // 1px, e não 2: o traço marca a hora, não disputa a atenção com o card
                        // (pedido do dono do produto vendo a produção — "esse risco verde
                        // atrapalhando o visual")
                        linhaDoAgora?.horario === linha.horario
                          && agora !== null
                          && dataDaCelula(coluna, data) === agora.data
                          && "relative before:pointer-events-none before:absolute before:inset-x-0 before:h-px before:-translate-y-1/2 before:bg-destaque before:content-['']",
                        linhaDoAgora?.horario === linha.horario
                          && agora !== null
                          && dataDaCelula(coluna, data) === agora.data
                          && (celula.alturaEmSlots > 1 ? 'before:top-(--agora-celula)' : 'before:top-(--agora)'),
                        // feedback do arrasto: a camada marca `data-alvo-arrasto`
                        // imperativamente; quem pinta é o CSS — zero re-render.
                        // O fundo suave sozinho não fecha 3:1 (1.4.11): o alvo
                        // ganha um TRAÇO interno forte (outline não mexe em
                        // layout) — sólido no acento = aceita; TRACEJADO no
                        // perigo = recusa (padrão ≠ cor, 1.4.1).
                        'data-[alvo-arrasto=aceita]:bg-selecao data-[alvo-arrasto=aceita]:outline-2 data-[alvo-arrasto=aceita]:-outline-offset-2 data-[alvo-arrasto=aceita]:outline-acento',
                        'data-[alvo-arrasto=recusa]:bg-perigo-suave data-[alvo-arrasto=recusa]:outline-2 data-[alvo-arrasto=recusa]:outline-dashed data-[alvo-arrasto=recusa]:-outline-offset-2 data-[alvo-arrasto=recusa]:outline-perigo data-[alvo-arrasto=recusa]:cursor-not-allowed',
                      )}
                    >
                      {celula.indisponivel && celula.cards.length === 0 ? (
                        <span className="sr-only">Fora do horário de atendimento</span>
                      ) : null}


                      {/*
                        `relative` NÃO é layout: é ordem de pintura.

                        A linha do agora é um `::before` ABSOLUTO da `<td>`; a pilha de cards era
                        conteúdo ESTÁTICO. Pela ordem de pintura do CSS, o descendente posicionado
                        (passo 8) vem depois do conteúdo em fluxo (passos 4–7) — então o traço
                        verde passava POR CIMA do card e riscava o nome do paciente. E como sessão
                        começa em hora redonda, isso acontecia o tempo todo (o dono do produto viu
                        na produção).

                        Posicionar a pilha põe os dois na MESMA camada; aí quem decide é a ordem de
                        árvore, e a pilha vem depois do `::before`. Sem `z-index` de propósito: com
                        um número, a pilha passaria a disputar com o cabeçalho `sticky`
                        (`z-(--z-fixo)`), que hoje ganha por ter z explícito. A linha continua
                        visível nos 4px de `p-1` em volta do card e nas colunas vazias — ela
                        atravessa a grade, só não risca o texto.
                      */}
                      <div className="relative flex flex-col gap-1">
                        {celula.cards.map((card) => (
                          <CardAgendamento
                            key={card.id}
                            card={card}
                            aoAbrir={podeVer ? aoAbrirCard : undefined}
                            aoRemarcar={podeArrastar ? aoRemarcarCard : undefined}
                            // sem permissão de editar, o chip continua sendo só
                            // texto (nada de menu que não pode agir)
                            chip={chipDoCard}
                          />
                        ))}
                      </div>

                      {/*
                        O convite vem DEPOIS da pilha: primeiro o que aconteceu naquele horário,
                        depois a oferta de usá-lo de novo. Numa célula vazia a ordem era indiferente
                        (não havia card); numa célula cuja situação LIBERA o horário, não é —
                        o histórico é a explicação de por que o horário voltou a estar livre.

                        Ele soma 32px à linha quando divide a célula com um card. Aceito: aquele slot
                        passou mesmo a ter duas coisas. Posicionar o convite por cima entraria em rota
                        de colisão com o `::before` da linha do agora, logo abaixo.
                      */}
                      {slotParaMarcar || slotComoAlvoDeRemarcacao ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (alvoDaCelula === null) {
                              return
                            }
                            if (slotComoAlvoDeRemarcacao) {
                              aoEscolherAlvo?.(alvoDaCelula)
                              return
                            }
                            aoMarcarNoSlot?.({
                              profissionalId: alvoDaCelula.profissionalId,
                              inicio: `${alvoDaCelula.data} ${linha.horario}`,
                            })
                          }}
                          // na visão Semana a coluna é um DIA: o nome acessível
                          // precisa dizer o dia E o profissional
                          aria-label={
                            slotComoAlvoDeRemarcacao
                              ? coluna.profissionalId !== undefined
                                ? `Remarcar para ${linha.horario} com ${coluna.rotulo}`
                                : `Remarcar para ${linha.horario} em ${coluna.rotulo} com ${nomeDoProfissionalDaVisao ?? 'o profissional selecionado'}`
                              : coluna.profissionalId !== undefined
                                ? `Marcar às ${linha.horario} com ${coluna.rotulo}`
                                : `Marcar às ${linha.horario} em ${coluna.rotulo} com ${nomeDoProfissionalDaVisao ?? 'o profissional selecionado'}`
                          }
                          className={cn(
                            'flex h-8 w-full items-center justify-center gap-1.5 rounded-campo text-texto-suave opacity-0 transition-opacity duration-(--duracao-1) hover:bg-acento-suave hover:text-acento hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
                            // no modo, o alvo fica VISÍVEL — quem navega por
                            // teclado não pode depender de hover para achar o slot
                            slotComoAlvoDeRemarcacao && 'bg-acento-suave text-acento opacity-100',
                          )}
                        >
                          <Plus aria-hidden="true" className="size-4" />
                          {/* o convite em PALAVRAS (aparece com o hover/foco do botão): o mesmo
                              começo do nome acessível, para "rótulo no nome" (2.5.3) */}
                          <span className="text-meta font-medium">
                            {slotComoAlvoDeRemarcacao ? `Remarcar para ${linha.horario}` : `Marcar às ${linha.horario}`}
                          </span>
                        </button>
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>

          {/* O gesto vive num IRMÃO da tabela: o estado do arrasto (ghost montado)
              nunca re-renderiza a grade — piso §16 com 20 profissionais × dia. */}
          {arrastoLigado ? (
            <CamadaDeArrasto
              conteinerRef={refConteiner}
              buscarCard={buscarCard}
              aoSoltar={aoSoltarCard}
              aoMudarArrasto={aoMudarArrasto}
            />
          ) : null}
      </div>


    </div>
  )
}
