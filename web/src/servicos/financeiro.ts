import { garantirCsrf, http, putComVersao } from '@/lib/http'
import { recursoDeCatalogo } from '@/lib/recurso-de-catalogo'
import type {
  CartaoFinanceiro,
  CategoriaFinanceira,
  ContaFinanceira,
  CriacaoDeLancamento,
  ExtratoDeCaixa,
  FiltroDeInteressados,
  FiltroDeLancamentos,
  Fornecedor,
  FornecedorDaLista,
  Funcionario,
  FuncionarioDaLista,
  InteressadoTipo,
  LancamentoCaixa,
  LancamentoCaixaDetalhe,
  LancamentoDaLista,
  LancamentoFaturado,
  PaginaDeApi,
  PagamentosSemTratamento,
  PayloadCartao,
  PayloadCategoria,
  PayloadConta,
  PayloadFaturamento,
  PayloadFornecedor,
  PayloadFuncionario,
  PayloadLancamento,
  PayloadLancamentoPago,
  PayloadSaldoDeAbertura,
  PayloadSubcategoria,
  PayloadTipoPagamento,
  PayloadTransferencia,
  SaldoDeAbertura,
  SaldosDasContas,
  SubcategoriaFinanceira,
  SugestaoDeTratamento,
  TipoDePagamento,
  Transferencia,
  VinculoDoLote,
} from '@/tipos'

/**
 * O dinheiro da clínica (§9). Os valores chegam como STRING decimal e `liquido`/
 * os totais do extrato vêm calculados do servidor — a tela exibe, nunca refaz a
 * conta (D1). Mutação sempre depois de `garantirCsrf()` (padrão de `tratamentos`).
 */
export async function listarLancamentos(
  filtro: FiltroDeLancamentos = {},
): Promise<PaginaDeApi<LancamentoDaLista>> {
  const { data } = await http.get<PaginaDeApi<LancamentoDaLista>>('/api/lancamentos', {
    params: {
      page: filtro.pagina ?? 1,
      ...(filtro.tipo !== undefined ? { tipo: filtro.tipo } : {}),
      ...(filtro.pago !== undefined ? { pago: filtro.pago ? 1 : 0 } : {}),
      ...(filtro.conta_id !== undefined ? { conta_id: filtro.conta_id } : {}),
      ...(filtro.de !== undefined ? { de: filtro.de } : {}),
      ...(filtro.ate !== undefined ? { ate: filtro.ate } : {}),
      // interessado: tipo e id sempre JUNTOS (o servidor recusa um sem o outro)
      ...(filtro.interessado_tipo !== undefined && filtro.interessado_id !== undefined
        ? { interessado_tipo: filtro.interessado_tipo, interessado_id: filtro.interessado_id }
        : {}),
    },
  })
  return data
}

/**
 * `obs` só existe AQUI (a listagem a omite — texto livre sensível, T-fin §1.3), e
 * `em_ciclo_fechado` também (SEC-FC-09). Daí o retorno ser `LancamentoCaixaDetalhe`.
 */
export async function buscarLancamento(id: number): Promise<LancamentoCaixaDetalhe> {
  const { data } = await http.get<LancamentoCaixaDetalhe>(`/api/lancamentos/${id}`)
  return data
}

/**
 * Cria um lançamento — ou N parcelas materializadas (D4). Na criação parcelada a
 * API devolve um envelope `{ criados, lancamentos }`. O corpo volta para quem chamou: é o
 * `pago_em` da RESPOSTA que diz se a baixa aconteceu (CR-CDD-06), não o `pagar_agora` pedido.
 */
export async function criarLancamento(payload: PayloadLancamento): Promise<CriacaoDeLancamento> {
  await garantirCsrf()
  const { data } = await http.post<CriacaoDeLancamento>('/api/lancamentos', payload)
  return data
}

/**
 * Edita — o lançamento inteiro quando está em aberto; SÓ o que o pago aceita mudar quando
 * está pago (`PayloadLancamentoPago`: o servidor recusa chave financeira no corpo do pago).
 */
export async function atualizarLancamento(
  id: number,
  payload: PayloadLancamento | PayloadLancamentoPago, versao: string): Promise<LancamentoCaixa> {
  const data = await putComVersao<LancamentoCaixa>(`/api/lancamentos/${id}`, payload, versao)
  return data
}

/** Exclui — só de NÃO-pago (a API recusa o pago). `aplicarNoGrupo` estende às parcelas. */
export async function excluirLancamento(id: number, aplicarNoGrupo = false): Promise<void> {
  await garantirCsrf()
  await http.delete(`/api/lancamentos/${id}`, {
    params: aplicarNoGrupo ? { aplicar_no_grupo: 1 } : {},
  })
}

/** Dar baixa (transição própria, sob `lancamentos.pagar`). */
export async function pagarLancamento(id: number): Promise<LancamentoCaixa> {
  await garantirCsrf()
  const { data } = await http.post<LancamentoCaixa>(`/api/lancamentos/${id}/pagamento`)
  return data
}

export async function estornarPagamento(id: number): Promise<LancamentoCaixa> {
  await garantirCsrf()
  const { data } = await http.delete<LancamentoCaixa>(`/api/lancamentos/${id}/pagamento`)
  return data
}

/**
 * A sugestão do tratamento de um pagamento de criança (`tratamentos.ver`). A regra — um só
 * tratamento particular em andamento — é do servidor; a tela só a oferece.
 */
export async function buscarSugestaoDeTratamento(pacienteId: number): Promise<SugestaoDeTratamento> {
  const { data } = await http.get<SugestaoDeTratamento>('/api/lancamentos/sugestao-de-tratamento', {
    params: { paciente_id: pacienteId },
  })
  return data
}

/** As receitas pagas no período sem tratamento, cada uma com a sugestão (quando há). */
export async function listarPagamentosSemTratamento(de: string, ate: string): Promise<PagamentosSemTratamento> {
  const { data } = await http.get<PagamentosSemTratamento>('/api/lancamentos/sem-tratamento', {
    params: { de, ate },
  })
  return data
}

/** O lote, tudo ou nada: um item recusado devolve 422 em `vinculos.{i}` e nada é gravado. */
export async function vincularTratamentos(vinculos: readonly VinculoDoLote[]): Promise<{ vinculados: number }> {
  await garantirCsrf()
  const { data } = await http.post<{ vinculados: number }>('/api/lancamentos/vincular-tratamentos', { vinculos })
  return data
}

/** Extrato em regime de caixa (D6): totais somados no servidor. */
export async function buscarFluxoCaixa(
  de: string,
  ate: string,
  contaId?: number,
): Promise<ExtratoDeCaixa> {
  const { data } = await http.get<ExtratoDeCaixa>('/api/fluxo-caixa', {
    params: { de, ate, ...(contaId !== undefined ? { conta_id: contaId } : {}) },
  })
  return data
}

/**
 * Quanto tem em cada conta (change `saldo-das-contas`): o saldo no fim de HOJE no fuso da
 * clínica — quem decide o "hoje" é o servidor, não o relógio do aparelho. Somado lá, em decimal.
 */
export async function buscarSaldosDasContas(): Promise<SaldosDasContas> {
  const { data } = await http.get<SaldosDasContas>('/api/contas/saldos')
  return data
}

/**
 * Define o saldo de abertura (rota própria, fora do CRUD da conta: exige editar contas E ver o
 * fluxo de caixa). Leva no `If-Match` o `updated_at` lido nos saldos.
 */
export function definirSaldoDeAbertura(
  contaId: number,
  payload: PayloadSaldoDeAbertura,
  versao: string,
): Promise<SaldoDeAbertura> {
  return putComVersao<SaldoDeAbertura>(`/api/contas/${contaId}/saldo-de-abertura`, payload, versao)
}

// ── Catálogos do dinheiro: as telas de cadastro e os seletores do lançamento ──

/**
 * Os quatro catálogos financeiros têm o CRUD de sempre — e ficam AQUI, e não junto
 * dos catálogos clínicos, porque compartilham com o lançamento os tipos e, sobretudo,
 * as CHAVES de query: criar uma conta na tela de Cadastros precisa invalidar o seletor
 * de conta do formulário de lançamento. Duas chaves para a mesma lista é a receita do
 * seletor que não vê o que acabou de ser cadastrado.
 */
export const contas = recursoDeCatalogo<ContaFinanceira, PayloadConta>('/api/contas')
export const tiposPagamento = recursoDeCatalogo<TipoDePagamento, PayloadTipoPagamento>(
  '/api/tipos-pagamento',
)
export const categorias = recursoDeCatalogo<CategoriaFinanceira, PayloadCategoria>('/api/categorias')
export const cartoes = recursoDeCatalogo<CartaoFinanceiro, PayloadCartao>('/api/cartoes')

export const listarContas = contas.listar
export const listarCategorias = categorias.listar
export const listarTiposPagamento = tiposPagamento.listar

/**
 * Subcategorias são AGREGADO da categoria: nascem por dentro dela
 * (`POST /categorias/{id}/subcategorias`) e depois são endereçadas sozinhas.
 *
 * `listar` não tem endpoint próprio — e não precisa: o `GET /categorias` já traz as
 * subcategorias embutidas. Ler a mãe e filtrar mantém UMA fonte para as duas telas e
 * faz a invalidação de `chaves.categorias()` alcançar, de uma vez, a lista de
 * categorias, a página da categoria e o seletor de subcategoria do lançamento.
 */
export function subcategoriasDe(categoriaId: number) {
  const recurso = recursoDeCatalogo<SubcategoriaFinanceira, PayloadSubcategoria>(
    `/api/categorias/${categoriaId}/subcategorias`,
  )

  return {
    ...recurso,
    listar: async (): Promise<SubcategoriaFinanceira[]> => {
      const todas = await categorias.listar()
      return todas.find((categoria) => categoria.id === categoriaId)?.subcategorias ?? []
    },
    // editar e excluir endereçam a subcategoria direto, fora da rota aninhada
    atualizar: (id: number, payload: PayloadSubcategoria, versao: string) =>
      putComVersao<SubcategoriaFinanceira>(`/api/subcategorias/${id}`, payload, versao),
    excluir: async (id: number): Promise<void> => {
      await garantirCsrf()
      await http.delete(`/api/subcategorias/${id}`)
    },
  }
}

export interface OpcaoInteressado {
  id: number
  nome: string
  /**
   * A categoria PADRÃO do fornecedor (design D6) — a listagem já a traz. Ausente para paciente e
   * funcionário: só o fornecedor tem categoria de despesa associada.
   */
  categoria_id?: number | null
  subcategoria_id?: number | null
}

/**
 * Busca o interessado por tipo, cada um sob a sua permissão de leitura
 * (`pacientes.ver` / `fornecedores.ver` / `funcionarios.ver`). O componente só a
 * dispara quando o autor tem a permissão — sem ela, nem oferece a busca. O nome do
 * paciente é o dado mínimo (a lista já o traz por whitelist); CPF fica no recibo.
 */
export async function buscarInteressados(
  tipo: InteressadoTipo,
  busca: string,
): Promise<OpcaoInteressado[]> {
  if (tipo === 'paciente') {
    const { data } = await http.get<PaginaDeApi<{ id: number; nome: string; nome_social: string | null }>>(
      '/api/pacientes',
      { params: { busca } },
    )
    return data.data.map((paciente) => ({ id: paciente.id, nome: paciente.nome_social ?? paciente.nome }))
  }
  if (tipo === 'fornecedor') {
    const { data } = await http.get<PaginaDeApi<FornecedorDaLista>>('/api/fornecedores', { params: { busca } })
    return data.data.map((fornecedor) => ({
      id: fornecedor.id,
      nome: fornecedor.razao_social,
      categoria_id: fornecedor.categoria_id,
      subcategoria_id: fornecedor.subcategoria_id,
    }))
  }
  // /funcionarios também é PAGINADO (envelope {data,...}), não array cru
  const { data } = await http.get<PaginaDeApi<{ id: number; nome: string }>>('/api/funcionarios', {
    params: { busca },
  })
  return data.data.map((funcionario) => ({ id: funcionario.id, nome: funcionario.nome }))
}

// ── Recibo: identidade da clínica + documento do interessado ─────────────────
// Leituras JÁ gated; a tela só as chama quando o autor tem a permissão. Campo
// ausente (sem permissão / não cadastrado) é OMITIDO no recibo, nunca fabricado.

/** Nome da clínica de `GET /configuracoes` (chave `clinica.nome`); `null` se ausente. */
export async function buscarNomeDaClinica(): Promise<string | null> {
  const { data } = await http.get<{ configuracoes: Array<{ chave: string; valor: unknown }> }>(
    '/api/configuracoes',
  )
  const linha = data.configuracoes.find((config) => config.chave === 'clinica.nome')
  return typeof linha?.valor === 'string' && linha.valor !== '' ? linha.valor : null
}

export interface DocumentoDoInteressado {
  nome: string | null
  /** CPF (paciente/funcionário) ou CPF/CNPJ (fornecedor); `null` se não cadastrado */
  documento: string | null
}

/**
 * Documento do interessado para o recibo, por tipo — cada leitura sob a sua
 * permissão (`pacientes.ver` / `fornecedores.ver` / `funcionarios.ver`). O
 * chamador só a dispara quando o autor pode ler; sem isso, o recibo omite.
 */
export async function buscarDocumentoDoInteressado(
  tipo: InteressadoTipo,
  id: number,
): Promise<DocumentoDoInteressado> {
  if (tipo === 'paciente') {
    const { data } = await http.get<{ nome: string; nome_social: string | null; cpf: string | null }>(
      `/api/pacientes/${id}`,
    )
    return { nome: data.nome_social ?? data.nome, documento: data.cpf }
  }
  if (tipo === 'fornecedor') {
    const { data } = await http.get<{ razao_social: string; cpf_cnpj: string | null }>(
      `/api/fornecedores/${id}`,
    )
    return { nome: data.razao_social, documento: data.cpf_cnpj }
  }
  const { data } = await http.get<{ nome: string; cpf: string | null }>(`/api/funcionarios/${id}`)
  return { nome: data.nome, documento: data.cpf }
}

/**
 * Fatura a sessão de um agendamento (change faturar-pelo-painel-da-agenda). O payload
 * NÃO leva `valor`: o preço é do servidor (T-fin-15), e quem decide se o agendamento é
 * faturável (sessão consumida, serviço definido, convênio particular, ainda não faturado)
 * é a rota — a tela só repete o motivo que ela devolver.
 */
export async function faturarAgendamento(
  agendamentoId: number,
  payload: PayloadFaturamento,
): Promise<LancamentoFaturado> {
  await garantirCsrf()
  const { data } = await http.post<LancamentoFaturado>(
    `/api/agendamentos/${agendamentoId}/faturamento`,
    payload,
  )
  return data
}

// ── A quem a clínica paga: fornecedores e funcionários (change `caixa-do-dia-a-dia`) ──

/**
 * O CRUD de um cadastro de pessoa PAGINADO e com busca no servidor — o formato que as duas rotas
 * têm, e que o `recursoDeCatalogo` (lista crua, sem busca) não cobre.
 *
 * A LISTA é minimizada pela API (T-fin-05); o DETALHE (`buscar`) traz documento, contatos,
 * endereço e o `updated_at` da concorrência otimista. A edição sempre relê o detalhe, fresco.
 */
function cadastroDePessoa<L, D, P>(caminho: string) {
  return {
    listar: async (filtro: FiltroDeInteressados): Promise<PaginaDeApi<L>> => {
      const busca = filtro.busca.trim()
      const { data } = await http.get<PaginaDeApi<L>>(caminho, {
        params: { page: filtro.pagina, ...(busca === '' ? {} : { busca }) },
      })
      return data
    },
    buscar: async (id: number): Promise<D> => {
      const { data } = await http.get<D>(`${caminho}/${id}`)
      return data
    },
    criar: async (payload: P): Promise<D> => {
      await garantirCsrf()
      const { data } = await http.post<D>(caminho, payload)
      return data
    },
    atualizar: (id: number, payload: P, versao: string): Promise<D> =>
      putComVersao<D>(`${caminho}/${id}`, payload, versao),
    /** Com lançamentos, o servidor recusa (422 "…inative-o"): o histórico fiscal fica. */
    excluir: async (id: number): Promise<void> => {
      await garantirCsrf()
      await http.delete(`${caminho}/${id}`)
    },
  }
}

export const fornecedores = cadastroDePessoa<FornecedorDaLista, Fornecedor, PayloadFornecedor>(
  '/api/fornecedores',
)
export const funcionarios = cadastroDePessoa<FuncionarioDaLista, Funcionario, PayloadFuncionario>(
  '/api/funcionarios',
)

// ── Transferência entre contas (T-fin-19) ────────────────────────────────────

export async function criarTransferencia(payload: PayloadTransferencia): Promise<Transferencia> {
  await garantirCsrf()
  const { data } = await http.post<Transferencia>('/api/transferencias', payload)
  return data
}

/** A leitura da EDIÇÃO: o extrato não traz `obs` nem o `updated_at` que o `PUT` exige. */
export async function buscarTransferencia(id: number): Promise<Transferencia> {
  const { data } = await http.get<Transferencia>(`/api/transferencias/${id}`)
  return data
}

export function atualizarTransferencia(
  id: number,
  payload: PayloadTransferencia,
  versao: string,
): Promise<Transferencia> {
  return putComVersao<Transferencia>(`/api/transferencias/${id}`, payload, versao)
}

export async function excluirTransferencia(id: number): Promise<void> {
  await garantirCsrf()
  await http.delete(`/api/transferencias/${id}`)
}
