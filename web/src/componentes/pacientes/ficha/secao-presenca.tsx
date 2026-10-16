import { useQuery } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useId, useState } from 'react'

import { CampoSelect } from '@/componentes/ui/campo-select'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'
import { Tabela } from '@/componentes/ui/tabela'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { dataLegivel } from '@/lib/datas'
import { buscarPresencaDoPaciente } from '@/servicos/agenda'
import type { SessaoPorProfissional } from '@/tipos'

interface SecaoPresencaProps {
  pacienteId: number
}

/**
 * Seção Presença da ficha — a ASSIDUIDADE do paciente em um olhar.
 *
 * Tudo vem CALCULADO do servidor (§13): taxa, totais e a sequência de faltas
 * (fonte única do alerta). A tela exibe e formata — nunca reconta. O check-in
 * real (meio · por quem) é da Fase 2; nenhum controle dele existe aqui.
 */
export function SecaoPresenca({ pacienteId }: SecaoPresencaProps) {
  const idResumo = useId()
  const idFaltas = useId()
  const presenca = useQuery({
    queryKey: chaves.presencaDoPaciente(pacienteId),
    queryFn: () => buscarPresencaDoPaciente(pacienteId),
  })

  if (presenca.isPending) {
    return (
      <div aria-busy="true" className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((indice) => (
          <Skeleton key={indice} className="h-20 w-full" />
        ))}
      </div>
    )
  }

  if (presenca.isError) {
    return (
      <EstadoErro
        mensagem="Não foi possível carregar a assiduidade."
        aoTentarNovamente={() => void presenca.refetch()}
      />
    )
  }

  const dados = presenca.data

  if (dados.totais.total === 0) {
    return (
      <EstadoVazio
        titulo="Nenhum agendamento nos últimos 12 meses"
        descricao="A assiduidade aparece aqui quando o paciente tiver sessões passadas na janela."
      />
    )
  }

  const { consecutivas, limite } = dados.faltas_consecutivas
  const noLimite = consecutivas >= limite

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={idResumo} className="flex flex-col gap-3">
        <h3 id={idResumo} className="text-subtitulo font-semibold text-texto">
          Assiduidade — últimos 12 meses
        </h3>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Cartao
            rotulo="Taxa de comparecimento"
            // string decimal do servidor — a tela SÓ troca o ponto (pt-BR); sem base → travessão
            valor={dados.taxa_comparecimento === null ? '—' : `${dados.taxa_comparecimento.replace('.', ',')}%`}
          />
          <Cartao rotulo="Compareceu" valor={String(dados.totais.compareceu)} />
          <Cartao rotulo="Faltas" valor={String(dados.totais.faltas)} />
          <Cartao
            rotulo="Faltas seguidas"
            valor={`${consecutivas} de ${limite}`}
            alerta={noLimite}
            notaDeAlerta={noLimite ? 'no limite do alerta' : undefined}
          />
        </dl>
        <p className="text-meta text-texto-suave">
          Última falta: {dataLegivel(dados.ultima_falta_em)}
        </p>
      </section>

      {/* key por paciente: a ficha NÃO remonta ao trocar de criança pela busca do
          cabeçalho — sem o remount, o filtro de especialidade do paciente anterior
          ficava agarrado e podia prender a tabela num recorte vazio (CR-FS-01) */}
      <SessoesPorProfissional key={pacienteId} linhas={dados.sessoes_por_profissional} />

      <section aria-labelledby={idFaltas} className="flex flex-col gap-3">
        <h3 id={idFaltas} className="text-subtitulo font-semibold text-texto">
          Faltas na janela
        </h3>
        {dados.faltas.length === 0 ? (
          <p className="text-corpo text-texto-suave">Nenhuma falta nos últimos 12 meses.</p>
        ) : (
          <>
            <Tabela densidade="confortavel" legenda="Faltas do paciente">
              <Tabela.Cabecalho>
                <Tabela.Linha>
                  <Tabela.CelulaCabecalho>Data</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho>Status</Tabela.CelulaCabecalho>
                </Tabela.Linha>
              </Tabela.Cabecalho>
              <Tabela.Corpo>
                {dados.faltas.map((falta) => (
                  <Tabela.Linha key={falta.id}>
                    <Tabela.Celula className="text-texto">{dataLegivel(falta.data)}</Tabela.Celula>
                    <Tabela.Celula className="text-texto-suave">
                      {falta.status?.nome ?? '—'}
                    </Tabela.Celula>
                  </Tabela.Linha>
                ))}
              </Tabela.Corpo>
            </Tabela>
            {/* a API amostra (teto) — lista cortada se declara */}
            {dados.totais.faltas > dados.faltas.length ? (
              <p className="text-meta text-texto-suave">
                Mostrando {dados.faltas.length} de {dados.totais.faltas} faltas.
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}

/**
 * O pedido verbatim da clínica: "quantas sessões fez COM CADA profissional…
 * e um filtro por especialidade". As linhas vêm PRONTAS do servidor (mesma
 * régua do "Compareceu" — a soma bate com o cartão por construção); o filtro
 * é client-side sobre o dado que já veio, e as opções nascem das PRÓPRIAS
 * linhas — só especialidades que a criança de fato tem.
 */
function SessoesPorProfissional({ linhas }: { linhas: SessaoPorProfissional[] }) {
  const idTitulo = useId()
  const [especialidadeEscolhida, setEspecialidadeEscolhida] = useState('')

  if (linhas.length === 0) {
    return null // sem finalizada não há quebra — o resumo acima já conta a história
  }

  const especialidades = [
    ...new Map(
      linhas
        .filter((linha) => linha.especialidade !== null)
        .map((linha) => [String(linha.especialidade?.id), linha.especialidade?.nome ?? '—']),
    ).entries(),
  ]
  const visiveis = especialidadeEscolhida === ''
    ? linhas
    : linhas.filter((linha) => String(linha.especialidade?.id) === especialidadeEscolhida)

  return (
    <section aria-labelledby={idTitulo} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 id={idTitulo} className="text-subtitulo font-semibold text-texto">
          Sessões por profissional
        </h3>
        {especialidades.length > 1 ? (
          <div className="w-64">
            <CampoSelect
              rotulo="Filtrar por especialidade"
              value={especialidadeEscolhida}
              onChange={(evento) => {
                setEspecialidadeEscolhida(evento.target.value)
              }}
              opcoes={[
                { valor: '', rotulo: 'Todas as especialidades' },
                ...especialidades.map(([valor, rotulo]) => ({ valor, rotulo })),
              ]}
            />
          </div>
        ) : null}
      </div>

      {visiveis.length === 0 ? (
        <p className="text-corpo text-texto-suave">Nenhuma sessão nesta especialidade.</p>
      ) : (
        <Tabela densidade="confortavel" legenda="Sessões finalizadas por profissional">
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho>Profissional</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Especialidade</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Sessões</Tabela.CelulaCabecalho>
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {visiveis.map((linha) => (
              <Tabela.Linha key={`${linha.profissional?.id ?? 0}-${linha.especialidade?.id ?? 0}`}>
                <Tabela.Celula className="text-texto">{linha.profissional?.nome ?? '—'}</Tabela.Celula>
                <Tabela.Celula className="text-texto-suave">{linha.especialidade?.nome ?? '—'}</Tabela.Celula>
                <Tabela.Celula className="tabular-nums text-texto">{linha.finalizadas}</Tabela.Celula>
              </Tabela.Linha>
            ))}
          </Tabela.Corpo>
        </Tabela>
      )}
    </section>
  )
}

/** Cartão de resumo — rótulo textual sempre; o alerta fala por TEXTO além da cor (1.4.1). */
function Cartao({
  rotulo,
  valor,
  alerta = false,
  notaDeAlerta,
}: {
  rotulo: string
  valor: string
  alerta?: boolean
  notaDeAlerta?: string
}) {
  return (
    <div
      className={cn(
        'rounded-superficie border border-linha bg-superficie p-4',
        alerta && 'border-l-[3px] border-l-alerta-texto',
      )}
    >
      <dt className="text-meta text-texto-suave">{rotulo}</dt>
      <dd className={cn('mt-1 text-titulo font-semibold tabular-nums', alerta ? 'text-alerta-texto' : 'text-texto')}>
        {valor}
      </dd>
      {notaDeAlerta !== undefined ? (
        <dd className="mt-0.5 flex items-center gap-1 text-meta text-alerta-texto">
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {notaDeAlerta}
        </dd>
      ) : null}
    </div>
  )
}
