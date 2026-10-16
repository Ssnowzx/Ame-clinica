import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { Notificacoes } from '@/tipos'

import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { formatarContagem } from '@/lib/numeros'
import { TEMPO_AGENDA_MS } from '@/lib/query-client'
import { buscarNotificacoes } from '@/servicos/catalogos'
import { useAuthStore } from '@/stores/auth-store'

type Nivel = 'urgente' | 'atencao'

interface ItemDeAtencao {
  chave: 'pedidos_de_desmarque' | 'pacotes_acabando' | 'evolucoes_em_aberto' | 'lancamentos_em_atraso'
  nivel: Nivel
  /** O que o número conta, já concordando com ele */
  oQue: (total: number) => string
  destino: string
  permissaoDoDestino: string
  acao: string
}

/**
 * Os quatro blocos do centro de notificações que pedem AÇÃO — o urgente primeiro (a família está
 * esperando resposta). Cada um com o atalho para a tela onde se resolve.
 */
const ITENS: readonly ItemDeAtencao[] = [
  {
    chave: 'pedidos_de_desmarque',
    nivel: 'urgente',
    oQue: (total) => `${total === 1 ? 'sessão' : 'sessões'} com pedido de desmarque pelo WhatsApp`,
    destino: '/agenda',
    permissaoDoDestino: 'agenda.ver',
    acao: 'Abrir a agenda',
  },
  {
    chave: 'evolucoes_em_aberto',
    nivel: 'atencao',
    oQue: (total) => `${total === 1 ? 'atendimento' : 'atendimentos'} sem evolução registrada`,
    destino: '/evolucoes',
    permissaoDoDestino: 'evolucoes.ver',
    acao: 'Abrir as evoluções',
  },
  {
    chave: 'pacotes_acabando',
    nivel: 'atencao',
    oQue: (total) => `${total === 1 ? 'pacote está' : 'pacotes estão'} no fim`,
    destino: '/tratamentos',
    permissaoDoDestino: 'tratamentos.ver',
    acao: 'Ver os tratamentos',
  },
  {
    chave: 'lancamentos_em_atraso',
    nivel: 'atencao',
    // o sino junta receitas E despesas: nunca "pagamentos em atraso" nem valor em R$ aqui — o valor
    // a receber em atraso é outro número, e mora no cartão Dinheiro com esse nome
    oQue: (total) => (total === 1 ? 'lançamento vencido (a receber ou a pagar)' : 'lançamentos vencidos (a receber e a pagar)'),
    destino: '/financeiro',
    permissaoDoDestino: 'lancamentos.ver',
    acao: 'Abrir o financeiro',
  },
]

const NIVEIS: Record<Nivel, { palavra: string; Icone: typeof CircleAlert; pele: string }> = {
  urgente: { palavra: 'Urgente', Icone: CircleAlert, pele: 'bg-perigo-suave text-perigo-texto' },
  atencao: { palavra: 'Atenção', Icone: TriangleAlert, pele: 'bg-alerta-suave text-alerta-texto' },
}

/** O `total` de um bloco, se ele veio. Ausente ≠ zero: o servidor só manda o que a pessoa pode ver. */
function totalDo(notificacoes: Notificacoes, chave: ItemDeAtencao['chave']): number | null {
  return notificacoes[chave]?.total ?? null
}

/**
 * O quadro "PEDE ATENÇÃO" da Visão geral (D9): os blocos do sino que pedem ação, cada um com a
 * contagem, o estado em ÍCONE E PALAVRA (nunca só a cor) e o atalho.
 *
 * **Só os `total`, nunca os `itens`** — os itens trazem o nome da criança, e a Visão geral é a tela
 * que vai para a parede e para o papel. Reusa a MESMA chave do sino (`chaves.notificacoes()`): os
 * dois leem um cache só, e o sino já o mantém vivo.
 *
 * Cada bloco só aparece se VEIO na resposta (o servidor filtra pela permissão do módulo dono).
 * Nenhum veio → o quadro não existe para esta pessoa. Vieram e estão zerados → "Nada pede atenção
 * agora", em vez de sumir sem explicação.
 */
export function PedeAtencao() {
  const permissoes = useAuthStore((estado) => estado.usuario?.permissoes)
  const consulta = useQuery({
    queryKey: chaves.notificacoes(),
    queryFn: buscarNotificacoes,
    staleTime: TEMPO_AGENDA_MS,
  })

  if (consulta.isSuccess && ITENS.every((item) => totalDo(consulta.data, item.chave) === null)) {
    return null
  }

  return (
    <section
      aria-labelledby="pede-atencao"
      aria-busy={consulta.isPending || undefined}
      className="@container flex min-w-0 flex-col gap-4 rounded-superficie border border-linha bg-superficie p-5 shadow-e1 print:break-inside-avoid print:shadow-none"
    >
      <div className="flex flex-col gap-1">
        <h2 id="pede-atencao" className="text-pretty text-subtitulo font-semibold text-texto">
          Pede atenção
        </h2>
        <p className="text-pretty text-meta text-texto-suave">O que está esperando alguém agir, agora.</p>
      </div>

      {/* carregando: as quatro linhas na altura que elas têm em cada largura do quadro (PERF-01) — o
          texto quebra em duas linhas no quadro estreito */}
      {consulta.isPending ? (
        <div className="flex flex-col gap-3">
          {['desmarque', 'evolucoes', 'pacotes', 'lancamentos'].map((linha) => (
            <Skeleton key={linha} className="h-14 w-full @min-[26rem]:h-11 @min-[40rem]:h-10" />
          ))}
        </div>
      ) : null}

      {consulta.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar o que pede atenção."
          aoTentarNovamente={() => void consulta.refetch()}
        />
      ) : null}

      {consulta.isSuccess ? (
        <ListaDeAtencao notificacoes={consulta.data} temPermissao={(permissao) => permissoes?.includes(permissao) === true} />
      ) : null}
    </section>
  )
}

/** Quando nada está pendente: o quadro diz isso, em vez de sumir sem explicação. */
function NadaPedeAtencao() {
  return (
    <div className="flex items-start gap-3 rounded-campo bg-sucesso-suave px-4 py-3">
      <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-sucesso-texto" />
      <div>
        <p className="text-corpo font-semibold text-texto">Nada pede atenção agora</p>
        <p className="text-pretty text-meta text-texto-suave">
          Pedidos de desmarque, evoluções, pacotes no fim e lançamentos vencidos estão em dia.
        </p>
      </div>
    </div>
  )
}

/**
 * As três colunas de UMA linha — selo | texto | atalho — sobre a grade da lista (`subgrid`): os selos
 * de todas as linhas têm a mesma largura e o texto começa no mesmo lugar, e o atalho fica na direita,
 * sem descer para baixo do texto em algumas linhas e não em outras (DQ-12).
 */
const COLUNAS_DA_LINHA = 'col-span-3 grid grid-cols-subgrid items-center gap-x-3 px-2 py-3'

function LinhaDeAtencao({ item, total, comPorta }: { item: ItemDeAtencao; total: number; comPorta: boolean }) {
  const nivel = NIVEIS[item.nivel]
  const conteudo = (
    <>
      <span className={cn('inline-flex w-fit items-center gap-1 rounded-pilula px-2 py-0.5 text-meta font-semibold', nivel.pele)}>
        <nivel.Icone aria-hidden="true" className="size-3.5" />
        {nivel.palavra}
      </span>
      <span className="min-w-0 text-pretty text-corpo text-texto">
        <strong className="font-semibold tabular-nums">{formatarContagem(total)}</strong> {item.oQue(total)}
      </span>
    </>
  )

  // a linha inteira é a porta — só com a permissão do DESTINO (o link nunca promete 403)
  if (!comPorta) {
    return (
      <div className={COLUNAS_DA_LINHA}>
        {conteudo}
        <span />
      </div>
    )
  }

  return (
    <Link
      to={item.destino}
      className={cn(
        COLUNAS_DA_LINHA,
        'rounded-controle hover:bg-hover-de-linha focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
      )}
    >
      {conteudo}
      {/* no quadro estreito o atalho vira só a seta — o nome do destino segue no nome do link */}
      <span data-nao-imprimir className="inline-flex items-center gap-1 justify-self-end text-meta font-medium text-acento">
        <span className="sr-only @min-[26rem]:not-sr-only">{item.acao}</span>
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </span>
    </Link>
  )
}

function ListaDeAtencao({
  notificacoes,
  temPermissao,
}: {
  notificacoes: Notificacoes
  temPermissao: (permissao: string) => boolean
}) {
  const pendentes = ITENS.flatMap((item) => {
    const total = totalDo(notificacoes, item.chave)

    // zero não é notícia: o item com zero não aparece
    return total === null || total === 0 ? [] : [{ item, total }]
  })

  if (pendentes.length === 0) {
    return <NadaPedeAtencao />
  }

  return (
    <ul className="-mx-2 grid grid-cols-[auto_minmax(0,1fr)_auto]">
      {pendentes.map(({ item, total }) => (
        <li key={item.chave} className="col-span-3 grid grid-cols-subgrid border-b border-linha last:border-b-0">
          <LinhaDeAtencao item={item} total={total} comPorta={temPermissao(item.permissaoDoDestino)} />
        </li>
      ))}
    </ul>
  )
}
