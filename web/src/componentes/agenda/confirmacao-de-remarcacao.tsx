import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { Dialog } from '@/componentes/ui/dialog'
import { ListaDescricao } from '@/componentes/ui/lista-descricao'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarMutacaoDeAgendamento } from '@/hooks/usar-mutacao-de-agendamento'
import { montarPayloadDeRemarcacao, type AlvoDeRemarcacao } from '@/lib/arrastar-remarcar'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel } from '@/lib/datas'
import { buscarAgendamento, buscarTamanhoDaSerie } from '@/servicos/agenda'
import type { CardAgendamento, ProfissionalDaAgenda } from '@/tipos'

/** O que o soltar (ou a escolha por teclado) entrega: o card da grade + a célula alvo. */
export interface PedidoDeRemarcacao {
  /** O card como a GRADE o conhece — serve à exibição imediata; a VERSÃO nunca sai daqui (D2). */
  card: CardAgendamento
  alvo: AlvoDeRemarcacao
}

/**
 * Como a confirmação terminou — a página decide o destino do FOCO (2.4.3):
 * sucesso → o card remarcado no destino; cancelado → o gatilho de origem.
 */
export type ResultadoDaRemarcacao = 'sucesso' | 'cancelado'

interface ConfirmacaoDeRemarcacaoProps {
  pedido: PedidoDeRemarcacao | null
  /** Para nomear os profissionais de ORIGEM e DESTINO — o detalhe e a célula só conhecem o id. */
  profissionais: ProfissionalDaAgenda[]
  aoFechar: (resultado: ResultadoDaRemarcacao) => void
}

/**
 * A confirmação compacta do arrastar-para-remarcar (D2): soltar NUNCA grava —
 * este diálogo busca a versão FRESCA (`GET /api/agendamentos/{id}`, o mesmo do
 * painel), mostra o de→para e só então dispara o MESMO `atualizar` da edição
 * (`putComVersao`, If-Match da leitura fresca). É também o freio do misdrag:
 * soltar na célula vizinha errada nunca grava sozinho.
 *
 * Cancelar não emite requisição nenhuma — o card nunca saiu do lugar.
 */
export function ConfirmacaoDeRemarcacao({ pedido, profissionais, aoFechar }: ConfirmacaoDeRemarcacaoProps) {
  // sem pedido, NADA monta (padrão do PainelAgendamento): queries e mutação só
  // existem com um pedido em mãos — e cada pedido nasce com estado zerado
  if (pedido === null) {
    return null
  }
  return (
    <ConfirmacaoAberta
      key={`${pedido.card.id}-${pedido.alvo.profissionalId}-${pedido.alvo.data}-${pedido.alvo.horario}`}
      pedido={pedido}
      profissionais={profissionais}
      aoFechar={aoFechar}
    />
  )
}

interface ConfirmacaoAbertaProps {
  pedido: PedidoDeRemarcacao
  profissionais: ProfissionalDaAgenda[]
  aoFechar: (resultado: ResultadoDaRemarcacao) => void
}

function ConfirmacaoAberta({ pedido, profissionais, aoFechar }: ConfirmacaoAbertaProps) {
  const [aplicarNaSerie, setAplicarNaSerie] = useState(false)
  // nasce DESMARCADA: a família só é avisada quando foi a CLÍNICA que mudou (pedido da Mariana)
  const [avisarFamilia, setAvisarFamilia] = useState(false)
  const { atualizar, erros, gravando } = usarMutacaoDeAgendamento()

  // D2: o card da grade não carrega a versão que o If-Match precisa — e pode
  // estar velho (outra recepcionista mexeu). A leitura FRESCA decide a origem
  // exibida E a versão enviada. `gcTime: 0` + `staleTime: 0`: uma confirmação
  // de escrita nunca se serve de cache.
  const detalhe = useQuery({
    queryKey: chaves.agendamentoDetalhe(pedido.card.id),
    queryFn: () => buscarAgendamento(pedido.card.id),
    staleTime: 0,
    gcTime: 0,
  })

  // O alcance REAL da série vem do servidor (D9 da agenda-escrita): a grade só
  // conhece o período consultado — contar irmãos por ela mentiria.
  const serie = useQuery({
    queryKey: chaves.serieDoAgendamento(pedido.card.id),
    queryFn: () => buscarTamanhoDaSerie(pedido.card.id),
    gcTime: 0,
  })

  const fresco = detalhe.data
  const origem = fresco ?? pedido.card
  const nome = pedido.card.paciente?.nome_social ?? pedido.card.paciente?.nome ?? 'este agendamento'

  // O detalhe (`show`) só traz ESCALARES — sem a relação `profissional`. O nome
  // da ORIGEM sai do catálogo que a página JÁ carrega (`/agenda/selecao`), sem
  // requisição nova; o objeto do card da grade é só o fallback.
  const nomeDaOrigem =
    profissionais.find((item) => item.id === origem.profissional_id)?.nome
    ?? pedido.card.profissional?.nome
    ?? '—'

  const nomeDoDestino =
    profissionais.find((item) => item.id === pedido.alvo.profissionalId)?.nome
    ?? (pedido.alvo.profissionalId === origem.profissional_id ? nomeDaOrigem : undefined)
    ?? '—'

  // O agendamento TEM série (sinal do próprio registro): a caixa da opção é
  // RESERVADA enquanto o alcance real carrega — o checkbox não pode "pipocar"
  // debaixo do dedo de quem confirma rápido, nem sumir mudo se a consulta falhar.
  const temSerie = origem.recorrencia_grupo_id != null
  const emSerie = serie.data?.em_serie === true
  const seguintes = serie.data?.futuros ?? 0
  const serieCarregando = temSerie && !serie.isFetched
  const serieFalhou = temSerie && serie.isError

  // a recusa do servidor aparece AQUI, onde a pessoa está olhando — não só num
  // toast que passa; sem campos na tela, o porCampo também desagua no aviso
  const recusas = [
    ...erros.gerais,
    ...Object.values(erros.porCampo).filter((mensagem): mensagem is string => mensagem !== undefined),
  ]

  function confirmar(): void {
    if (fresco === undefined) {
      return
    }
    atualizar.mutate(
      {
        id: fresco.id,
        // o payload sai do ALVO (inicio + profissional_id SEMPRE — contrato do
        // PUT); do card FRESCO sai só a versão do If-Match
        payload: {
          ...montarPayloadDeRemarcacao(pedido.alvo, aplicarNaSerie && emSerie),
          ...(avisarFamilia ? { avisar_familia: true } : {}),
        },
        versao: fresco.updated_at,
      },
      {
        onSuccess: () => {
          aoFechar('sucesso')
        },
      },
    )
  }

  return (
    <Dialog
      aberto
      aoMudarAberto={(estaAberto) => {
        if (!estaAberto && !gravando) {
          aoFechar('cancelado')
        }
      }}
      titulo={`Remarcar ${nome}?`}
      descricao="Nada é gravado sem confirmar."
      className="max-w-md"
      // 2.4.3: o restore default do Radix roda no UNMOUNT e roubaria de volta o
      // foco que a página põe no card — o destino explícito é resolvido AQUI
      // (sucesso → card remarcado; cancelado → gatilho de origem), com o rAF da
      // página cobrindo o caso do card que ainda não re-renderizou (null aqui).
      focoAoFechar={() => {
        const card = document.querySelector<HTMLElement>(`[data-card-id="${String(pedido.card.id)}"]`)
        if (card === null) {
          return null
        }
        return (
          card.querySelector<HTMLElement>('[aria-label^="Remarcar"]') ??
          card.querySelector<HTMLElement>('button')
        )
      }}
      rodape={
        <div className="flex justify-end gap-3">
          <Botao
            variante="secundario"
            onClick={() => {
              aoFechar('cancelado')
            }}
            disabled={gravando}
          >
            Cancelar
          </Botao>
          <Botao
            onClick={confirmar}
            carregando={gravando}
            // só confirma com a leitura FRESCA em mãos (a versão vem dela) — e,
            // quando há série, com o alcance RESOLVIDO: quem confirma rápido não
            // pode gravar antes de a opção de série sequer aparecer
            disabled={fresco === undefined || detalhe.isFetching || serieCarregando}
          >
            {aplicarNaSerie && emSerie ? 'Remarcar série' : 'Remarcar agendamento'}
          </Botao>
        </div>
      }
    >
      {detalhe.isError ? (
        <div className="flex flex-col items-start gap-3">
          <AvisoErro mensagens={['Não foi possível carregar o agendamento para remarcar.']} />
          <Botao
            variante="secundario"
            tamanho="sm"
            onClick={() => {
              void detalhe.refetch()
            }}
          >
            Tentar novamente
          </Botao>
        </div>
      ) : fresco === undefined ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ListaDescricao
            itens={[
              {
                rotulo: 'De',
                valor: `${dataHoraLegivel(origem.inicio)} · ${nomeDaOrigem}`,
              },
              {
                rotulo: 'Para',
                valor: `${dataHoraLegivel(`${pedido.alvo.data} ${pedido.alvo.horario}`)} · ${nomeDoDestino}`,
              },
            ]}
          />

          {/* a caixa do bloco de série na MESMA geometria do CampoCheckbox
              (linha de 24px + ajuda de ~3 linhas de text-meta em 390px): o
              conteúdo troca, a altura não pula (CLS 0) */}
          {serieCarregando ? (
            <div aria-busy="true" className="flex flex-col gap-1.5">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : serieFalhou ? (
            <div className="flex flex-col items-start gap-3">
              <AvisoErro mensagens={['Não foi possível verificar a série deste agendamento. Confirmar agora remarca só este horário.']} />
              <Botao
                variante="secundario"
                tamanho="sm"
                onClick={() => {
                  void serie.refetch()
                }}
              >
                Tentar novamente
              </Botao>
            </div>
          ) : emSerie ? (
            /* o MESMO prompt de série do formulário — o gesto não inventa alcance */
            <CampoCheckbox
              rotulo="Aplicar também nos seguintes da série"
              marcado={aplicarNaSerie}
              aoMudar={setAplicarNaSerie}
              ajuda={`Desloca os ${seguintes} agendamentos seguintes pelo mesmo intervalo — inclusive os que estão fora do período que você está vendo. Se algum conflitar, nada é alterado.`}
            />
          ) : null}

          {origem.tipo === 'bloqueio' ? null : (
            <CampoCheckbox
              rotulo="Avisar a família pelo WhatsApp"
              marcado={avisarFamilia}
              aoMudar={setAvisarFamilia}
              ajuda="Marque quando foi a clínica que mudou o horário. Se a família pediu a troca, ela já sabe."
            />
          )}

          {recusas.length > 0 ? <AvisoErro mensagens={recusas} /> : null}
        </div>
      )}
    </Dialog>
  )
}
