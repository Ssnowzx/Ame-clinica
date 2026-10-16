import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarSearch } from 'lucide-react'
import { useEffect, useId, useRef, useState, type Ref } from 'react'
import { Link } from 'react-router-dom'

import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { ChipStatus } from '@/componentes/ui/chip-status'
import { Dialog } from '@/componentes/ui/dialog'
import { Segmento } from '@/componentes/ui/segmento'
import { SeletorDeData } from '@/componentes/ui/seletor-de-data'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import {
  agruparPorMotivo,
  anuncioDaPreviaVazia,
  consequenciaDoStatus,
  diaEMes,
  diaEmPalavrasCurto,
  fraseDaPreviaVazia,
  intervaloDoAlcance,
  partesDoInicio,
  plural,
  statusAplicaveisEmLote,
  tituloDoGrupo,
  type AlcanceDaTela,
  type StatusDaSelecao,
} from '@/lib/baixa-em-lote'
import { chaves } from '@/lib/chaves-query'
import { ErroDeApi } from '@/lib/http'
import { executarBaixaEmLote, preverBaixaEmLote } from '@/servicos/agenda'
import { useAuthStore } from '@/stores/auth-store'
import type { AlcanceDaBaixa, PreviaDaBaixa, RecusaDaBaixa, ResultadoDaBaixa } from '@/tipos'

/**
 * Só os campos que existem como widget nesta tela. `status_id` ENTRA (diferente do desmarque):
 * aqui o status é escolhido no diálogo, e a recusa dele pousa sob "Marcar como".
 */
const CAMPOS = new Set(['de', 'ate', 'status_id', 'profissional_id'])

/** Mudança explícita de status ou alcance reagenda a prévia depois deste silêncio (D4). */
const ATRASO_DA_PREVIA_MS = 500

/**
 * Piso de duração da RECONFERÊNCIA — o clique em "Atualizar os números".
 *
 * A prévia volta em ~30 ms e, quando os números são os MESMOS, a tela ficava idêntica: o
 * skeleton e o spinner nasciam e morriam rápido demais para serem vistos, e o botão era lido
 * como quebrado ("aperto em atualizar não faz nada" — o dono do produto, ao vivo).
 *
 * O piso não ATRASA a resposta: corre junto com a chamada, então rede lenta já o cumpre sozinha
 * e não paga nada a mais. É o mesmo meio segundo do silêncio de D4 de propósito — toda
 * conferência mostra a caixa carregando pelo mesmo tempo, venha de onde vier.
 *
 * Vale igual para quem OUVE: a região viva fica vazia durante o piso, então a MESMA frase
 * voltando é conteúdo NOVO para o leitor de tela, e não uma mutação coalescida em 30 ms — sem
 * isso o defeito se repetia no áudio. E nada disso é animação: sob `prefers-reduced-motion` o
 * pulse do skeleton morre (CSS global) e a batida continua de pé, porque o que muda é CONTEÚDO.
 */
const DURACAO_MINIMA_DA_CONFERENCIA_MS = 500

/**
 * De onde veio o pedido de prévia — é a origem que decide as DUAS temporizações: o silêncio
 * antes de disparar (só `ajuste`) e o piso de duração visível (só `reconferencia`).
 *
 * `abertura` e `ajuste` não precisam do piso: abrir o diálogo já é a mudança inteira da tela, e
 * o ajuste passa 500 ms de skeleton ANTES mesmo de disparar. Quem não tinha batida nenhuma era
 * a reconferência, e só ela paga por uma.
 */
type OrigemDoPedido = 'abertura' | 'ajuste' | 'reconferencia'

/** Uma pausa como promessa: o piso precisa ser ESPERADO junto com a chamada, não agendado à parte. */
function esperar(ms: number): Promise<void> {
  return new Promise<void>((resolver) => {
    window.setTimeout(() => {
      resolver()
    }, ms)
  })
}

const ALCANCES: ReadonlyArray<{ valor: AlcanceDaTela; rotulo: string }> = [
  { valor: 'dia', rotulo: 'Dia à vista' },
  { valor: 'ultimos7', rotulo: 'Últimos 7 dias' },
  { valor: 'datas', rotulo: 'Escolher datas' },
]

const MENSAGEM_DO_CICLO = 'A produção deste período está sendo fechada agora — tente de novo em instantes.'
const MENSAGEM_DE_ESCOPO = 'Fora do seu escopo de profissional.'

interface BaixaEmLoteProps {
  aberto: boolean
  aoFechar: () => void
  profissionalId: number
  nomeDoProfissional: string
  /** A data que a agenda está mostrando — "Dia à vista" é ela, "Últimos 7 dias" conta para trás dela. */
  dataDaAgenda: string
  /** Hoje NA CLÍNICA (marcador do calendário; o servidor recusa `ate` depois disto). */
  hoje: string
  /** Os status da seleção da agenda — com `aplicavel_em_lote` (D13). */
  status: readonly StatusDaSelecao[]
  /** Fecha o diálogo e leva o foco ao card daquele agendamento (navegando de data se preciso). */
  aoLocalizarAgendamento: (id: number, data: string) => void
  /** O botão "Dar baixa" da barra — destino do foco ao fechar (2.4.3). */
  focoAoFechar?: () => HTMLElement | null
}

/**
 * Dar baixa em toda a agenda em aberto de um profissional (change `baixa-em-lote-por-status`).
 *
 * A prévia numerada É a confirmação (D15): o título nomeia o profissional, o botão carrega o
 * status e o número, a consequência no saldo está escrita — não há um segundo "tem certeza?".
 * A proteção é toda antes do clique: este gesto CONSOME sessões de propósito, e desfazer é
 * criança por criança, pelo card. O número que ela leu é o número que roda: assinatura e
 * referência da prévia voltam na execução, e agenda que mudou vira 409 com a prévia nova (D5).
 */
export function BaixaEmLote({
  aberto,
  aoFechar,
  profissionalId,
  nomeDoProfissional,
  dataDaAgenda,
  hoje,
  status,
  aoLocalizarAgendamento,
  focoAoFechar,
}: BaixaEmLoteProps) {
  const queryClient = useQueryClient()
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  // sem toast: toda recusa pousa DENTRO do diálogo (aviso geral sempre montado; `status_id` sob
  // "Marcar como"; `de`/`ate` no campo ou no aviso geral) — o toast era a mesma frase pela
  // terceira vez e roubava o Esc (achado do gate; gatilho TOAST-ROUBA-O-ESC)
  const { erros, limparErros, aoFalhar } = usarErrosDoServidor(CAMPOS, { toast: false })

  const aplicaveis = statusAplicaveisEmLote(status)
  // o primeiro aplicável por `ordem` nasce marcado (D4) — a clínica reordena se quiser outro padrão
  const [statusId, setStatusId] = useState<number | null>(aplicaveis[0]?.id ?? null)
  const [alcanceDaTela, setAlcanceDaTela] = useState<AlcanceDaTela>('dia')
  const [datas, setDatas] = useState({ de: dataDaAgenda, ate: dataDaAgenda })
  const [previa, setPrevia] = useState<PreviaDaBaixa | null>(null)
  const [resultado, setResultado] = useState<ResultadoDaBaixa | null>(null)
  const [avisoDeMudanca, setAvisoDeMudanca] = useState<string | null>(null)
  // cada pedido de prévia: o primeiro (ao abrir) e "Atualizar os números" são imediatos; mudança
  // de status ou alcance espera 500 ms de silêncio (D4). A ORIGEM viaja junto porque também
  // decide o piso de duração visível da reconferência.
  const [pedidoDePrevia, setPedidoDePrevia] = useState<{ versao: number; origem: OrigemDoPedido }>({
    versao: 0,
    origem: 'abertura',
  })
  // a prévia que a pessoa leu no momento do clique — para dizer "1 ficou de fora" no resultado
  const numeroConfirmado = useRef(0)
  // uma prévia em voo para um alcance que já mudou não pode pousar por cima da nova (corrida)
  const serieDaPrevia = useRef(0)
  // os dois alvos possíveis da rolagem: a caixa dos números e, quando existe, o aviso do 409
  const caixaDaPrevia = useRef<HTMLDivElement>(null)
  const avisoDaMudanca = useRef<HTMLParagraphElement>(null)

  const statusEscolhido = aplicaveis.find((item) => item.id === statusId) ?? null
  const { de, ate } = intervaloDoAlcance(alcanceDaTela, dataDaAgenda, datas)
  const alcance: AlcanceDaBaixa = { profissionalId, statusId: statusId ?? 0, de, ate }

  /** Qualquer mudança derruba a prévia e pede outra: número velho é pior que número nenhum. */
  function invalidarPrevia(origem: OrigemDoPedido = 'ajuste'): void {
    serieDaPrevia.current += 1
    setPrevia(null)
    setAvisoDeMudanca(null)
    limparErros()
    setPedidoDePrevia((anterior) => ({ versao: anterior.versao + 1, origem }))
  }

  function traduzirFalha(erro: unknown): void {
    // 403 do escopo D11: a tela é dona do texto, e "sem acesso a este recurso" não diz o caminho
    if (erro instanceof ErroDeApi && erro.motivo === 'sem_acesso') {
      aoFalhar(new ErroDeApi('sem_acesso', MENSAGEM_DE_ESCOPO))
      return
    }
    aoFalhar(erro)
  }

  const mutacaoDaPrevia = useMutation({
    retry: 0,
    mutationFn: async () => {
      const serie = serieDaPrevia.current
      // O piso começa a correr JUNTO com a chamada — é piso, não atraso somado. `.finally` que
      // DEVOLVE promessa adia o pouso até ela resolver e reemite o valor (ou o motivo) original:
      // assim a recusa idêntica — apertar "Atualizar" com o mesmo 422 na tela — também ganha a
      // batida, porque ela some e volta com o mesmo texto pelo mesmo motivo.
      const piso =
        pedidoDePrevia.origem === 'reconferencia'
          ? esperar(DURACAO_MINIMA_DA_CONFERENCIA_MS)
          : Promise.resolve()
      const dados = await preverBaixaEmLote(alcance).finally(() => piso)

      return { serie, dados }
    },
    onMutate: limparErros,
    onSuccess: ({ serie, dados }) => {
      if (serie === serieDaPrevia.current) {
        setPrevia(dados)
      }
    },
    onError: traduzirFalha,
  })

  const mutacaoDaBaixa = useMutation({
    retry: 0,
    mutationFn: () => {
      if (previa === null) {
        throw new Error('sem prévia')
      }
      numeroConfirmado.current = previa.contagens.agendamentos

      return executarBaixaEmLote(alcance, { assinatura: previa.assinatura, referencia: previa.referencia })
    },
    onMutate: limparErros,
    onSuccess: async (desfecho) => {
      if (desfecho.tipo === 'previa_desatualizada') {
        // o corpo é recarregado com a prévia NOVA, nada foi gravado (D5)
        setPrevia(desfecho.previa)
        setAvisoDeMudanca(
          `A agenda mudou desde que você conferiu: agora são ${String(desfecho.previa.contagens.agendamentos)}. Confira e confirme de novo.`,
        )
        return
      }
      if (desfecho.tipo === 'ciclo_em_alteracao') {
        aoFalhar(new ErroDeApi('conflito', MENSAGEM_DO_CICLO))
        return
      }
      setResultado(desfecho.resultado)
      setPrevia(null)
      // UMA invalidação por operação (spec): a grade reflete sem recarregar a página
      await queryClient.invalidateQueries({ queryKey: chaves.agenda() })
    },
    onError: traduzirFalha,
  })

  // A prévia sozinha: cada pedido vira UMA chamada, imediata ou depois do silêncio (D4). O
  // `mutate` lê o alcance do render corrente na hora de disparar — nunca o de quando foi pedido.
  const dispararPrevia = mutacaoDaPrevia.mutate
  useEffect(() => {
    if (statusId === null || resultado !== null) {
      return
    }
    const cronometro = setTimeout(() => {
      dispararPrevia()
    }, pedidoDePrevia.origem === 'ajuste' ? ATRASO_DA_PREVIA_MS : 0)

    return () => {
      clearTimeout(cronometro)
    }
  }, [pedidoDePrevia, statusId, resultado, dispararPrevia])

  // em 390 a caixa nascia com o número cortado no meio (achado do gate do desmarque). UMA vez por
  // prévia que chega — em `ref` inline o React reexecutava a rolagem em TODO render do pai, e a
  // agenda re-renderiza sozinha a cada minuto (achado do gate: o corpo rolava sem gesto). A
  // dependência é o OBJETO da prévia, não "tem prévia": a prévia nova do 409 `previa_desatualizada`
  // substitui a lida sem passar pelo skeleton, e o número que mudou também precisa estar à vista.
  // Com o aviso do 409 na tela o alvo é O AVISO, que fica ACIMA da caixa: rolar a caixa empurrava
  // "A agenda mudou…" para fora (medido em 0 px visíveis a 390), e quem enxerga via o número mudar
  // sem ler o porquê (achado da reconferência)
  useEffect(() => {
    if (previa === null) {
      return
    }
    const alvo = avisoDaMudanca.current ?? caixaDaPrevia.current
    alvo?.scrollIntoView({ block: 'nearest' })
  }, [previa])

  const contagens = previa?.contagens
  const podeExecutar = previa !== null && contagens !== undefined && contagens.agendamentos > 0
  const executando = mutacaoDaBaixa.isPending

  const anuncio = anuncioDaRegiaoViva({ resultado, previa, avisoDeMudanca })

  // o teto (422 em `ate`) pousa no campo "Até" E no aviso geral (spec); `profissional_id` não tem
  // widget; `de` só tem widget em "Escolher datas" — fora dele a recusa sobe ao aviso geral, porque
  // sem o toast como rede nenhuma chave pode ficar sem pouso
  const recusaDoAte = erros.campos.get('ate')
  const recusaDoProfissional = erros.campos.get('profissional_id')
  const recusaDoDeSemCampo = alcanceDaTela === 'datas' ? undefined : erros.campos.get('de')
  const avisosGerais = [
    ...erros.gerais,
    ...[recusaDoDeSemCampo, recusaDoAte, recusaDoProfissional].filter(
      (mensagem): mensagem is string => mensagem !== undefined,
    ),
  ]

  // A caixa só afirma "carregando" enquanto a prévia está mesmo a caminho: em voo, ou esperando o
  // silêncio de D4. Recusa (422/403) encerra a espera — o número não vem, e a caixa que seguia com
  // `aria-busy` anunciava uma região ocupada que nunca terminava (achado da reconferência)
  const houveRecusa = erros.gerais.length > 0 || erros.campos.size > 0
  const previaACaminho = previa === null && !houveRecusa

  const rodape =
    resultado !== null ? (
      <div className="flex justify-end">
        <Botao type="button" tamanho="lg" onClick={aoFechar}>
          Fechar
        </Botao>
      </div>
    ) : (
      <div className="flex flex-wrap justify-end gap-3">
        <Botao type="button" variante="secundario" tamanho="lg" disabled={executando} onClick={aoFechar}>
          Cancelar
        </Botao>
        {aplicaveis.length > 0 ? (
          <Botao
            type="button"
            variante="secundario"
            tamanho="lg"
            carregando={mutacaoDaPrevia.isPending}
            disabled={executando}
            onClick={() => {
              invalidarPrevia('reconferencia')
            }}
          >
            Atualizar os números
          </Botao>
        ) : null}
        {/* só com prévia carregada para o alcance corrente E com número: "Aplicar em 0" é ruído */}
        {podeExecutar && statusEscolhido !== null ? (
          <Botao
            type="button"
            tamanho="lg"
            carregando={executando}
            onClick={() => {
              mutacaoDaBaixa.mutate()
            }}
          >
            Aplicar “{statusEscolhido.nome}” em {contagens.agendamentos}
          </Botao>
        ) : null}
      </div>
    )

  return (
    <Dialog
      aberto={aberto}
      aoMudarAberto={(estaAberto) => {
        // Esc e overlay travados enquanto executa: fechar no meio deixaria a pessoa sem o resultado
        if (!estaAberto && !executando) aoFechar()
      }}
      titulo={
        resultado === null
          ? `Dar baixa na agenda de ${nomeDoProfissional}`
          : `Baixa aplicada na agenda de ${nomeDoProfissional}`
      }
      descricao={
        resultado === null
          ? 'Escolha o status e o alcance. Nada muda antes de você ver os números.'
          : 'O que aconteceu, e o que ficou para você resolver.'
      }
      rodape={rodape}
      focoAoFechar={focoAoFechar}
    >
      <div className="flex flex-col gap-5">
        {/* A região viva EXISTE ANTES da mensagem (vazia desde a montagem): criar a região junto
            com o conteúdo é o anti-padrão que falha em parte dos leitores de tela. */}
        <p role="status" className="sr-only">
          {anuncio}
        </p>

        <AvisoErro mensagens={avisosGerais} />

        {resultado === null ? (
          <>
            {avisoDeMudanca !== null ? (
              <p
                ref={avisoDaMudanca}
                className="rounded-campo bg-alerta-suave px-3 py-2 text-rotulo font-medium text-alerta-texto"
              >
                {avisoDeMudanca}
              </p>
            ) : null}

            <EscolhaDoStatus
              aplicaveis={aplicaveis}
              escolhido={statusId}
              erro={erros.campos.get('status_id')}
              podeEditarStatus={temPermissao('status_agendamento.editar')}
              aoEscolher={(id) => {
                setStatusId(id)
                invalidarPrevia()
              }}
            />

            {aplicaveis.length > 0 ? (
              <>
                <EscolhaDoAlcance
                  alcance={alcanceDaTela}
                  dataDaAgenda={dataDaAgenda}
                  hoje={hoje}
                  de={de}
                  ate={ate}
                  erroDe={erros.campos.get('de')}
                  erroAte={erros.campos.get('ate')}
                  aoMudarAlcance={(valor) => {
                    setAlcanceDaTela(valor)
                    invalidarPrevia()
                  }}
                  aoMudarDatas={(parciais) => {
                    setDatas((anteriores) => ({ ...anteriores, ...parciais }))
                    invalidarPrevia()
                  }}
                />

                <CaixaDaPrevia
                  ref={caixaDaPrevia}
                  previa={previa}
                  carregando={previaACaminho}
                  nomeDoProfissional={nomeDoProfissional}
                  aoLocalizar={aoLocalizarAgendamento}
                />
              </>
            ) : null}
          </>
        ) : (
          <CorpoDoResultado
            resultado={resultado}
            nomeDoStatus={statusEscolhido?.nome ?? ''}
            numeroDaPrevia={numeroConfirmado.current}
            aoLocalizar={aoLocalizarAgendamento}
          />
        )}
      </div>
    </Dialog>
  )
}

/** Junta duas frases sem dobrar o ponto: nem toda frase da casa já termina em ponto. */
function comPonto(frase: string): string {
  return frase.endsWith('.') ? frase : `${frase}.`
}

/** O que a região viva diz, por marco: prévia pronta, agenda que mudou, baixa aplicada. */
function anuncioDaRegiaoViva({
  resultado,
  previa,
  avisoDeMudanca,
}: {
  resultado: ResultadoDaBaixa | null
  previa: PreviaDaBaixa | null
  avisoDeMudanca: string | null
}): string {
  if (resultado !== null) {
    return `Baixa aplicada: ${plural(resultado.aplicados, 'agendamento', 'agendamentos')}`
  }
  if (previa === null) {
    return ''
  }
  const { contagens, recusados } = previa
  // o mesmo carimbo da caixa, para quem só ouve: a região diz a MESMA frase que a tela mostra
  const conferidos = `Números conferidos às ${partesDoInicio(previa.referencia).hora}.`
  if (contagens.agendamentos === 0) {
    return `${comPonto(anuncioDaPreviaVazia(recusados.length))} ${conferidos}`
  }
  const sessoes =
    contagens.sessoes_a_descontar > 0
      ? `${plural(contagens.sessoes_a_descontar, 'sessão será descontada', 'sessões serão descontadas')}`
      : 'nenhuma sessão será descontada'
  const fora = recusados.length > 0 ? `, ${plural(recusados.length, 'fica de fora', 'ficam de fora')}` : ''
  const previaDita =
    `Prévia: ${plural(contagens.agendamentos, 'agendamento', 'agendamentos')}, `
    + `${plural(contagens.criancas, 'criança', 'crianças')}, ${sessoes}${fora}`

  const comAviso = avisoDeMudanca === null ? previaDita : `${avisoDeMudanca} ${previaDita}`

  return `${comPonto(comAviso)} ${conferidos}`
}

interface EscolhaDoStatusProps {
  aplicaveis: readonly StatusDaSelecao[]
  escolhido: number | null
  erro: string | undefined
  podeEditarStatus: boolean
  aoEscolher: (id: number) => void
}

/**
 * "Marcar como": rádios NATIVOS `sr-only` cujo rótulo é o `ChipStatus` — o dialeto que a régua
 * do cadastro já usa (D15). `name` compartilhado entrega setas, `aria-checked` e a leitura
 * "2 de 3" de graça; a skin do marcado é o anel de acento sobre o chip (canal de forma, não só
 * de cor), e a consequência em prosa fica sob o marcado.
 */
function EscolhaDoStatus({ aplicaveis, escolhido, erro, podeEditarStatus, aoEscolher }: EscolhaDoStatusProps) {
  const nome = useId()
  const idDoErro = useId()

  if (aplicaveis.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-campo bg-info-suave px-3 py-3 text-rotulo font-medium text-info-texto">
        <p>
          Nenhum status está marcado como aplicável em lote. Marque “Finalizado” ou outro em Cadastros ›
          Status de agendamento.
        </p>
        {podeEditarStatus ? (
          <Botao asChild variante="fantasma" tamanho="sm">
            <Link to="/status-agendamento">Abrir status de agendamento</Link>
          </Botao>
        ) : null}
      </div>
    )
  }

  const marcado = aplicaveis.find((item) => item.id === escolhido) ?? null

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={erro === undefined ? undefined : idDoErro}>
      <legend className="mb-2 text-corpo font-medium text-texto">Marcar como</legend>
      <div className="flex flex-wrap gap-2">
        {aplicaveis.map((item) => (
          <label key={item.id} className="cursor-pointer">
            <input
              type="radio"
              name={nome}
              value={item.id}
              checked={item.id === escolhido}
              onChange={() => {
                aoEscolher(item.id)
              }}
              className="peer sr-only"
            />
            <span className="inline-flex rounded-pilula p-0.5 transition-shadow duration-(--duracao-1) peer-checked:outline-2 peer-checked:outline-offset-1 peer-checked:outline-acento peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foco hover:shadow-e1">
              <ChipStatus nome={item.nome} cor={item.cor} corBorda={item.cor_borda} tipo={item.tipo} tamanho="md" />
            </span>
          </label>
        ))}
      </div>
      {marcado !== null ? <p className="text-meta text-texto-suave">{consequenciaDoStatus(marcado)}</p> : null}
      {erro !== undefined ? (
        <p id={idDoErro} role="alert" className="text-meta text-perigo-texto">
          {erro}
        </p>
      ) : null}
    </fieldset>
  )
}

interface EscolhaDoAlcanceProps {
  alcance: AlcanceDaTela
  dataDaAgenda: string
  hoje: string
  de: string
  ate: string
  erroDe: string | undefined
  erroAte: string | undefined
  aoMudarAlcance: (valor: AlcanceDaTela) => void
  aoMudarDatas: (parciais: Partial<{ de: string; ate: string }>) => void
}

/** "Quando": três presets no `Segmento` (pele única) e, em "Escolher datas", dois `SeletorDeData`. */
function EscolhaDoAlcance({
  alcance,
  dataDaAgenda,
  hoje,
  de,
  ate,
  erroDe,
  erroAte,
  aoMudarAlcance,
  aoMudarDatas,
}: EscolhaDoAlcanceProps) {
  const apoio =
    alcance === 'dia'
      ? diaEmPalavrasCurto(dataDaAgenda)
      : alcance === 'ultimos7'
        ? `de ${diaEMes(de)} a ${diaEMes(ate)}, contando para trás a partir da data da agenda — não é a semana de segunda a domingo.`
        : 'Só até hoje: a baixa registra o que já aconteceu.'

  return (
    <div className="flex flex-col gap-2">
      <p className="text-corpo font-medium text-texto">Quando</p>
      <Segmento rotulo="Quando" opcoes={ALCANCES} valor={alcance} aoMudar={aoMudarAlcance} className="flex-wrap self-start" />
      {alcance === 'datas' ? (
        <div className="flex flex-wrap gap-4">
          <CampoDeData rotulo="De" valor={de} hoje={hoje} erro={erroDe} aoMudar={(iso) => aoMudarDatas({ de: iso })} />
          <CampoDeData rotulo="Até" valor={ate} hoje={hoje} erro={erroAte} aoMudar={(iso) => aoMudarDatas({ ate: iso })} />
        </div>
      ) : null}
      <p className="text-meta text-texto-suave">{apoio}</p>
    </div>
  )
}

interface CampoDeDataProps {
  rotulo: string
  valor: string
  hoje: string
  erro: string | undefined
  aoMudar: (iso: string) => void
}

/**
 * `SeletorDeData` com rótulo VISÍVEL e recusa por campo. O componente do DS só tem rótulo
 * `sr-only`; o texto visível é `aria-hidden` para não dobrar o nome acessível. `min-w-0`: sem
 * ele o "Até" passava da borda do diálogo a 200% em 390 px (achado do gate do desmarque).
 *
 * A recusa é LIGADA ao campo (`recusado` + `idDaRecusa`): sem isso a mensagem existia na tela e
 * o campo seguia são para quem ouve — o leitor de tela pousava num campo sem `aria-invalid` e
 * sem descrição, e a pessoa não sabia qual data o servidor recusou (3.3.1).
 */
function CampoDeData({ rotulo, valor, hoje, erro, aoMudar }: CampoDeDataProps) {
  const id = useId()
  const idDoErro = useId()

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span aria-hidden="true" className="text-rotulo font-medium text-texto">
        {rotulo}
      </span>
      <SeletorDeData
        id={id}
        rotulo={rotulo}
        valor={valor}
        hoje={hoje}
        aoMudar={aoMudar}
        recusado={erro !== undefined}
        idDaRecusa={erro === undefined ? undefined : idDoErro}
        className="min-w-0"
      />
      {erro !== undefined ? (
        <p id={idDoErro} role="alert" className="text-meta text-perigo-texto">
          {erro}
        </p>
      ) : null}
    </div>
  )
}

interface CaixaDaPreviaProps {
  previa: PreviaDaBaixa | null
  /** A prévia está a caminho (em voo ou esperando o silêncio de D4) — quem sabe isso é o pai. */
  carregando: boolean
  nomeDoProfissional: string
  aoLocalizar: (id: number, data: string) => void
  ref?: Ref<HTMLDivElement>
}

/** Os números antes do clique — carregando é skeleton na caixa exata; vazio diz o caminho. */
function CaixaDaPrevia({ previa, carregando, nomeDoProfissional, aoLocalizar, ref }: CaixaDaPreviaProps) {
  if (previa === null) {
    // Sem prévia E sem carregamento é RECUSA, e a recusa já tem dono: a mensagem específica no
    // aviso geral (`role="alert"`, e também no campo quando o teto recusa `ate`) e o "Atualizar
    // os números" no rodapé como caminho de volta. A caixa some em vez de repetir a frase uma
    // terceira vez — foi por isso que o gate tirou o toast. O que ela NÃO pode é seguir dizendo
    // `aria-busy` para sempre: quem ouve ficava numa região ocupada que nunca terminava
    return carregando ? (
      <div aria-busy="true" className="flex flex-col gap-2 rounded-superficie border border-linha bg-fundo p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    ) : null
  }

  const { contagens, status, recusados, avisos, referencia } = previa
  // alvo que não desconta chega com `avisos: {}` — ausência é zero, nunca `undefined > 0`
  const evolucoesVencidas = avisos.evolucoes_vencidas ?? 0

  return (
    <div ref={ref} className="flex flex-col gap-2 rounded-superficie border border-linha bg-fundo p-4">
      {contagens.agendamentos === 0 ? (
        <p className="text-corpo text-texto-suave">{fraseDaPreviaVazia(recusados.length)}</p>
      ) : (
        <>
          <p className="text-corpo font-medium text-texto">
            {plural(contagens.agendamentos, 'agendamento', 'agendamentos')} ·{' '}
            {plural(contagens.criancas, 'criança', 'crianças')}
          </p>
          <p className="text-meta text-texto-suave">
            {status.desconta_sessao
              ? `${plural(contagens.sessoes_a_descontar, 'sessão será descontada', 'sessões serão descontadas')} dos pacotes.`
              : 'Nenhuma sessão será descontada.'}
          </p>
          {contagens.sem_pacote > 0 ? (
            <p className="text-meta text-texto-suave">{contagens.sem_pacote} sem pacote — só muda o status.</p>
          ) : null}
          {contagens.ja_consumidas > 0 ? (
            <p className="text-meta text-texto-suave">
              {plural(contagens.ja_consumidas, 'já tinha', 'já tinham')} sessão descontada — só muda o status.
            </p>
          ) : null}
          {contagens.com_atendimento_registrado > 0 ? (
            <p className="text-meta text-texto-suave">
              {plural(contagens.com_atendimento_registrado, 'já tem', 'já têm')} atendimento registrado.
            </p>
          ) : null}
          {/* sem "de N pacotes": a prévia não devolve pacotes distintos, e `criancas` conta também
              quem está sem pacote — a frase dizia "2 sessões de 3 pacotes" (achado do gate) */}
          {status.desconta_sessao && contagens.sessoes_a_descontar > 0 ? (
            <p className="rounded-campo bg-alerta-suave px-3 py-2 text-meta font-medium text-alerta-texto">
              Isso desconta {plural(contagens.sessoes_a_descontar, 'sessão', 'sessões')} do saldo dos pacotes.
              Desfazer depois é criança por criança, pelo card.
            </p>
          ) : null}
        </>
      )}
      {evolucoesVencidas > 0 ? (
        <p className="rounded-campo bg-info-suave px-3 py-2 text-meta font-medium text-info-texto">
          {nomeDoProfissional} tem {plural(evolucoesVencidas, 'evolução vencida', 'evoluções vencidas')}. A
          baixa não mexe nisso.
        </p>
      ) : null}
      <ListaDeRecusados titulo="Ficam de fora:" nivel="h3" recusados={recusados} aoLocalizar={aoLocalizar} />
      {/* QUANDO os números foram conferidos, no rodapé da caixa e no tom suave — a legenda dos
          números, não um número a mais. A hora é a `referencia` que o SERVIDOR devolve: ele a
          calcula com `now(clinica.timezone)`, então é a parede da clínica (§13) e nunca o
          relógio de quem abriu a tela. É também a hora que MANDA: passados 30 minutos dela a
          execução recusa com 409 e a prévia nova — o carimbo torna esse prazo legível antes da
          recusa. Muda a cada prévia que pousa, inclusive quando os números voltam idênticos. */}
      <p className="text-meta text-texto-suave">Números conferidos às {partesDoInicio(referencia).hora}.</p>
    </div>
  )
}

interface ListaDeRecusadosProps {
  titulo: string
  /** Sob o título do diálogo (h2) a lista é h3; sob o título do resultado (h3) é h4 — a ordem não pula. */
  nivel: 'h3' | 'h4'
  recusados: readonly RecusaDaBaixa[]
  aoLocalizar: (id: number, data: string) => void
}

/**
 * Agrupado por motivo, cada linha com "Ver na agenda": sem nome de menor na resposta (D17) e
 * ainda assim com caminho — o botão fecha o diálogo e leva o foco ao card.
 */
function ListaDeRecusados({ titulo, nivel, recusados, aoLocalizar }: ListaDeRecusadosProps) {
  if (recusados.length === 0) {
    return null
  }
  const Titulo = nivel

  return (
    <div className="flex flex-col gap-2">
      <Titulo className="text-meta font-medium text-texto">{titulo}</Titulo>
      {[...agruparPorMotivo(recusados)].map(([motivo, itens]) => (
        <div key={motivo} className="flex flex-col gap-1">
          <p className="text-meta text-texto-suave">{tituloDoGrupo(motivo, itens.length)}</p>
          <ul className="flex flex-col gap-0.5">
            {itens.map((item) => {
              const inicio = partesDoInicio(item.inicio)

              return (
                <li key={item.id} className="flex items-center gap-2 text-meta text-texto">
                  <span className="tabular-nums">
                    {inicio.dia} · {inicio.hora}
                  </span>
                  <button
                    type="button"
                    aria-label={`Ver o agendamento de ${inicio.dia} às ${inicio.hora} na agenda`}
                    onClick={() => {
                      aoLocalizar(item.id, inicio.data)
                    }}
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-controle text-acento transition-colors duration-(--duracao-1) hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
                  >
                    <CalendarSearch aria-hidden="true" className="size-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

interface CorpoDoResultadoProps {
  resultado: ResultadoDaBaixa
  nomeDoStatus: string
  numeroDaPrevia: number
  aoLocalizar: (id: number, data: string) => void
}

/** O resultado substitui o corpo; o `<h3>` recebe o foco — ninguém é conduzido às listas sem isso. */
function CorpoDoResultado({ resultado, nomeDoStatus, numeroDaPrevia, aoLocalizar }: CorpoDoResultadoProps) {
  const titulo = useRef<HTMLHeadingElement>(null)
  const faltaram = numeroDaPrevia - resultado.aplicados

  // o foco vai ao título UMA vez, ao pousar o resultado (2.4.3). Em `ref` inline o React
  // reexecutava o `focus()` em todo render do pai — e a agenda re-renderiza sozinha a cada
  // minuto: quem estava em "Ver na agenda" ou "Fechar" perdia o lugar sem gesto (achado do gate)
  useEffect(() => {
    titulo.current?.focus()
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <h3 tabIndex={-1} ref={titulo} className="text-corpo font-medium text-texto">
        {plural(resultado.aplicados, 'agendamento marcado', 'agendamentos marcados')} como “{nomeDoStatus}”.
      </h3>
      <p className="text-meta text-texto-suave">
        {resultado.contagens.sessoes_descontadas > 0
          ? plural(resultado.contagens.sessoes_descontadas, 'sessão descontada', 'sessões descontadas')
          : 'Nenhuma sessão descontada'}{' '}
        · {plural(resultado.contagens.criancas, 'criança', 'crianças')}.
      </p>
      {/* só por recusa do domínio que a prévia não antecipa: agenda que mudou vira 409 antes daqui */}
      {faltaram > 0 ? (
        <p className="rounded-campo bg-alerta-suave px-3 py-2 text-meta font-medium text-alerta-texto">
          {faltaram === 1
            ? '1 ficou de fora por uma recusa que a prévia não antecipou — veja o motivo abaixo.'
            : `${String(faltaram)} ficaram de fora por recusas que a prévia não antecipou — veja os motivos abaixo.`}
        </p>
      ) : null}
      <ListaDeRecusados titulo="Ficaram de fora:" nivel="h4" recusados={resultado.recusados} aoLocalizar={aoLocalizar} />
    </div>
  )
}
