import { skipToken, useQuery } from '@tanstack/react-query'
import { ArrowLeft, FileQuestion } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { ExigePermissao } from '@/componentes/acesso-negado'
import { FormularioDoRelatorio } from '@/componentes/relatorios/formulario-do-relatorio'
import { LinhasDeAssinatura } from '@/componentes/relatorios/linhas-de-assinatura'
import { ResultadoDoRelatorio } from '@/componentes/relatorios/resultado-do-relatorio'
import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { FolhaImpressa } from '@/componentes/ui/folha-impressa'
import { Skeleton } from '@/componentes/ui/skeleton'
import { PERMISSOES_DO_VINCULO_EM_LOTE } from '@/lib/catalogos'
import { chaves } from '@/lib/chaves-query'
import { hojeNaClinica, periodoEmPalavras, TIMEZONE_PADRAO } from '@/lib/datas'
import { ErroDeApi } from '@/lib/http'
import { ehMesValido } from '@/lib/meses'
import { possuiTodasAsPermissoes } from '@/lib/permissoes'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { relatorioDoCatalogo, relatorioParaOUsuario, type RelatorioDoCatalogo } from '@/lib/relatorios/catalogo'
import {
  lerParametrosDaUrl,
  obrigatoriosDoRecorte,
  parametrosDaConsulta,
  parametrosParaUrl,
  prontidaoDoRelatorio,
  recorteDoRelatorio,
  temFiltroRemovivel,
} from '@/lib/relatorios/parametros'
import { periodoDoEnvelope } from '@/lib/relatorios/periodo'
import { buscarConfiguracaoAgenda } from '@/servicos/catalogos'
import { executarRelatorio } from '@/servicos/relatorios'
import { useAuthStore } from '@/stores/auth-store'
import type { EnvelopeDeRelatorio, ParametrosDeRelatorio } from '@/tipos'

/**
 * UM relatório: o formulário declarado pelo catálogo, o resultado e o papel (change
 * `area-de-relatorios`). A rota é `/relatorios/:slug`; slug fora do catálogo é "não existe"
 * com a volta, e as permissões do relatório são exigidas TODAS — o `ExigePermissao` da
 * casa é "qualquer uma", então aqui ele é ANINHADO, um por permissão.
 */
export function PaginaRelatorio() {
  const { slug = '' } = useParams<{ slug: string }>()
  const relatorio = relatorioDoCatalogo(slug)

  if (relatorio === undefined) {
    return (
      <div className="p-8">
        <EstadoVazio
          nivel={2}
          icone={<FileQuestion className="size-8" />}
          titulo="Este relatório não existe."
          descricao="O endereço pode estar errado ou o relatório pode ter mudado de nome."
          acao={
            <Botao asChild variante="secundario">
              <Link to="/relatorios">Ver todos os relatórios</Link>
            </Botao>
          }
        />
      </div>
    )
  }

  return (
    <ExigeTodas permissoes={relatorio.permissoes}>
      <ConteudoDoRelatorio relatorio={relatorio} />
    </ExigeTodas>
  )
}

/** "Todas" = "qualquer uma" aninhada, uma por permissão — o mesmo molde das rotas de produtividade. */
function ExigeTodas({ permissoes, children }: { permissoes: readonly string[]; children: ReactNode }) {
  return permissoes.reduceRight<ReactNode>(
    (filho, permissao) => <ExigePermissao permissao={permissao}>{filho}</ExigePermissao>,
    children,
  )
}

/** A recusa do servidor em uma frase — a primeira mensagem de campo quando é 422. */
function mensagemDoErro(erro: unknown): string {
  if (erro instanceof ErroDeApi) {
    if (erro.motivo === 'sem_acesso') {
      return 'Você não tem acesso a este relatório.'
    }
    if (erro.motivo === 'invalido') {
      const primeira = Object.values(erro.camposInvalidos).flat().find((texto) => texto !== '')
      return primeira === undefined ? 'O servidor recusou o recorte pedido. Revise o período e os filtros.' : `O servidor recusou o recorte: ${primeira}`
    }
  }

  return 'Não foi possível gerar o relatório.'
}

/**
 * O "Recebido por profissional" avisa quantos pagamentos do período ficaram sem profissional; quem
 * pode vinculá-los em lote ganha o caminho até lá, no MÊS do relatório (change
 * `vincular-pagamentos-ao-tratamento`). Período de vários meses leva ao primeiro deles.
 */
function LinkParaVincular({ envelope }: { envelope: EnvelopeDeRelatorio }) {
  const mes = envelope.periodo?.de.slice(0, 7) ?? ''
  const destino = ehMesValido(mes) ? `/financeiro/vincular?mes=${mes}` : '/financeiro/vincular'

  return (
    <Botao asChild variante="secundario" tamanho="sm">
      <Link to={destino}>Vincular pagamentos</Link>
    </Botao>
  )
}

/**
 * O DRE avisa quantas categorias estão na linha padrão (change `dre-gerencial`, D2): o caminho para
 * conferir mora no próprio aviso. Quem vê o DRE vê o fluxo de caixa — e a configuração abre com ele.
 */
function LinkParaConfigurarDre() {
  return (
    <Botao asChild variante="secundario" tamanho="sm">
      <Link to="/financeiro/dre/configurar">Configurar DRE</Link>
    </Botao>
  )
}

/** A ação de cada aviso, por relatório — fora do papel; `undefined` = o aviso só informa. */
function acaoDosAvisos(slug: string, envelope: EnvelopeDeRelatorio, podeVincular: boolean): ReactNode {
  if (slug === 'recebido-por-profissional' && podeVincular) {
    return <LinkParaVincular envelope={envelope} />
  }

  return slug === 'dre-gerencial' ? <LinkParaConfigurarDre /> : undefined
}

function ConteudoDoRelatorio({ relatorio: doCatalogo }: { relatorio: RelatorioDoCatalogo }) {
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  // o recorte que ESTE usuário pode pedir (ex.: sem o total da clínica, um profissional por vez)
  const relatorio = relatorioParaOUsuario(doCatalogo, temPermissao)
  const [url, setUrl] = useSearchParams()
  const idDoResultado = useId()
  const podeAgenda = useAuthStore((estado) => estado.temPermissao('agenda.ver'))
  const podeVincular = useAuthStore((estado) =>
    possuiTodasAsPermissoes(estado.temPermissao, PERMISSOES_DO_VINCULO_EM_LOTE),
  )

  // o fuso da CLÍNICA (§13) decide o "hoje" dos atalhos — nunca o relógio do navegador.
  // A configuração fica atrás de `agenda.ver`; sem ela, o padrão da casa.
  const configuracao = useQuery({
    queryKey: chaves.configuracaoAgenda(),
    queryFn: buscarConfiguracaoAgenda,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: podeAgenda,
  })
  const hoje = hojeNaClinica(configuracao.data?.timezone ?? TIMEZONE_PADRAO)

  // a URL é a fonte do recorte (D5): lida saneada, e só dispara a consulta quando está
  // completa — uma URL pela metade mostra o formulário, nunca uma chamada 422
  const parametros = lerParametrosDaUrl(url, relatorio)
  const prontidao = prontidaoDoRelatorio(relatorio, parametros)
  // o que vai ao servidor (e à chave): o recorte menos o que só existe na tela
  const consultados = parametrosDaConsulta(relatorio, parametros)
  const chaveDaConsulta = Object.fromEntries(Object.entries(consultados).filter(([, valor]) => valor !== undefined))

  const resultado = useQuery({
    queryKey: chaves.relatorio(relatorio.slug, chaveDaConsulta),
    queryFn: prontidao.pronto ? () => executarRelatorio(relatorio.slug, consultados) : skipToken,
  })

  function gerar(proximos: ParametrosDeRelatorio): void {
    // `push`, não `replace`: o Voltar devolve o recorte anterior — é o que "filtros na URL" promete
    setUrl(parametrosParaUrl(proximos))
  }

  function limparFiltros(): void {
    // "sem os filtros" tira profissional, convênio, especialidade, status — não o RECORTE:
    // a situação e os campos que ela usa continuam, senão o relatório na tela vira outro. E
    // não tira o OBRIGATÓRIO (CR-RPP-27): sem ele "Gerar sem os filtros" caía em "Escolha o
    // profissional"/"Escolha o paciente", o contrário do que o botão prometeu
    setUrl(
      parametrosParaUrl(
        recorteDoRelatorio(relatorio, {
          de: parametros.de,
          ate: parametros.ate,
          situacao: parametros.situacao,
          mes: parametros.mes,
          dias: parametros.dias,
          ordenar: parametros.ordenar,
          ...obrigatoriosDoRecorte(relatorio, parametros),
        }),
      ),
    )
  }

  const periodoDoPapel =
    resultado.isSuccess
      ? (periodoDoEnvelope(resultado.data) ?? '')
      : (periodoEmPalavras(parametros.de ?? '', parametros.ate ?? '') ?? '')

  return (
    <div className="flex flex-col gap-6">
      <header data-nao-imprimir className="flex flex-col gap-3">
        <Link
          to="/relatorios"
          className="inline-flex w-fit items-center gap-1 rounded-controle text-corpo font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Relatórios
        </Link>
        <div>
          <h1 className="text-titulo font-semibold text-texto">{relatorio.nome}</h1>
          <p className="mt-1 max-w-2xl text-corpo text-texto-suave">{relatorio.descricao}</p>
          {relatorio.nomesAntigos.length > 0 ? (
            <p className="mt-1 text-meta text-texto-suave">No ClinicaÁgil: {relatorio.nomesAntigos.join(' · ')}</p>
          ) : null}
          {relatorio.notaSemPermissao !== undefined && !temPermissao(relatorio.notaSemPermissao.permissao) ? (
            <p className="mt-2 max-w-2xl text-corpo text-texto">{relatorio.notaSemPermissao.texto}</p>
          ) : null}
        </div>
      </header>

      <FormularioDoRelatorio relatorio={relatorio} inicial={parametros} hoje={hoje} aoGerar={gerar} />

      <section aria-labelledby={idDoResultado} className="flex flex-col gap-4">
        <h2 id={idDoResultado} data-nao-imprimir className="text-subtitulo font-semibold text-texto">
          Resultado
        </h2>

        {!prontidao.pronto ? (
          <EstadoVazio
            // nem todo relatório tem período: em `pacientes`, o recorte pode ser o mês das
            // aniversariantes — a razão da prontidão diz o que falta, logo abaixo
            titulo="Preencha os filtros e clique em Gerar."
            descricao={
              url.size === 0
                ? 'O resultado aparece aqui, com totais, e pode ser impresso.'
                : `${prontidao.razao} Ajuste o formulário e clique em Gerar.`
            }
          />
        ) : null}

        {prontidao.pronto && resultado.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : null}

        {resultado.isError ? (
          <EstadoErro mensagem={mensagemDoErro(resultado.error)} aoTentarNovamente={() => void resultado.refetch()} />
        ) : null}

        {resultado.isSuccess ? (
          <FolhaImpressa
            titulo={relatorio.nome}
            periodo={periodoDoPapel}
            rodape={relatorio.assinaturas === undefined ? undefined : <LinhasDeAssinatura rotulos={relatorio.assinaturas} />}
          >
            <ResultadoDoRelatorio
              // um recorte, um resultado: a recusa da planilha de OUTRO recorte não fica na tela
              // quando a consulta nova já está no cache e o resultado não chega a desmontar (CR-WEB-06)
              key={JSON.stringify(chaves.relatorio(relatorio.slug, chaveDaConsulta))}
              envelope={resultado.data}
              aoLimparFiltros={limparFiltros}
              podeLimparFiltros={temFiltroRemovivel(relatorio, parametros)}
              parametrosDaPlanilha={consultados}
              acaoDosAvisos={acaoDosAvisos(relatorio.slug, resultado.data, podeVincular)}
            />
          </FolhaImpressa>
        ) : null}
      </section>
    </div>
  )
}
