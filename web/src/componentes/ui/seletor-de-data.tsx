import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'

import { Botao } from '@/componentes/ui/botao'
import { Popover } from '@/componentes/ui/popover'
import { cn } from '@/lib/cn'
import { isoDeTextoDigitado, mascararData } from '@/lib/data-digitada'
import { dataLegivel, NOMES_DOS_MESES, periodoEmPalavras } from '@/lib/datas'
import { dataEhValida, diaDaSemana, somarDias } from '@/lib/grade-agenda'

/** Semana começa na segunda, como a grade da agenda (`inicioDaSemana`). */
const DIAS_DA_SEMANA_CURTOS = [
  { curto: 'seg', longo: 'segunda-feira' },
  { curto: 'ter', longo: 'terça-feira' },
  { curto: 'qua', longo: 'quarta-feira' },
  { curto: 'qui', longo: 'quinta-feira' },
  { curto: 'sex', longo: 'sexta-feira' },
  { curto: 'sáb', longo: 'sábado' },
  { curto: 'dom', longo: 'domingo' },
] as const

const ANOS_PARA_TRAS = 10
const ANOS_PARA_FRENTE = 5
/** 6 semanas sempre: a grade não muda de altura ao trocar de mês. */
const CELULAS = 42
const DIAS_POR_SEMANA = 7

interface AnoEMes {
  ano: number
  mes: number
}

function anoEMes(iso: string): AnoEMes {
  const [ano = 0, mes = 1] = iso.split('-').map(Number)

  return { ano, mes }
}

function primeiroDoMes({ ano, mes }: AnoEMes): string {
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-01`
}

function somarMeses({ ano, mes }: AnoEMes, delta: number): AnoEMes {
  const indice = ano * 12 + (mes - 1) + delta

  return { ano: Math.floor(indice / 12), mes: (indice % 12) + 1 }
}

/** O mesmo dia do mês no mês pedido — ou o último dia dele, quando o dia não existe (31 → 30). */
function mesmoDiaNoMes(iso: string, alvo: AnoEMes): string {
  const candidato = `${primeiroDoMes(alvo).slice(0, 8)}${iso.slice(8)}`
  if (dataEhValida(candidato)) {
    return candidato
  }

  return somarDias(primeiroDoMes(somarMeses(alvo, 1)), -1)
}

/** Recuo até a segunda-feira da semana: 0 (segunda) … 6 (domingo). */
function recuoAteSegunda(iso: string): number {
  return (diaDaSemana(iso) + 6) % DIAS_POR_SEMANA
}

export interface SeletorDeDataProps {
  /** Rótulo do campo (só para leitor de tela) — é o nome acessível, ex.: "Data da agenda". */
  rotulo: string
  /** `AAAA-MM-DD` válido. */
  valor: string
  aoMudar: (data: string) => void
  /** `AAAA-MM-DD` de hoje NA CLÍNICA (nunca o relógio do navegador), para o marcador do calendário. */
  hoje?: string
  /** Sem raio nas pontas: para viver entre `‹` e `›` num grupo encadeado. */
  encadeado?: boolean
  /**
   * Recusa vinda de FORA (o servidor não aceitou esta data): acende a mesma pele de erro da data
   * mal digitada. Sozinho o campo só sabe o que é data de calendário — "depois de hoje" ou "o
   * teto do lote" quem sabe é a tela.
   */
  recusado?: boolean
  /** `id` da mensagem que explica a recusa — o campo aponta para ela (`aria-describedby`). */
  idDaRecusa?: string
  id?: string
  className?: string
}

/**
 * Data digitada + calendário — nunca o `<input type="date">` do navegador.
 *
 * O seletor nativo é um espaço por segmento (dia, mês, ano) e um calendário que só anda de mês
 * em mês; trocar o ANO exige achar o segmento certo e teclar setas (achado do usuário,
 * 2026-09-02: "não consigo arrumar o ano"). Aqui há dois caminhos, ambos rápidos:
 * digitar `dd/mm/aaaa` (a máscara põe as barras) ou abrir o calendário, onde mês e ano são
 * LISTAS — dois cliques levam a qualquer ano.
 *
 * Enquanto o campo está em edição ele mostra o que foi digitado; ao sair, volta a mostrar o
 * valor de verdade — texto que não é data some sozinho, sem mensagem e sem travar a tela.
 * O calendário é uma grade APG: uma célula tabulável por vez, setas andam entre os dias,
 * PageUp/PageDown trocam o mês, Enter escolhe, Esc fecha devolvendo o foco ao gatilho.
 */
export function SeletorDeData({
  rotulo,
  valor,
  aoMudar,
  hoje,
  encadeado = false,
  recusado = false,
  idDaRecusa,
  id: idExterno,
  className,
}: SeletorDeDataProps) {
  const idGerado = useId()
  const id = idExterno ?? idGerado
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')
  const [calendarioAberto, setCalendarioAberto] = useState(false)

  const exibido = editando ? texto : dataLegivel(valor)
  const malDigitado = editando && texto.length === 10 && isoDeTextoDigitado(texto) === null

  function aoDigitar(evento: ChangeEvent<HTMLInputElement>) {
    const mascarado = mascararData(evento.target.value)
    setTexto(mascarado)
    const iso = isoDeTextoDigitado(mascarado)
    if (iso !== null && iso !== valor) {
      aoMudar(iso)
    }
  }

  return (
    <div className={cn('inline-flex items-center', className)}>
      <label className="sr-only" htmlFor={id}>
        {rotulo}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        maxLength={10}
        value={exibido}
        // as duas recusas acendem a mesma pele, e a de fora traz junto a mensagem que a explica
        aria-invalid={malDigitado || recusado || undefined}
        aria-describedby={idDaRecusa}
        onFocus={() => {
          setTexto(dataLegivel(valor))
          setEditando(true)
        }}
        onBlur={() => {
          setEditando(false)
        }}
        onChange={aoDigitar}
        className={cn(
          'relative h-8 w-28 border border-borda-campo bg-superficie px-2 text-corpo font-medium tabular-nums text-texto',
          'placeholder:text-texto-desativado hover:bg-fundo focus-visible:z-(--z-fixo)',
          'aria-invalid:border-perigo aria-invalid:text-perigo-texto',
          encadeado ? '-ml-px' : 'rounded-l-campo',
        )}
      />
      <Popover
        aberto={calendarioAberto}
        aoMudarAberto={setCalendarioAberto}
        titulo="Escolher a data"
        gatilho={
          <Botao
            variante="secundario"
            tamanho="sm"
            aria-label="Abrir o calendário"
            className={cn(
              'relative -ml-px rounded-l-none px-2 focus-visible:z-(--z-fixo)',
              encadeado && 'rounded-r-none',
            )}
          >
            <CalendarDays aria-hidden="true" className="size-4" />
          </Botao>
        }
      >
        {calendarioAberto ? (
          <Calendario
            valor={valor}
            hoje={hoje}
            aoEscolher={(iso) => {
              aoMudar(iso)
              setCalendarioAberto(false)
            }}
          />
        ) : null}
      </Popover>
    </div>
  )
}

interface CalendarioProps {
  valor: string
  hoje?: string
  aoEscolher: (iso: string) => void
}

function Calendario({ valor, hoje, aoEscolher }: CalendarioProps) {
  const [visivel, setVisivel] = useState<AnoEMes>(() => anoEMes(valor))
  // a ÚNICA célula tabulável da grade (roving tabindex, padrão APG)
  const [focado, setFocado] = useState(valor)
  const refGrade = useRef<HTMLTableElement>(null)
  const moverFoco = useRef(false)
  const idMes = useId()
  const idAno = useId()
  const idLegenda = useId()

  // O foco só é MOVIDO quando foi o teclado que pediu: com o mouse, `focado` acompanha o
  // clique e não há nada a mover.
  useEffect(() => {
    if (!moverFoco.current) {
      return
    }
    moverFoco.current = false
    refGrade.current?.querySelector<HTMLButtonElement>(`[data-dia="${focado}"]`)?.focus()
  }, [focado])

  const primeiro = primeiroDoMes(visivel)
  const inicioDaGrade = somarDias(primeiro, -recuoAteSegunda(primeiro))
  const dias = Array.from({ length: CELULAS }, (_, indice) => somarDias(inicioDaGrade, indice))
  const semanas = Array.from({ length: CELULAS / DIAS_POR_SEMANA }, (_, indice) =>
    dias.slice(indice * DIAS_POR_SEMANA, (indice + 1) * DIAS_POR_SEMANA),
  )
  const prefixoDoMes = primeiro.slice(0, 7)
  const anos = Array.from(
    { length: ANOS_PARA_TRAS + ANOS_PARA_FRENTE + 1 },
    (_, indice) => visivel.ano - ANOS_PARA_TRAS + indice,
  )

  /** Cabeçalho (setas e listas): muda o mês à vista e leva a célula tabulável junto, sem focar. */
  function mostrarMes(alvo: AnoEMes) {
    setVisivel(alvo)
    setFocado(mesmoDiaNoMes(focado, alvo))
  }

  /** Teclado na grade: move a célula tabulável, abre o mês dela se preciso e FOCA. */
  function irPara(iso: string) {
    moverFoco.current = true
    setFocado(iso)
    const alvo = anoEMes(iso)
    if (alvo.ano !== visivel.ano || alvo.mes !== visivel.mes) {
      setVisivel(alvo)
    }
  }

  function aoTeclar(evento: KeyboardEvent<HTMLTableElement>) {
    const passos: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    const passo = passos[evento.key]
    if (passo !== undefined) {
      evento.preventDefault()
      irPara(somarDias(focado, passo))

      return
    }
    if (evento.key === 'Home' || evento.key === 'End') {
      evento.preventDefault()
      const recuo = recuoAteSegunda(focado)
      irPara(somarDias(focado, evento.key === 'Home' ? -recuo : DIAS_POR_SEMANA - 1 - recuo))

      return
    }
    if (evento.key === 'PageUp' || evento.key === 'PageDown') {
      evento.preventDefault()
      irPara(mesmoDiaNoMes(focado, somarMeses(anoEMes(focado), evento.key === 'PageUp' ? -1 : 1)))
    }
  }

  const controleDeLista =
    'h-8 rounded-controle border border-borda-campo bg-superficie px-2 text-corpo text-texto'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Botao
          variante="secundario"
          tamanho="sm"
          aria-label="Mês anterior"
          className="px-2"
          onClick={() => {
            mostrarMes(somarMeses(visivel, -1))
          }}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </Botao>
        <label className="sr-only" htmlFor={idMes}>
          Mês
        </label>
        <select
          id={idMes}
          value={visivel.mes}
          onChange={(evento) => {
            mostrarMes({ ano: visivel.ano, mes: Number(evento.target.value) })
          }}
          className={cn(controleDeLista, 'min-w-0 flex-1')}
        >
          {NOMES_DOS_MESES.map((nome, indice) => (
            <option key={nome} value={indice + 1}>
              {nome}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={idAno}>
          Ano
        </label>
        <select
          id={idAno}
          value={visivel.ano}
          onChange={(evento) => {
            mostrarMes({ ano: Number(evento.target.value), mes: visivel.mes })
          }}
          className={cn(controleDeLista, 'w-24 tabular-nums')}
        >
          {anos.map((ano) => (
            <option key={ano} value={ano}>
              {ano}
            </option>
          ))}
        </select>
        <Botao
          variante="secundario"
          tamanho="sm"
          aria-label="Próximo mês"
          className="px-2"
          onClick={() => {
            mostrarMes(somarMeses(visivel, 1))
          }}
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </Botao>
      </div>

      <table
        ref={refGrade}
        role="grid"
        aria-labelledby={idLegenda}
        onKeyDown={aoTeclar}
        className="w-full border-separate border-spacing-1 text-center"
      >
        <caption id={idLegenda} className="sr-only">
          {NOMES_DOS_MESES[visivel.mes - 1]} de {visivel.ano}
        </caption>
        <thead>
          <tr>
            {DIAS_DA_SEMANA_CURTOS.map((dia) => (
              <th key={dia.curto} scope="col" className="pb-1 text-meta font-medium text-texto-suave">
                <abbr title={dia.longo} className="no-underline">
                  {dia.curto}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semanas.map((semana) => (
            <tr key={semana[0]}>
              {semana.map((iso) => {
                const selecionado = iso === valor
                const ehHoje = iso === hoje
                const doMes = iso.startsWith(prefixoDoMes)

                return (
                  <td key={iso} role="gridcell" aria-selected={selecionado} className="p-0">
                    <button
                      type="button"
                      data-dia={iso}
                      tabIndex={iso === focado ? 0 : -1}
                      aria-label={periodoEmPalavras(iso) ?? iso}
                      aria-current={ehHoje ? 'date' : undefined}
                      onClick={() => {
                        aoEscolher(iso)
                      }}
                      onFocus={() => {
                        setFocado(iso)
                      }}
                      className={cn(
                        'mx-auto flex size-9 items-center justify-center rounded-controle text-corpo tabular-nums',
                        'transition-colors duration-(--duracao-1) hover:bg-acento-suave',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
                        !doMes && 'text-texto-desativado',
                        ehHoje && 'border border-destaque font-semibold text-acento',
                        // escolhido, o preenchimento já marca: a borda de "hoje" toma a cor dele, senão
                        // o destaque do tema contornaria o preenchimento (change tema-da-clinica)
                        selecionado && 'border-acento bg-acento font-semibold text-sobre-acento hover:bg-acento-intenso',
                      )}
                    >
                      {Number(iso.slice(8))}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
