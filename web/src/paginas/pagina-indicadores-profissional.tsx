import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronLeft, ChevronRight, CircleAlert } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { NumeroDestaque } from '@/componentes/indicadores/graficos'
import { NomeDoPaciente } from '@/componentes/indicadores/nome-do-paciente'
import { Botao } from '@/componentes/ui/botao'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Paginacao } from '@/componentes/ui/paginacao'
import { Skeleton } from '@/componentes/ui/skeleton'
import { Tabela } from '@/componentes/ui/tabela'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel, hojeNaClinica, TIMEZONE_PADRAO } from '@/lib/datas'
import { ErroDeApi } from '@/lib/http'
import { ehMesValido, rotuloDoMes, somarMeses } from '@/lib/meses'
import { formatarContagem } from '@/lib/numeros'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { buscarSelecaoDaAgenda } from '@/servicos/agenda'
import { buscarItensDeAtendimentos, buscarProducaoDoMes } from '@/servicos/indicadores'
import { useAuthStore } from '@/stores/auth-store'
import type { ItemDeAtendimento } from '@/tipos'

/**
 * A página do PROFISSIONAL no drill-down (§11): os três KPIs do mês (a linha
 * dele da vista de produção, reusada) + a lista paginada dos atendimentos com o
 * filtro por especialidade — o combo que a clínica pediu ("ver individualmente
 * por profissional, filtrando por especialidade"). O escopo D11 vale no
 * servidor: o escopado só alcança a própria produção; id inexistente → erro
 * amigável com volta.
 */
export function PaginaIndicadoresProfissional() {
  const { id } = useParams()
  const [parametros, setParametros] = useSearchParams()
  const podeVerSelecao = useAuthStore((estado) => estado.temPermissao('agenda.ver'))

  const profissionalId = Number(id)
  const idValido = Number.isInteger(profissionalId) && profissionalId > 0

  const mesDaUrl = parametros.get('mes')
  const mes = mesDaUrl !== null && ehMesValido(mesDaUrl)
    ? mesDaUrl
    : hojeNaClinica(TIMEZONE_PADRAO).slice(0, 7)

  const especialidadeBruta = Number(parametros.get('especialidade_id') ?? '')
  const especialidadeId = Number.isInteger(especialidadeBruta) && especialidadeBruta > 0 ? especialidadeBruta : undefined

  const paginaBruta = Number(parametros.get('pagina') ?? '1')
  const pagina = Number.isInteger(paginaBruta) && paginaBruta > 0 ? paginaBruta : 1

  // a volta respeita a ORIGEM (feedback do usuário): quem chega da ficha do
  // profissional volta para ELA — `de=ficha` viaja na porta e sobrevive à troca
  // de mês/filtro/página (trocarParametro preserva a query)
  const veioDaFicha = parametros.get('de') === 'ficha'
  const volta = veioDaFicha
    ? { para: `/profissionais/${profissionalId}`, rotulo: 'Voltar à ficha do profissional' }
    : { para: `/indicadores?mes=${mes}`, rotulo: 'Voltar aos indicadores' }

  // a linha de produção dele = os KPIs (vista reusada; sem linha = mês sem produção)
  const producao = useQuery({
    queryKey: chaves.indicadores('profissionais', mes),
    queryFn: () => buscarProducaoDoMes(mes),
    enabled: idValido,
  })

  const itens = useQuery({
    queryKey: chaves.indicadoresItens('atendimentos', {
      mes,
      profissional_id: profissionalId,
      especialidade_id: especialidadeId,
      pagina,
    }),
    queryFn: () =>
      buscarItensDeAtendimentos(
        mes,
        { profissional_id: profissionalId, ...(especialidadeId !== undefined ? { especialidade_id: especialidadeId } : {}) },
        pagina,
      ),
    enabled: idValido,
  })

  // o select do filtro vem da seleção da agenda (já sob `agenda.ver`, cacheada);
  // sem essa permissão o filtro simplesmente não aparece — a lista continua
  const selecao = useQuery({
    queryKey: chaves.selecaoDaAgenda(),
    queryFn: buscarSelecaoDaAgenda,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: podeVerSelecao,
  })

  function trocarParametro(chave: string, valor: string | null): void {
    const proximos = new URLSearchParams(parametros)
    if (valor === null) {
      proximos.delete(chave)
    } else {
      proximos.set(chave, valor)
    }
    // filtro e mês reancoram a lista: página volta ao início
    if (chave !== 'pagina') {
      proximos.delete('pagina')
    }
    setParametros(proximos, { replace: true })
  }

  if (!idValido) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-superficie border border-linha-forte border-l-[3px] border-l-perigo-texto bg-superficie p-6"
      >
        <div className="flex items-start gap-2">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-perigo-texto" />
          <p className="text-corpo text-texto">Este endereço de profissional não é válido.</p>
        </div>
        <Link
          to="/indicadores"
          className="rounded-controle text-corpo font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
        >
          Voltar aos indicadores
        </Link>
      </div>
    )
  }

  const linhaDeProducao = producao.data?.linhas.find((linha) => linha.profissional.id === profissionalId)
  // id inexistente/apagado: o normalizador devolve `invalido` — não é "tente de novo"
  const naoEncontrado = itens.error instanceof ErroDeApi && itens.error.motivo === 'invalido'
  // o título nasce do CONTEXTO da resposta (a API nomeia a âncora); a produção
  // cobre o caso com filtro ativo (o contexto do combo vem "Nome · Especialidade")
  const nomeDoProfissional =
    linhaDeProducao?.profissional.nome
    ?? (especialidadeId === undefined ? itens.data?.contexto.rotulo : itens.data?.contexto.rotulo.split(' · ')[0])
    ?? 'Profissional'

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link
            to={volta.para}
            className="flex w-fit items-center gap-1 rounded-controle text-meta font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            {volta.rotulo}
          </Link>
          <h1 className="text-titulo font-semibold text-texto">{nomeDoProfissional}</h1>
          <p className="text-corpo text-texto-suave">Produção do profissional em {rotuloDoMes(mes)}.</p>
        </div>

        <div role="group" aria-label="Mês da produção" className="flex items-center gap-2">
          <Botao
            variante="secundario"
            tamanho="sm"
            aria-label="Mês anterior"
            onClick={() => trocarParametro('mes', somarMeses(mes, -1))}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Botao>
          <span aria-live="polite" className="min-w-36 text-center text-corpo font-medium text-texto">
            {rotuloDoMes(mes)}
          </span>
          <Botao
            variante="secundario"
            tamanho="sm"
            aria-label="Próximo mês"
            onClick={() => trocarParametro('mes', somarMeses(mes, 1))}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </Botao>
        </div>
      </header>

      {naoEncontrado ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-superficie border border-linha-forte border-l-[3px] border-l-perigo-texto bg-superficie p-6"
        >
          <div className="flex items-start gap-2">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-perigo-texto" />
            <p className="text-corpo text-texto">Não encontramos este profissional.</p>
          </div>
          <Link
            to={volta.para}
            className="rounded-controle text-corpo font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
          >
            {volta.rotulo}
          </Link>
        </div>
      ) : (
        <>
          <section aria-label="Produção do mês" className="grid gap-4 rounded-superficie border border-linha bg-superficie p-4 sm:grid-cols-3">
            {producao.isPending ? <Skeleton className="h-14 w-full sm:col-span-3" /> : null}
            {producao.isError ? (
              <EstadoErro
                className="sm:col-span-3"
                mensagem="Não foi possível carregar a produção do mês."
                aoTentarNovamente={() => void producao.refetch()}
              />
            ) : null}
            {producao.isSuccess ? (
              <>
                <NumeroDestaque rotulo="atendimentos finalizados" valor={formatarContagem(linhaDeProducao?.atendimentos ?? 0)} />
                <NumeroDestaque rotulo="sessões consumidas, pelo dia da sessão" valor={formatarContagem(linhaDeProducao?.sessoes_consumidas ?? 0)} />
                <NumeroDestaque rotulo="evoluções preenchidas" valor={formatarContagem(linhaDeProducao?.evolucoes_preenchidas ?? 0)} />
              </>
            ) : null}
          </section>

          {selecao.isSuccess && selecao.data.especialidades.length > 0 ? (
            <div className="max-w-72">
              <CampoSelect
                rotulo="Filtrar por especialidade"
                value={especialidadeId === undefined ? '' : String(especialidadeId)}
                onChange={(evento) => {
                  trocarParametro('especialidade_id', evento.target.value === '' ? null : evento.target.value)
                }}
                opcoes={[
                  { valor: '', rotulo: 'Todas as especialidades' },
                  ...selecao.data.especialidades.map((especialidade) => ({
                    valor: String(especialidade.id),
                    rotulo: especialidade.nome,
                  })),
                ]}
              />
            </div>
          ) : null}

          {itens.isPending ? <Skeleton className="h-64 w-full" /> : null}

          {itens.isError && !naoEncontrado ? (
            <EstadoErro
              mensagem="Não foi possível carregar os atendimentos do profissional."
              aoTentarNovamente={() => void itens.refetch()}
            />
          ) : null}

          {itens.isSuccess && itens.data.total === 0 ? (
            <EstadoVazio
              titulo="Nenhum atendimento neste recorte."
              descricao="Troque o mês ou limpe o filtro de especialidade."
            />
          ) : null}

          {itens.isSuccess && itens.data.data.length > 0 ? (
            <Tabela legenda={`${itens.data.contexto.rotulo} — ${rotuloDoMes(mes)} — ${formatarContagem(itens.data.contexto.total)} atendimentos`}>
              <Tabela.Cabecalho>
                <Tabela.Linha>
                  <Tabela.CelulaCabecalho scope="col">Sessão</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho scope="col">Criança</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho scope="col">Especialidade</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho scope="col">Convênio</Tabela.CelulaCabecalho>
                </Tabela.Linha>
              </Tabela.Cabecalho>
              <Tabela.Corpo>
                {itens.data.data.map((item: ItemDeAtendimento) => (
                  <Tabela.Linha key={item.id}>
                    <Tabela.Celula>{item.finalizado_em === null ? '—' : dataHoraLegivel(item.finalizado_em)}</Tabela.Celula>
                    <Tabela.Celula>
                      <NomeDoPaciente paciente={item.paciente} />
                    </Tabela.Celula>
                    <Tabela.Celula>{item.especialidade?.nome ?? '—'}</Tabela.Celula>
                    <Tabela.Celula>{item.convenio === null ? 'Sem convênio' : (item.convenio.nome ?? '—')}</Tabela.Celula>
                  </Tabela.Linha>
                ))}
              </Tabela.Corpo>
            </Tabela>
          ) : null}

          {itens.isSuccess && itens.data.total > 0 ? (
            <Paginacao
              pagina={itens.data.current_page}
              totalPaginas={itens.data.last_page}
              totalItens={itens.data.total}
              aoMudar={(nova) => {
                trocarParametro('pagina', String(nova))
              }}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
