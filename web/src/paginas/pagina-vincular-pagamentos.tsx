import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { LoteDeVinculos } from '@/componentes/financeiro/lote-de-vinculos'
import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { hojeNaClinica, TIMEZONE_PADRAO } from '@/lib/datas'
import { ErroDeApi } from '@/lib/http'
import { ehMesValido, limitesDoMes, rotuloDoMes, somarMeses } from '@/lib/meses'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { buscarConfiguracaoAgenda } from '@/servicos/catalogos'
import { listarPagamentosSemTratamento } from '@/servicos/financeiro'
import { useAuthStore } from '@/stores/auth-store'

function mensagemDoErro(erro: unknown): string {
  return erro instanceof ErroDeApi && erro.motivo === 'sem_acesso'
    ? 'Você não tem acesso à lista de pagamentos sem tratamento.'
    : 'Não foi possível carregar os pagamentos sem tratamento.'
}

/**
 * "Vincular pagamentos ao tratamento" (change `vincular-pagamentos-ao-tratamento`, design D5): as
 * receitas PAGAS no mês que ficaram com a criança e sem o tratamento — as que caem em "Sem
 * profissional" no Recebido por profissional. O mês mora na URL (`?mes=`), como nos Indicadores:
 * o link do aviso do relatório abre o mês do relatório, e o Voltar e o F5 não o perdem.
 */
export function PaginaVincularPagamentos() {
  const [parametros, setParametros] = useSearchParams()
  const podeAgenda = useAuthStore((estado) => estado.temPermissao('agenda.ver'))
  const titulo = useRef<HTMLHeadingElement>(null)

  // o fuso da CLÍNICA (§13) decide o mês atual — nunca o relógio do navegador
  const configuracao = useQuery({
    queryKey: chaves.configuracaoAgenda(),
    queryFn: buscarConfiguracaoAgenda,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: podeAgenda,
  })

  const mesDaUrl = parametros.get('mes')
  const mes =
    mesDaUrl !== null && ehMesValido(mesDaUrl)
      ? mesDaUrl
      : hojeNaClinica(configuracao.data?.timezone ?? TIMEZONE_PADRAO).slice(0, 7)
  const periodo = limitesDoMes(mes)
  const pagamentos = useQuery({
    queryKey: chaves.pagamentosSemTratamento(periodo),
    queryFn: () => listarPagamentosSemTratamento(periodo.de, periodo.ate),
  })

  function trocarMes(proximo: string): void {
    const proximos = new URLSearchParams(parametros)
    proximos.set('mes', proximo)
    setParametros(proximos, { replace: true })
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <Link
          to="/financeiro"
          className="flex w-fit items-center gap-1.5 text-corpo text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Financeiro
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h1
              ref={titulo}
              tabIndex={-1}
              className="text-titulo font-semibold text-texto focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foco"
            >
              Vincular pagamentos ao tratamento
            </h1>
            <p className="mt-1 text-corpo text-texto-suave">
              Receitas pagas de crianças que ficaram sem o tratamento — por isso aparecem em "Sem profissional" no
              Recebido por profissional. As que têm sugestão já vêm marcadas: confira e vincule de uma vez.
            </p>
          </div>

          <div role="group" aria-label="Mês dos pagamentos" className="flex items-center gap-2">
            <Botao
              variante="secundario"
              tamanho="sm"
              aria-label="Mês anterior"
              onClick={() => {
                trocarMes(somarMeses(mes, -1))
              }}
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
              onClick={() => {
                trocarMes(somarMeses(mes, 1))
              }}
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </Botao>
          </div>
        </div>
      </header>

      {pagamentos.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="ml-auto h-11 w-56" />
        </div>
      ) : null}

      {pagamentos.isError ? (
        <EstadoErro mensagem={mensagemDoErro(pagamentos.error)} aoTentarNovamente={() => void pagamentos.refetch()} />
      ) : null}

      {pagamentos.isSuccess && pagamentos.data.data.length === 0 ? (
        <EstadoVazio
          nivel={2}
          titulo={`Nenhum pagamento sem tratamento em ${rotuloDoMes(mes)}.`}
          descricao="Todas as receitas pagas de crianças neste mês já estão ligadas a um tratamento."
          acao={
            <Botao
              variante="secundario"
              onClick={() => {
                trocarMes(somarMeses(mes, -1))
              }}
            >
              Ver {rotuloDoMes(somarMeses(mes, -1))}
            </Botao>
          }
        />
      ) : null}

      {pagamentos.isSuccess && pagamentos.data.data.length > 0 ? (
        // `key`: trocar de mês começa um lote novo — a marcação de setembro não vaza para outubro
        <LoteDeVinculos key={mes} pagamentos={pagamentos.data} ancoraDoFoco={titulo} />
      ) : null}
    </section>
  )
}
