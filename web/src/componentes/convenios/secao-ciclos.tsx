import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, LockOpen } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { CabecalhoDeCadastro } from '@/componentes/cadastro/cabecalho-de-cadastro'
import { Botao } from '@/componentes/ui/botao'
import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'
import { Tabela } from '@/componentes/ui/tabela'
import { usarToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel, dataLegivel } from '@/lib/datas'
import { distribuirErrosDoServidor, semErros, type ErrosDoServidor } from '@/lib/erros'
import { buscarProximoCiclo, fecharCiclo, listarCiclos, reabrirCiclo } from '@/servicos/ciclos'
import { useAuthStore } from '@/stores/auth-store'
import type { FechamentoDeCiclo, PeriodoDoCiclo } from '@/tipos'

/** Teto do servidor (SEC-FC-06) — o contador aparece porque o limite existe. */
const LIMITE_DO_MOTIVO = 500

interface SecaoCiclosProps {
  convenioId: number
  /** Nome do convênio para NOMEAR o alvo nos diálogos (§2) — nunca "este convênio" */
  nomeDoConvenio: string
}

/** "16/06/2026 a 15/07/2026" — as duas pontas, sempre; o período é o alvo da ação. */
function periodoLegivel(periodo: PeriodoDoCiclo): string {
  return `${dataLegivel(periodo.periodo_inicio)} a ${dataLegivel(periodo.periodo_fim)}`
}

/**
 * O estado da linha em português de balcão.
 *
 * A tabela é append-only: o mesmo período pode ter uma linha reaberta e outra fechada
 * depois. Dizer só "Fechado"/"Reaberto" sem QUEM e QUANDO transformaria a trilha em
 * fofoca — a reabertura é a exceção que precisa ter dono visível.
 */
function estadoDoCiclo(ciclo: FechamentoDeCiclo): string {
  if (ciclo.aberto) {
    return 'Fechado'
  }
  const quem = ciclo.reaberto_por?.nome ?? '—'
  return `Reaberto por ${quem} em ${dataHoraLegivel(ciclo.reaberto_em)}`
}

/**
 * Seção "Ciclos de faturamento" da página do convênio (3ª seção, `h2` — mesmo padrão da
 * tabela de serviços e das regras de limite).
 *
 * **A seção inteira vive sob `ciclos.fechar` (SEC-FC-09).** Sem a permissão ela não
 * existe — nem o calendário derivado, nem a lista de fechamentos, nem as consultas que
 * os buscam. O motivo não é estética: quem tem `lancamentos.editar` e recebe um 422 de
 * ciclo fechado não pode aprender, por esta tela, QUANDO cada operadora fecha nem quem
 * fechou o quê. A afordância não pode virar oráculo do calendário alheio.
 */
export function SecaoCiclos({ convenioId, nomeDoConvenio }: SecaoCiclosProps) {
  const podeFechar = useAuthStore((estado) => estado.temPermissao('ciclos.fechar'))
  const podeReabrir = useAuthStore((estado) => estado.temPermissao('ciclos.reabrir'))
  const queryClient = useQueryClient()
  const { notificar } = usarToast()

  /**
   * A âncora de foco da seção (2.4.3) — o `h2`, que sobrevive a QUALQUER repintura.
   *
   * Fechar e reabrir apagam os próprios gatilhos ("Fechar período" some quando não há
   * mais período; "Reabrir" some quando o ciclo deixa de estar fechado). Devolver o foco
   * ao gatilho, o default do diálogo, o joga num nó fora do DOM — ou seja, no `body`.
   */
  const refDoTitulo = useRef<HTMLHeadingElement>(null)
  // só a conclusão BEM-SUCEDIDA reancora; cancelar continua devolvendo ao gatilho, que
  // nesse caso continua existindo (é ref, não estado: é lido no unmount do diálogo)
  const irParaAncora = useRef(false)

  const [confirmandoFechamento, setConfirmandoFechamento] = useState(false)
  const [aReabrir, setAReabrir] = useState<FechamentoDeCiclo | null>(null)
  const [motivo, setMotivo] = useState('')
  const [errosDeFechar, setErrosDeFechar] = useState<readonly string[]>([])
  const [errosDeReabrir, setErrosDeReabrir] = useState<ErrosDoServidor>(semErros)

  // `enabled` pela permissão: sem `ciclos.fechar` a consulta NEM SAI — um 403 no
  // console também é informação de que este convênio tem (ou não) calendário.
  const historico = useQuery({
    queryKey: chaves.ciclosDoConvenio(convenioId),
    queryFn: () => listarCiclos(convenioId),
    enabled: podeFechar,
  })

  const proximo = useQuery({
    queryKey: chaves.proximoCicloDoConvenio(convenioId),
    queryFn: () => buscarProximoCiclo(convenioId),
    enabled: podeFechar,
  })

  function invalidarCiclos(): void {
    void queryClient.invalidateQueries({ queryKey: chaves.ciclosDoConvenio(convenioId) })
    void queryClient.invalidateQueries({ queryKey: chaves.proximoCicloDoConvenio(convenioId) })
  }

  /**
   * O sucesso PRECISA ser dito (4.1.3). A ação apaga o gatilho, a tabela repinta e o
   * foco vai para a âncora: sem o toast, para quem usa leitor de tela o efeito de uma
   * mutação de impacto é silêncio — e o silêncio se lê como "não aconteceu nada".
   */
  function anunciar(titulo: string): void {
    irParaAncora.current = true
    notificar({ tom: 'sucesso', titulo })
  }

  /**
   * Lido pelo diálogo no UNMOUNT: só a conclusão bem-sucedida reancora no `h2`. Cancelar
   * ou fechar com Esc continua devolvendo o foco ao gatilho — que, nesse caminho, não
   * foi apagado por ninguém.
   */
  function destinoDoFoco(): HTMLElement | null {
    if (!irParaAncora.current) {
      return null
    }
    irParaAncora.current = false
    return refDoTitulo.current
  }

  const fechamento = useMutation({
    mutationFn: (periodo: PeriodoDoCiclo) => fecharCiclo(convenioId, periodo),
    onSuccess: (_, periodo) => {
      setErrosDeFechar([])
      setConfirmandoFechamento(false)
      anunciar(`Produção de ${periodoLegivel(periodo)} fechada.`)
      invalidarCiclos()
    },
    onError: (erro) => {
      // o período não é campo de formulário nenhum aqui — a recusa vai INTEIRA para o
      // aviso dentro do diálogo (CR-CA-05: a mensagem fica onde a pessoa está olhando)
      setErrosDeFechar(distribuirErrosDoServidor(erro, new Set()).gerais)
    },
  })

  const reabertura = useMutation({
    mutationFn: ({ ciclo, texto }: { ciclo: FechamentoDeCiclo; texto: string }) =>
      reabrirCiclo(convenioId, ciclo.id, texto),
    onSuccess: (_, { ciclo }) => {
      setErrosDeReabrir(semErros())
      setAReabrir(null)
      setMotivo('')
      anunciar(`Período de ${periodoLegivel(ciclo)} reaberto.`)
      invalidarCiclos()
    },
    onError: (erro) => {
      setErrosDeReabrir(distribuirErrosDoServidor(erro, new Set(['motivo'])))
    },
  })

  if (!podeFechar) {
    return null
  }

  const ciclos = historico.data ?? []
  const periodoAFechar = proximo.data?.periodo ?? null
  const motivoPreenchido = motivo.trim() !== ''

  // As duas consultas montam UMA seção: elas saem juntas, falham juntas e carregam
  // juntas. Tratá-las em separado é o que produzia duas caixas iguais empilhadas — dois
  // vazios com forma idêntica (o segundo roubando a ação do primeiro) e dois "Tentar
  // novamente" para uma queda só (achados R2).
  const carregando = proximo.isPending || historico.isPending
  const comErro = proximo.isError || historico.isError
  const carregado = proximo.isSuccess && historico.isSuccess

  // Sem período a fechar, o histórico NÃO tem estado vazio próprio: o vazio da seção já
  // foi dito acima, e com o próximo passo certo.
  const mostrarHistorico = ciclos.length > 0 || periodoAFechar !== null

  return (
    <section className="flex flex-col gap-6">
      <CabecalhoDeCadastro
        titulo="Ciclos de faturamento"
        nivel="h2"
        refDoTitulo={refDoTitulo}
        contador={
          carregado
            ? `${ciclos.length} ${ciclos.length === 1 ? 'fechamento' : 'fechamentos'}`
            : undefined
        }
      />

      {/* UM bloco de erro para a seção: as duas consultas caem juntas, e o retry refaz
          as duas. Duas caixas com dois "Tentar novamente" fazem a pessoa escolher entre
          botões que fazem a mesma coisa. */}
      {comErro ? (
        <EstadoErro
          mensagem="Não foi possível carregar os ciclos de faturamento deste convênio."
          aoTentarNovamente={() => {
            void proximo.refetch()
            void historico.refetch()
          }}
        />
      ) : null}

      {/* O esqueleto reserva a CAIXA REAL do card: o MESMO container, os MESMOS elementos
          de texto e o mesmo tamanho de botão. `h-24` chapado saltava ~17px a 1440 e ~39px
          a 390 — onde o botão quebra linha e o card cresce (achado I1 — CLS).

          As alturas não são digitadas: `1lh` é a altura de linha DO PRÓPRIO elemento, ou
          seja, o token `text-rotulo`/`text-subtitulo` lido de volta. Repetir `1.575rem`
          aqui seria restatar o token à mão, e ele mudaria sem levar o esqueleto junto. */}
      {carregando ? (
        <div
          aria-hidden="true"
          className="flex flex-wrap items-center justify-between gap-4 rounded-superficie border border-linha-forte bg-superficie p-4"
        >
          <div>
            <p className="text-rotulo font-medium">
              <Skeleton className="block h-[1lh] w-44" />
            </p>
            <p className="mt-1 text-subtitulo font-semibold">
              <Skeleton className="block h-[1lh] w-64" />
            </p>
          </div>
          {/* mesmo `tamanho` do botão real (md) — a coluna da direita não pode encolher */}
          <Skeleton className="h-10 w-40" />
        </div>
      ) : null}

      {/* O PRÓXIMO PERÍODO — quem deriva é o servidor (o corte é regra dele, e duas
          derivações independentes divergiriam justamente na virada de mês). */}
      {carregado && periodoAFechar !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-superficie border border-linha-forte bg-superficie p-4">
          <div>
            <p className="text-rotulo font-medium text-texto-suave">Próximo período a fechar</p>
            <p className="mt-1 text-subtitulo font-semibold text-texto tabular-nums">
              {periodoLegivel(periodoAFechar)}
            </p>
          </div>
          <Botao
            onClick={() => {
              setErrosDeFechar([])
              setConfirmandoFechamento(true)
            }}
          >
            <CalendarCheck aria-hidden="true" className="size-4" />
            Fechar período
          </Botao>
        </div>
      ) : null}

      {/* SEM CALENDÁRIO — o próximo passo é o cadastro. Não há deep-link para a linha do
          convênio (a lista não lê a busca da URL), então o texto diz o caminho inteiro,
          nomeando a `legend` exata do formulário. */}
      {carregado && proximo.data?.motivo === 'sem_calendario' ? (
        <EstadoVazio
          titulo="Este convênio ainda não tem fechamento configurado"
          descricao={`Para fechar a produção é preciso primeiro dizer quando ${nomeDoConvenio} corta o faturamento: em Convênios, abra a linha deste convênio no botão “Editar” e preencha “Fechamento do faturamento”. Sem o corte, nada é congelado aqui.`}
          acao={
            <Botao asChild>
              <Link to="/convenios">Abrir o cadastro dos convênios</Link>
            </Botao>
          }
        />
      ) : null}

      {/* JÁ FECHADO — o calendário EXISTE e o último período já foi fechado. Mandar
          configurar o corte aqui (o que a tela fazia quando os dois estados eram o mesmo
          `null`) manda arrumar o que está certo, com a prova do contrário logo abaixo. */}
      {carregado && proximo.data?.motivo === 'ja_fechado' ? (
        <EstadoVazio
          titulo="O último período já foi fechado"
          descricao="Não há período a fechar agora. O próximo aparece aqui depois do próximo corte deste convênio — a lista abaixo mostra o que já foi fechado."
        />
      ) : null}

      {carregado && mostrarHistorico ? (
        ciclos.length === 0 ? (
          <EstadoVazio
            titulo="Nenhum período fechado ainda"
            descricao="Quando o faturamento fechar um período deste convênio, ele aparece aqui com quem fechou, quando, e se alguém o reabriu depois."
          />
        ) : (
          <Tabela legenda={`Períodos fechados de ${nomeDoConvenio}`}>
            <Tabela.Cabecalho>
              <Tabela.Linha>
                <Tabela.CelulaCabecalho>Período</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho>Fechado por</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho>Fechado em</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho>Situação</Tabela.CelulaCabecalho>
                {podeReabrir ? <Tabela.CelulaCabecalho>Ações</Tabela.CelulaCabecalho> : null}
              </Tabela.Linha>
            </Tabela.Cabecalho>
            <Tabela.Corpo>
              {ciclos.map((ciclo) => (
                <Tabela.Linha key={ciclo.id}>
                  <Tabela.Celula className="tabular-nums">{periodoLegivel(ciclo)}</Tabela.Celula>
                  <Tabela.Celula className="text-texto-suave">
                    {ciclo.fechado_por.nome}
                  </Tabela.Celula>
                  <Tabela.Celula className="text-texto-suave tabular-nums">
                    {dataHoraLegivel(ciclo.fechado_em)}
                  </Tabela.Celula>
                  <Tabela.Celula className="text-texto-suave">{estadoDoCiclo(ciclo)}</Tabela.Celula>
                  {podeReabrir ? (
                    <Tabela.Celula>
                      {/* Reabrir só existe para o fechamento que AINDA congela. Uma linha já
                          reaberta é história: oferecer o botão nela seria prometer uma ação
                          que o servidor recusa (422 "já reaberto"). */}
                      {ciclo.aberto ? (
                        <Botao
                          variante="secundario"
                          tamanho="sm"
                          onClick={() => {
                            setErrosDeReabrir(semErros())
                            setMotivo('')
                            setAReabrir(ciclo)
                          }}
                        >
                          <LockOpen aria-hidden="true" className="size-3.5" />
                          Reabrir
                        </Botao>
                      ) : null}
                    </Tabela.Celula>
                  ) : null}
                </Tabela.Linha>
              ))}
            </Tabela.Corpo>
          </Tabela>
        )
      ) : null}

      {/* FECHAR: não é destrutivo, é de IMPACTO — a partir daqui a produção do período
          para de aceitar edição para a clínica inteira. Tom `atencao`, e a consequência
          diz também a SAÍDA (quem reabre), que é o que a pessoa vai precisar saber. */}
      <DialogConfirmacao
        aberto={confirmandoFechamento}
        aoMudarAberto={(aberto) => {
          if (!aberto) {
            setConfirmandoFechamento(false)
          }
        }}
        titulo={
          periodoAFechar === null
            ? ''
            : `Fechar a produção de ${nomeDoConvenio} de ${periodoLegivel(periodoAFechar)}?`
        }
        consequencia={
          'A partir do fechamento, os atendimentos, as evoluções e os lançamentos deste '
          + 'convênio com data dentro do período deixam de aceitar edição — registrar '
          + 'sessão que aconteceu continua liberado. Só o administrador reabre, com motivo '
          + 'registrado na trilha.'
        }
        rotuloConfirmar="Fechar período"
        tom="atencao"
        carregando={fechamento.isPending}
        erros={errosDeFechar}
        focoAoFechar={destinoDoFoco}
        aoConfirmar={async () => {
          if (periodoAFechar !== null) {
            await fechamento.mutateAsync(periodoAFechar)
          }
        }}
      />

      {/* REABRIR: a chave-mestra. Permissão dedicada (o botão nem existe sem ela),
          palavra digitada e motivo obrigatório — o servidor exige os três, e a tela
          exige os dois que são dela. */}
      <DialogConfirmacao
        aberto={aReabrir !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) {
            setAReabrir(null)
            setMotivo('')
          }
        }}
        titulo={
          aReabrir === null
            ? ''
            : `Reabrir o período de ${periodoLegivel(aReabrir)} de ${nomeDoConvenio}?`
        }
        consequencia={
          'O período volta a aceitar edição — inclusive de produção que já foi enviada à '
          + 'operadora. A reabertura fica registrada na trilha com o seu usuário, a data, o '
          + 'período e o motivo que você escrever abaixo.'
        }
        rotuloConfirmar="Reabrir período"
        tom="perigo"
        palavraDeConfirmacao="REABRIR"
        podeConfirmar={motivoPreenchido}
        motivoDoBloqueio="Escreva o motivo da reabertura."
        carregando={reabertura.isPending}
        erros={errosDeReabrir.gerais}
        focoAoFechar={destinoDoFoco}
        aoConfirmar={async () => {
          if (aReabrir !== null) {
            await reabertura.mutateAsync({ ciclo: aReabrir, texto: motivo.trim() })
          }
        }}
      >
        <CampoTextoLongo
          rotulo="Motivo da reabertura"
          obrigatorio
          value={motivo}
          onChange={(evento) => {
            setMotivo(evento.target.value)
          }}
          limite={LIMITE_DO_MOTIVO}
          linhas={3}
          // SEC-FC-06: este texto vai para a trilha de auditoria, que é append-only e
          // lida por quem administra — NÃO é campo de prontuário. A instrução vem ANTES
          // do erro, porque depois de escrito o nome de uma criança já foi gravado.
          ajuda="Escreva o motivo operacional (ex.: “sessão do dia 12 ficou fora da produção enviada”). Não escreva o nome da criança nem informação do prontuário: este texto fica guardado na trilha de auditoria."
          erro={errosDeReabrir.campos.get('motivo')}
          // a trilha é lida por gente; o corretor "enhanced" do navegador MANDA o texto
          // para o fornecedor, e o mesmo cuidado da evolução vale aqui
          spellCheck={false}
          autoComplete="off"
          disabled={reabertura.isPending}
        />
      </DialogConfirmacao>
    </section>
  )
}
