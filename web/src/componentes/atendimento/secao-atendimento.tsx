import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { SeloDeCicloFechado } from '@/componentes/ciclos/selo-de-ciclo-fechado'
import { DialogoDeEvolucao } from '@/componentes/evolucoes/formulario-evolucao'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import { Realce } from '@/componentes/ui/realce'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { usarMutacaoDeAtendimento } from '@/hooks/usar-mutacao-de-atendimento'
import type { StatusDaSelecao } from '@/lib/baixa-em-lote'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel } from '@/lib/datas'
import { evolucaoVaiFinalizar } from '@/lib/evolucao-finaliza-a-sessao'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { buscarAtendimento, buscarAtendimentoDoAgendamento } from '@/servicos/atendimentos'
import { buscarConfiguracaoAgenda } from '@/servicos/catalogos'
import { useAuthStore } from '@/stores/auth-store'
import type { AtendimentoDetalhe, DestinoDaEvolucao, SessaoAoSalvarEvolucao } from '@/tipos'

interface SecaoAtendimentoProps {
  agendamentoId: number
  nomeDaCrianca: string
  profissionalId: number | null
  /**
   * O status atual PERMITE registrar atendimento? Derivado da flag `marca_falta`
   * do status (Decisão 2b): um status de falta não oferece "Iniciar atendimento".
   * Default `true` — o formulário, que não deriva status aqui, segue como antes.
   */
  permiteRegistrar?: boolean
  /**
   * Os status da seleção da agenda (que a tela JÁ carregou) e o status atual da sessão. Servem para
   * AVISAR, antes do clique, que salvar a evolução vai finalizar a sessão e descontar do pacote
   * (evolucao-finaliza-a-sessao) — quem decide é o servidor. Ausentes, a seção não promete nada.
   */
  statusDaSelecao?: readonly StatusDaSelecao[]
  statusAtualId?: number
  /**
   * O pacote da sessão está sem saldo (do cartão que a tela já tem): a finalização seria recusada, e o
   * aviso diz isso em vez de prometer o desconto (observação do gate de acessibilidade, r2).
   */
  pacoteSemSaldo?: boolean
  /**
   * A evolução finalizou a sessão, e a agenda já foi relida (a invalidação acontece antes deste aviso).
   * O painel troca a foto pelo cartão da grade (status e saldo novos); o Editar adota a versão nova só
   * se a de antes for a que ele abriu (gates CR-EVO-03/04, R2-01 e R3-02).
   */
  aoFinalizar?: (sessao: SessaoAoSalvarEvolucao) => void
}

/**
 * O atendimento vive DENTRO do diálogo do agendamento, não num botão a mais no card.
 *
 * A grade cheia tem ~330 cards e o card é `memo`izado (piso de perf da §16: 20
 * profissionais × dia inteiro, fluida). Um botão por card seria pago 330 vezes — e o card
 * já carrega horário, nome, chip de status, saldo, metadados e alerta de últimas sessões.
 * Mais um alvo o transforma no amontoado que a clínica reclama (§2).
 */
export function SecaoAtendimento({
  agendamentoId,
  nomeDaCrianca,
  profissionalId,
  permiteRegistrar = true,
  statusDaSelecao,
  statusAtualId,
  pacoteSemSaldo = false,
  aoFinalizar,
}: SecaoAtendimentoProps) {
  const podeVer = useAuthStore((estado) => estado.temPermissao('atendimentos.ver'))
  const podeCriar = useAuthStore((estado) => estado.temPermissao('atendimentos.criar'))
  const podeExcluir = useAuthStore((estado) => estado.temPermissao('atendimentos.excluir'))
  const podeVerEvolucao = useAuthStore((estado) => estado.temPermissao('evolucoes.ver'))
  // Sem vínculo, criar evolução é ASSINAR EM NOME DE OUTRO (FA-04): além de
  // `evolucoes.criar`, exige a permissão de exceção — o botão não promete o que
  // o servidor nega com 403 (defesa de UI; o controle é o `authorize()` do boundary).
  const podeCriarEvolucao = useAuthStore(
    (estado) =>
      estado.temPermissao('evolucoes.criar')
      && (estado.usuario?.profissional_id != null || estado.temPermissao('evolucoes.assinar_por_outro')),
  )

  const { erros, registrar, excluir, salvando, excluindo } = usarMutacaoDeAtendimento()
  const [observacoes, setObservacoes] = useState('')
  const [confirmandoDesfazer, setConfirmandoDesfazer] = useState(false)
  const [escrevendoEvolucao, setEscrevendoEvolucao] = useState(false)
  const [registrandoSemEvolucao, setRegistrandoSemEvolucao] = useState(false)
  // a recusa do status FICA na seção: o toast some em 5 s, e alguém precisa resolver pelo menu de status.
  // Ela vale para o status em que aconteceu: trocado pelo chip, o aviso sai (gate CR-EVO-13)
  const [recusa, setRecusa] = useState<{ motivo: string; statusId: number | undefined } | null>(null)
  const recusaDaFinalizacao = recusa !== null && recusa.statusId === statusAtualId ? recusa.motivo : null
  const idDoRegistroSemEvolucao = useId()
  const idDoAvisoDaFinalizacao = useId()
  const idDaRecusa = useId()
  // "Registrar atendimento" também troca o ramo e some com o próprio botão (A11Y-EVO-02)
  const focarNoRegistro = useRef(false)
  // Registrar a evolução troca o ramo da seção: o botão que abriu o diálogo some, e o foco cairia no
  // `body` (2.4.3, medido no navegador). Depois de um registro, ele vai para o bloco do registro
  const refDoRegistro = useRef<HTMLDivElement>(null)
  const acabouDeRegistrar = useRef(false)

  // A evolução direto da sessão registra o atendimento junto (D1): o servidor exige as DUAS permissões
  const podeEscreverDireto = podeCriar && podeCriarEvolucao

  // REGRA É DADO (§13): a clínica liga a finalização pela evolução na configuração. A tela só a lê
  // para avisar ANTES do clique — efeito no pacote não chega de surpresa
  // — sem requisição a mais: a agenda já leu esta configuração, e o `staleTime` a reaproveita
  const configuracao = useQuery({
    queryKey: chaves.configuracaoAgenda(),
    queryFn: buscarConfiguracaoAgenda,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: podeVer && podeCriarEvolucao,
  })
  const finalizariaPelaConfiguracao = evolucaoVaiFinalizar(
    statusDaSelecao,
    statusAtualId,
    configuracao.data?.statusAoSalvarEvolucao ?? 0,
  )
  const vaiFinalizar = finalizariaPelaConfiguracao && !pacoteSemSaldo
  const semSaldoParaFinalizar = finalizariaPelaConfiguracao && pacoteSemSaldo

  const atendimento = useQuery({
    queryKey: chaves.atendimentosDoAgendamento(agendamentoId),
    queryFn: () => buscarAtendimentoDoAgendamento(agendamentoId),
    enabled: podeVer,
  })

  /**
   * O DETALHE do atendimento — a única fonte de `em_ciclo_fechado` (SEC-FC-09: a API o
   * mantém fora da listagem de propósito). Por isso a query mora AQUI e não mais dentro da
   * `ObservacoesDoAtendimento`: o mesmo `show` que traz a observação é o que diz se a
   * produção do período já foi enviada, e quem precisa disso são as DUAS ações da seção —
   * "Salvar observações" (editar) e "Desfazer registro" (excluir).
   *
   * O gatilho continua sendo o CLIQUE, não a abertura do diálogo: o `show` é AUDITADO
   * (art. 11) e nenhuma requisição a mais sai daqui. Enquanto a pessoa não pede as
   * observações, a seção não sabe do ciclo — e não finge saber: as ações seguem
   * oferecidas, e quem responde é a 422 do servidor (D7).
   */
  const [observacoesAbertas, setObservacoesAbertas] = useState(false)
  const registradoId = atendimento.data?.id ?? null

  useEffect(() => {
    if (focarNoRegistro.current && registradoId !== null) {
      focarNoRegistro.current = false
      refDoRegistro.current?.focus()
    }
  }, [registradoId])

  const detalhe = useQuery({
    queryKey: chaves.atendimento(registradoId ?? 0),
    queryFn: () => {
      // guarda, não `as number`: o `enabled` já garante o id, e um dia em que ele não
      // garantir isto falha alto em vez de pedir `/atendimentos/null`
      if (registradoId === null) {
        throw new Error('Detalhe do atendimento pedido sem atendimento registrado.')
      }

      return buscarAtendimento(registradoId)
    },
    enabled: observacoesAbertas && registradoId !== null,
    // mesmo regime do prontuário: nada de dado clínico sobrevivendo em cache, e toda
    // abertura chega ao servidor (senão a trilha do art. 11 mente sobre quem leu)
    gcTime: 0,
    staleTime: 0,
  })

  // `=== true` e não `!== false`: enquanto o detalhe não foi pedido, `data` é `undefined` —
  // e "não sei" nunca pode ser lido como "está fechado" (nem como "está aberto").
  const emCicloFechado = detalhe.data?.em_ciclo_fechado === true

  if (!podeVer) {
    return null
  }

  // Os QUATRO estados. Sem isto, uma falha de rede renderiza como FATO: o diálogo afirmaria
  // "a sessão ainda não foi registrada", ofereceria registrar (→ 422) e ESCONDERIA "Ver
  // evolução" — a profissional concluiria que o prontuário da criança não existe. Contador
  // que exibe "0" numa falha de rede diz "fila vazia"; aqui a mentira é pior (gate CR).
  if (atendimento.isPending) {
    return (
      // aria-busy anuncia "carregando" à TA — o Skeleton é aria-hidden (4.1.3)
      <section aria-busy className="mt-5 border-t border-linha pt-5">
        <h3 className="text-corpo font-semibold text-texto">Atendimento</h3>
        <Skeleton className="mt-3 h-24 w-full" />
      </section>
    )
  }

  if (atendimento.isError) {
    return (
      <section className="mt-5 border-t border-linha pt-5">
        <h3 className="text-corpo font-semibold text-texto">Atendimento</h3>
        <EstadoErro
          className="mt-3"
          mensagem="Não foi possível saber se esta sessão já tem atendimento registrado."
          aoTentarNovamente={() => void atendimento.refetch()}
        />
      </section>
    )
  }

  const registrado = atendimento.data ?? null
  const destino: DestinoDaEvolucao =
    registrado !== null ? { atendimentoId: registrado.id } : { agendamentoId }

  function lembrarResultado(sessao: SessaoAoSalvarEvolucao | undefined) {
    acabouDeRegistrar.current = true
    setRecusa(
      sessao !== undefined && !sessao.finalizada && sessao.motivo !== null
        ? { motivo: sessao.motivo, statusId: statusAtualId }
        : null,
    )
    if (sessao?.finalizada === true) {
      aoFinalizar?.(sessao)
    }
  }

  function focoDepoisDoRegistro(): HTMLElement | null {
    const alvo = acabouDeRegistrar.current ? refDoRegistro.current : null
    acabouDeRegistrar.current = false
    return alvo
  }

  function registrarSessao() {
    focarNoRegistro.current = true
    registrar.mutate(
      {
        agendamentoId,
        // `finalizado_em` NÃO vai: quem carimba é o servidor, no relógio da CLÍNICA. Mandar o
        // relógio do navegador seria mandar outro fuso — e a hora do prontuário de uma
        // criança não é a hora da máquina de quem digitou.
        payload: { observacoes: observacoes.trim() === '' ? null : observacoes },
      },
      {
        onError: () => {
          focarNoRegistro.current = false
        },
      },
    )
  }

  function desfazer() {
    if (registrado === null) {
      return
    }
    return new Promise<void>((resolver, rejeitar) => {
      excluir.mutate(registrado.id, {
        onSuccess: () => {
          setConfirmandoDesfazer(false)
          resolver()
        },
        onError: () => {
          rejeitar(new Error('recusado'))
        },
      })
    })
  }

  return (
    <section className="mt-5 border-t border-linha pt-5">
      <h3 className="text-corpo font-semibold text-texto">Atendimento</h3>

      <AvisoErro mensagens={erros.gerais} className="mt-3" />

      {registrado === null ? (
        <div className="mt-3 flex flex-col gap-3">
          {/* Status de falta não registra atendimento (Decisão 2b): em vez do
              formulário, uma linha de leitura que explica por que não há o que iniciar. */}
          {permiteRegistrar && podeEscreverDireto ? (
            // O gesto único (evolucao-finaliza-a-sessao, D5): escrever a evolução registra a sessão
            // junto. Registrar sem evolução continua, secundário — e o campo de observações mora
            // DENTRO dele, para nada digitado ali se perder num "Escrever evolução"
            <>
              <p id={idDoAvisoDaFinalizacao} className="text-meta text-texto-suave">
                {vaiFinalizar
                  ? 'A sessão ainda não foi registrada. Ao salvar a evolução, a sessão é registrada e finalizada — e desconta do pacote.'
                  : semSaldoParaFinalizar
                    ? 'A sessão ainda não foi registrada. Ao salvar a evolução, ela é registrada junto — mas o pacote está sem saldo, e a sessão não será finalizada.'
                    : 'A sessão ainda não foi registrada. Ao salvar a evolução, a sessão é registrada junto.'}
              </p>
              <div className="flex flex-wrap justify-end gap-3">
                <Botao
                  type="button"
                  variante="secundario"
                  aria-expanded={registrandoSemEvolucao}
                  aria-controls={registrandoSemEvolucao ? idDoRegistroSemEvolucao : undefined}
                  onClick={() => {
                    setRegistrandoSemEvolucao((aberto) => !aberto)
                  }}
                >
                  Registrar sem evolução
                </Botao>
                <Botao
                  type="button"
                  // o aviso do desconto chega a quem navega por Tab (A11Y-EVO-03)
                  aria-describedby={idDoAvisoDaFinalizacao}
                  onClick={() => {
                    setEscrevendoEvolucao(true)
                  }}
                >
                  Escrever evolução
                </Botao>
              </div>
              {registrandoSemEvolucao ? (
                <div id={idDoRegistroSemEvolucao} className="flex flex-col gap-3">
                  <p className="text-meta text-texto-suave">
                    Registrar sem a evolução não desconta a sessão do pacote — quem desconta é o status
                    do agendamento.
                  </p>
                  <RegistroSemEvolucao
                    observacoes={observacoes}
                    aoMudarObservacoes={setObservacoes}
                    erro={erros.campos.get('observacoes')}
                    salvando={salvando}
                    variante="secundario"
                    aoRegistrar={registrarSessao}
                  />
                </div>
              ) : null}
            </>
          ) : permiteRegistrar ? (
            <>
              <p className="text-meta text-texto-suave">
                A sessão ainda não foi registrada. Registrar não desconta a sessão do pacote — quem
                desconta é o status do agendamento.
              </p>

              {podeCriar ? (
                <RegistroSemEvolucao
                  observacoes={observacoes}
                  aoMudarObservacoes={setObservacoes}
                  erro={erros.campos.get('observacoes')}
                  salvando={salvando}
                  variante="primario"
                  aoRegistrar={registrarSessao}
                />
              ) : null}
            </>
          ) : (
            <p className="text-meta text-texto-suave">
              O status atual marca falta — não há atendimento a registrar para esta sessão.
            </p>
          )}
        </div>
      ) : (
        <div
          ref={refDoRegistro}
          tabIndex={-1}
          role="group"
          aria-label="Sessão registrada"
          // com a recusa, o grupo a diz ao receber o foco (A11Y-EVO-05)
          aria-describedby={recusaDaFinalizacao !== null ? idDaRecusa : undefined}
          className="mt-3 flex flex-col gap-3 rounded-superficie focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
        >
          <p className="text-meta text-texto-suave">
            Sessão registrada em {dataHoraLegivel(registrado.finalizado_em)}.
          </p>

          {recusaDaFinalizacao !== null ? (
            <div id={idDaRecusa}>
              <Realce
                tom="atencao"
                rotulo="A sessão não foi finalizada"
                icone={<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-alerta-texto" />}
                texto={recusaDaFinalizacao}
              />
            </div>
          ) : null}

          {/* o caminho de hoje (registrada, sem evolução) também finaliza: o aviso vem aqui também
              (gate CR-EVO-05) */}
          {(vaiFinalizar || semSaldoParaFinalizar) && registrado.evolucao_id === null && podeCriarEvolucao ? (
            <p id={idDoAvisoDaFinalizacao} className="text-meta text-texto-suave">
              {vaiFinalizar
                ? 'Ao salvar a evolução, a sessão é finalizada — e desconta do pacote.'
                : 'O pacote está sem saldo: salvar a evolução não vai finalizar a sessão.'}
            </p>
          ) : null}

          {/* Por que "Desfazer registro" e "Salvar observações" sumiram (D7). Sem o selo,
              o sumiço vira suspeita de bug — e a pessoa liga para a coordenação ou tenta
              pela porta do lado. Ele não nomeia convênio nem período: a seção só tem o
              booleano deste registro (SEC-FC-09). */}
          {emCicloFechado ? <SeloDeCicloFechado className="self-start" /> : null}

          {/* A observação NÃO pode ser write-only (gate SEC F-04). Escrever e nunca mais
              conseguir reler empurra a profissional a manter a própria cópia fora do sistema —
              e aí o dado clínico sai da clínica pela via humana, sem cifra e sem trilha. Não
              existe defesa técnica contra isso; existe defesa contra o INCENTIVO.

              A leitura é sob DEMANDA, nunca automática: o `show` do atendimento é AUDITADO, e
              abrir o diálogo não pode gravar na trilha uma leitura que ninguém pediu. */}
          <ObservacoesDoAtendimento
            atendimentoId={registrado.id}
            detalhe={detalhe}
            aberta={observacoesAbertas}
            aoAbrir={() => {
              setObservacoesAbertas(true)
            }}
          />

          <div className="flex flex-wrap justify-end gap-3">
            {/* Escrita composta: o servidor exige as DUAS permissões, e o botão não pode
                prometer o que ele nega. Ver a evolução existente só exige `evolucoes.ver`.
                `undefined` NÃO é `null`: a API omite o campo de quem não tem permissão
                nenhuma de evolução (gate SEC F-03) — aí não há o que oferecer (re-review I-1). */}
            {registrado.evolucao_id === undefined
              ? null
              : registrado.evolucao_id === null
              ? podeCriarEvolucao && (
                  <Botao
                    type="button"
                    variante="secundario"
                    aria-describedby={vaiFinalizar || semSaldoParaFinalizar ? idDoAvisoDaFinalizacao : undefined}
                    onClick={() => {
                      setEscrevendoEvolucao(true)
                    }}
                  >
                    Escrever evolução
                  </Botao>
                )
              : podeVerEvolucao && (
                  <Botao
                    type="button"
                    variante="secundario"
                    onClick={() => {
                      setEscrevendoEvolucao(true)
                    }}
                  >
                    Ver evolução
                  </Botao>
                )}

            {/* Em ciclo fechado o servidor recusa o DELETE com 422: a ação some (D7 — o
                padrão do "Excluir" que some do lançamento pago). */}
            {podeExcluir && !emCicloFechado ? (
              <Botao
                type="button"
                variante="perigo-suave"
                onClick={() => {
                  setConfirmandoDesfazer(true)
                }}
              >
                Desfazer registro
              </Botao>
            ) : null}
          </div>
        </div>
      )}

      {registrado !== null ? (
        <>
          <DialogConfirmacao
            aberto={confirmandoDesfazer}
            aoMudarAberto={setConfirmandoDesfazer}
            titulo={`Desfazer o registro de atendimento de ${nomeDaCrianca}?`}
            consequencia={
              'O registro da sessão é apagado. Se já houver evolução escrita, ou se a sessão já '
              + 'tiver sido descontada do pacote, o servidor recusa — e diz o que é preciso fazer antes.'
            }
            rotuloConfirmar="Desfazer registro"
            tom="perigo"
            carregando={excluindo}
            // a recusa do servidor DENTRO do diálogo: as chaves dela não têm campo na tela
            erros={erros.gerais}
            aoConfirmar={desfazer}
          />

        </>
      ) : null}

      {/* UM diálogo, fora dos dois ramos. Salvar a evolução pela sessão faz o atendimento NASCER
          com o diálogo aberto: se ele morasse no ramo "sem registro", desmontaria no meio do
          salvamento — e o React Query descarta os callbacks de quem desmontou (o `aoFechar` não
          rodaria, como no achado do `idCongelado`). */}
      {registrado !== null || podeEscreverDireto ? (
        <DialogoDeEvolucao
          aberto={escrevendoEvolucao}
          aoMudarAberto={setEscrevendoEvolucao}
          destino={destino}
          evolucaoId={registrado?.evolucao_id ?? undefined}
          profissionalSugerido={profissionalId}
          nomeDaCrianca={nomeDaCrianca}
          avisoAoRegistrar={vaiFinalizar ? 'Ao registrar, a sessão é finalizada e desconta do pacote.' : undefined}
          aoRegistrar={lembrarResultado}
          focoAoFechar={focoDepoisDoRegistro}
        />
      ) : null}
    </section>
  )
}

interface RegistroSemEvolucaoProps {
  observacoes: string
  aoMudarObservacoes: (texto: string) => void
  erro: string | undefined
  salvando: boolean
  /** Primário quando é a ÚNICA ação (a recepção); secundário quando "Escrever evolução" é a principal. */
  variante: 'primario' | 'secundario'
  aoRegistrar: () => void
}

/** Registrar a sessão sem evolução: as observações e o botão que as grava junto com o registro. */
function RegistroSemEvolucao({
  observacoes,
  aoMudarObservacoes,
  erro,
  salvando,
  variante,
  aoRegistrar,
}: RegistroSemEvolucaoProps) {
  return (
    <>
      <CampoTextoLongo
        rotulo="Observações do atendimento"
        value={observacoes}
        onChange={(evento) => {
          aoMudarObservacoes(evento.target.value)
        }}
        erro={erro}
        // dado clínico não sai da clínica pelo corretor do navegador
        spellCheck={false}
        autoComplete="off"
      />
      <div className="flex justify-end">
        <Botao type="button" variante={variante} onClick={aoRegistrar} carregando={salvando}>
          Registrar atendimento
        </Botao>
      </div>
    </>
  )
}

interface ObservacoesDoAtendimentoProps {
  atendimentoId: number
  /**
   * A consulta do detalhe, ERGUIDA para a seção: o mesmo `show` responde "qual é a
   * observação" e "este período já foi fechado", e a segunda resposta governa uma ação que
   * não mora aqui ("Desfazer registro"). Duplicar a query seria duplicar uma leitura
   * AUDITADA — dois `consultou` na trilha para um clique da profissional.
   */
  detalhe: UseQueryResult<AtendimentoDetalhe>
  aberta: boolean
  aoAbrir: () => void
}

/**
 * A observação do atendimento, sob demanda.
 *
 * Ela é **detail-only** (a API a omite da listagem — é texto potencialmente clínico) e a
 * leitura do detalhe é **AUDITADA** (`consultou`). Por isso não há prefetch: o botão é o
 * consentimento explícito de quem lê, e a trilha registra uma leitura que de fato aconteceu.
 */
function ObservacoesDoAtendimento({
  atendimentoId,
  detalhe,
  aberta,
  aoAbrir,
}: ObservacoesDoAtendimentoProps) {
  const podeEditar = useAuthStore((estado) => estado.temPermissao('atendimentos.editar'))
  const { erros, atualizar, salvando } = usarMutacaoDeAtendimento()
  const [texto, setTexto] = useState<string | null>(null)
  const refDoPainel = useRef<HTMLDivElement>(null)

  /**
   * O botão que abre o painel é SUBSTITUÍDO por ele — e o foco cai no `body` (2.4.3).
   *
   * O padrão é anterior a esta change, mas ela o agravou: no mesmo instante em que o
   * painel entra, "Desfazer registro" some e o selo de ciclo fechado aparece. Três
   * mudanças de estado a partir de um clique, e o cursor de quem navega por teclado
   * largado na raiz do documento. O painel recebe o foco e se anuncia pelo nome.
   */
  useEffect(() => {
    if (aberta) {
      refDoPainel.current?.focus()
    }
  }, [aberta])

  if (!aberta) {
    return (
      <div>
        <Botao type="button" variante="secundario" tamanho="md" onClick={aoAbrir}>
          Ver observações da sessão
        </Botao>
      </div>
    )
  }

  // O painel é UM destino de foco para os três estados: o `tabIndex={-1}` o torna
  // focável sem entrar na ordem de Tab, e o grupo nomeado diz onde a pessoa chegou.
  const painel = (conteudo: ReactNode) => (
    <div
      ref={refDoPainel}
      tabIndex={-1}
      role="group"
      aria-label="Observações da sessão"
      className="flex flex-col gap-2 rounded-superficie focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
    >
      {conteudo}
    </div>
  )

  if (detalhe.isPending) {
    return painel(
      <>
        <p role="status" className="sr-only">
          Abrindo as observações da sessão.
        </p>
        <Skeleton aria-hidden="true" className="h-24 w-full" />
      </>,
    )
  }

  if (detalhe.isError) {
    return painel(
      <EstadoErro
        mensagem="Não foi possível abrir as observações desta sessão."
        aoTentarNovamente={() => void detalhe.refetch()}
      />,
    )
  }

  const valor = texto ?? detalhe.data.observacoes ?? ''

  return painel(
    <>
      <CampoTextoLongo
        rotulo="Observações da sessão"
        value={valor}
        onChange={(evento) => {
          setTexto(evento.target.value)
        }}
        disabled={!podeEditar}
        erro={erros.campos.get('observacoes')}
        spellCheck={false}
        autoComplete="off"
      />
      {/* Em ciclo fechado o campo continua LEGÍVEL e copiável — some só a ação de gravar
          (D7: esconder a ação, nunca desabilitar campo por regra de servidor). O selo, na
          seção logo acima, é quem diz por quê. */}
      {podeEditar && !detalhe.data.em_ciclo_fechado ? (
        <div className="flex justify-end">
          <Botao
            type="button"
            variante="secundario"
            tamanho="md"
            carregando={salvando}
            onClick={() => {
              atualizar.mutate({
                id: atendimentoId,
                payload: { observacoes: valor.trim() === '' ? null : valor },
                versao: detalhe.data.updated_at,
              })
            }}
          >
            Salvar observações
          </Botao>
        </div>
      ) : null}
    </>,
  )
}
