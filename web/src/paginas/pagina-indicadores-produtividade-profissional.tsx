import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { AvatarDoProfissional } from '@/componentes/agenda/avatar-do-profissional'
import { BarraDePercentual, NumeroDestaque } from '@/componentes/indicadores/graficos'
import { usePeriodoDosIndicadores } from '@/componentes/indicadores/periodo-dos-indicadores'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { FolhaImpressa } from '@/componentes/ui/folha-impressa'
import { ListaDescricao } from '@/componentes/ui/lista-descricao'
import { RoladorHorizontal } from '@/componentes/ui/rolador-horizontal'
import { Skeleton } from '@/componentes/ui/skeleton'
import { Tabela } from '@/componentes/ui/tabela'
import { chaves } from '@/lib/chaves-query'
import { rotuloDoMes } from '@/lib/meses'
import { formatarMinutosEmHoras } from '@/lib/minutos'
import { formatarContagem } from '@/lib/numeros'
import { buscarProdutividadeDoMes } from '@/servicos/indicadores'
import type { LinhaDeProdutividade } from '@/tipos'

const DIAS_DA_SEMANA: Record<number, string> = {
  1: 'Segunda',
  2: 'Terça',
  3: 'Quarta',
  4: 'Quinta',
  5: 'Sexta',
  6: 'Sábado',
  7: 'Domingo',
}

/**
 * O detalhe de UM profissional, aberto pela tabela da aba Equipe — dentro da área, no mesmo mês
 * (`/indicadores/produtividade/:id?mes=`): a semana dele (grade × marcado × realizado, em
 * horas e em atendimentos), os três percentuais e a PERDA discriminada — faltas, horários
 * liberados, ainda em aberto, ocioso. É a resposta da pergunta que um percentual sozinho
 * não responde: "por que a agenda não rendeu?".
 *
 * Lê a vista de PRODUTIVIDADE do mês inteiro (a linha dele) — a régua de capacidade em horas, que
 * a tabela da Equipe resume em ocupação do período; e o escopo D11 vale por construção: o escopado
 * só recebe a própria linha, então o id alheio cai em "não encontrado", nunca em número de outro.
 */
export function PaginaIndicadoresProdutividadeProfissional() {
  const { id } = useParams()
  const { mes, mesCorrente } = usePeriodoDosIndicadores()

  const profissionalId = Number(id)
  const idValido = Number.isInteger(profissionalId) && profissionalId > 0

  const vista = useQuery({
    queryKey: chaves.indicadores('produtividade', mes),
    queryFn: () => buscarProdutividadeDoMes(mes),
    enabled: idValido,
  })

  const linha = vista.data?.linhas.find((item) => item.profissional.id === profissionalId)
  // a volta é a aba Equipe (change indicadores-profissionais): a antiga Produtividade virou ela
  const voltar = `/indicadores/equipe?mes=${mes}`

  return (
    <div className="flex flex-col gap-4">
      <Link
        data-nao-imprimir
        to={voltar}
        className="inline-flex w-fit items-center gap-1.5 rounded-controle text-meta font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Todos os profissionais
      </Link>

      {!idValido || (vista.isSuccess && linha === undefined) ? (
        <EstadoVazio
          titulo="Profissional não encontrado neste recorte."
          descricao="Ele pode estar inativo, fora do seu escopo, ou o endereço está errado."
          acao={
            <Link to={voltar} className="text-corpo font-medium text-acento hover:underline">
              Voltar à equipe
            </Link>
          }
        />
      ) : null}

      {idValido && vista.isPending ? <Skeleton className="h-64 w-full" /> : null}

      {vista.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar a produtividade do profissional."
          aoTentarNovamente={() => void vista.refetch()}
        />
      ) : null}

      {linha !== undefined ? <DetalheDoProfissional linha={linha} mes={mes} emCurso={mes === mesCorrente} /> : null}
    </div>
  )
}

function DetalheDoProfissional({ linha, mes, emCurso }: { linha: LinhaDeProdutividade; mes: string; emCurso: boolean }) {
  const foraPorCalendario = linha.minutos_em_feriados + linha.minutos_em_bloqueios > 0
  const semGrade = linha.minutos_na_grade === 0
  const diasComGrade = linha.por_dia_da_semana.filter((dia) => dia.minutos_na_grade > 0 || dia.marcados > 0)

  return (
    <FolhaImpressa titulo={`Produtividade — ${linha.profissional.nome}`} periodo={rotuloDoMes(mes)}>
      <div className="flex flex-col gap-4">
        {/* `div`, não `header`: o shell da área já é o banner da página, e dois banners
            reprovam no axe (a FolhaImpressa aprendeu isso na change anterior) */}
        <div className="flex flex-wrap items-center gap-4">
          <AvatarDoProfissional
            id={linha.profissional.id}
            fotoVersao={linha.profissional.foto_versao}
            nome={linha.profissional.nome}
            cor={linha.especialidade?.cor ?? null}
            tamanho="lg"
          />
          <div className="flex min-w-0 flex-col">
            <h2 className="text-titulo font-semibold text-texto">{linha.profissional.nome}</h2>
            <p className="text-corpo text-texto-suave">
              {linha.especialidade === null ? 'Sem especialidade' : linha.especialidade.nome}
              {linha.duracao_referencia_min === null
                ? ''
                : ` · sessão de ${String(linha.duracao_referencia_min)} min`}
              {' · '}
              {rotuloDoMes(mes)}
            </p>
            {/* a JANELA em palavras (CR-IND-03): a tabela da Equipe, de onde se chega aqui, conta o período
                até hoje; este detalhe é a régua da capacidade, do mês INTEIRO */}
            {/* a diferença só existe no mês EM CURSO: num mês fechado, a tabela da Equipe também conta o
                mês inteiro (CR-IND-03) */}
            <p className="text-pretty text-meta text-texto-suave">
              Números do mês inteiro de {rotuloDoMes(mes)}
              {emCurso ? ' — a tabela da Equipe mostra só o período até hoje.' : '.'}
            </p>
          </div>
        </div>

        {semGrade ? (
          <EstadoVazio
            nivel={3}
            titulo={foraPorCalendario ? 'Sem grade neste mês.' : 'Sem horário configurado.'}
            descricao={
              foraPorCalendario
                ? `O mês inteiro caiu em feriado ou bloqueio (${formatarMinutosEmHoras(linha.minutos_em_feriados)} e ${formatarMinutosEmHoras(linha.minutos_em_bloqueios)}). Marcados: ${formatarContagem(linha.marcados)}; realizados: ${formatarContagem(linha.realizados)}.`
                : `Sem escala cadastrada não há capacidade para comparar. Marcados: ${formatarContagem(linha.marcados)}; realizados: ${formatarContagem(linha.realizados)}.`
            }
          />
        ) : (
          <section
            aria-labelledby="produtividade-taxas"
            className="flex min-w-0 flex-col gap-3 rounded-superficie border border-linha bg-superficie p-4"
          >
            <h3 id="produtividade-taxas" className="text-titulo font-semibold text-texto">
              O mês em números
            </h3>
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
              <NumeroDestaque rotulo="atendimentos possíveis" valor={formatarContagem(linha.capacidade_atendimentos)} />
              <NumeroDestaque rotulo="marcados" valor={formatarContagem(linha.marcados)} />
              <NumeroDestaque rotulo="realizados" valor={formatarContagem(linha.realizados)} />
              {/* mesma régua do ocioso e dos percentuais (change atendimento-em-grupo): quem
                  atende N ao mesmo tempo tem N × o relógio em vaga */}
              <NumeroDestaque
                rotulo={(linha.atendimentos_simultaneos ?? 1) > 1 ? 'horas de vaga' : 'horas na grade'}
                valor={formatarMinutosEmHoras(linha.minutos_de_vaga ?? linha.minutos_na_grade)}
              />
            </div>
            <dl className="grid gap-2 sm:grid-cols-3">
              <Taxa rotulo="Ocupação" descricao="marcado ÷ capacidade" valor={linha.ocupacao_pct} />
              <Taxa rotulo="Produtividade" descricao="realizado ÷ capacidade" valor={linha.produtividade_pct} />
              <Taxa rotulo="Aproveitamento" descricao="realizado ÷ marcado" valor={linha.aproveitamento_pct} />
            </dl>
          </section>
        )}

        <section
          aria-labelledby="produtividade-semana"
          className="flex min-w-0 flex-col gap-3 rounded-superficie border border-linha bg-superficie p-4"
        >
          <h3 id="produtividade-semana" className="text-titulo font-semibold text-texto">
            Por dia da semana
          </h3>
          {diasComGrade.length === 0 ? (
            <p className="text-corpo text-texto-suave">Nenhum dia com grade ou marcação neste mês.</p>
          ) : (
            <RoladorHorizontal rotulo="Produtividade por dia da semana">
              {/* `rolagem="externa"`: quem rola é o `RoladorHorizontal` (que tem véu, nome e
                    parada de teclado). Sem a prop, o invólucro da `Tabela` rolava por dentro e
                    o rolador ficava inerte — no celular a última coluna era inalcançável pelo
                    teclado (achado A11Y-03, `scrollable-region-focusable`). */}
                <Tabela legenda="Grade, marcados e realizados por dia da semana" densidade="compacta" rolagem="externa">
                <Tabela.Cabecalho>
                  <Tabela.Linha>
                    <Tabela.CelulaCabecalho>Dia</Tabela.CelulaCabecalho>
                    <Tabela.CelulaCabecalho className="text-right">Na grade</Tabela.CelulaCabecalho>
                    <Tabela.CelulaCabecalho className="text-right">Marcados</Tabela.CelulaCabecalho>
                    <Tabela.CelulaCabecalho className="text-right">Horas marcadas</Tabela.CelulaCabecalho>
                    <Tabela.CelulaCabecalho className="text-right">Realizados</Tabela.CelulaCabecalho>
                    <Tabela.CelulaCabecalho className="text-right">Horas realizadas</Tabela.CelulaCabecalho>
                  </Tabela.Linha>
                </Tabela.Cabecalho>
                <Tabela.Corpo>
                  {diasComGrade.map((dia) => (
                    <Tabela.Linha key={dia.dia}>
                      <Tabela.Celula>{DIAS_DA_SEMANA[dia.dia] ?? String(dia.dia)}</Tabela.Celula>
                      <Tabela.Celula numerica>{formatarMinutosEmHoras(dia.minutos_na_grade)}</Tabela.Celula>
                      <Tabela.Celula numerica>{formatarContagem(dia.marcados)}</Tabela.Celula>
                      <Tabela.Celula numerica>{formatarMinutosEmHoras(dia.minutos_marcados)}</Tabela.Celula>
                      <Tabela.Celula numerica>{formatarContagem(dia.realizados)}</Tabela.Celula>
                      <Tabela.Celula numerica>{formatarMinutosEmHoras(dia.minutos_realizados)}</Tabela.Celula>
                    </Tabela.Linha>
                  ))}
                  <Tabela.Linha>
                    <Tabela.Celula className="font-semibold">Total do mês</Tabela.Celula>
                    <Tabela.Celula numerica className="font-semibold">{formatarMinutosEmHoras(linha.minutos_na_grade)}</Tabela.Celula>
                    <Tabela.Celula numerica className="font-semibold">{formatarContagem(linha.marcados)}</Tabela.Celula>
                    <Tabela.Celula numerica className="font-semibold">{formatarMinutosEmHoras(linha.minutos_marcados)}</Tabela.Celula>
                    <Tabela.Celula numerica className="font-semibold">{formatarContagem(linha.realizados)}</Tabela.Celula>
                    <Tabela.Celula numerica className="font-semibold">{formatarMinutosEmHoras(linha.minutos_realizados)}</Tabela.Celula>
                  </Tabela.Linha>
                </Tabela.Corpo>
              </Tabela>
            </RoladorHorizontal>
          )}
        </section>

        <section
          aria-labelledby="produtividade-perda"
          className="flex min-w-0 flex-col gap-3 rounded-superficie border border-linha bg-superficie p-4"
        >
          <div className="flex flex-col gap-1">
            <h3 id="produtividade-perda" className="text-titulo font-semibold text-texto">
              Onde a agenda não rendeu
            </h3>
            <p className="max-w-prose text-meta text-texto-suave">
              A diferença entre o que cabia e o que aconteceu, item a item. Faltas e liberações
              seguem a situação marcada na agenda. "Outros, sem cobrança" são os horários que
              ficaram ocupados sem descontar sessão e sem virar falta — o que ainda está em
              aberto, e situações como Falta Justificada e Reserva de Agenda.
            </p>
          </div>
          <ListaDescricao
            itens={[
              { rotulo: 'Faltas', valor: formatarContagem(linha.faltas) },
              { rotulo: 'Horários liberados (desmarcados)', valor: formatarContagem(linha.liberados) },
              // NÃO é só "ainda vai acontecer": aqui caem também as situações que ocupam o
              // horário sem cobrar sessão nem marcar falta — "Falta Justificada" e "Reserva
              // de Agenda" do catálogo padrão (achado CR-04). O rótulo diz o que o balde É, e
              // o parágrafo da seção nomeia os casos — rótulo comprido estourava a linha em
              // 320px, onde o `dt` da lista não encolhe (medido: documento em 349).
              { rotulo: 'Outros, sem cobrança', valor: formatarContagem(linha.em_aberto) },
              { rotulo: 'Horas ociosas (sem marcação)', valor: formatarMinutosEmHoras(linha.minutos_ociosos) },
              ...((linha.atendimentos_simultaneos ?? 1) > 1
                ? [
                    {
                      rotulo: 'Atendimentos ao mesmo tempo',
                      valor: `${linha.atendimentos_simultaneos} · ${formatarMinutosEmHoras(linha.minutos_na_grade)} de relógio`,
                    },
                  ]
                : []),
              { rotulo: 'Horas em feriados', valor: formatarMinutosEmHoras(linha.minutos_em_feriados) },
              { rotulo: 'Horas em bloqueios', valor: formatarMinutosEmHoras(linha.minutos_em_bloqueios) },
            ]}
          />
          <Link
            data-nao-imprimir
            to={`/indicadores/profissionais/${String(linha.profissional.id)}?mes=${mes}`}
            className="w-fit rounded-controle text-meta font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
          >
            Ver os atendimentos do mês
          </Link>
        </section>
      </div>
    </FolhaImpressa>
  )
}

/** Uma taxa com a conta escrita por extenso — o número nunca aparece sem dizer de onde veio. */
function Taxa({ rotulo, descricao, valor }: { rotulo: string; descricao: string; valor: number | null }) {
  return (
    <div className="flex flex-col gap-1 rounded-campo bg-fundo px-3 py-2">
      <dt className="flex items-baseline justify-between gap-2">
        <span className="text-corpo font-medium text-texto">{rotulo}</span>
        <span className="text-meta text-texto-suave">{descricao}</span>
      </dt>
      <dd>
        <BarraDePercentual valor={valor} />
      </dd>
    </div>
  )
}
