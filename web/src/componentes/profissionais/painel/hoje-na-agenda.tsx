import { useQuery } from '@tanstack/react-query'

import type { CardAgendamento } from '@/tipos'

import { CartaoDaFicha, PortaDoBloco } from '@/componentes/profissionais/painel/secao-do-painel'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { formatarContagem } from '@/lib/numeros'
import { TEMPO_AGENDA_MS } from '@/lib/query-client'
import { buscarAgenda } from '@/servicos/agenda'

/**
 * HOJE NA AGENDA (mantido da change ficha-do-profissional, com o próximo atendimento em destaque).
 *
 * Número derivado de leitura ESCOPADA só na PRÓPRIA ficha (design, decisão 1): em ficha de colega o
 * servidor devolveria o RECORTE de quem olha (vazio ou o próprio), e um "0" fabricado pelo escopo
 * mentiria — então a seção vira PORTA para a agenda filtrada, sem buscar nada.
 *
 * O dia é sempre HOJE, na parede da clínica: o mês escolhido no painel não muda o que "hoje" quer dizer.
 */
export function HojeNaAgenda({
  profissionalId,
  ehProprio,
  hoje,
  agora,
}: {
  profissionalId: number
  ehProprio: boolean
  /** `Y-m-d` na parede da clínica */
  hoje: string
  /** `HH:mm` na parede da clínica — decide o que ainda está por vir */
  agora: string
}) {
  return (
    <CartaoDaFicha id="ficha-prof-hoje" titulo="Hoje na agenda">
      {ehProprio ? (
        <DiaDoProprio profissionalId={profissionalId} hoje={hoje} agora={agora} />
      ) : (
        <p className="text-corpo text-texto-suave">O dia deste profissional se vê na agenda, com o recorte do seu papel.</p>
      )}
      <PortaDoBloco para={`/agenda?profissional=${profissionalId}&visao=dia`}>Abrir na agenda</PortaDoBloco>
    </CartaoDaFicha>
  )
}

function DiaDoProprio({ profissionalId, hoje, agora }: { profissionalId: number; hoje: string; agora: string }) {
  // MESMA chave e MESMA busca da visão Dia da agenda: cache compartilhado de graça
  const agendaDeHoje = useQuery({
    queryKey: chaves.agenda({ de: hoje, ate: hoje, profissionalId, visao: 'dia' }),
    queryFn: () => buscarAgenda({ de: hoje, ate: hoje, profissionalId }),
    staleTime: TEMPO_AGENDA_MS,
  })

  if (agendaDeHoje.isPending) {
    return <Skeleton className="h-24 w-full" />
  }
  if (agendaDeHoje.isError) {
    return <EstadoErro mensagem="Não foi possível carregar o seu dia." aoTentarNovamente={() => void agendaDeHoje.refetch()} />
  }

  return <ResumoDoDia cards={agendaDeHoje.data} profissionalId={profissionalId} agora={agora} />
}

/** O resumo do PRÓPRIO dia: o próximo atendimento em destaque, o total e as contagens por status. */
function ResumoDoDia({ cards, profissionalId, agora }: { cards: CardAgendamento[]; profissionalId: number; agora: string }) {
  const doDia = cards.filter((card) => card.tipo === 'atendimento' && card.profissional_id === profissionalId)

  if (doDia.length === 0) {
    return <p className="text-corpo text-texto-suave">Nenhum atendimento hoje.</p>
  }

  const porStatus = new Map<string, number>()
  for (const card of doDia) {
    const nome = card.status?.nome ?? 'Sem status'
    porStatus.set(nome, (porStatus.get(nome) ?? 0) + 1)
  }

  // `inicio` é "Y-m-d H:i": a fatia [11..16] compara como texto com o "HH:mm" de agora
  const proximo = doDia
    .filter((card) => card.inicio.slice(11, 16) > agora)
    .sort((a, b) => a.inicio.localeCompare(b.inicio))[0]

  return (
    <div className="flex flex-col gap-3">
      {proximo === undefined ? null : <ProximoAtendimento card={proximo} />}
      <p className="text-corpo text-texto">
        <span className="text-titulo font-semibold tabular-nums">{formatarContagem(doDia.length)}</span>{' '}
        <span className="text-texto-suave">{doDia.length === 1 ? 'atendimento hoje' : 'atendimentos hoje'}</span>
        {proximo === undefined ? <span className="text-texto-suave"> · nenhum ainda por vir</span> : null}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {[...porStatus.entries()].map(([nome, total]) => (
          <li key={nome} className="text-meta text-texto-suave">
            <span className="font-medium tabular-nums text-texto">{total}</span> {nome}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** O PRÓXIMO atendimento, em destaque: a hora, a criança e a especialidade — o que o profissional procura primeiro. */
function ProximoAtendimento({ card }: { card: CardAgendamento }) {
  const crianca = card.paciente?.nome_social ?? card.paciente?.nome ?? null

  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-campo bg-acento-suave px-3 py-2 text-corpo text-texto">
      <span className="text-meta font-medium text-texto-suave">Próximo às</span>
      <span className="text-titulo font-semibold tabular-nums text-acento">{card.inicio.slice(11, 16)}</span>
      {crianca === null ? null : <span className="font-medium">{crianca}</span>}
      {card.especialidade === null ? null : <span className="text-meta text-texto-suave">{card.especialidade.nome}</span>}
    </p>
  )
}
