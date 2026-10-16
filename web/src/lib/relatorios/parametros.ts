import { ehMesValido } from '@/lib/meses'
import type { CampoDaSituacao, FiltroDeRelatorio, RelatorioDoCatalogo } from '@/lib/relatorios/catalogo'
import { campoAparece, camposExigidos } from '@/lib/relatorios/catalogo'
import { validarPeriodo } from '@/lib/relatorios/periodo'
import type { ParametrosDeRelatorio } from '@/tipos'

/**
 * Os filtros do relatório VIVEM na URL (design D5): o link copiado reproduz o recorte e o
 * Voltar devolve o anterior. A query string é entrada NÃO confiável — id que não é inteiro
 * positivo, resultado que o relatório não oferece, divisão desconhecida, mês fora do
 * formato: tudo é DESCARTADO aqui, e a tela nunca monta uma chamada fadada ao 422.
 */

/** O nome do parâmetro (o MESMO da API) de cada filtro declarado. */
export const PARAMETRO_DO_FILTRO = {
  profissional: 'profissional_id',
  convenio: 'convenio_id',
  servico: 'servico_id',
  especialidade: 'especialidade_id',
  status: 'status_id',
  situacao: 'situacao',
  tipo: 'tipo',
  paciente: 'paciente_id',
  dias: 'dias',
  mes: 'mes',
  ordenar: 'ordenar',
  conta: 'conta_id',
  categoria: 'categoria_id',
  contabeis: 'somente_contabeis',
} as const satisfies Record<Exclude<FiltroDeRelatorio, 'periodo'>, keyof ParametrosDeRelatorio>

const CAMPOS_DA_SITUACAO: readonly CampoDaSituacao[] = ['periodo', 'mes', 'dias']

/** Os parâmetros que cada campo condicional ocupa — o período são DOIS. */
const PARAMETROS_DO_CAMPO = {
  periodo: ['de', 'ate'],
  mes: ['mes'],
  dias: ['dias'],
} as const satisfies Record<CampoDaSituacao, ReadonlyArray<keyof ParametrosDeRelatorio>>

/** Por que "Gerar" está desabilitado, quando falta o campo que a situação exige. */
const RAZAO_DO_CAMPO: Record<CampoDaSituacao, string> = {
  periodo: 'Informe o início e o fim do período.',
  mes: 'Escolha o mês.',
  dias: 'Informe os dias sem atendimento.',
}

/** A faixa do servidor para "sem atendimento há N dias" (`min:1`, `max:365`). */
const DIAS_MINIMO = 1
const DIAS_MAXIMO = 365

const INTEIRO_POSITIVO = /^[1-9]\d*$/

function inteiroPositivo(bruto: string | null): string | undefined {
  return bruto !== null && INTEIRO_POSITIVO.test(bruto) ? bruto : undefined
}

function inteiroAte(bruto: string | null, teto: number): string | undefined {
  const inteiro = inteiroPositivo(bruto)

  return inteiro !== undefined && Number(inteiro) <= teto ? inteiro : undefined
}

function dentroDe(bruto: string | null, aceitos: ReadonlyArray<{ valor: string }> | undefined): string | undefined {
  return bruto !== null && aceitos?.some((opcao) => opcao.valor === bruto) ? bruto : undefined
}

/** Lê da URL SÓ o que o relatório declara, já saneado. */
export function lerParametrosDaUrl(url: URLSearchParams, relatorio: RelatorioDoCatalogo): ParametrosDeRelatorio {
  const parametros: ParametrosDeRelatorio = {}

  // a SITUAÇÃO vem primeiro: é ela que diz se o período, o mês e os dias existem neste
  // recorte — em `pacientes`, "Ativas" não tem data nenhuma
  if (relatorio.filtros.includes('situacao')) {
    parametros.situacao = dentroDe(url.get('situacao'), relatorio.situacoes)
  }
  const situacao = parametros.situacao

  if (campoAparece(relatorio, 'periodo', situacao)) {
    parametros.de = url.get('de') ?? undefined
    parametros.ate = url.get('ate') ?? undefined
  }
  for (const filtro of relatorio.filtros) {
    switch (filtro) {
      case 'profissional':
      case 'convenio':
      case 'especialidade':
      case 'status':
      case 'paciente':
      case 'conta':
      case 'categoria':
        parametros[PARAMETRO_DO_FILTRO[filtro]] = inteiroPositivo(url.get(PARAMETRO_DO_FILTRO[filtro]))
        break
      case 'servico':
        // o serviço é POR convênio: sem convênio na URL o campo nem se escolhe, e um `servico_id`
        // solto seria um filtro que o formulário não mostra e o papel anunciaria
        parametros.servico_id =
          inteiroPositivo(url.get('convenio_id')) === undefined ? undefined : inteiroPositivo(url.get('servico_id'))
        break
      case 'dias':
        parametros.dias = campoAparece(relatorio, 'dias', situacao) ? inteiroAte(url.get('dias'), DIAS_MAXIMO) : undefined
        break
      case 'mes': {
        const mes = url.get('mes')
        parametros.mes = campoAparece(relatorio, 'mes', situacao) && mes !== null && ehMesValido(mes) ? mes : undefined
        break
      }
      case 'tipo':
        parametros.tipo = dentroDe(url.get('tipo'), relatorio.tipos)
        break
      case 'contabeis':
        // a API valida `boolean`: só `1` liga; qualquer outra coisa é o padrão (todos)
        parametros.somente_contabeis = url.get('somente_contabeis') === '1' ? '1' : undefined
        break
      case 'ordenar':
        parametros.ordenar = dentroDe(url.get('ordenar'), relatorio.ordenacoes)
        break
      case 'situacao':
      case 'periodo':
        break
    }
  }
  if (relatorio.resultados !== undefined) {
    const resultado = url.get('resultado')
    parametros.resultado =
      resultado === 'analitico' || resultado === 'sintetico'
        ? relatorio.resultados.includes(resultado)
          ? resultado
          : undefined
        : undefined
    if (parametros.resultado === 'sintetico') {
      parametros.dividir_por = dentroDe(url.get('dividir_por'), relatorio.divisoes)
    }
  }

  return parametros
}

/**
 * O recorte que vai para a URL: sem os campos que a situação em vigor NÃO usa. Um `de=` no
 * link de "Pacientes ativas" seria um filtro que o servidor ignora e que o papel anunciaria
 * como se tivesse aplicado.
 */
export function recorteDoRelatorio(
  relatorio: RelatorioDoCatalogo,
  parametros: ParametrosDeRelatorio,
): ParametrosDeRelatorio {
  const recorte: ParametrosDeRelatorio = { ...parametros }
  for (const campo of CAMPOS_DA_SITUACAO) {
    if (!campoAparece(relatorio, campo, parametros.situacao)) {
      for (const chave of PARAMETROS_DO_CAMPO[campo]) {
        recorte[chave] = undefined
      }
    }
  }

  return recorte
}

/** Os filtros que "Gerar sem os filtros" tira (o recorte — período, situação, mês, dias — fica). */
const FILTROS_REMOVIVEIS = [
  'profissional',
  'convenio',
  'servico',
  'especialidade',
  'status',
  'tipo',
  'paciente',
  'conta',
  'categoria',
  'contabeis',
] as const

/** Os parâmetros OBRIGATÓRIOS deste relatório, com o valor atual — "sem os filtros" os mantém. */
export function obrigatoriosDoRecorte(
  relatorio: RelatorioDoCatalogo,
  parametros: ParametrosDeRelatorio,
): ParametrosDeRelatorio {
  const mantidos: ParametrosDeRelatorio = {}
  for (const filtro of relatorio.obrigatorios ?? []) {
    if (filtro === 'periodo') {
      continue
    }
    const chave = PARAMETRO_DO_FILTRO[filtro]
    mantidos[chave] = parametros[chave]
  }

  return mantidos
}

/**
 * Há filtro que "Gerar sem os filtros" consegue TIRAR? Não conta o obrigatório (ele fica) nem a
 * linha "Base" do cabeçalho, que não é filtro — sem isto o botão aparecia sempre no recebido e,
 * para a faturista, prometia o que não cumpria (CR-RPP-27).
 */
export function temFiltroRemovivel(relatorio: RelatorioDoCatalogo, parametros: ParametrosDeRelatorio): boolean {
  const obrigatorios = new Set(relatorio.obrigatorios ?? [])

  return FILTROS_REMOVIVEIS.some(
    (filtro) => !obrigatorios.has(filtro) && (parametros[PARAMETRO_DO_FILTRO[filtro]] ?? '') !== '',
  )
}

/**
 * O que vai ao SERVIDOR — o recorte menos o que só existe na tela. Nas Vendas, o convênio serve
 * para achar o serviço (a tabela é por convênio) e o relatório não filtra por ele: mandá-lo seria
 * um parâmetro que a API descarta calada e que a chave do cache contaria como recorte novo.
 */
export function parametrosDaConsulta(
  relatorio: RelatorioDoCatalogo,
  parametros: ParametrosDeRelatorio,
): ParametrosDeRelatorio {
  return relatorio.convenioSoParaOServico === true ? { ...parametros, convenio_id: undefined } : parametros
}

/** Só o que tem valor vai para a URL — parâmetro vazio é ruído no link e "" para o servidor. */
export function parametrosParaUrl(parametros: ParametrosDeRelatorio): URLSearchParams {
  const url = new URLSearchParams()
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor !== undefined && valor !== '') {
      url.set(chave, valor)
    }
  }

  return url
}

/** O que falta, dito pelo nome — o genérico só para filtro que ninguém nomeou. */
const RAZAO_DO_OBRIGATORIO: Partial<Record<FiltroDeRelatorio, string>> = {
  paciente: 'Escolha o paciente.',
  profissional: 'Escolha o profissional.',
}

export type ProntidaoDoRelatorio = { pronto: true } | { pronto: false; razao: string }

/**
 * O relatório pode ser gerado com estes parâmetros? A razão sai em TEXTO para ficar ao
 * lado de "Gerar" — e a MESMA régua decide se a tela dispara a consulta ao abrir uma URL
 * com parâmetros: uma URL incompleta mostra o formulário, nunca uma chamada 422.
 */
export function prontidaoDoRelatorio(
  relatorio: RelatorioDoCatalogo,
  parametros: ParametrosDeRelatorio,
): ProntidaoDoRelatorio {
  if (campoAparece(relatorio, 'periodo', parametros.situacao)) {
    const periodo = validarPeriodo(parametros.de ?? '', parametros.ate ?? '')
    if (!periodo.valido) {
      return { pronto: false, razao: periodo.razao }
    }
  }
  // FORA DA FAIXA é pior que faltando: o saneamento da URL descarta o valor inválido, o
  // servidor aplica o padrão dele (60 dias) e o relatório sai com OUTRO recorte, sem avisar.
  // Antes, quem digitava 999 batia no balão do navegador e o botão não dizia nada (CRR-16).
  if (campoAparece(relatorio, 'dias', parametros.situacao) && (parametros.dias ?? '') !== '') {
    const dias = Number(parametros.dias)
    if (!Number.isInteger(dias) || dias < DIAS_MINIMO || dias > DIAS_MAXIMO) {
      return {
        pronto: false,
        razao: `Os dias sem atendimento vão de ${String(DIAS_MINIMO)} a ${String(DIAS_MAXIMO)}.`,
      }
    }
  }
  // o período já foi cobrado acima, com a razão dele; aqui ficam o mês e os dias
  for (const campo of camposExigidos(relatorio, parametros.situacao)) {
    if (PARAMETROS_DO_CAMPO[campo].some((chave) => (parametros[chave] ?? '') === '')) {
      return { pronto: false, razao: RAZAO_DO_CAMPO[campo] }
    }
  }
  // o `dividir_por` é `required_if:resultado,sintetico` na API: sintético sem divisão é 422
  if (parametros.resultado === 'sintetico' && relatorio.divisoes !== undefined && (parametros.dividir_por ?? '') === '') {
    return { pronto: false, razao: 'Escolha por onde dividir o resultado sintético.' }
  }
  for (const filtro of relatorio.obrigatorios ?? []) {
    if (filtro === 'periodo') {
      continue
    }
    const valor = parametros[PARAMETRO_DO_FILTRO[filtro]]
    if (valor === undefined || valor === '') {
      return { pronto: false, razao: RAZAO_DO_OBRIGATORIO[filtro] ?? 'Preencha os filtros obrigatórios.' }
    }
  }

  return { pronto: true }
}
