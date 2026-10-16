import { useQuery } from '@tanstack/react-query'
import { CalendarDays, FileText } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { useNavigate } from 'react-router-dom'

import { Botao } from '@/componentes/ui/botao'
import { ChipStatus } from '@/componentes/ui/chip-status'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { MarcadorEspecialidade } from '@/componentes/ui/marcador-especialidade'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { dataComHorarioLegivel, dataLegivel } from '@/lib/datas'
import { buscarAgendamentosDoPaciente } from '@/servicos/agenda'
import { useAuthStore } from '@/stores/auth-store'
import type { BlocoDeAgendamentos, ItemAgendamentoDaFicha, StatusDoCard } from '@/tipos'

interface SecaoAgendamentosProps {
  pacienteId: number
}

interface FaixaDeStatus {
  status: StatusDoCard
  total: number
}

/** Distribuição por status: agrupa os itens pela flag do status (nunca pelo nome). */
function distribuir(itens: readonly ItemAgendamentoDaFicha[]): FaixaDeStatus[] {
  const porStatus = new Map<number, FaixaDeStatus>()
  for (const item of itens) {
    if (item.status === null) {
      continue
    }
    const faixa = porStatus.get(item.status.id) ?? { status: item.status, total: 0 }
    faixa.total += 1
    porStatus.set(item.status.id, faixa)
  }
  return [...porStatus.values()].sort((a, b) => b.total - a.total)
}

/** Uma linha da lista — data E HORA, especialidade, profissional e o status como chip. */
function LinhaDoAgendamento({ item }: { item: ItemAgendamentoDaFicha }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-superficie border border-linha p-3">
      <div className="flex min-w-0 items-stretch gap-2">
        {item.especialidade !== null ? <MarcadorEspecialidade cor={item.especialidade.cor} /> : null}
        <div className="min-w-0">
          <p className="text-rotulo text-texto">{dataComHorarioLegivel(item.inicio, item.fim)}</p>
          <p className="mt-0.5 truncate text-meta text-texto-suave">
            {[item.especialidade?.nome, item.profissional?.nome].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {/* SÓ no `true`: em `false` a seção não cobra pendência (isso é da fila de evoluções
            em aberto), e em `null` ela não denuncia que existe algo que o usuário não pode ver */}
        {item.tem_evolucao === true ? (
          <span className="inline-flex items-center gap-1 rounded-controle border border-linha px-2 py-0.5 text-meta text-texto-suave">
            <FileText aria-hidden className="size-3" />
            Evolução registrada
          </span>
        ) : null}
        {item.status !== null ? (
          <ChipStatus
            nome={item.status.nome}
            cor={item.status.cor}
            corBorda={item.status.cor_borda}
            tipo={item.status.tipo}
          />
        ) : null}
      </div>
    </li>
  )
}

/**
 * Um bloco da seção — título, o vazio PRÓPRIO dele e a lista. O vazio de um bloco
 * nunca apaga o conteúdo do outro (design D2): paciente novo com sessão marcada tem
 * "Próximas sessões" cheia e "Últimos 90 dias" vazia, e isso é informação, não erro.
 */
function BlocoDeSessoes({
  titulo,
  bloco,
  vazio,
  descricaoDoVazio,
  acaoDoVazio,
  resumo,
}: {
  titulo: string
  bloco: BlocoDeAgendamentos
  vazio: string
  descricaoDoVazio: string
  acaoDoVazio?: ReactNode
  /** Contador + distribuição por status (só faz sentido no histórico) */
  resumo?: boolean
}) {
  const idDoTitulo = useId()
  const distribuicao = resumo === true ? distribuir(bloco.itens) : []
  // o corte vem do PRÓPRIO payload (itens × total real): a tela não espelha o teto do
  // servidor nem adivinha o corte — espelhar dava falso positivo no caso exatamente-no-teto
  const cortado = bloco.itens.length < bloco.total

  return (
    <section aria-labelledby={idDoTitulo} className="flex flex-col gap-3">
      <div>
        <h3 id={idDoTitulo} className="text-subtitulo font-semibold text-texto">
          {titulo}
        </h3>
        <p className="mt-0.5 text-meta text-texto-suave">
          {bloco.janela.ate === null
            ? `A partir de ${dataLegivel(bloco.janela.de)}`
            : `${dataLegivel(bloco.janela.de)} a ${dataLegivel(bloco.janela.ate)}`}
        </p>
      </div>

      {bloco.itens.length === 0 ? (
        <EstadoVazio titulo={vazio} descricao={descricaoDoVazio} acao={acaoDoVazio} />
      ) : (
        <>
          {resumo === true ? (
            <div className="flex flex-col gap-2">
              <p className="text-corpo-lg font-semibold text-texto">
                {bloco.total} {bloco.total === 1 ? 'atendimento' : 'atendimentos'}
              </p>
              {cortado ? (
                <p className="text-meta text-texto-suave">
                  Mostrando {bloco.itens.length} de {bloco.total} — a distribuição abaixo considera
                  só os exibidos.
                </p>
              ) : null}
              {distribuicao.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {distribuicao.map((faixa) => (
                    <span key={faixa.status.id} className="inline-flex items-center gap-1.5">
                      <ChipStatus
                        nome={faixa.status.nome}
                        cor={faixa.status.cor}
                        corBorda={faixa.status.cor_borda}
                        tipo={faixa.status.tipo}
                      />
                      <span className="text-meta text-texto-suave">×{faixa.total}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <ul className="flex flex-col gap-2">
            {bloco.itens.map((item) => (
              <LinhaDoAgendamento key={item.id} item={item} />
            ))}
          </ul>

          {/* amostra DECLARADA: só quando a lista está mesmo cortada (N < M) */}
          {cortado && resumo !== true ? (
            <p className="text-meta text-texto-suave">
              Mostrando {bloco.itens.length} de {bloco.total} — abra a agenda para ver as demais.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}

/**
 * Seção Agendamentos (ficha do paciente) — as PRÓXIMAS sessões e os atendimentos dos
 * últimos 90 dias, na mesma leitura. Antes a seção reusava o comparecimento recente do
 * painel da agenda, que é só passado: a sessão de hoje, com presença já registrada,
 * sumia até o relógio passar do horário (clínica, 2026-09-08). Payload minimizado no
 * servidor (sem conteúdo clínico). Os quatro estados, por bloco.
 */
export function SecaoAgendamentos({ pacienteId }: SecaoAgendamentosProps) {
  const navegar = useNavigate()
  // o vazio dos próximos leva ao próximo passo (§5.9 do DS) — mas só para quem pode marcar
  const podeAgendar = useAuthStore((estado) => estado.temPermissao('agenda.criar'))
  const agendamentos = useQuery({
    queryKey: chaves.agendamentosDoPaciente(pacienteId),
    queryFn: () => buscarAgendamentosDoPaciente(pacienteId),
  })

  if (agendamentos.isPending) {
    return (
      <ul aria-busy className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((indice) => (
          <li key={indice} className="rounded-superficie border border-linha p-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-3 w-48" />
          </li>
        ))}
      </ul>
    )
  }

  if (agendamentos.isError) {
    return (
      <EstadoErro
        mensagem="Não foi possível carregar os agendamentos do paciente."
        aoTentarNovamente={() => void agendamentos.refetch()}
      />
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <BlocoDeSessoes
        titulo="Próximas sessões"
        bloco={agendamentos.data.proximos}
        vazio="Nenhuma sessão marcada"
        descricaoDoVazio="Este paciente não tem sessão agendada daqui para a frente."
        acaoDoVazio={
          podeAgendar ? (
            <Botao
              type="button"
              onClick={() => {
                navegar('/agenda')
              }}
            >
              <CalendarDays aria-hidden className="size-4" />
              Marcar uma sessão
            </Botao>
          ) : undefined
        }
        resumo={false}
      />
      <BlocoDeSessoes
        titulo="Últimos 90 dias"
        bloco={agendamentos.data.recentes}
        vazio="Sem atendimentos nesta janela"
        descricaoDoVazio="Este paciente não teve atendimentos nos últimos 90 dias."
        resumo
      />
    </div>
  )
}
