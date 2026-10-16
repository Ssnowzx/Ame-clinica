import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquareOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { BotaoVoltarParaConversas, CabecalhoDaConversa } from '@/componentes/mensagens/cabecalho-da-conversa'
import { CampoDeEnvio } from '@/componentes/mensagens/campo-de-envio'
import { ListaDeConversas } from '@/componentes/mensagens/lista-de-conversas'
import { RelogioDaJanela } from '@/componentes/mensagens/relogio-da-janela'
import { ThreadDaConversa } from '@/componentes/mensagens/thread-da-conversa'
import { VincularPaciente } from '@/componentes/mensagens/vincular-paciente'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Botao } from '@/componentes/ui/botao'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarToast } from '@/componentes/ui/toast'
import { usarDebounce } from '@/hooks/usar-debounce'
import { usarFocoDoMestreDetalhe } from '@/hooks/usar-foco-do-mestre-detalhe'
import { usarHistoricoDaThread } from '@/hooks/usar-historico-da-thread'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { distribuirErrosDoServidor } from '@/lib/erros'
import {
  abrirConversa,
  arquivarConversa,
  definirLembretes,
  enviarArquivo,
  enviarMensagem,
  listarConversas,
  listarTemplates,
  reenviarMensagem,
  vincularConversa,
} from '@/servicos/mensageria'
import { useAuthStore } from '@/stores/auth-store'
import type { FiltroDeConversas, PayloadDeEnvio, ThreadDaConversa as Thread } from '@/tipos'

/** Lista: 15 s. Thread aberta: 8 s — quem está conversando espera resposta agora. */
function motivoDoErro(erro: unknown): string {
  const { gerais } = distribuirErrosDoServidor(erro, new Set())
  return gerais[0] ?? 'Não foi possível concluir a ação. Tente novamente.'
}

const INTERVALO_DA_LISTA = 15_000

const INTERVALO_DA_THREAD = 8_000

/**
 * A caixa de entrada do WhatsApp (change mensageria-whatsapp).
 *
 * ATUALIZAÇÃO POR POLLING (design D7): com ~24 usuários e um número, um servidor de socket
 * seria processo novo, autenticação nova e superfície nova para nada. O intervalo é
 * SUSPENSO quando a aba do navegador está oculta — sem isso, vinte abas esquecidas abertas
 * numa recepção bateriam no servidor a noite inteira.
 */
export function PaginaMensagens() {
  const [parametros, setParametros] = useSearchParams()
  const [filtro, setFiltro] = useState<FiltroDeConversas>('ativas')
  const [busca, setBusca] = useState('')
  // debounce: sem ele era uma requisição POR TECLA — e o termo é nome de menor, então
  // cada tecla também virava uma linha a mais no log do proxy (gatilho LOG)
  const buscaDebounced = usarDebounce(busca, 300)
  const [pagina, setPagina] = useState(1)
  // a conversa em que o diálogo de vínculo foi ABERTO (null = fechado). Guardar o id, e não um
  // booleano, é o que impede vincular a conversa errada: ver `vinculoAberto` abaixo
  const [vinculandoEm, setVinculandoEm] = useState<number | null>(null)
  // para onde o foco volta quando o diálogo de vínculo fecha: o "Mais ações" do celular, se foi
  // por ele (o item do menu já saiu da árvore); `null` = o botão que abriu, o padrão do Dialog
  const origemDoVinculo = useRef<HTMLElement | null>(null)
  const refDaFicha = useRef<HTMLAnchorElement>(null)
  const [visivel, setVisivel] = useState(() => document.visibilityState === 'visible')
  const clienteDeQuery = useQueryClient()
  const { notificar } = usarToast()
  const podeResponder = useAuthStore((estado) => estado.usuario?.permissoes.includes('mensagens.responder') ?? false)
  const podeConectar = useAuthStore((estado) => estado.usuario?.permissoes.includes('mensagens.conectar') ?? false)

  const selecionada = Number(parametros.get('conversa')) || null
  // O diálogo de vínculo pertence à conversa em que abriu. Se a conversa muda POR FORA com ele
  // aberto (voltar do navegador, link do centro de notificações), ele fecha — antes, continuava
  // aberto sobre a outra conversa e vinculava a ERRADA. Ajuste durante o render, não num efeito:
  // nem um quadro do diálogo sobre a conversa nova, e ele não reabre ao voltar à antiga
  if (vinculandoEm !== null && vinculandoEm !== selecionada) {
    setVinculandoEm(null)
  }
  const vinculoAberto = vinculandoEm !== null
  const abrirVinculo = (origem: HTMLElement | null) => {
    origemDoVinculo.current = origem
    setVinculandoEm(selecionada)
  }

  useEffect(() => {
    const aoTrocar = () => setVisivel(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', aoTrocar)
    return () => document.removeEventListener('visibilitychange', aoTrocar)
  }, [])

  const lista = useQuery({
    queryKey: chaves.conversas({ filtro, busca: buscaDebounced, pagina }),
    queryFn: () => listarConversas(filtro, buscaDebounced, pagina),
    refetchInterval: visivel ? INTERVALO_DA_LISTA : false,
  })

  const thread = useQuery({
    queryKey: chaves.conversa(selecionada ?? 0),
    queryFn: () => abrirConversa(selecionada as number),
    enabled: selecionada !== null,
    refetchInterval: visivel ? INTERVALO_DA_THREAD : false,
    // o teor da conversa de uma criança não fica no cache depois que alguém sai da aba
    gcTime: 0,
  })

  const templates = useQuery({
    queryKey: chaves.templatesDeMensagem(),
    queryFn: listarTemplates,
    // só é preciso quando a janela fecha; carregar sempre é barato e evita espera no clique
    enabled: podeResponder,
  })

  const recarregar = () => {
    void clienteDeQuery.invalidateQueries({ queryKey: ['conversas'] })
    void clienteDeQuery.invalidateQueries({ queryKey: chaves.notificacoes() })
  }

  const envio = useMutation({
    mutationFn: (payload: PayloadDeEnvio) => enviarMensagem(selecionada as number, payload),
    onSuccess: recarregar,
    onError: (erro) => notificar({ tom: 'erro', titulo: motivoDoErro(erro) }),
  })

  const anexo = useMutation({
    mutationFn: (arquivo: File) => enviarArquivo(selecionada as number, arquivo),
    onSuccess: recarregar,
    onError: (erro) => notificar({ tom: 'erro', titulo: motivoDoErro(erro) }),
  })

  const reenvio = useMutation({
    mutationFn: reenviarMensagem,
    onSuccess: () => {
      recarregar()
      notificar({ tom: 'sucesso', titulo: 'Mensagem reenfileirada para envio.' })
    },
    onError: (erro) => notificar({ tom: 'erro', titulo: motivoDoErro(erro) }),
  })

  const arquivamento = useMutation({
    mutationFn: (arquivar: boolean) => arquivarConversa(selecionada as number, arquivar),
    onSuccess: (conversaAtualizada) => {
      recarregar()
      notificar({
        tom: 'sucesso',
        titulo: conversaAtualizada.arquivada ? 'Conversa arquivada.' : 'Conversa reaberta.',
      })
    },
    onError: (erro) => notificar({ tom: 'erro', titulo: motivoDoErro(erro) }),
  })

  const vinculo = useMutation({
    // o id vai COM o pedido: o da conversa em que o diálogo abriu, nunca o da aberta na hora
    mutationFn: ({ conversaId, pacienteId }: { conversaId: number; pacienteId: number }) =>
      vincularConversa(conversaId, pacienteId),
    onSuccess: (conversaAtualizada) => {
      // o cabeçalho troca "Vincular paciente" pelo link da ficha JÁ, antes de o diálogo fechar:
      // é para o link que o foco volta — o botão que abriu o diálogo deixa de existir (A11Y-CL-03c).
      // A chave é a da conversa que o SERVIDOR vinculou, e não a aberta agora: quem trocou de
      // conversa com o pedido no ar veria o paciente da família A no cabeçalho da B (SEC-CL2-03)
      clienteDeQuery.setQueryData<Thread>(chaves.conversa(conversaAtualizada.id), (atual) =>
        atual?.conversa.id === conversaAtualizada.id
          ? { ...atual, conversa: { ...atual.conversa, paciente: conversaAtualizada.paciente } }
          : atual,
      )
      setVinculandoEm(null)
      recarregar()
      notificar({ tom: 'sucesso', titulo: 'Conversa vinculada ao paciente.' })
    },
    onError: (erro) => notificar({ tom: 'erro', titulo: motivoDoErro(erro) }),
  })

  const optOut = useMutation({
    mutationFn: (sem: boolean) => definirLembretes(selecionada as number, sem),
    // o toast diz o estado NOVO: "Preferência atualizada" não dizia se ficou ligado ou desligado
    // (A11Y-CL-09) — e no celular o botão com o estado está escondido no menu
    onSuccess: (_conversa, sem) => {
      recarregar()
      notificar({ tom: 'sucesso', titulo: sem ? 'Lembretes silenciados.' : 'Lembretes reativados.' })
    },
    onError: (erro) => notificar({ tom: 'erro', titulo: motivoDoErro(erro) }),
  })

  // trocar de filtro/busca volta à primeira página (trocar de conversa zera o histórico no gancho)
  useEffect(() => setPagina(1), [filtro, buscaDebounced])

  const conversa = thread.data?.conversa ?? null
  const { mensagens, carregarAnteriores, temHistorico } = usarHistoricoDaThread(selecionada, thread.data?.mensagens)
  const foco = usarFocoDoMestreDetalhe(selecionada, { pronta: thread.isSuccess, falhou: thread.isError })
  const voltarParaConversas = () => setParametros({})
  // "Carregar anteriores" que falha diz o porquê — sem isso era uma rejeição solta e um clique mudo
  const pedirAnteriores = () => {
    carregarAnteriores().catch((erro: unknown) => notificar({ tom: 'erro', titulo: motivoDoErro(erro) }))
  }
  const desconectado = lista.data !== undefined && lista.data.conexao !== 'conectado'

  return (
    // Altura CONTIDA — sem ela a thread deixa de rolar em si mesma e o `scrollIntoView`
    // passa a rolar a PÁGINA, jogando o campo focado para fora da tela (achado do gate de
    // a11y; foi a minha troca por `h-full` que causou isso). `dvh` porque a barra do
    // navegador móvel muda `vh` no meio da rolagem.
    //
    // O desconto vem do TOKEN, não de um número aqui: era `6.25rem` (100px) e estava errado —
    // a moldura real é 112px (88 acima + 24 abaixo), então esta página transbordava o
    // documento em 12px. Medido na change `agenda-no-mouse`, que precisou do mesmo número e
    // encontrou a divergência. Duas cópias de uma medição divergem; esta divergia.
    //
    // `relative`: os `sr-only` desta página (o cabeçalho no celular) são absolutos, e sem um
    // ancestral posicionado escapariam para o documento e o esticariam.
    //
    // `min-h-[22rem]`: com zoom de 400% (320×256) ou texto a 200%, a altura contida esmagava a
    // conversa até sumir. Abaixo desse piso, é o DOCUMENTO que rola — e o campo de escrever
    // continua alcançável (1.4.10, A11Y-CL-04). 22 e não 30: com 30rem (480 px) um celular de
    // 375×548 (altura útil 436) já rolava o documento (CRL2-01). A 390×658 a altura contida é 546.
    <div className="relative flex h-[calc(100dvh-var(--moldura-do-shell))] min-h-[22rem] flex-col gap-3">
      {/*
        Abaixo de `lg`, com uma conversa aberta, o cabeçalho da página SAI DA VISTA (change
        conversa-legivel, D2): título, frase e busca comiam 150 px de um celular em que a
        conversa ficava com 98. O `h1` continua para o leitor de tela (`sr-only`); a frase e a
        busca saem de vez (`hidden`) — busca invisível mas focável seria uma parada de Tab no
        vazio. Sem conversa aberta, a lista precisa da busca, e nada muda.
      */}
      <header
        className={cn('flex flex-wrap items-center justify-between gap-3', selecionada !== null && 'max-lg:sr-only')}
      >
        <div>
          {/* âncora do foco na volta, quando a conversa fechada não está na página da lista */}
          <h1 ref={foco.refDoH1} tabIndex={-1} className="text-titulo font-semibold text-texto">
            Mensagens
          </h1>
          <p className={cn('text-meta text-texto-suave', selecionada !== null && 'max-lg:hidden')}>
            As conversas de WhatsApp da clínica, no lugar de todo mundo — sem celular pessoal.
          </p>
        </div>
        <div className={cn('w-full max-w-xs', selecionada !== null && 'max-lg:hidden')}>
          <CampoTexto
            rotulo="Buscar conversa"
            type="search"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Nome ou telefone…"
          />
        </div>
      </header>

      {desconectado && (
        <div role="status" className="rounded-campo bg-alerta-suave p-3 text-corpo text-alerta-texto">
          <strong className="font-medium">WhatsApp não conectado.</strong>{' '}
          {podeConectar ? (
            <>
              O histórico continua legível, mas nada pode ser enviado.{' '}
              <Link to="/configuracoes/whatsapp" className="underline underline-offset-2">
                Conectar o número da clínica
              </Link>
              .
            </>
          ) : (
            'O histórico continua legível, mas nada pode ser enviado. Fale com o administrador da clínica.'
          )}
        </div>
      )}

      {/*
        O split de duas colunas só liga em `lg` (1024). Em `md` (768) a largura útil é
        viewport − 256 px da barra lateral: a coluna fixa de 20rem comia 320 e sobravam
        120 px para a thread — o botão Enviar ficava 122 px FORA do painel, cortado pelo
        `overflow-hidden`. Abaixo de `lg` é MASTER-DETAIL: ou a lista, ou a conversa.
      */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <section
          ref={foco.refDaLista}
          aria-label="Conversas"
          aria-busy={lista.isPending}
          className={cn(
            'min-h-0 overflow-hidden rounded-superficie bg-superficie ring-1 ring-linha',
            selecionada !== null && 'hidden lg:block',
          )}
        >
          {lista.isPending ? (
            // moldura já montada (a barra de filtros mede 57 px): sem ela, a chegada do
            // dado empurra a lista inteira para baixo
            <div className="flex h-full flex-col">
              <div className="h-[57px] border-b border-linha" />
              <div className="space-y-px p-0">
                {[0, 1, 2, 3, 4].map((linha) => (
                  <Skeleton key={linha} className="h-[74px] w-full rounded-none" />
                ))}
              </div>
            </div>
          ) : lista.isError ? (
            <div className="p-3">
              <EstadoErro mensagem={motivoDoErro(lista.error)} aoTentarNovamente={() => void lista.refetch()} />
            </div>
          ) : (
            <ListaDeConversas
              conversas={lista.data.conversas}
              selecionada={selecionada}
              filtro={filtro}
              onFiltro={setFiltro}
              onSelecionar={(id) => {
                foco.aoAbrir()
                setParametros({ conversa: String(id) })
              }}
              pagina={lista.data.pagina}
              ultimaPagina={lista.data.ultima_pagina}
              total={lista.data.total}
              onPagina={setPagina}
            />
          )}
        </section>

        <section
          aria-label="Conversa selecionada"
          aria-busy={thread.isPending && selecionada !== null}
          className={cn(
            'flex min-h-0 flex-col overflow-hidden rounded-superficie bg-fundo ring-1 ring-linha',
            selecionada === null && 'hidden lg:flex',
          )}
        >
          {selecionada === null ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EstadoVazio
                titulo="Nenhuma conversa aberta"
                descricao="Escolha uma conversa à esquerda para ler o histórico e responder à família."
                icone={<MessageSquareOff className="size-8" />}
                className="border-0"
              />
            </div>
          ) : thread.isPending ? (
            // cabeçalho, thread e rodapé de composição já no lugar — só o conteúdo pulsa
            <div className="flex h-full flex-col">
              {/* 53 px no celular: o cabeçalho de uma linha (alvo de 44 + respiro + filete) */}
              <div className="h-[73px] border-b border-linha bg-superficie max-lg:h-[53px]" />
              <div className="flex-1 space-y-3 p-4">
                <Skeleton className="h-10 w-2/3" />
                <Skeleton className="ml-auto h-10 w-1/2" />
                <Skeleton className="h-10 w-1/2" />
              </div>
              <div className="h-[104px] border-t border-linha bg-superficie" />
            </div>
          ) : thread.isError ? (
            // no celular a lista está escondida: o erro precisa da própria volta, senão é beco
            <div className="space-y-2 p-4">
              <BotaoVoltarParaConversas
                aoVoltar={voltarParaConversas}
                refDoBotao={foco.refDoVoltarDoErro}
                className="-ml-2 -mt-2"
              />
              <EstadoErro mensagem={motivoDoErro(thread.error)} aoTentarNovamente={() => void thread.refetch()} />
            </div>
          ) : (
            <>
              <CabecalhoDaConversa
                refDoTitulo={foco.refDoTitulo}
                refDaFicha={refDaFicha}
                conversa={thread.data.conversa}
                podeAgir={podeResponder}
                aoVoltar={voltarParaConversas}
                silenciando={optOut.isPending}
                arquivando={arquivamento.isPending}
                aoSilenciar={(silenciar) => optOut.mutate(silenciar)}
                aoArquivar={(arquivar) => arquivamento.mutate(arquivar)}
                aoVincular={abrirVinculo}
              />

              {(thread.data.tem_anteriores || temHistorico) && (
                <div className="border-b border-linha bg-superficie px-4 py-2 text-center">
                  <Botao variante="fantasma" tamanho="sm" onClick={pedirAnteriores}>
                    Carregar mensagens anteriores
                  </Botao>
                </div>
              )}
              <ThreadDaConversa
                conversaId={thread.data.conversa.id}
                mensagens={mensagens}
                podeReenviar={podeResponder && !desconectado}
                onReenviar={(id) => reenvio.mutate(id)}
              />

              <div className="border-t border-linha bg-superficie px-3 pt-2">
                <RelogioDaJanela
                  expiraEm={thread.data.conversa.janela_expira_em}
                  aberta={thread.data.conversa.janela_aberta}
                  desconectado={desconectado}
                />
              </div>

              {podeResponder && conversa !== null && (
                <CampoDeEnvio
                  conversa={conversa}
                  templates={templates.data ?? []}
                  // carregando ou falhou, a lista vazia não prova "nenhum aprovado" — o aviso espera
                  templatesCarregados={templates.isSuccess}
                  enviando={envio.isPending || anexo.isPending}
                  // o campo NÃO some quando o canal cai: ele fica visível e desabilitado,
                  // com o motivo ao lado. Sumir deixa a pessoa procurando o que aconteceu,
                  // e o aviso do topo está a ~700 px do ponto da ação
                  bloqueio={desconectado ? 'O WhatsApp da clínica não está conectado.' : null}
                  onEnviar={(payload) => envio.mutate(payload)}
                  onArquivo={(arquivo) => anexo.mutate(arquivo)}
                />
              )}
            </>
          )}
        </section>
      </div>
      <VincularPaciente
        aberto={vinculoAberto}
        vinculando={vinculo.isPending}
        focoAoFechar={() => {
          // vinculou: o botão que abriu sumiu, e o link da ficha nasceu no lugar dele
          const ficha = refDaFicha.current
          if (ficha !== null && ficha.isConnected) return ficha
          const origem = origemDoVinculo.current
          return origem !== null && origem.isConnected ? origem : null
        }}
        aoFechar={() => setVinculandoEm(null)}
        aoVincular={(pacienteId) => {
          if (vinculandoEm !== null) vinculo.mutate({ conversaId: vinculandoEm, pacienteId })
        }}
      />
    </div>
  )
}
