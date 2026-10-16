import { useMutation, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { StatusDaSelecao } from '@/lib/baixa-em-lote'

import { AcaoDoPreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { Dialog } from '@/componentes/ui/dialog'
import { Realce } from '@/componentes/ui/realce'
import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { CAMINHOS, usePodeResolver } from '@/lib/caminhos-dos-cadastros'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { MOTIVO_DA_RECUSA } from '@/lib/desmarque-em-lote'
import {
  executarDesmarqueEmLote,
  preverDesmarqueEmLote,
  type AlcanceDoDesmarque,
  type PreviaDoDesmarque,
  type ResultadoDoDesmarque,
} from '@/servicos/agenda'
import { useAuthStore } from '@/stores/auth-store'

/**
 * SÓ os campos que existem como widget nesta tela. `status_id` e `periodo` ficaram de fora de
 * propósito: a recusa por status não-configurado vem em `status_id`, e enquanto essa chave
 * esteve aqui a mensagem era roteada para um campo inexistente e SUMIA — a recepcionista
 * clicava "Desmarcar 7" e não acontecia nada visível (achado na conferência ao vivo). Fora da
 * lista, ela cai no aviso geral do topo, que é onde alguém a lê.
 */
const CAMPOS = new Set(['de', 'ate', 'motivo'])

const PERIODOS: { valor: AlcanceDoDesmarque['periodo']; rotulo: string }[] = [
  { valor: 'manha', rotulo: 'Manhã' },
  { valor: 'tarde', rotulo: 'Tarde' },
  { valor: 'dia', rotulo: 'Dia inteiro' },
]

/**
 * O que falta, por quê e onde se resolve (change `o-sistema-avisa-o-que-falta`, D4). O nome da aba e
 * o do ajuste são os do catálogo de configurações (`agenda.status_desmarque_id`, seção Agenda).
 */
const FALTA_O_STATUS_DO_DESMARQUE =
  'o status que os agendamentos recebem quando a agenda é desmarcada. Sem ele, o desmarque é recusado. Fica em Configurações › Agenda, em “Status aplicado ao desmarcar a agenda do profissional”.'

/**
 * A seleção da agenda diz qual status é o do desmarque (`desmarque_da_clinica`)? Só afirma que FALTA
 * quando a seleção chegou E conhece a flag: payload sem ela não promete nada — e a recusa do servidor
 * continua dizendo o que falta, como antes.
 */
function faltaOStatusDoDesmarque(status: readonly StatusDaSelecao[] | undefined): boolean {
  if (status === undefined || !status.some((item) => item.desmarque_da_clinica !== undefined)) {
    return false
  }

  return !status.some((item) => item.desmarque_da_clinica === true)
}

/** Quantas famílias por motivo — a lista crua repetia a mesma frase e não dizia nada. */
function agruparPorMotivo(itens: { motivo: string }[]): Map<string, number> {
  const porMotivo = new Map<string, number>()
  for (const item of itens) {
    porMotivo.set(item.motivo, (porMotivo.get(item.motivo) ?? 0) + 1)
  }

  return porMotivo
}

interface DesmarqueEmLoteProps {
  aberto: boolean
  aoFechar: () => void
  profissionalId: number
  nomeDoProfissional: string
  /** A data que a agenda está mostrando — o alcance nasce nela. */
  dataDaAgenda: string
  /** Leva ao desmarque de UM agendamento, que é o fluxo que já existe. */
  aoEscolherHorarioEspecifico: () => void
  /**
   * Os status da seleção que a página da agenda JÁ carregou (como na baixa em lote): o aviso de
   * configuração sai deles, sem requisição (D4/D6). `undefined` = ainda não chegaram — nada se afirma.
   */
  status?: readonly StatusDaSelecao[]
}

/**
 * Baixa em massa da agenda de um profissional (change `desmarque-do-profissional`).
 *
 * O diálogo abre PERGUNTANDO o alcance, e uma das saídas é "um horário específico" — que
 * devolve ao desmarque individual já existente, em vez de criar um segundo caminho para a
 * mesma coisa.
 *
 * A execução só fica disponível DEPOIS da prévia, e mudar qualquer parte do alcance invalida
 * a prévia carregada: a proteção desta tela é toda antes do clique, porque depois dele não há
 * desfazer para a parte que saiu pelo WhatsApp.
 */
export function DesmarqueEmLote({
  aberto,
  aoFechar,
  profissionalId,
  nomeDoProfissional,
  dataDaAgenda,
  aoEscolherHorarioEspecifico,
  status,
}: DesmarqueEmLoteProps) {
  const queryClient = useQueryClient()
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const podeAvisar = temPermissao('mensagens.responder')
  const { erros, limparErros, aoFalhar } = usarErrosDoServidor(CAMPOS)

  // Antes deste aviso, a falta do status só aparecia como 422 DEPOIS da prévia e do clique em "Desmarcar"
  const faltaStatus = faltaOStatusDoDesmarque(status)
  const podeConfigurar = usePodeResolver(CAMINHOS.configuracoes)

  const [de, setDe] = useState(dataDaAgenda)
  const [ate, setAte] = useState(dataDaAgenda)
  const [periodo, setPeriodo] = useState<AlcanceDoDesmarque['periodo']>('dia')
  const [motivo, setMotivo] = useState('')
  const [bloquear, setBloquear] = useState(true)
  // nasce MARCADA (decisão da clínica); sem a permissão de mensagens ela nem é oferecida
  const [avisar, setAvisar] = useState(true)
  const [previa, setPrevia] = useState<PreviaDoDesmarque | null>(null)
  const [resultado, setResultado] = useState<ResultadoDoDesmarque | null>(null)

  const alcance: AlcanceDoDesmarque = { profissionalId, de, ate, periodo }

  /** Qualquer mudança no alcance derruba a prévia: número velho é pior que número nenhum. */
  function invalidarPrevia(): void {
    setPrevia(null)
    setResultado(null)
  }

  const mutacaoDaPrevia = useMutation({
    retry: 0,
    mutationFn: () => preverDesmarqueEmLote(alcance),
    onMutate: limparErros,
    onSuccess: setPrevia,
    onError: aoFalhar,
  })

  const mutacaoDaBaixa = useMutation({
    retry: 0,
    mutationFn: () =>
      executarDesmarqueEmLote(alcance, {
        statusId: null,
        bloquear,
        avisar: podeAvisar && avisar,
        motivo: motivo.trim() === '' ? 'Agenda desmarcada' : motivo.trim(),
      }),
    onMutate: limparErros,
    onSuccess: async (dados) => {
      setResultado(dados)
      setPrevia(null)
      await queryClient.invalidateQueries({ queryKey: chaves.agenda() })
    },
    onError: aoFalhar,
  })

  const contagens = previa?.contagens

  // rolagem e foco UMA vez por marco (prévia que chega, resultado que pousa): em `ref` inline o
  // React reexecutava `scrollIntoView`/`focus` em todo render do pai, e a agenda re-renderiza
  // sozinha a cada minuto — o foco voltava ao título sem gesto (achado do gate da baixa em lote,
  // que herdou esta espinha)
  const caixaDaPrevia = useRef<HTMLDivElement>(null)
  const tituloDoResultado = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (contagens !== undefined) {
      caixaDaPrevia.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [contagens])
  useEffect(() => {
    if (resultado !== null) {
      tituloDoResultado.current?.focus()
    }
  }, [resultado])

  const anuncio = (() => {
    if (resultado !== null) {
      return `Agenda desmarcada: ${String(resultado.desmarcados)} agendamento(s). `
        + (resultado.recusados.length > 0 ? `${String(resultado.recusados.length)} não foram tocados. ` : '')
        + (resultado.nao_avisados.length > 0 ? `${String(resultado.nao_avisados.length)} família(s) para avisar à mão.` : '')
    }
    if (contagens === undefined) {
      return ''
    }
    if (contagens.agendamentos === 0) {
      return 'Nada a desmarcar nesse período.'
    }

    return `Prévia pronta: ${String(contagens.agendamentos)} agendamento(s), `
      + `${String(contagens.criancas)} criança(s)`
      + (podeAvisar && avisar ? `, ${String(contagens.avisos)} mensagem(ns) que não podem ser canceladas depois` : '')
      + `. Botão Desmarcar ${String(contagens.agendamentos)} disponível.`
  })()

  const podeExecutar = previa !== null && contagens !== undefined && contagens.agendamentos > 0

  /**
   * As ações no RODAPÉ FIXO do `Dialog`, não no corpo rolável. O gate mediu o botão que
   * executa a ação irreversível nascendo **fora da vista**: 132px abaixo em 390px e 20px
   * abaixo em 1366×768, que é a resolução de desktop mais comum do país. A spec manda a tela
   * "dizer o número antes do clique" — número renderizado fora do viewport não diz.
   */
  const rodape =
    resultado !== null ? (
      <div className="flex justify-end">
        <Botao type="button" tamanho="lg" onClick={aoFechar}>
          Fechar
        </Botao>
      </div>
    ) : (
      <div className="flex flex-wrap justify-end gap-3">
        <Botao type="button" variante="secundario" tamanho="lg" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao
          type="button"
          // primário enquanto é o ÚNICO caminho adiante (a spec proíbe executar antes dele);
          // secundário depois, quando vira "atualizar o número" — e também quando falta o status do
          // desmarque: aí o caminho adiante é configurar, e o primário é o "Abrir Configurações"
          variante={previa === null && !faltaStatus ? 'primario' : 'secundario'}
          tamanho="lg"
          carregando={mutacaoDaPrevia.isPending}
          onClick={() => {
            mutacaoDaPrevia.mutate()
          }}
        >
          {previa === null ? 'Ver o que será desmarcado' : 'Atualizar os números'}
        </Botao>
        {/* só depois da prévia E com alcance não-vazio: oferecer "Desmarcar 0" num botão de
            perigo é ruído que assusta (achado ao vivo) */}
        {podeExecutar ? (
          <Botao
            type="button"
            variante="perigo"
            tamanho="lg"
            carregando={mutacaoDaBaixa.isPending}
            onClick={() => {
              mutacaoDaBaixa.mutate()
            }}
          >
            Desmarcar {contagens.agendamentos}
          </Botao>
        ) : null}
      </div>
    )

  return (
    <Dialog
      aberto={aberto}
      aoMudarAberto={(estaAberto) => {
        if (!estaAberto) aoFechar()
      }}
      // ACH-2: o cabeçalho continuava dizendo "Nada é desmarcado antes de você ver os números"
      // DEPOIS de 10 desmarcados — a moldura contradizia o corpo
      titulo={
        resultado === null
          ? `Desmarcar a agenda de ${nomeDoProfissional}`
          : `Agenda de ${nomeDoProfissional} desmarcada`
      }
      descricao={
        resultado === null
          ? 'Escolha o alcance. Nada é desmarcado antes de você ver os números.'
          : 'O que aconteceu, e o que ficou para você resolver.'
      }
      rodape={rodape}
    >
      <div className="flex flex-col gap-5">
        {/* A região viva EXISTE ANTES da mensagem, e é por isso que ela é um parágrafo vazio
            aqui em cima: criar a região junto com o conteúdo é o anti-padrão que falha em
            parte dos leitores de tela. Quem aciona a prévia — a proteção inteira desta
            feature — precisa OUVIR os números; antes recebia silêncio (achado do gate). */}
        <p role="status" className="sr-only">
          {anuncio}
        </p>

        {/* ANTES do alcance e da prévia: quem vai desmarcar fica sabendo que falta configurar antes de
            escolher datas e ver números que o servidor não vai aplicar. A ação vai no `acao` só para
            quem pode configurar; sem a permissão, a quem pedir entra no texto — num `acao`, a frase
            longa não quebraria linha e estouraria o diálogo no celular. */}
        {resultado === null && faltaStatus ? (
          <Realce
            tom="atencao"
            rotulo="Falta configurar"
            icone={<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-alerta-texto" />}
            texto={
              podeConfigurar
                ? FALTA_O_STATUS_DO_DESMARQUE
                : `${FALTA_O_STATUS_DO_DESMARQUE} ${CAMINHOS.configuracoes.pedido}`
            }
            acao={
              podeConfigurar ? (
                <AcaoDoPreRequisito para={CAMINHOS.configuracoes} aoNavegar={aoFechar} />
              ) : undefined
            }
          />
        ) : null}

        <AvisoErro mensagens={erros.gerais} />

        {resultado === null ? (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-corpo font-medium text-texto">O que desmarcar</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
                {PERIODOS.map((item) => (
                  <button
                    key={item.valor}
                    type="button"
                    aria-pressed={periodo === item.valor}
                    onClick={() => {
                      setPeriodo(item.valor)
                      invalidarPrevia()
                    }}
                    className={cn(
                      'rounded-controle px-3 py-2 text-corpo transition-colors duration-(--duracao-1)',
                      periodo === item.valor
                        ? 'bg-acento-suave font-semibold text-acento'
                        : 'text-texto-suave hover:bg-hover-de-linha',
                    )}
                  >
                    {item.rotulo}
                  </button>
                ))}
              </div>
              {/* a outra saída: NÃO cria caminho novo, devolve ao desmarque de um agendamento */}
              <button
                type="button"
                onClick={aoEscolherHorarioEspecifico}
                className="self-start rounded-controle px-1 py-1 text-meta text-acento underline underline-offset-2"
              >
                Prefiro desmarcar só um horário específico
              </button>
            </div>

            <div className="flex flex-wrap gap-4">
              {/* `min-w-0` nos dois: sem ele o campo "Até" passava 35px da borda do diálogo a
                  200% de texto em 390px (1.4.4, achado do gate) — a mesma classe de defeito
                  que já mordeu esta equipe duas vezes */}
              <CampoTexto
                className="min-w-0"
                rotulo="De"
                type="date"
                /* o servidor recusa intervalo acima do teto de dias; o `max` evita que a
                   recepcionista descubra isso só depois de digitar (achado do gate) */
                max={ate}
                value={de}
                erro={erros.campos.get('de')}
                onChange={(evento) => {
                  setDe(evento.target.value)
                  invalidarPrevia()
                }}
              />
              <CampoTexto
                className="min-w-0"
                rotulo="Até"
                type="date"
                min={de}
                value={ate}
                erro={erros.campos.get('ate')}
                onChange={(evento) => {
                  setAte(evento.target.value)
                  invalidarPrevia()
                }}
              />
            </div>

            <CampoTexto
              rotulo="Motivo"
              ajuda="Vira o rótulo do bloqueio na grade."
              value={motivo}
              erro={erros.campos.get('motivo')}
              onChange={(evento) => {
                setMotivo(evento.target.value)
              }}
            />

            <CampoCheckbox
              rotulo="Bloquear o período na agenda"
              ajuda="O profissional não está — sem o bloqueio, alguém pode marcar em cima por engano."
              marcado={bloquear}
              aoMudar={setBloquear}
            />

            {podeAvisar ? (
              <CampoCheckbox
                rotulo="Avisar as famílias pelo WhatsApp"
                ajuda="As mensagens saem assim que o desmarque é confirmado."
                marcado={avisar}
                aoMudar={setAvisar}
              />
            ) : (
              <p className="text-meta text-texto-suave">
                Você não tem permissão para enviar mensagens. A lista de famílias a avisar
                aparece ao final, para avisar à mão.
              </p>
            )}

            {contagens === undefined ? null : (
              <div
                // quem enxerga precisa VER os números: em 390 a caixa nascia com 49 de 157px na
                // vista, com o número cortado no meio (achado do gate) — a rolagem está no effect
                ref={caixaDaPrevia}
                className="flex flex-col gap-2 rounded-superficie border border-linha bg-fundo p-4"
              >
                <p className="text-corpo font-medium text-texto">
                  {contagens.agendamentos} agendamento(s) · {contagens.criancas} criança(s)
                  {podeAvisar && avisar ? ` · ${contagens.avisos} mensagem(ns)` : ''}
                </p>
                {/* o bloqueio é a maior quantidade que a operação grava, e a prévia dizia
                    apenas "1 agendamento" enquanto o servidor escrevia 1206 linhas (achado do
                    gate de segurança). O número que a pessoa confirma tem de ser o maior. */}
                {bloquear && contagens.bloqueios > 0 && contagens.agendamentos > 0 ? (
                  <p className="text-meta text-texto-suave">
                    {contagens.bloqueios} bloqueio(s) de agenda serão criados, um por dia.
                  </p>
                ) : null}
                {contagens.agendamentos === 0 ? (
                  <p className="text-meta text-texto-suave">
                    Nada a desmarcar nesse período — escolha outra data ou outro período.
                  </p>
                ) : null}
                {contagens.sessoes_estornadas > 0 ? (
                  <p className="text-meta text-texto-suave">
                    {contagens.sessoes_estornadas} sessão(ões) volta(m) para o saldo do pacote.
                  </p>
                ) : null}
                {podeAvisar && avisar && contagens.avisos > 0 ? (
                  <p className="text-meta text-perigo-texto">
                    As mensagens não podem ser canceladas depois de enviadas.
                  </p>
                ) : null}
                {previa !== null && previa.recusados.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-meta font-medium text-texto">Não serão tocados:</p>
                    <ul className="flex flex-col gap-0.5">
                      {previa.recusados.map((item) => (
                        <li key={item.id} className="text-meta text-texto-suave">
                          {item.inicio} — {MOTIVO_DA_RECUSA[item.motivo] ?? item.motivo}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}

          </>
        ) : (
          <div className="flex flex-col gap-3">
            {/* o conteúdo do diálogo é SUBSTITUÍDO por completo; sem levar o foco até aqui
                ninguém é conduzido às listas que o resultado existe para entregar */}
            <h3 tabIndex={-1} ref={tituloDoResultado} className="text-corpo font-medium text-texto">
              {resultado.desmarcados} agendamento(s) desmarcado(s)
              {resultado.avisados > 0 ? ` · ${resultado.avisados} família(s) avisada(s)` : ''}.
            </h3>
            {resultado.recusados.length > 0 ? (
              <div className="flex flex-col gap-1">
                <h4 className="text-meta font-medium text-texto">Não foram tocados:</h4>
                <ul className="flex flex-col gap-0.5">
                  {resultado.recusados.map((item) => (
                    <li key={item.id} className="text-meta text-texto-suave">
                      {item.inicio} — {MOTIVO_DA_RECUSA[item.motivo] ?? item.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {resultado.nao_avisados.length > 0 ? (
              <div className="flex flex-col gap-1">
                <h4 className="text-meta font-medium text-texto">
                  {resultado.nao_avisados.length} família(s) que você precisa avisar:
                </h4>
                {/* AGRUPADO por motivo: a lista repetia a mesma frase uma vez por família e
                    não dizia QUEM — três linhas iguais não dão o que fazer (achado ao vivo).
                    O nome da criança não vem de propósito: a resposta carrega só o id, e nome
                    de menor não trafega onde não precisa (§12). Quem precisa dos nomes olha a
                    grade, que já está atualizada com os desmarcados. */}
                <ul className="flex flex-col gap-0.5">
                  {[...agruparPorMotivo(resultado.nao_avisados)].map(([motivo, quantas]) => (
                    <li key={motivo} className="text-meta text-texto-suave">
                      {quantas} — {motivo}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Dialog>
  )
}
