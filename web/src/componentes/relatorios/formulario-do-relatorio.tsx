import { useQuery } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'

import { CampoPaciente } from '@/componentes/relatorios/campo-paciente'
import {
  ajudaDaCategoria,
  categoriaCabe,
  opcoesDeCategoria,
  opcoesDeConta,
  usarCatalogosDoCaixa,
} from '@/componentes/relatorios/catalogos-do-caixa'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { SeletorDeData } from '@/componentes/ui/seletor-de-data'
import { PERMISSOES_DA_SELECAO_DA_AGENDA } from '@/lib/catalogos'
import { chaves } from '@/lib/chaves-query'
import { dataEhValida } from '@/lib/grade-agenda'
import { rotuloDoMes, somarMeses } from '@/lib/meses'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { campoAparece, naturezaDaCategoria, type OpcaoDeclarada, type RelatorioDoCatalogo } from '@/lib/relatorios/catalogo'
import { prontidaoDoRelatorio, recorteDoRelatorio } from '@/lib/relatorios/parametros'
import { ATALHOS_DE_PERIODO, periodoDoAtalho, type AtalhoDePeriodo } from '@/lib/relatorios/periodo'
import { buscarSelecaoComDesligados, buscarSelecaoDaAgenda } from '@/servicos/agenda'
import { convenios, servicosDoConvenio } from '@/servicos/catalogos-de-apoio'
import { useAuthStore } from '@/stores/auth-store'
import type { ParametrosDeRelatorio } from '@/tipos'

/** O rascunho sempre tem período: o formulário nasce com "este mês" quando a URL não diz. */
type Rascunho = ParametrosDeRelatorio & { de: string; ate: string }

const OPCOES_DE_RESULTADO = [
  { valor: 'analitico', rotulo: 'Analítico (linha a linha)' },
  { valor: 'sintetico', rotulo: 'Sintético (totais)' },
] as const

const TODOS = { valor: '', rotulo: 'Todos' }
const ESCOLHA_O_PROFISSIONAL = { valor: '', rotulo: 'Escolha o profissional' }
const AJUDA_DO_PROFISSIONAL_OBRIGATORIO =
  'Você vê um profissional por vez. A soma de todos fica com quem vê o fluxo de caixa.'
const TODAS = { valor: '', rotulo: 'Todas' }

/** Quantos meses para trás e para frente o campo "Mês" oferece — um ano de cada lado. */
const MESES_OFERECIDOS = 12

function comMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/**
 * Os meses do campo "Mês" (`AAAA-MM`), em torno de HOJE na clínica. O ano importa: a linha
 * das aniversariantes traz a idade que a criança FARÁ — "setembro de 2026" e "setembro de
 * 2025" não dão a mesma coluna.
 */
function opcoesDeMes(hoje: string): OpcaoDeclarada[] {
  const atual = hoje.slice(0, 7)

  return Array.from({ length: MESES_OFERECIDOS * 2 + 1 }, (_, indice) => somarMeses(atual, indice - MESES_OFERECIDOS)).map(
    (mes) => ({ valor: mes, rotulo: comMaiuscula(rotuloDoMes(mes)) }),
  )
}

function rascunhoDe(inicial: ParametrosDeRelatorio, relatorio: RelatorioDoCatalogo, hoje: string): Rascunho {
  const de = dataEhValida(inicial.de) ? inicial.de : undefined
  const ate = dataEhValida(inicial.ate) ? inicial.ate : undefined
  // o fechamento de caixa nasce em HOJE; os outros, no mês corrente
  const padrao = periodoDoAtalho(relatorio.periodoPadrao ?? 'este-mes', hoje)
  const usa = (filtro: RelatorioDoCatalogo['filtros'][number]): boolean => relatorio.filtros.includes(filtro)

  return {
    ...inicial,
    de: de !== undefined && ate !== undefined ? de : padrao.de,
    ate: de !== undefined && ate !== undefined ? ate : padrao.ate,
    // situação e ordenação NÃO têm vazio: o servidor sempre assume a primeira, e o
    // formulário mostra qual é em vez de deixar o campo em branco mentindo "nenhuma"
    situacao: relatorio.situacoes === undefined ? undefined : (inicial.situacao ?? relatorio.situacoes[0]?.valor),
    ordenar: relatorio.ordenacoes === undefined ? undefined : (inicial.ordenar ?? relatorio.ordenacoes[0]?.valor),
    dias: usa('dias') ? (inicial.dias ?? (relatorio.diasPadrao === undefined ? undefined : String(relatorio.diasPadrao))) : undefined,
    mes: usa('mes') ? (inicial.mes ?? hoje.slice(0, 7)) : undefined,
    resultado: relatorio.resultados === undefined ? undefined : (inicial.resultado ?? relatorio.resultados[0]),
    dividir_por:
      inicial.resultado === 'sintetico' ? (inicial.dividir_por ?? relatorio.divisoes?.[0]?.valor) : inicial.dividir_por,
  }
}

/** O campo Tipo diz o que o Tipo É neste relatório (receber ou pagar, entradas ou saídas…). */
const ROTULOS_DO_TIPO_PADRAO = { campo: 'Tipo de movimentação', todos: 'Todas' }

/** Nas Vendas o convênio só acha o serviço — o campo diz que não é filtro. */
const AJUDA_DO_CONVENIO_DO_SERVICO =
  'Serve para achar o serviço: cada convênio tem a sua tabela. O relatório não se filtra por convênio.'

/** Por que o campo Serviço está como está — a permissão primeiro, depois o convênio. */
function ajudaDoServico({ podeServicos, temConvenio, comErro }: { podeServicos: boolean; temConvenio: boolean; comErro: boolean }): string | undefined {
  if (!podeServicos) {
    return 'Listar os serviços precisa da permissão de ver serviços.'
  }
  if (!temConvenio) {
    return 'Escolha o convênio: cada convênio tem a sua tabela de serviços.'
  }

  return comErro ? 'Não foi possível carregar os serviços deste convênio.' : undefined
}

export interface FormularioDoRelatorioProps {
  relatorio: RelatorioDoCatalogo
  /** O recorte que está na URL — o formulário nasce dele e volta a ele quando a URL muda (Voltar). */
  inicial: ParametrosDeRelatorio
  /** `AAAA-MM-DD` de hoje NA CLÍNICA — os atalhos e o calendário partem daqui. */
  hoje: string
  aoGerar: (parametros: ParametrosDeRelatorio) => void
}

/**
 * UM formulário, montado pela DECLARAÇÃO do relatório (design D4): período com atalhos, e
 * só os filtros que ele usa; "Resultado" e "Dividir por" quando ele oferece. A mesma cara
 * em todos — o que o ClinicaÁgil não tem (um formulário próprio por relatório).
 *
 * Alguns campos são da SITUAÇÃO, não do relatório: em `pacientes`, o período existe para
 * "Cadastradas no período" e o mês para "Aniversariantes" — nas outras situações eles não
 * aparecem, não são exigidos e não vão para a URL.
 *
 * O rascunho é local; "Gerar" o entrega a quem grava na URL. Quando a URL muda por fora
 * (Voltar, link colado), o rascunho volta a ela — ajuste de estado DURANTE o render, o
 * padrão do React para estado derivado de prop, sem `useEffect` nem remontagem (remontar
 * derrubaria o foco de quem acabou de apertar Gerar).
 */
export function FormularioDoRelatorio({ relatorio, inicial, hoje, aoGerar }: FormularioDoRelatorioProps) {
  const chaveDoInicial = JSON.stringify(inicial)
  const [rascunho, setRascunho] = useState<Rascunho>(() => rascunhoDe(inicial, relatorio, hoje))
  const [chaveSincronizada, setChaveSincronizada] = useState(chaveDoInicial)
  if (chaveSincronizada !== chaveDoInicial) {
    setChaveSincronizada(chaveDoInicial)
    setRascunho(rascunhoDe(inicial, relatorio, hoje))
  }

  const idBase = useId()
  const idDaRazao = `${idBase}-razao`
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  // a seleção da agenda (nomes de profissionais, especialidades, status) abre com QUALQUER das
  // permissões da rota — a faturista a lê por `repasse.ver`, sem permissão de agenda
  const podeAgenda = PERMISSOES_DA_SELECAO_DA_AGENDA.some((permissao) => temPermissao(permissao))
  const podeConvenios = temPermissao('convenios.ver')
  const podeServicos = temPermissao('servicos.ver')

  const usa = (filtro: RelatorioDoCatalogo['filtros'][number]): boolean => relatorio.filtros.includes(filtro)
  const aparece = (campo: 'periodo' | 'mes' | 'dias'): boolean => campoAparece(relatorio, campo, rascunho.situacao)
  const precisaDaSelecao = usa('profissional') || usa('especialidade') || usa('status')

  // os catálogos do formulário vêm da seleção da agenda (profissionais, especialidades,
  // status) e do cadastro de convênios — cada um só é pedido quando o relatório o usa E
  // o usuário pode lê-lo; sem a permissão, o campo fica desabilitado dizendo o porquê
  // o repasse fecha também o último mês de quem saiu: o filtro oferece os desligados, marcados
  const comDesligados = relatorio.profissionaisComDesligados === true
  const selecao = useQuery({
    queryKey: comDesligados ? chaves.selecaoComDesligados() : chaves.selecaoDaAgenda(),
    queryFn: comDesligados ? buscarSelecaoComDesligados : buscarSelecaoDaAgenda,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: precisaDaSelecao && podeAgenda,
  })
  const listaDeConvenios = useQuery({
    queryKey: chaves.convenios(),
    queryFn: convenios.listar,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: usa('convenio') && podeConvenios,
  })
  // serviço é POR convênio (o preço muda por operadora): a lista só existe depois do convênio
  const convenioDoServico = Number(rascunho.convenio_id ?? '')
  const temConvenio = Number.isInteger(convenioDoServico) && convenioDoServico > 0
  const listaDeServicos = useQuery({
    queryKey: chaves.servicosDoConvenio(convenioDoServico),
    queryFn: () => servicosDoConvenio(convenioDoServico).listar(),
    enabled: usa('servico') && podeServicos && temConvenio,
    // chave de DETALHE do convênio: a regra do `gcTime: 0` é sem exceção (re-review r8). Aqui ela
    // também serve ao recorte — um serviço recém-removido não fica oferecido pelo cache
    gcTime: 0,
  })

  const caixa = usarCatalogosDoCaixa(relatorio)
  const natureza = naturezaDaCategoria(relatorio, rascunho.tipo)
  const rotulosDoTipo = relatorio.rotulosDoTipo ?? ROTULOS_DO_TIPO_PADRAO

  const prontidao = prontidaoDoRelatorio(relatorio, recorteDoRelatorio(relatorio, rascunho))

  function mudar<Chave extends keyof Rascunho>(chave: Chave, valor: Rascunho[Chave]): void {
    setRascunho((atual) => ({ ...atual, [chave]: valor }))
  }

  function aplicarAtalho(atalho: string): void {
    const escolhido = ATALHOS_DE_PERIODO.find((opcao) => opcao.valor === atalho)
    if (escolhido === undefined) {
      return
    }
    const periodo = periodoDoAtalho(escolhido.valor satisfies AtalhoDePeriodo, hoje)
    setRascunho((atual) => ({ ...atual, de: periodo.de, ate: periodo.ate }))
  }

  function limparFiltros(): void {
    // "limpar" tira profissional, convênio, especialidade, status — não o RECORTE: a
    // situação e os campos dela continuam, senão o relatório na tela vira outro
    setRascunho((atual) =>
      rascunhoDe(
        { de: atual.de, ate: atual.ate, situacao: atual.situacao, mes: atual.mes, dias: atual.dias, ordenar: atual.ordenar },
        relatorio,
        hoje,
      ),
    )
  }

  function enviar(evento: FormEvent<HTMLFormElement>): void {
    evento.preventDefault()
    if (!prontidao.pronto) {
      return
    }
    aoGerar(recorteDoRelatorio(relatorio, rascunho))
  }

  // obrigatório (sem o total da clínica, um profissional por vez): sem "Todos" — o vazio é
  // "escolha", e "Gerar" fica desligado com a razão até haver um
  const exigeProfissional = (relatorio.obrigatorios ?? []).includes('profissional')
  const opcoesDeProfissional = [
    exigeProfissional ? ESCOLHA_O_PROFISSIONAL : TODOS,
    ...(selecao.data?.profissionais ?? []).map((item) => ({
      valor: String(item.id),
      rotulo: item.ativo === false ? `${item.nome} (desligado)` : item.nome,
    })),
  ]
  const opcoesDeEspecialidade = [TODAS, ...(selecao.data?.especialidades ?? []).map((item) => ({ valor: String(item.id), rotulo: item.nome }))]
  const opcoesDeStatus = [TODOS, ...(selecao.data?.status ?? []).map((item) => ({ valor: String(item.id), rotulo: item.nome }))]
  const opcoesDeConvenio = [TODOS, ...(listaDeConvenios.data ?? []).map((item) => ({ valor: String(item.id), rotulo: item.nome }))]
  const opcoesDeServico = [
    TODOS,
    ...(temConvenio ? (listaDeServicos.data ?? []) : []).map((item) => ({ valor: String(item.id), rotulo: item.procedimento })),
  ]
  const ajudaDaSelecao = podeAgenda ? undefined : 'Listar as opções precisa de permissão da agenda ou do repasse.'

  return (
    <form
      data-nao-imprimir
      aria-label={`Filtros do relatório ${relatorio.nome}`}
      onSubmit={enviar}
      className="flex max-w-2xl flex-col gap-5"
    >
      {aparece('periodo') ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-rotulo font-medium text-texto">Período</legend>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <span aria-hidden="true" className="text-rotulo font-medium text-texto">
                De
              </span>
              <SeletorDeData
                rotulo="De (início do período)"
                valor={rascunho.de}
                hoje={hoje}
                aoMudar={(data) => {
                  mudar('de', data)
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span aria-hidden="true" className="text-rotulo font-medium text-texto">
                Até
              </span>
              <SeletorDeData
                rotulo="Até (fim do período)"
                valor={rascunho.ate}
                hoje={hoje}
                aoMudar={(data) => {
                  mudar('ate', data)
                }}
              />
            </div>
            <CampoSelect
              rotulo="Atalho de período"
              placeholder="Escolher…"
              value=""
              opcoes={ATALHOS_DE_PERIODO}
              className="min-w-44"
              onChange={(evento) => {
                aplicarAtalho(evento.target.value)
              }}
            />
          </div>
        </fieldset>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {usa('situacao') && relatorio.situacoes !== undefined ? (
          <CampoSelect
            rotulo="Situação"
            value={rascunho.situacao ?? ''}
            opcoes={relatorio.situacoes}
            onChange={(evento) => {
              mudar('situacao', evento.target.value)
            }}
          />
        ) : null}
        {usa('tipo') && relatorio.tipos !== undefined ? (
          <CampoSelect
            rotulo={rotulosDoTipo.campo}
            // sem "todos", o vazio não existe: vale a PRIMEIRA, que é o padrão do servidor (a base do DRE)
            value={rascunho.tipo ?? (rotulosDoTipo.todos === undefined ? (relatorio.tipos[0]?.valor ?? '') : '')}
            opcoes={
              rotulosDoTipo.todos === undefined
                ? relatorio.tipos
                : [{ valor: '', rotulo: rotulosDoTipo.todos }, ...relatorio.tipos]
            }
            onChange={(evento) => {
              const tipo = evento.target.value || undefined
              // "A pagar" com uma categoria de receita é pedido incoerente (422): a categoria que não
              // cabe na natureza nova sai junto, em vez de virar uma recusa depois do Gerar
              setRascunho((atual) => ({
                ...atual,
                tipo,
                categoria_id: categoriaCabe(caixa.categorias, atual.categoria_id, naturezaDaCategoria(relatorio, tipo))
                  ? atual.categoria_id
                  : undefined,
              }))
            }}
          />
        ) : null}
        {caixa.mostraConta ? (
          <CampoSelect
            rotulo="Conta"
            value={rascunho.conta_id ?? ''}
            opcoes={opcoesDeConta(caixa.contas)}
            ajuda={caixa.erroNasContas ? 'Não foi possível carregar as contas.' : undefined}
            onChange={(evento) => {
              mudar('conta_id', evento.target.value || undefined)
            }}
          />
        ) : null}
        {caixa.mostraCategoria ? (
          <CampoSelect
            rotulo="Categoria"
            value={rascunho.categoria_id ?? ''}
            opcoes={opcoesDeCategoria(caixa.categorias, natureza, rascunho.categoria_id)}
            ajuda={ajudaDaCategoria(relatorio, natureza, caixa.erroNasCategorias)}
            onChange={(evento) => {
              mudar('categoria_id', evento.target.value || undefined)
            }}
          />
        ) : null}
        {aparece('mes') ? (
          <CampoSelect
            rotulo="Mês"
            value={rascunho.mes ?? ''}
            opcoes={opcoesDeMes(hoje)}
            onChange={(evento) => {
              mudar('mes', evento.target.value || undefined)
            }}
          />
        ) : null}
        {aparece('dias') ? (
          <CampoTexto
            rotulo="Dias sem atendimento"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={rascunho.dias ?? ''}
            ajuda="De 1 a 365 dias."
            onChange={(evento) => {
              mudar('dias', evento.target.value || undefined)
            }}
          />
        ) : null}
        {usa('profissional') ? (
          <CampoSelect
            rotulo="Profissional"
            value={rascunho.profissional_id ?? ''}
            opcoes={opcoesDeProfissional}
            disabled={!podeAgenda}
            obrigatorio={exigeProfissional}
            ajuda={ajudaDaSelecao ?? (exigeProfissional ? AJUDA_DO_PROFISSIONAL_OBRIGATORIO : undefined)}
            onChange={(evento) => {
              mudar('profissional_id', evento.target.value || undefined)
            }}
          />
        ) : null}
        {usa('convenio') ? (
          <CampoSelect
            rotulo={relatorio.convenioSoParaOServico === true ? 'Convênio do serviço' : 'Convênio'}
            value={rascunho.convenio_id ?? ''}
            opcoes={opcoesDeConvenio}
            disabled={!podeConvenios}
            ajuda={
              podeConvenios
                ? relatorio.convenioSoParaOServico === true
                  ? AJUDA_DO_CONVENIO_DO_SERVICO
                  : undefined
                : 'Listar os convênios precisa da permissão de ver convênios.'
            }
            onChange={(evento) => {
              const convenioId = evento.target.value || undefined
              // o serviço é da tabela do convênio ANTERIOR: trocar o convênio o limpa
              setRascunho((atual) => ({ ...atual, convenio_id: convenioId, servico_id: undefined }))
            }}
          />
        ) : null}
        {usa('servico') ? (
          <CampoSelect
            rotulo="Serviço"
            value={temConvenio ? (rascunho.servico_id ?? '') : ''}
            opcoes={opcoesDeServico}
            disabled={!podeServicos || !temConvenio}
            ajuda={ajudaDoServico({ podeServicos, temConvenio, comErro: listaDeServicos.isError })}
            onChange={(evento) => {
              mudar('servico_id', evento.target.value || undefined)
            }}
          />
        ) : null}
        {usa('especialidade') ? (
          <CampoSelect
            rotulo="Especialidade"
            value={rascunho.especialidade_id ?? ''}
            opcoes={opcoesDeEspecialidade}
            disabled={!podeAgenda}
            ajuda={ajudaDaSelecao}
            onChange={(evento) => {
              mudar('especialidade_id', evento.target.value || undefined)
            }}
          />
        ) : null}
        {usa('status') ? (
          <CampoSelect
            rotulo="Status"
            value={rascunho.status_id ?? ''}
            opcoes={opcoesDeStatus}
            disabled={!podeAgenda}
            ajuda={ajudaDaSelecao}
            onChange={(evento) => {
              mudar('status_id', evento.target.value || undefined)
            }}
          />
        ) : null}
        {usa('paciente') ? (
          <CampoPaciente
            pacienteId={rascunho.paciente_id}
            aoEscolher={(pacienteId) => {
              mudar('paciente_id', pacienteId)
            }}
          />
        ) : null}
        {usa('ordenar') && relatorio.ordenacoes !== undefined ? (
          <CampoSelect
            rotulo="Ordenar por"
            value={rascunho.ordenar ?? ''}
            opcoes={relatorio.ordenacoes}
            onChange={(evento) => {
              mudar('ordenar', evento.target.value)
            }}
          />
        ) : null}
        {usa('contabeis') ? (
          <CampoCheckbox
            rotulo="Somente lançamentos contábeis"
            ajuda="Deixa de fora o que foi lançado sem a marca Contábil — o que o contador não recebe."
            marcado={rascunho.somente_contabeis === '1'}
            aoMudar={(marcado) => {
              mudar('somente_contabeis', marcado ? '1' : undefined)
            }}
            className="md:col-span-2"
          />
        ) : null}
        {relatorio.resultados !== undefined ? (
          <CampoSelect
            rotulo="Resultado"
            value={rascunho.resultado ?? relatorio.resultados[0] ?? ''}
            opcoes={OPCOES_DE_RESULTADO.filter((opcao) => relatorio.resultados?.includes(opcao.valor))}
            onChange={(evento) => {
              const resultado = evento.target.value === 'sintetico' ? 'sintetico' : 'analitico'
              setRascunho((atual) => ({
                ...atual,
                resultado,
                // o servidor exige a divisão no sintético (`required_if`): a primeira é o padrão
                dividir_por: resultado === 'sintetico' ? (atual.dividir_por ?? relatorio.divisoes?.[0]?.valor) : undefined,
              }))
            }}
          />
        ) : null}
        {rascunho.resultado === 'sintetico' && relatorio.divisoes !== undefined ? (
          <CampoSelect
            rotulo="Dividir por"
            value={rascunho.dividir_por ?? ''}
            opcoes={relatorio.divisoes}
            onChange={(evento) => {
              mudar('dividir_por', evento.target.value)
            }}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* `aria-disabled`, não `disabled`: inerte MAS focável, para a razão ser lida
            pelo `aria-describedby` — o padrão do `Botao` da casa (A11Y-03) */}
        <Botao
          type="submit"
          aria-disabled={prontidao.pronto ? undefined : true}
          aria-describedby={prontidao.pronto ? undefined : idDaRazao}
        >
          Gerar
        </Botao>
        <Botao type="button" variante="fantasma" onClick={limparFiltros}>
          Limpar filtros
        </Botao>
        {prontidao.pronto ? null : (
          <p id={idDaRazao} role="status" className="text-meta text-texto-suave">
            {prontidao.razao}
          </p>
        )}
      </div>
    </form>
  )
}
