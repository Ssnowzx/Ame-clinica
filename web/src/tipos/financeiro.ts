import type { ContatoDoPaciente, EnderecoDoPaciente } from '@/tipos/cadastros'

/**
 * O dinheiro da clínica (§9): lançamentos de caixa e o extrato do fluxo.
 *
 * **Valores monetários chegam como STRING decimal — nunca float (D1).** A tela os
 * FORMATA para exibição (BRL/pt-BR) e não os recalcula: `liquido` e os totais do
 * extrato vêm calculados pelo servidor (`bcadd`/`bcsub`). Duas contas para o mesmo
 * número garantem que uma delas estará errada na hora errada.
 */

export type TipoLancamento = 'receita' | 'despesa'
export type InteressadoTipo = 'paciente' | 'fornecedor' | 'funcionario'

/** Interessado via whitelist do servidor (T-fin-21): `{tipo, id, nome}` — nunca o cadastro. */
export interface InteressadoDoLancamento {
  tipo: InteressadoTipo
  id: number
  nome: string | null
}

/**
 * Um lançamento de caixa. `obs` é **detail-only** (texto livre sensível): só vem no
 * `show`, nunca na listagem — a tela não o reintroduz na lista. `pago_em`,
 * `grupo_parcelamento`, `parcela`, `parcelas_total` são SERVER-SET.
 */
export interface LancamentoCaixa {
  id: number
  tipo: TipoLancamento
  /** `Y-m-d` */
  competencia: string
  /** `Y-m-d` */
  vencimento: string
  categoria_id: number
  subcategoria_id: number | null
  /** decimal string — nunca float (D1) */
  valor: string
  juros: string
  multa: string
  desconto: string
  /** CALCULADO pelo servidor: valor + juros + multa − desconto (T-fin-06) */
  liquido: string
  tipo_pagamento_id: number
  conta_id: number
  contabil: boolean
  documento: string | null
  agendamento_id: number | null
  grupo_parcelamento: string | null
  parcela: number | null
  parcelas_total: number | null
  /** `"Y-m-d H:i"` quando pago; `null` em aberto — a situação de pagamento */
  pago_em: string | null
  interessado?: InteressadoDoLancamento
  /** DETAIL-ONLY: presente só no `show`. Texto livre — sempre escapado ao renderizar. */
  obs?: string | null
  tratamento_id?: number | null
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/**
 * O DETALHE do lançamento — `GET /lancamentos/{id}`.
 *
 * Tipo próprio pelo mesmo motivo do atendimento: `em_ciclo_fechado` **não existe na
 * listagem** (SEC-FC-09 — seriam 100 consultas por página, e a lista não tem as ações que
 * ele governa). Declará-lo opcional na `LancamentoCaixa` faria a linha da lista ler
 * `undefined` e concluir "aberto" — um "pode editar" afirmado por ausência de dado.
 */
export interface LancamentoCaixaDetalhe extends LancamentoCaixa {
  /** Derivado pelo servidor a partir da `competencia` do lançamento (D3). */
  em_ciclo_fechado: boolean
  /**
   * O tratamento do dinheiro (change `recebido-por-profissional`). OBRIGATÓRIO no detalhe: o
   * `show` sempre o manda, e é por ele que o formulário decide o que mostrar e o que enviar.
   * Opcional aqui, um fixture sem o campo faria a tela concluir "sem vínculo" por ausência de dado.
   */
  tratamento_id: number | null
  /**
   * Quem abriu a cobrança pelo WhatsApp por último, e quando (change `cobranca-pelo-whatsapp`).
   * OBRIGATÓRIO no detalhe pelo mesmo motivo do `tratamento_id`: ausente, a tela concluiria "a
   * família nunca foi lembrada" — e é esse engano que o registro existe para evitar.
   */
  ultima_cobranca: UltimaCobranca | null
}

/**
 * A linha da LISTAGEM (`GET /lancamentos`). `tem_anexo` só existe aqui: o `show` não o traz, e o
 * detalhe mostra a seção Anexos inteira (change `anexo-no-lancamento`).
 */
export interface LancamentoDaLista extends LancamentoCaixa {
  tem_anexo: boolean
}

/**
 * O que `POST /lancamentos` devolve: o lançamento criado, ou — no parcelado (D4) — o envelope com
 * as parcelas materializadas. É pelo `pago_em` DAQUI que a tela anuncia "pago" (CR-CDD-06), nunca
 * pelo que ela pediu.
 */
export type CriacaoDeLancamento =
  | LancamentoCaixa
  | { criados: number; grupo_parcelamento: string | null; lancamentos: LancamentoCaixa[] }

/** A última cobrança aberta — sem telefone nem texto: só quando e por quem. */
export interface UltimaCobranca {
  /** `Y-m-d H:i`, na parede da clínica */
  em: string
  /** `null` = o usuário que cobrou não existe mais */
  por: string | null
}

/**
 * Um responsável da criança COM telefone válido (change `cobranca-pelo-whatsapp`, D2). O
 * telefone já vem no formato do link do WhatsApp (DDI 55, só dígitos) e a mensagem já vem
 * preenchida pelo servidor. Nenhum dos dois vai para log nem para armazenamento do navegador.
 */
export interface ResponsavelCobravel {
  nome: string
  parentesco: string
  telefone: string
  mensagem: string
}

/** `GET /lancamentos/{id}/cobranca` — sob `lancamentos.ver` E `pacientes.ver`. */
export interface CobrancaDoLancamento {
  lancamento_id: number
  /** Vazia quando nenhum responsável tem telefone válido. */
  responsaveis: ResponsavelCobravel[]
  ultima_cobranca: UltimaCobranca | null
}

/**
 * Um arquivo anexado ao lançamento (change `anexo-no-lancamento`): só METADADOS — o conteúdo
 * desce pelo download autenticado, nunca por URL de armazenamento.
 */
export interface AnexoDoLancamento {
  id: number
  nome: string
  mime: string
  /** bytes do arquivo ORIGINAL (exibição) */
  tamanho: number
  /** `Y-m-d H:i` */
  criado_em: string
  criado_por: { id: number; nome: string } | null
}

export interface FiltroDeLancamentos {
  tipo?: TipoLancamento
  /** `true` = pagos; `false` = em aberto; ausente = ambos */
  pago?: boolean
  conta_id?: number
  /** `Y-m-d` — filtra por vencimento no SERVIDOR (filtrar após paginar erraria) */
  de?: string
  ate?: string
  /** Filtro por interessado — tipo e id JUNTOS (a seção Financeiro da ficha o fixa no paciente) */
  interessado_tipo?: InteressadoTipo
  interessado_id?: number
  pagina?: number
}

/**
 * O que a tela ENVIA. Valores monetários como string decimal. `parcelas` só na
 * criação (a API a recusa no PUT — o parcelamento é materializado, D4). Campos
 * acessórios vazios são OMITIDOS do payload, nunca enviados como `""`.
 */
export interface PayloadLancamento {
  tipo: TipoLancamento
  competencia: string
  vencimento: string
  interessado_tipo: InteressadoTipo | null
  interessado_id: number | null
  categoria_id: number
  subcategoria_id: number | null
  valor: string
  juros?: string
  multa?: string
  desconto?: string
  tipo_pagamento_id: number
  conta_id: number
  /**
   * Flag contábil (§9). OMITIDA na criação quando o usuário não a toca — a API
   * aplica `financeiro.contabil_padrao` da clínica (§13). Enviá-la sempre
   * sobrescreveria o padrão configurável em silêncio.
   */
  contabil?: boolean
  documento: string | null
  obs: string | null
  /** ≥ 2; só na criação */
  parcelas?: number
  /**
   * "Já foi pago" (change `caixa-do-dia-a-dia`, D1): o lançamento nasce pago na MESMA transação
   * que o cria, com `pago_em` do servidor. Só na criação, só no lançamento único (a API recusa
   * com parcelas ≥ 2) e só para quem pode dar baixa. AUSENTE quando desmarcado: nada muda.
   */
  pagar_agora?: boolean
  /**
   * O tratamento DA criança interessada (change `recebido-por-profissional`): é por ele que o
   * pagamento chega ao profissional. `null` = sem vínculo. AUSENTE no lançamento faturado pela
   * agenda: aquele vínculo é do servidor, e a tela não o reenvia.
   */
  tratamento_id?: number | null
}

/**
 * O que a edição de um lançamento PAGO envia — e nada além.
 *
 * O servidor recusa o `PUT` do pago quando o corpo CONTÉM qualquer chave financeira, mesmo com o
 * valor igual (T-fin-09). Mandar o lançamento inteiro, como a edição do aberto faz, derrubava
 * toda edição do pago pela tela, até a da observação. `tratamento_id` fica fora no faturado
 * pela agenda, pela mesma razão do `PayloadLancamento`.
 */
export interface PayloadLancamentoPago {
  tratamento_id?: number | null
  documento: string | null
  obs: string | null
}

// ── Vínculo pagamento → tratamento conduzido (change `vincular-pagamentos-ao-tratamento`) ──

/**
 * `GET /lancamentos/sugestao-de-tratamento?paciente_id=`. Há sugestão só quando a criança tem
 * EXATAMENTE um tratamento particular em andamento (design D1) — a regra é do servidor, e a tela
 * nunca a refaz. É sugestão: quem lança confirma ao salvar (D2).
 */
export interface SugestaoDeTratamento {
  tratamento_id: number | null
}

/** A sugestão de uma linha do lote, já com os nomes (o servidor manda `''` quando não há nome). */
export interface SugestaoDoPagamento {
  tratamento_id: number
  especialidade: string
  profissional: string
  convenio: string
}

/** Uma receita PAGA de criança, sem sessão e sem tratamento — `GET /lancamentos/sem-tratamento`. */
export interface PagamentoSemTratamento {
  id: number
  /** `"Y-m-d H:i"` — a régua do "Recebido por profissional" */
  pago_em: string
  /** decimal string — nunca float (D1) */
  liquido: string
  paciente: { id: number; nome: string }
  sugestao: SugestaoDoPagamento | null
  /** Os tratamentos da criança no escopo de quem pede — vazio = não há o que escolher. */
  tratamentos_da_crianca: TratamentoDaCrianca[]
}

/** Um tratamento da criança na lista do lote: o bastante para o rótulo do caixa. */
export interface TratamentoDaCrianca {
  id: number
  especialidade_id: number
  profissional_id: number
  convenio_id: number
  sessoes_total: number
  sessoes_saldo: number
  vencido: boolean
  status: string
}

export interface PagamentosSemTratamento {
  data: PagamentoSemTratamento[]
  contagem: number
  /** O servidor cortou a lista no teto de linhas — há mais no período. */
  truncado: boolean
}

/** Um par do lote. O servidor aplica tudo ou nada (design D3). */
export interface VinculoDoLote {
  lancamento_id: number
  tratamento_id: number
}

// ── Fluxo de caixa (extrato em regime de caixa, D6) ──────────────────────────

/**
 * Um movimento do extrato: lançamento pago OU transferência entre contas. A
 * transferência é movimento PRÓPRIO — NUNCA entra em entradas/saídas (T-fin-19).
 */
export interface MovimentoDeCaixa {
  movimento: TipoLancamento | 'transferencia'
  // lançamento pago:
  lancamento_id?: number
  conta_id?: number
  categoria_id?: number
  valor_liquido?: string
  /** `"Y-m-d H:i"` */
  pago_em?: string
  interessado?: InteressadoDoLancamento | null
  // transferência:
  transferencia_id?: number
  conta_origem_id?: number
  conta_destino_id?: number
  valor?: string
  /** `Y-m-d` */
  data?: string
  /**
   * O saldo DEPOIS deste movimento (change `saldo-das-contas`, D3), acumulado pelo servidor na
   * ordem em que os movimentos chegam: o da conta filtrada, ou o da clínica sem conta. A tela
   * só desenha — nunca soma.
   */
  saldo: string
}

export interface ExtratoDeCaixa {
  de: string
  ate: string
  conta_id: number | null
  /** O saldo no fim do dia anterior a `de` — a primeira linha do extrato parte dele. */
  saldo_anterior: string
  /** Em ordem cronológica, JÁ ordenados pelo servidor (o saldo corrido depende da ordem). */
  movimentos: MovimentoDeCaixa[]
  /** Totais CALCULADOS pelo servidor — a tela exibe, não soma */
  totais: {
    entradas: string
    saidas: string
    saldo_do_periodo: string
    /** fora de entradas/saídas (T-fin-19) */
    transferido: string
  }
}

// ── Saldo das contas (change `saldo-das-contas`) ────────────────────────────

/**
 * Uma conta com o saldo no FIM do dia pedido: a abertura, mais o que foi pago e transferido
 * desde ela. Sob `fluxo_caixa.ver` — é o dinheiro da clínica, e a listagem comum de contas não
 * traz a abertura.
 */
export interface SaldoDaConta {
  id: number
  nome: string
  /** A inativa só vem com saldo diferente de zero: dinheiro não some da soma. */
  ativo: boolean
  /** decimal string — nunca float (D1) */
  saldo: string
  /** O valor de abertura (pode ser negativo: cheque especial). */
  saldo_inicial: string
  /** `Y-m-d` do dia da abertura; `null` = a conta nunca teve abertura e parte de zero. */
  saldo_inicial_em: string | null
  /** token da concorrência otimista (If-Match) do `PUT` da abertura */
  updated_at: string
}

export interface SaldosDasContas {
  /** `Y-m-d` — o dia do saldo; sem pedir, HOJE no fuso da clínica. */
  em: string
  contas: SaldoDaConta[]
  /** A soma das contas, feita pelo SERVIDOR. */
  total: string
}

export interface PayloadSaldoDeAbertura {
  /** decimal string, pode ser negativo */
  saldo_inicial: string
  /** `Y-m-d`; `null` = sem data (a abertura vale desde sempre) */
  saldo_inicial_em: string | null
}

export interface SaldoDeAbertura extends PayloadSaldoDeAbertura {
  id: number
  updated_at: string
}

// ── Catálogos que o formulário consome (payload REAL da API) ─────────────────

/**
 * `updated_at` é o token do `If-Match` (concorrência otimista): as quatro controladoras
 * financeiras exigem a versão lida no PUT, como as dos catálogos clínicos. Ele vem no
 * JSON cru desde sempre — a tela de cadastro é a primeira a precisar dele declarado.
 */
export interface ContaFinanceira {
  id: number
  nome: string
  codigo_contabil: string | null
  ativo: boolean
  updated_at: string
}

export interface TipoDePagamento {
  id: number
  nome: string
  updated_at: string
}

export interface SubcategoriaFinanceira {
  id: number
  nome: string
  categoria_id: number
  /** exportação ao contador (§9) */
  codigo_contabil: string | null
  updated_at: string
}

/** Categoria com a natureza (`tipo`) que a coerência categoria×tipo exige (T-fin-11). */
export interface CategoriaFinanceira {
  id: number
  nome: string
  tipo: TipoLancamento
  subcategorias: SubcategoriaFinanceira[]
  updated_at: string
}

/** Crédito ou débito — o `Cartao::TIPOS` do servidor. */
export type TipoDeCartao = 'credito' | 'debito'

/**
 * Cartão como CADASTRO: a taxa, os dias de recebimento e a liquidação automática
 * ficam guardados, mas a engine de recebíveis é fase 2 (spec `financeiro-cadastros`).
 * `pct_a_vista` é string decimal como todo dinheiro/percentual da casa (D1).
 */
export interface CartaoFinanceiro {
  id: number
  nome: string
  tipo: TipoDeCartao
  /** Catálogo GLOBAL e fechado (as operadoras não são dado da clínica) — nunca `null` vira erro. */
  bandeira: Bandeira | null
  pct_a_vista: string
  /**
   * A taxa por faixa de parcelamento, só as que a operadora cobra — chave ausente é
   * "não preenchida", nunca `undefined` de valor. "12" significa "12x ou mais".
   */
  pct_parcelas: Partial<Record<RotuloDeParcela, string>> | null
  dias_recebimento: number
  conta_id: number
  liquidar_auto: boolean
  /** Cadastro (T-fin-03): nenhum cálculo de custo de antecipação lê este campo ainda. */
  antecipacao_credito: boolean
  updated_at: string
}

/** `Cartao::BANDEIRAS` do servidor — catálogo fechado, nunca cadastro da clínica. */
export type Bandeira = 'visa' | 'mastercard' | 'elo' | 'hipercard' | 'amex' | 'banescard' | 'outra'

/** `Cartao::PARCELAS` do servidor — "12" é "12x ou mais". */
export type RotuloDeParcela = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12'

export interface PayloadConta {
  nome: string
  codigo_contabil: string | null
  ativo: boolean
}

export interface PayloadTipoPagamento {
  nome: string
}

export interface PayloadCategoria {
  nome: string
  tipo: TipoLancamento
}

export interface PayloadSubcategoria {
  nome: string
  codigo_contabil: string | null
}

export interface PayloadCartao {
  nome: string
  tipo: TipoDeCartao
  /**
   * SEMPRE presente (nunca `undefined`) — `null` é como se LIMPA a bandeira. Uma chave
   * ausente e um `PUT` com `sometimes` no servidor significam a MESMA coisa: "não mexi
   * nisso". Omitir a chave ao escolher "Nenhuma" fazia o servidor preservar o valor
   * antigo em silêncio — o "limpar" nunca chegava a limpar nada (achado do gate).
   */
  bandeira: Bandeira | null
  pct_a_vista: string
  /**
   * SEMPRE presente, mesmo `{}` quando nenhuma faixa está preenchida — pela mesma razão
   * de `bandeira`: omitir a chave ao apagar a ÚLTIMA faixa preservava as parcelas antigas
   * no servidor (achado do gate).
   */
  pct_parcelas: Partial<Record<RotuloDeParcela, string>>
  dias_recebimento: number
  conta_id: number
  liquidar_auto: boolean
  antecipacao_credito: boolean
}

/**
 * Faturamento da sessão pela agenda (change faturar-pelo-painel-da-agenda):
 * `POST /api/agendamentos/{id}/faturamento`. NÃO tem `valor` — o preço vem da tabela
 * de serviços do tratamento e a API recusa o campo (T-fin-15). Só o que a rota exige
 * (categoria de receita, forma de pagamento, conta) e o que ela aceita como opcional.
 */
export interface PayloadFaturamento {
  categoria_id: number
  subcategoria_id?: number
  tipo_pagamento_id: number
  conta_id: number
  /** decimal string — nunca float (D1) */
  desconto?: string
  /** `Y-m-d` */
  vencimento?: string
  obs?: string
  documento?: string
  /** "Já foi pago" (change `caixa-do-dia-a-dia`): a sessão nasce faturada E paga. Ausente = só fatura. */
  pagar_agora?: boolean
}

/** O que o faturamento devolve: o lançamento criado, com `liquido` calculado pelo servidor. */
export type LancamentoFaturado = LancamentoCaixa

// ── A quem a clínica paga: fornecedores e funcionários (change `caixa-do-dia-a-dia`) ──

/** O recorte das duas listas: a busca vai ao SERVIDOR (razão social/nome fantasia, ou nome). */
export interface FiltroDeInteressados {
  busca: string
  pagina: number
}

/**
 * A LINHA da lista de fornecedores — minimizada pela própria API (T-fin-05): documento,
 * contatos e endereço são só do detalhe. Sem `updated_at`: a edição relê o cadastro.
 */
export interface FornecedorDaLista {
  id: number
  razao_social: string
  nome_fantasia: string | null
  /** A categoria PADRÃO: preenche a categoria da despesa quando ela está vazia (design D6). */
  categoria_id: number | null
  subcategoria_id: number | null
  centro_custo: string | null
  ativo: boolean
}

/**
 * O DETALHE do fornecedor — `GET /fornecedores/{id}`. Contatos e endereço seguem a MESMA
 * whitelist do paciente (trait `ValidaContatosEEndereco`), daí os tipos reaproveitados.
 */
export interface Fornecedor extends FornecedorDaLista {
  /** Só dígitos: CPF (11) ou CNPJ (14) — o dígito verificador é conferido pelo servidor. */
  cpf_cnpj: string | null
  contatos_json: ContatoDoPaciente[] | null
  endereco_json: EnderecoDoPaciente | null
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

export interface PayloadFornecedor {
  razao_social: string
  nome_fantasia: string | null
  cpf_cnpj: string | null
  categoria_id: number | null
  subcategoria_id: number | null
  centro_custo: string | null
  ativo: boolean
  /** Ausentes no cadastro rápido: o formulário curto não os desenha e não os envia. */
  contatos_json?: ContatoDoPaciente[]
  endereco_json?: EnderecoDoPaciente | null
}

/** A LINHA da lista de funcionários — minimizada pela API, como a de fornecedores. */
export interface FuncionarioDaLista {
  id: number
  nome: string
  funcao: string
  ativo: boolean
}

/** O DETALHE do funcionário. É registro operacional (§9), NÃO usuário do sistema. */
export interface Funcionario extends FuncionarioDaLista {
  /** Só dígitos (11), com o dígito verificador conferido pelo servidor. */
  cpf: string | null
  /** `Y-m-d` */
  nascimento: string | null
  contatos_json: ContatoDoPaciente[] | null
  endereco_json: EnderecoDoPaciente | null
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

export interface PayloadFuncionario {
  nome: string
  funcao: string
  cpf: string | null
  nascimento: string | null
  ativo: boolean
  /** Ausentes no cadastro rápido: o formulário curto não os desenha e não os envia. */
  contatos_json?: ContatoDoPaciente[]
  endereco_json?: EnderecoDoPaciente | null
}

// ── Transferência entre contas (T-fin-19): o dinheiro muda de lugar, não é receita nem despesa ──

/** `GET /transferencias/{id}` — o que a edição pela linha do Fluxo precisa (o extrato não traz `obs`). */
export interface Transferencia {
  id: number
  conta_origem_id: number
  conta_destino_id: number
  /** decimal string — nunca float (D1) */
  valor: string
  /** `Y-m-d` */
  data: string
  obs: string | null
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

export interface PayloadTransferencia {
  conta_origem_id: number
  conta_destino_id: number
  /** decimal string — nunca float (D1) */
  valor: string
  /** `Y-m-d` */
  data: string
  obs: string | null
}
