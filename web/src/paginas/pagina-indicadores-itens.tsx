import { skipToken, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ArrowLeft, CircleAlert } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import { NomeDoPaciente } from '@/componentes/indicadores/nome-do-paciente'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Paginacao } from '@/componentes/ui/paginacao'
import { Skeleton } from '@/componentes/ui/skeleton'
import { Tabela } from '@/componentes/ui/tabela'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel } from '@/lib/datas'
import { ErroDeApi } from '@/lib/http'
import { ehMesValido, rotuloDoMes } from '@/lib/meses'
import { formatarContagem } from '@/lib/numeros'
import { buscarItensDaAgenda, buscarItensDeAtendimentos } from '@/servicos/indicadores'
import type { FiltroDeAtendimentos, ItemDaAgenda, ItemDeAtendimento, ItensDeIndicador } from '@/tipos'

/**
 * União DISCRIMINADA por origem (CR-DD-02): o TS pareia origem→filtro→fetcher→
 * tabela por narrowing — trocar o fetcher de uma origem quebra o build, não a
 * tela. Nenhum `as` sobrevive.
 */
type ParametrosDosItens =
  /** `passadas`: só as sessões que JÁ PASSARAM — a porta da "Situação das sessões que já passaram" */
  | { origem: 'agenda'; mes: string; statusId: number; pagina: number; passadas: boolean }
  | { origem: 'atendimentos'; mes: string; filtro: FiltroDeAtendimentos; pagina: number }

type ResultadoDosItens =
  | { origem: 'agenda'; pagina: ItensDeIndicador<ItemDaAgenda> }
  | { origem: 'atendimentos'; pagina: ItensDeIndicador<ItemDeAtendimento> }

/** Id positivo da query string; ausente → undefined; lixo → NaN (invalida a página). */
function idDaUrl(bruto: string | null): number | undefined {
  if (bruto === null) {
    return undefined
  }
  const numero = Number(bruto)

  return Number.isInteger(numero) && numero > 0 ? numero : Number.NaN
}

/**
 * A query string é entrada NÃO CONFIÁVEL: origem fora do par, mês fora do
 * formato, id não numérico ou combinação de dimensões que a API recusaria —
 * tudo vira `null` aqui e a tela mostra o erro amigável com a volta ao painel,
 * nunca uma requisição fadada ao 422 nem uma tela quebrada.
 */
function parametrosValidados(parametros: URLSearchParams): ParametrosDosItens | null {
  const origem = parametros.get('origem')
  const mes = parametros.get('mes')
  if ((origem !== 'agenda' && origem !== 'atendimentos') || mes === null || !ehMesValido(mes)) {
    return null
  }

  const paginaBruta = Number(parametros.get('pagina') ?? '1')
  const pagina = Number.isInteger(paginaBruta) && paginaBruta > 0 ? paginaBruta : 1

  if (origem === 'agenda') {
    const statusId = idDaUrl(parametros.get('status_id'))
    if (statusId === undefined || Number.isNaN(statusId)) {
      return null
    }

    return { origem, mes, statusId, pagina, passadas: parametros.get('passadas') === '1' }
  }

  const profissionalId = idDaUrl(parametros.get('profissional_id'))
  const especialidadeId = idDaUrl(parametros.get('especialidade_id'))
  const convenioId = idDaUrl(parametros.get('convenio_id'))
  if ([profissionalId, especialidadeId, convenioId].some(Number.isNaN)) {
    return null
  }
  // no máximo UMA dimensão base — salvo o combo profissional×especialidade (a
  // MESMA regra da API: melhor recusar aqui que prometer um 422)
  const bases = [profissionalId, especialidadeId, convenioId].filter((id) => id !== undefined).length
  const combo = profissionalId !== undefined && especialidadeId !== undefined && convenioId === undefined
  if (bases > 1 && !combo) {
    return null
  }

  return {
    origem,
    mes,
    filtro: {
      ...(profissionalId !== undefined ? { profissional_id: profissionalId } : {}),
      ...(especialidadeId !== undefined ? { especialidade_id: especialidadeId } : {}),
      ...(convenioId !== undefined ? { convenio_id: convenioId } : {}),
    },
    pagina,
  }
}

/** O fetch pareado pela origem — devolve o resultado ETIQUETADO para o narrowing da tela. */
async function buscarItens(parametros: ParametrosDosItens): Promise<ResultadoDosItens> {
  if (parametros.origem === 'agenda') {
    return {
      origem: 'agenda',
      pagina: await buscarItensDaAgenda(parametros.mes, parametros.statusId, parametros.pagina, parametros.passadas),
    }
  }

  return {
    origem: 'atendimentos',
    pagina: await buscarItensDeAtendimentos(parametros.mes, parametros.filtro, parametros.pagina),
  }
}

/** Query inválida ou âncora inexistente: erro amigável com a volta — nunca tela quebrada. */
function VoltaAmigavel({ mensagem, mes }: { mensagem: string; mes: string | null }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-superficie border border-linha-forte border-l-[3px] border-l-perigo-texto bg-superficie p-6"
    >
      <div className="flex items-start gap-2">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-perigo-texto" />
        <p className="text-corpo text-texto">{mensagem}</p>
      </div>
      <Link
        to={mes !== null && ehMesValido(mes) ? `/indicadores?mes=${mes}` : '/indicadores'}
        className="rounded-controle text-corpo font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
      >
        Voltar aos indicadores
      </Link>
    </div>
  )
}

/**
 * A página de itens do drill-down (§11): TODA caixa do painel abre aqui (ou numa
 * página própria) — o cabeçalho de contexto vem da RESPOSTA, a URL carrega só
 * ids e mês (nunca nome — gatilho LOG), e a volta preserva o mês.
 */
export function PaginaIndicadoresItens() {
  const [parametros, setParametros] = useSearchParams()
  const validados = parametrosValidados(parametros)
  const itens = useItensDoIndicador(validados)

  if (validados === null) {
    return (
      <VoltaAmigavel
        mensagem="Este endereço de itens não é válido. Volte ao painel e abra por uma das caixas."
        mes={parametros.get('mes')}
      />
    )
  }

  function trocarPagina(nova: number): void {
    const proximos = new URLSearchParams(parametros)
    proximos.set('pagina', String(nova))
    setParametros(proximos, { replace: true })
  }

  return (
    <div className="flex flex-col gap-5">
      <CabecalhoDosItens
        mes={validados.mes}
        contexto={itens.isSuccess ? itens.data.pagina.contexto : null}
        unidade={validados.origem === 'agenda' ? 'agendamentos' : 'atendimentos'}
        soAsPassadas={validados.origem === 'agenda' && validados.passadas}
      />
      <EstadosDosItens itens={itens} mes={validados.mes} aoTrocarPagina={trocarPagina} />
    </div>
  )
}

/** A consulta da lista, com a chave por origem, filtros, corte das passadas e página. */
function useItensDoIndicador(validados: ParametrosDosItens | null) {
  return useQuery({
    queryKey: chaves.indicadoresItens(validados?.origem ?? 'agenda', {
      mes: validados?.mes,
      status_id: validados?.origem === 'agenda' ? validados.statusId : undefined,
      passadas: validados?.origem === 'agenda' && validados.passadas ? 1 : undefined,
      ...(validados?.origem === 'atendimentos' ? validados.filtro : {}),
      pagina: validados?.pagina,
    }),
    // skipToken em vez de `enabled`: o TS estreita `validados` para não-nulo no
    // próprio ramo — nenhuma promessa vazia, nenhum cast
    queryFn: validados === null ? skipToken : () => buscarItens(validados),
  })
}

/** Os quatro estados da lista, e a paginação enquanto houver itens no recorte. */
function EstadosDosItens({
  itens,
  mes,
  aoTrocarPagina,
}: {
  itens: UseQueryResult<ResultadoDosItens>
  mes: string
  aoTrocarPagina: (pagina: number) => void
}) {
  // âncora que não existe (id inexistente, status apagado) volta como
  // `invalido` do normalizador — é "não encontrado", não "tente de novo"
  const naoEncontrado = itens.error instanceof ErroDeApi && itens.error.motivo === 'invalido'

  return (
    <>
      {itens.isPending ? <Skeleton className="h-64 w-full" /> : null}

      {itens.isError && naoEncontrado ? (
        <VoltaAmigavel mensagem="Não encontramos esta lista — o filtro pode ter sido apagado ou o endereço está errado." mes={mes} />
      ) : null}

      {itens.isError && !naoEncontrado ? (
        <EstadoErro mensagem="Não foi possível carregar os itens do indicador." aoTentarNovamente={() => void itens.refetch()} />
      ) : null}

      {itens.isSuccess && itens.data.pagina.total === 0 ? (
        <EstadoVazio titulo="Nenhum item neste recorte." descricao="Troque o mês no painel ou abra outra caixa." />
      ) : null}

      {itens.isSuccess && itens.data.pagina.data.length > 0 ? <TabelaDosItens resultado={itens.data} mes={mes} /> : null}

      {/* enquanto houver itens no recorte, a paginação fica de pé — inclusive numa
          página além do fim (URL editada): dá o caminho de volta para a 1ª */}
      {itens.isSuccess && itens.data.pagina.total > 0 ? (
        <Paginacao
          pagina={itens.data.pagina.current_page}
          totalPaginas={itens.data.pagina.last_page}
          totalItens={itens.data.pagina.total}
          aoMudar={aoTrocarPagina}
        />
      ) : null}
    </>
  )
}

/** A tabela da origem — o resultado ETIQUETADO estreita o tipo dos itens sem cast. */
function TabelaDosItens({ resultado, mes }: { resultado: ResultadoDosItens; mes: string }) {
  const legenda = `${resultado.pagina.contexto.rotulo} — ${rotuloDoMes(mes)}`

  return resultado.origem === 'agenda' ? (
    <TabelaDaAgenda itens={resultado.pagina.data} legenda={legenda} />
  ) : (
    <TabelaDeAtendimentos itens={resultado.pagina.data} legenda={legenda} />
  )
}

/**
 * O cabeçalho da lista: a volta, o rótulo que veio da RESPOSTA e, quando a lista vem da "Situação das
 * sessões que já passaram", o corte dito em texto — "só as que já passaram" (contrato 2 da rodada 1):
 * sem isso, quem compara o total daqui com o mês inteiro na agenda acha que falta sessão.
 */
function CabecalhoDosItens({
  mes,
  contexto,
  unidade,
  soAsPassadas,
}: {
  mes: string
  contexto: { rotulo: string; total: number } | null
  unidade: string
  soAsPassadas: boolean
}) {
  return (
    <header className="flex flex-col gap-1">
      <Link
        to={`/indicadores?mes=${mes}`}
        className="flex w-fit items-center gap-1 rounded-controle text-meta font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        Voltar aos indicadores
      </Link>
      <h1 className="text-titulo font-semibold text-texto">{contexto === null ? 'Itens do indicador' : contexto.rotulo}</h1>
      {contexto === null ? null : (
        <p className="text-corpo text-texto-suave">
          {rotuloDoMes(mes)} · {formatarContagem(contexto.total)} {unidade}
        </p>
      )}
      {soAsPassadas ? (
        <p className="text-pretty text-corpo text-texto-suave">
          Só as sessões que já passaram, como na tabela de onde você veio — as que ainda vão acontecer ficam fora.
        </p>
      ) : null}
    </header>
  )
}

function TabelaDaAgenda({ itens, legenda }: { itens: ItemDaAgenda[]; legenda: string }) {
  return (
    <Tabela legenda={legenda}>
      <Tabela.Cabecalho>
        <Tabela.Linha>
          <Tabela.CelulaCabecalho scope="col">Início</Tabela.CelulaCabecalho>
          <Tabela.CelulaCabecalho scope="col">Criança</Tabela.CelulaCabecalho>
          <Tabela.CelulaCabecalho scope="col">Profissional</Tabela.CelulaCabecalho>
        </Tabela.Linha>
      </Tabela.Cabecalho>
      <Tabela.Corpo>
        {itens.map((item) => (
          <Tabela.Linha key={item.id}>
            <Tabela.Celula>{dataHoraLegivel(item.inicio)}</Tabela.Celula>
            <Tabela.Celula>
              <NomeDoPaciente paciente={item.paciente} />
            </Tabela.Celula>
            <Tabela.Celula>{item.profissional?.nome ?? '—'}</Tabela.Celula>
          </Tabela.Linha>
        ))}
      </Tabela.Corpo>
    </Tabela>
  )
}

function TabelaDeAtendimentos({ itens, legenda }: { itens: ItemDeAtendimento[]; legenda: string }) {
  return (
    <Tabela legenda={legenda}>
      <Tabela.Cabecalho>
        <Tabela.Linha>
          <Tabela.CelulaCabecalho scope="col">Sessão</Tabela.CelulaCabecalho>
          <Tabela.CelulaCabecalho scope="col">Criança</Tabela.CelulaCabecalho>
          <Tabela.CelulaCabecalho scope="col">Profissional</Tabela.CelulaCabecalho>
          <Tabela.CelulaCabecalho scope="col">Especialidade</Tabela.CelulaCabecalho>
          <Tabela.CelulaCabecalho scope="col">Convênio</Tabela.CelulaCabecalho>
        </Tabela.Linha>
      </Tabela.Cabecalho>
      <Tabela.Corpo>
        {itens.map((item) => (
          <Tabela.Linha key={item.id}>
            <Tabela.Celula>{item.finalizado_em === null ? '—' : dataHoraLegivel(item.finalizado_em)}</Tabela.Celula>
            <Tabela.Celula>
              <NomeDoPaciente paciente={item.paciente} />
            </Tabela.Celula>
            <Tabela.Celula>{item.profissional?.nome ?? '—'}</Tabela.Celula>
            <Tabela.Celula>{item.especialidade?.nome ?? '—'}</Tabela.Celula>
            <Tabela.Celula>{item.convenio === null ? 'Sem convênio' : (item.convenio.nome ?? '—')}</Tabela.Celula>
          </Tabela.Linha>
        ))}
      </Tabela.Corpo>
    </Tabela>
  )
}
