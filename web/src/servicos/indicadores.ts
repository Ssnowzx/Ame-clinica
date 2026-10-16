import { http } from '@/lib/http'
import { limitesDoMes } from '@/lib/meses'
import type {
  FiltroDeAtendimentos,
  GraficosFinanceiros,
  IndicadoresDeAtendimentos,
  IndicadoresDePacientes,
  ItemDaAgenda,
  ItemDeAtendimento,
  ItensDeIndicador,
  PainelDaAgenda,
  PainelDaEquipe,
  PainelDoDinheiro,
  PainelDosPacientes,
  ProducaoDoMes,
  ProdutividadeDoMes,
} from '@/tipos'

/**
 * As vistas do dashboard (§11) — cada uma atrás da permissão do módulo DONO (T-not-13): o bloco
 * correspondente só chama a sua com a permissão em mãos; a URL digitada à mão continua levando 403
 * do servidor.
 */

export async function buscarIndicadoresDeAtendimentos(mes: string): Promise<IndicadoresDeAtendimentos> {
  const { data } = await http.get<IndicadoresDeAtendimentos>('/api/indicadores/atendimentos', {
    params: { mes },
  })

  return data
}

export async function buscarIndicadoresDePacientes(mes: string): Promise<IndicadoresDePacientes> {
  const { data } = await http.get<IndicadoresDePacientes>('/api/indicadores/pacientes', {
    params: { mes },
  })

  return data
}

/** Produção por profissional do MÊS — reusa a vista de relatório (sob `atendimentos.ver`, escopo D11). */
export async function buscarProducaoDoMes(mes: string): Promise<ProducaoDoMes> {
  const { data } = await http.get<ProducaoDoMes>('/api/relatorios/producao-por-profissional', {
    params: limitesDoMes(mes),
  })

  return data
}

/**
 * A tela Gráficos Financeiros (§11) — rota PRÓPRIA, sob a mesma `fluxo_caixa.ver`.
 * O ano das duas séries sai do `mes`: não existe segundo parâmetro de período.
 */
export async function buscarGraficosDoFinanceiro(mes: string): Promise<GraficosFinanceiros> {
  const { data } = await http.get<GraficosFinanceiros>('/api/indicadores/financeiro/graficos', {
    params: { mes },
  })

  return data
}

/**
 * Itens do drill da agenda: um status no mês, paginado (sob `agenda.ver`, escopo D11). Com
 * `passadas`, só as sessões que JÁ PASSARAM (`inicio < agora`, no fuso da clínica) — o mesmo corte
 * da tabela "Situação das sessões que já passaram", que é de onde a porta vem (CR-IND-02). Sem ele, o
 * parâmetro nem viaja: a lista do mês inteiro continua a de sempre.
 */
export async function buscarItensDaAgenda(
  mes: string,
  statusId: number,
  pagina: number,
  passadas = false,
): Promise<ItensDeIndicador<ItemDaAgenda>> {
  const { data } = await http.get<ItensDeIndicador<ItemDaAgenda>>('/api/indicadores/agenda/itens', {
    params: { mes, status_id: statusId, page: pagina, ...(passadas ? { passadas: 1 } : {}) },
  })

  return data
}

/**
 * Itens do drill de atendimentos: o mês inteiro (a porta do TOTAL) ou UMA dimensão —
 * com a exceção deliberada do combo profissional×especialidade (pedido da clínica).
 */
export async function buscarItensDeAtendimentos(
  mes: string,
  filtro: FiltroDeAtendimentos,
  pagina: number,
): Promise<ItensDeIndicador<ItemDeAtendimento>> {
  const { data } = await http.get<ItensDeIndicador<ItemDeAtendimento>>(
    '/api/indicadores/atendimentos/itens',
    { params: { mes, ...filtro, page: pagina } },
  )

  return data
}

/** A produção por profissional (aba Equipe, §11): exige `agenda.ver` E `atendimentos.ver` — a rota confere as duas. */
export async function buscarProdutividadeDoMes(mes: string): Promise<ProdutividadeDoMes> {
  const { data } = await http.get<ProdutividadeDoMes>('/api/indicadores/produtividade', { params: { mes } })

  return data
}

/**
 * Os PAINÉIS por frente (change indicadores-profissionais, D1/D9): cada um sob a permissão do
 * módulo dono — dinheiro `fluxo_caixa.ver`, agenda `agenda.ver`, pacientes `pacientes.ver`,
 * equipe `agenda.ver` + `atendimentos.ver`. O período e a comparação vêm prontos do servidor.
 */
export async function buscarPainelDoDinheiro(mes: string): Promise<PainelDoDinheiro> {
  const { data } = await http.get<PainelDoDinheiro>('/api/indicadores/painel/dinheiro', { params: { mes } })

  return data
}

export async function buscarPainelDaAgenda(mes: string): Promise<PainelDaAgenda> {
  const { data } = await http.get<PainelDaAgenda>('/api/indicadores/painel/agenda', { params: { mes } })

  return data
}

export async function buscarPainelDosPacientes(mes: string): Promise<PainelDosPacientes> {
  const { data } = await http.get<PainelDosPacientes>('/api/indicadores/painel/pacientes', { params: { mes } })

  return data
}

export async function buscarPainelDaEquipe(mes: string): Promise<PainelDaEquipe> {
  const { data } = await http.get<PainelDaEquipe>('/api/indicadores/painel/equipe', { params: { mes } })

  return data
}
