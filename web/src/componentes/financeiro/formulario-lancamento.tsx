import { skipToken, useQuery } from '@tanstack/react-query'
import { AlertDialog } from 'radix-ui'
import { useMemo, useRef, useState, type FormEvent } from 'react'

import {
  BuscaDeInteressado,
  type InteressadoSelecionado,
} from '@/componentes/financeiro/busca-de-interessado'
import { SeloDeCicloFechado } from '@/componentes/ciclos/selo-de-ciclo-fechado'
import { SecaoAnexosDoLancamento } from '@/componentes/financeiro/anexos-do-lancamento'
import {
  CampoTratamento,
  RAZAO_DO_FATURAMENTO,
  RAZAO_DO_PAGO_SEM_BAIXA,
} from '@/componentes/financeiro/campo-tratamento'
import { AvisoDePreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { CAMINHOS } from '@/lib/caminhos-dos-cadastros'
import { CobrancaNoDetalhe } from '@/componentes/financeiro/cobranca-pelo-whatsapp'
import { ResumoDoLancamentoPago } from '@/componentes/financeiro/resumo-do-lancamento-pago'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import { usarMutacaoDeLancamento } from '@/hooks/usar-mutacao-de-lancamento'
import { chaves } from '@/lib/chaves-query'
import { paraDecimalDaApi } from '@/lib/dinheiro'
import { devolverOFoco, levarOFocoParaDentro } from '@/lib/foco-do-dialogo'
import {
  buscarSugestaoDeTratamento,
  listarCategorias,
  listarContas,
  listarTiposPagamento,
} from '@/servicos/financeiro'
import { useAuthStore } from '@/stores/auth-store'
import type {
  LancamentoCaixaDetalhe,
  PayloadLancamento,
  PayloadLancamentoPago,
  TipoLancamento,
} from '@/tipos'

interface ValoresLancamento {
  tipo: TipoLancamento
  competencia: string
  vencimento: string
  categoria_id: string
  subcategoria_id: string
  valor: string
  juros: string
  multa: string
  desconto: string
  tipo_pagamento_id: string
  conta_id: string
  contabil: boolean
  contabilTocado: boolean
  documento: string
  obs: string
  parcelas: string
  interessado: InteressadoSelecionado | null
  /** `''` = sem tratamento */
  tratamento_id: string
  /** "Já foi pago" (caixa-do-dia-a-dia) — só na criação, desmarcado por padrão */
  pagar_agora: boolean
}

function valoresIniciais(lancamento: LancamentoCaixaDetalhe | null): ValoresLancamento {
  if (lancamento === null) {
    return {
      tipo: 'receita',
      competencia: '',
      vencimento: '',
      categoria_id: '',
      subcategoria_id: '',
      valor: '',
      juros: '',
      multa: '',
      desconto: '',
      tipo_pagamento_id: '',
      conta_id: '',
      contabil: false,
      contabilTocado: false,
      documento: '',
      obs: '',
      parcelas: '',
      interessado: null,
      tratamento_id: '',
      pagar_agora: false,
    }
  }

  return {
    tipo: lancamento.tipo,
    competencia: lancamento.competencia,
    vencimento: lancamento.vencimento,
    categoria_id: String(lancamento.categoria_id),
    subcategoria_id: lancamento.subcategoria_id === null ? '' : String(lancamento.subcategoria_id),
    valor: lancamento.valor,
    juros: lancamento.juros === '0.00' ? '' : lancamento.juros,
    multa: lancamento.multa === '0.00' ? '' : lancamento.multa,
    desconto: lancamento.desconto === '0.00' ? '' : lancamento.desconto,
    tipo_pagamento_id: String(lancamento.tipo_pagamento_id),
    conta_id: String(lancamento.conta_id),
    contabil: lancamento.contabil,
    contabilTocado: true,
    documento: lancamento.documento ?? '',
    obs: lancamento.obs ?? '',
    parcelas: '',
    interessado:
      lancamento.interessado === undefined
        ? null
        : {
            tipo: lancamento.interessado.tipo,
            id: lancamento.interessado.id,
            nome: lancamento.interessado.nome ?? '',
          },
    tratamento_id: lancamento.tratamento_id === null ? '' : String(lancamento.tratamento_id),
    pagar_agora: false,
  }
}

/** O parcelamento materializa N lançamentos (D4): com 2 ou mais, cada parcela se paga no seu dia. */
function ehParcelado(parcelas: string): boolean {
  return Number(parcelas) >= 2
}

/** Por que "Já foi pago" fica indisponível no parcelado — a MESMA frase da spec, ao lado da opção. */
export const RAZAO_DO_PARCELADO_SEM_PAGAR = 'Parcelado: dê baixa em cada parcela quando for paga.'

/** O que "Já foi pago" faz (design D8): registra e dá baixa, agora. */
export const EXPLICACAO_DO_JA_PAGO = 'Registra e dá baixa agora: o lançamento já nasce pago, com a data de hoje.'

/** `""` no campo acessório → OMITIDO do payload (nunca enviado como string vazia). */
function decimalOpcional(entrada: string): string | undefined {
  const convertido = paraDecimalDaApi(entrada)
  return convertido === '' ? undefined : convertido
}

interface EntradaDaSugestao {
  /** A criança interessada; `null` = não é paciente (nada a sugerir). */
  pacienteId: number | null
  /** O tratamento no estado do formulário (`''` = vazio). */
  escolhido: string
  /** O campo é editável E o lançamento se salva daqui. */
  podeSugerir: boolean
}

interface TratamentoSugerido {
  /** O que o campo mostra e o que vai no corpo: a escolha, ou a sugestão que ninguém recusou. */
  tratamentoId: string
  /** O valor veio da sugestão — o campo mostra o selo. */
  sugerido: boolean
  /** Quem lança mexeu no campo desta criança: a sugestão não volta para ela. */
  marcarTratamentoTocado: () => void
}

/**
 * A sugestão do tratamento (change `vincular-pagamentos-ao-tratamento`, design D2): o servidor
 * sugere, a tela oferece, quem SALVA confirma. Pedida quando a criança está escolhida e o campo
 * está vazio e intocado PARA ESSA criança; quem troca ou tira vence, e a sugestão não volta para
 * aquela criança nesta abertura do formulário.
 *
 * A sugestão é DERIVADA a cada render, nunca copiada para o estado por um efeito: não existe o
 * instante em que o `<select>` mostra uma coisa e o corpo leva outra, e uma resposta atrasada não
 * atropela a escolha de quem já mexeu (a consulta desliga no primeiro toque).
 */
function useTratamentoSugerido({ pacienteId, escolhido, podeSugerir }: EntradaDaSugestao): TratamentoSugerido {
  const podeVerTratamentos = useAuthStore((estado) => estado.temPermissao('tratamentos.ver'))
  const [tocadoPara, setTocadoPara] = useState<readonly number[]>([])
  const pede =
    podeSugerir &&
    podeVerTratamentos &&
    pacienteId !== null &&
    escolhido === '' &&
    !tocadoPara.includes(pacienteId)
  const sugestao = useQuery({
    queryKey: chaves.sugestaoDeTratamento(pacienteId ?? 0),
    queryFn: pede && pacienteId !== null ? () => buscarSugestaoDeTratamento(pacienteId) : skipToken,
    // cada abertura pergunta de novo: o pacote pode ter acabado desde a última vez
    gcTime: 0,
  })
  const sugeridoId = pede ? (sugestao.data?.tratamento_id ?? null) : null

  return {
    tratamentoId: sugeridoId === null ? escolhido : String(sugeridoId),
    sugerido: sugeridoId !== null,
    marcarTratamentoTocado: () => {
      if (pacienteId !== null) {
        setTocadoPara((anteriores) => (anteriores.includes(pacienteId) ? anteriores : [...anteriores, pacienteId]))
      }
    },
  }
}

export interface FormularioLancamentoProps {
  /**
   * O DETALHE (com `obs` e `em_ciclo_fechado`) quando editando; `null` = novo lançamento.
   *
   * `LancamentoCaixaDetalhe` de propósito: a linha da LISTAGEM não serve aqui — ela não
   * carrega o booleano do ciclo (SEC-FC-09), e o tipo é quem impede alguém passar uma
   * linha de lista e o formulário concluir "aberto" por ausência de campo.
   */
  lancamento: LancamentoCaixaDetalhe | null
  aoFechar: () => void
}

/**
 * Cria/edita um lançamento de caixa. Dinheiro é STRING decimal (D1); a categoria é
 * filtrada pela natureza do lançamento (coerência categoria×tipo, T-fin-11); o
 * parcelamento só aparece na criação (a API o recusa no PUT). A recusa do servidor
 * pousa no campo; a de estado (mexer no PAGO) cai no aviso geral.
 */
export function FormularioLancamento({ lancamento, aoFechar }: FormularioLancamentoProps) {
  const editando = lancamento !== null
  // Ciclo fechado (D7): a competência deste lançamento cai em período já enviado à
  // operadora — o servidor recusa `atualizar` com 422. Some a AÇÃO de salvar; nenhum campo
  // é desabilitado (é o padrão desta mesma tela, onde "Excluir" some do lançamento pago
  // sem travar campo nenhum). O selo explica o sumiço sem nomear convênio nem período: a
  // tela só recebe o booleano do registro (SEC-FC-09).
  const emCicloFechado = lancamento?.em_ciclo_fechado === true
  // Lançamento PAGO é documento contábil (T-fin-09): o servidor só aceita mudar o tratamento, a
  // obs e o documento, e recusa o corpo que CONTÉM qualquer chave financeira, mesmo com o valor
  // igual. Os campos financeiros viram leitura e o `PUT` leva só o que ele aceita.
  const lancamentoPago = lancamento !== null && lancamento.pago_em !== null ? lancamento : null
  // Faturado pela agenda: o tratamento é do SERVIDOR — a sessão faturada diz de qual pacote é o
  // dinheiro. A tela o mostra, não o edita e não o reenvia.
  const doFaturamento = lancamento !== null && lancamento.agendamento_id !== null
  // No PAGO, trocar o tratamento move dinheiro já recebido entre profissionais: o servidor exige
  // a permissão de dar baixa (SEC-RPP-03). Sem ela o campo vira leitura — o `PUT` reenvia o
  // vínculo como está, e reenviar o mesmo não é mexer nele.
  const podeDarBaixa = useAuthStore((estado) => estado.temPermissao('lancamentos.pagar'))
  // os anexos (change `anexo-no-lancamento`) se LEEM com `lancamentos.ver`: sem ela a lista seria
  // um 403 — a seção nem aparece. Existem só na edição: o lançamento novo ainda não tem id
  const podeVerAnexos = useAuthStore((estado) => estado.temPermissao('lancamentos.ver'))
  const tratamentoSoLeitura = doFaturamento
    ? RAZAO_DO_FATURAMENTO
    : lancamentoPago !== null && !podeDarBaixa
      ? RAZAO_DO_PAGO_SEM_BAIXA
      : null
  const [valores, setValores] = useState<ValoresLancamento>(() => valoresIniciais(lancamento))
  // aberto pelo estado e sem `AlertDialog.Cancel`: o foco entra e volta à mão (gate A11Y-AVI-02)
  const refConteudo = useRef<HTMLDivElement>(null)
  const refDisparador = useRef<HTMLElement | null>(null)
  // "Já foi pago": só na CRIAÇÃO e só para quem dá baixa (a API exige `lancamentos.pagar`). No
  // parcelado a opção existe, indisponível, e diz por quê — sumir sem razão seria pior
  const ofereceJaPago = !editando && podeDarBaixa
  const parcelado = ehParcelado(valores.parcelas)
  const pagaAgora = ofereceJaPago && !parcelado && valores.pagar_agora
  const { erros, criar, atualizar, salvando } = usarMutacaoDeLancamento()
  const pacienteAtual = valores.interessado?.tipo === 'paciente' ? valores.interessado.id : null
  const { tratamentoId, sugerido, marcarTratamentoTocado } = useTratamentoSugerido({
    pacienteId: pacienteAtual,
    escolhido: valores.tratamento_id,
    // o vínculo que NÃO se muda daqui (faturado, pago sem baixa) e o que não se SALVA daqui
    // (ciclo fechado: sem o botão, a sugestão diria "vai para" sobre o que nunca foi gravado). E
    // só RECEITA: a devolução (despesa) sugerida ao pacote tiraria dinheiro do profissional sem
    // ninguém ter escolhido — a despesa se vincula à mão, quando é mesmo do pacote
    podeSugerir: tratamentoSoLeitura === null && !emCicloFechado && valores.tipo === 'receita',
  })

  const contas = useQuery({ queryKey: chaves.contas(), queryFn: listarContas })
  const categorias = useQuery({ queryKey: chaves.categorias(), queryFn: listarCategorias })
  const tiposPagamento = useQuery({ queryKey: chaves.tiposPagamento(), queryFn: listarTiposPagamento })

  // Os catálogos têm permissão PRÓPRIA (contas.ver/categorias.ver/tipos_pagamento.ver),
  // distinta de lancamentos.criar. Sem elas, a API responde 403 — e um select vazio e mudo
  // faria o formulário "nascer morto" sem explicar. O aviso diz o que aconteceu.
  const catalogosComErro = contas.isError || categorias.isError || tiposPagamento.isError

  // categoria da MESMA natureza do lançamento (a API recusa o contrário)
  const categoriasDoTipo = useMemo(
    () => (categorias.data ?? []).filter((categoria) => categoria.tipo === valores.tipo),
    [categorias.data, valores.tipo],
  )
  const categoriaEscolhida = categoriasDoTipo.find(
    (categoria) => String(categoria.id) === valores.categoria_id,
  )

  // Catálogo VAZIO não é catálogo com erro: a consulta respondeu, e respondeu "não há
  // nada". Sem distinguir os dois, o seletor fica mudo em "Selecione…" e o formulário
  // nasce impossível sem dizer por quê — foi o que a clínica encontrou no primeiro
  // recebimento (2026-09-02). O aviso de erro/permissão acima continua como está.
  const contaVazia = contas.isSuccess && contas.data.length === 0
  const tipoPagamentoVazio = tiposPagamento.isSuccess && tiposPagamento.data.length === 0
  // categoria tem DUAS caras de vazio: nenhuma cadastrada, ou nenhuma da natureza escolhida
  const semCategoriaDoTipo = categorias.isSuccess && categoriasDoTipo.length === 0
  const faltaCatalogo = contaVazia || tipoPagamentoVazio || semCategoriaDoTipo

  function definir(parciais: Partial<ValoresLancamento>): void {
    setValores((anteriores) => ({ ...anteriores, ...parciais }))
  }

  function mudarTipo(tipo: TipoLancamento): void {
    // trocar a natureza invalida a categoria/subcategoria escolhidas
    definir({ tipo, categoria_id: '', subcategoria_id: '' })
  }

  function mudarCategoria(categoriaId: string): void {
    definir({ categoria_id: categoriaId, subcategoria_id: '' })
  }

  function mudarInteressado(interessado: InteressadoSelecionado | null): void {
    // o tratamento é DAQUELA criança: trocar (ou tirar) o interessado limpa a escolha. No
    // faturado não, porque ali o vínculo não é da tela e não segue a troca
    setValores((anteriores) => ({
      ...anteriores,
      ...(doFaturamento ? { interessado } : { interessado, tratamento_id: '' }),
      ...categoriaPadraoDo(interessado, anteriores),
    }))
  }

  /**
   * O fornecedor traz a categoria (design D6): numa DESPESA com a categoria VAZIA, a categoria
   * padrão dele vem preenchida — e a subcategoria junto, se ainda for daquela categoria. Numa
   * receita, ou com a categoria já escolhida, nada acontece: é conveniência, nunca regra, e a
   * escolha de quem lança nunca é sobrescrita. Categoria que não é de despesa também não entra
   * (o servidor a recusaria, e o seletor nem a mostra).
   */
  function categoriaPadraoDo(
    interessado: InteressadoSelecionado | null,
    anteriores: ValoresLancamento,
  ): Partial<ValoresLancamento> {
    if (interessado === null || anteriores.tipo !== 'despesa' || anteriores.categoria_id !== '') {
      return {}
    }
    const categoria = (categorias.data ?? []).find(
      (uma) => uma.tipo === 'despesa' && uma.id === interessado.categoria_id,
    )
    if (categoria === undefined) {
      return {}
    }
    const subcategoria = categoria.subcategorias.find((uma) => uma.id === interessado.subcategoria_id)
    return {
      categoria_id: String(categoria.id),
      subcategoria_id: subcategoria === undefined ? '' : String(subcategoria.id),
    }
  }

  /** O vínculo com o tratamento — fora do corpo no faturado pela agenda, nem igual ao gravado. */
  function vinculoDoPayload(): Pick<PayloadLancamento, 'tratamento_id'> {
    if (doFaturamento) {
      return {}
    }
    // o que vai é o que o CAMPO mostra: a escolha de quem lança, ou a sugestão que ninguém recusou
    return { tratamento_id: tratamentoId === '' ? null : Number(tratamentoId) }
  }

  function paraPayload(): PayloadLancamento {
    const parcelas = Number(valores.parcelas)
    return {
      tipo: valores.tipo,
      competencia: valores.competencia,
      vencimento: valores.vencimento,
      interessado_tipo: valores.interessado?.tipo ?? null,
      interessado_id: valores.interessado?.id ?? null,
      categoria_id: Number(valores.categoria_id),
      subcategoria_id: valores.subcategoria_id === '' ? null : Number(valores.subcategoria_id),
      valor: paraDecimalDaApi(valores.valor),
      juros: decimalOpcional(valores.juros),
      multa: decimalOpcional(valores.multa),
      desconto: decimalOpcional(valores.desconto),
      tipo_pagamento_id: Number(valores.tipo_pagamento_id),
      conta_id: Number(valores.conta_id),
      // §13: só envia se o usuário tocou — senão o servidor aplica o padrão da clínica
      ...(editando || valores.contabilTocado ? { contabil: valores.contabil } : {}),
      documento: valores.documento === '' ? null : valores.documento,
      obs: valores.obs === '' ? null : valores.obs,
      ...(!editando && parcelas >= 2 ? { parcelas } : {}),
      // desmarcado, a chave nem viaja: o POST fica exatamente como era antes da opção existir
      ...(pagaAgora ? { pagar_agora: true } : {}),
      ...vinculoDoPayload(),
    }
  }

  /** O PAGO: só o que o servidor aceita mudar nele, e nenhuma chave financeira (T-fin-09). */
  function paraPayloadDoPago(): PayloadLancamentoPago {
    return {
      ...vinculoDoPayload(),
      documento: valores.documento === '' ? null : valores.documento,
      obs: valores.obs === '' ? null : valores.obs,
    }
  }

  function submeter(evento: FormEvent): void {
    evento.preventDefault()
    const fechar = { onSuccess: aoFechar }

    if (editando) {
      atualizar.mutate(
        {
          id: lancamento.id,
          payload: lancamentoPago === null ? paraPayload() : paraPayloadDoPago(),
          versao: lancamento.updated_at,
        },
        fechar,
      )
      return
    }
    criar.mutate(paraPayload(), fechar)
  }

  const erroDe = (campo: string): string | undefined => erros.campos.get(campo)
  // no faturado, a criança dos tratamentos é a GRAVADA: o vínculo não segue a troca de interessado
  const pacienteDoGravado =
    lancamento?.interessado?.tipo === 'paciente' ? lancamento.interessado.id : null

  return (
    <AlertDialog.Root
      open
      onOpenChange={(aberto) => {
        if (!aberto && !salvando) aoFechar()
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-(--z-scrim) bg-texto/40" />
        <AlertDialog.Content
          ref={refConteudo}
          className="fixed left-1/2 top-1/2 z-(--z-dialogo) max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-janela bg-superficie-elevada p-6 shadow-e3"
          onOpenAutoFocus={(evento) => {
            levarOFocoParaDentro(evento, refConteudo.current, refDisparador)
          }}
          onCloseAutoFocus={(evento) => {
            devolverOFoco(evento, refDisparador)
          }}
        >
          <AlertDialog.Title className="text-titulo font-semibold text-texto">
            {editando ? 'Editar lançamento' : 'Novo lançamento'}
          </AlertDialog.Title>
          <AlertDialog.Description className="sr-only">
            Preencha os dados do lançamento de caixa.
          </AlertDialog.Description>

          <form onSubmit={submeter} className="mt-5 flex flex-col gap-4">
            {emCicloFechado ? <SeloDeCicloFechado className="self-start" /> : null}
            {/* quem já lembrou a família, e a ação de lembrar (change `cobranca-pelo-whatsapp`) */}
            {lancamento === null ? null : <CobrancaNoDetalhe lancamento={lancamento} />}
            {/* `ciclo_fechado` não é campo do formulário: a recusa que chega por outro
                caminho (aba antiga, ciclo fechado entre o GET e o PUT) pousa em `gerais`. */}
            <AvisoErro mensagens={erros.gerais} />
            {catalogosComErro ? (
              <AvisoErro
                mensagens={[
                  'Não foi possível carregar contas, categorias ou formas de pagamento. Você pode não ter permissão para vê-las — fale com o administrador.',
                ]}
              />
            ) : null}

            {lancamentoPago !== null ? (
              <ResumoDoLancamentoPago
                lancamento={lancamentoPago}
                contas={contas.data ?? []}
                categorias={categorias.data ?? []}
                tiposPagamento={tiposPagamento.data ?? []}
                podeTrocarTratamento={podeDarBaixa && !doFaturamento && pacienteAtual !== null}
              />
            ) : (
              <>
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoSelect
                  rotulo="Tipo"
                  obrigatorio
                  value={valores.tipo}
                  onChange={(evento) => {
                    mudarTipo(evento.target.value as TipoLancamento)
                  }}
                  opcoes={[
                    { valor: 'receita', rotulo: 'Receita' },
                    { valor: 'despesa', rotulo: 'Despesa' },
                  ]}
                  erro={erroDe('tipo')}
                />
                {/* a mensagem mora DENTRO da célula do campo: sob a grade de duas colunas
                    ela pousava debaixo do campo vizinho, e apontava para o lugar errado */}
                <div className="flex flex-col gap-1">
                  <CampoSelect
                    rotulo="Conta"
                    obrigatorio
                    placeholder="Selecione a conta"
                    value={valores.conta_id}
                    onChange={(evento) => {
                      definir({ conta_id: evento.target.value })
                    }}
                    opcoes={(contas.data ?? []).map((conta) => ({
                      valor: String(conta.id),
                      rotulo: conta.nome,
                    }))}
                    erro={erroDe('conta_id')}
                    ajuda={
                      contaVazia ? (
                        <AvisoDePreRequisito para={CAMINHOS.conta} oQueFalta="Nenhuma conta cadastrada." />
                      ) : undefined
                    }
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <CampoSelect
                    rotulo="Categoria"
                    obrigatorio
                    placeholder="Selecione a categoria"
                    value={valores.categoria_id}
                    onChange={(evento) => {
                      mudarCategoria(evento.target.value)
                    }}
                    opcoes={categoriasDoTipo.map((categoria) => ({
                      valor: String(categoria.id),
                      rotulo: categoria.nome,
                    }))}
                    erro={erroDe('categoria_id')}
                    ajuda={
                      semCategoriaDoTipo ? (
                        <AvisoDePreRequisito
                          para={CAMINHOS.categoria}
                          oQueFalta={
                            categorias.data.length === 0
                              ? 'Nenhuma categoria cadastrada.'
                              : `Nenhuma categoria de ${valores.tipo} cadastrada.`
                          }
                        />
                      ) : undefined
                    }
                  />
                </div>
                <CampoSelect
                  rotulo="Subcategoria"
                  placeholder="Nenhuma"
                  value={valores.subcategoria_id}
                  onChange={(evento) => {
                    definir({ subcategoria_id: evento.target.value })
                  }}
                  opcoes={[
                    { valor: '', rotulo: 'Nenhuma' },
                    ...(categoriaEscolhida?.subcategorias ?? []).map((subcategoria) => ({
                      valor: String(subcategoria.id),
                      rotulo: subcategoria.nome,
                    })),
                  ]}
                  erro={erroDe('subcategoria_id')}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <CampoTexto
                  rotulo="Competência"
                  type="date"
                  obrigatorio
                  value={valores.competencia}
                  onChange={(evento) => {
                    definir({ competencia: evento.target.value })
                  }}
                  erro={erroDe('competencia')}
                />
                <CampoTexto
                  rotulo="Vencimento"
                  type="date"
                  obrigatorio
                  value={valores.vencimento}
                  onChange={(evento) => {
                    definir({ vencimento: evento.target.value })
                  }}
                  erro={erroDe('vencimento')}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <CampoTexto
                  rotulo="Valor (R$)"
                  inputMode="decimal"
                  obrigatorio
                  placeholder="0,00"
                  value={valores.valor}
                  onChange={(evento) => {
                    definir({ valor: evento.target.value })
                  }}
                  erro={erroDe('valor')}
                />
                <div className="flex flex-col gap-1">
                  <CampoSelect
                    rotulo="Forma de pagamento"
                    obrigatorio
                    placeholder="Selecione"
                    value={valores.tipo_pagamento_id}
                    onChange={(evento) => {
                      definir({ tipo_pagamento_id: evento.target.value })
                    }}
                    opcoes={(tiposPagamento.data ?? []).map((tipo) => ({
                      valor: String(tipo.id),
                      rotulo: tipo.nome,
                    }))}
                    erro={erroDe('tipo_pagamento_id')}
                    ajuda={
                      tipoPagamentoVazio ? (
                        <AvisoDePreRequisito
                          para={CAMINHOS.tipoPagamento}
                          oQueFalta="Nenhuma forma de pagamento cadastrada."
                        />
                      ) : undefined
                    }
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <CampoTexto
                  rotulo="Juros (R$)"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={valores.juros}
                  onChange={(evento) => {
                    definir({ juros: evento.target.value })
                  }}
                  erro={erroDe('juros')}
                />
                <CampoTexto
                  rotulo="Multa (R$)"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={valores.multa}
                  onChange={(evento) => {
                    definir({ multa: evento.target.value })
                  }}
                  erro={erroDe('multa')}
                />
                <CampoTexto
                  rotulo="Desconto (R$)"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={valores.desconto}
                  onChange={(evento) => {
                    definir({ desconto: evento.target.value })
                  }}
                  erro={erroDe('desconto')}
                />
              </div>

              <BuscaDeInteressado
                selecionado={valores.interessado}
                aoMudar={mudarInteressado}
                erro={erroDe('interessado_tipo') ?? erroDe('interessado_id')}
              />
              </>
            )}

            {doFaturamento || pacienteAtual !== null ? (
              <CampoTratamento
                pacienteId={doFaturamento ? pacienteDoGravado : pacienteAtual}
                valor={doFaturamento ? valores.tratamento_id : tratamentoId}
                aoMudar={(escolhido) => {
                  marcarTratamentoTocado()
                  definir({ tratamento_id: escolhido })
                }}
                somenteLeitura={tratamentoSoLeitura}
                erro={erroDe('tratamento_id')}
                sugerido={sugerido}
                avisarSemProfissional={valores.tipo === 'receita'}
                aoNavegar={aoFechar}
              />
            ) : null}

            <CampoTexto
              rotulo="Documento"
              value={valores.documento}
              ajuda="Nº da nota, recibo ou referência (opcional)"
              maxLength={60}
              onChange={(evento) => {
                definir({ documento: evento.target.value })
              }}
              erro={erroDe('documento')}
            />

            <CampoTextoLongo
              rotulo="Observações"
              value={valores.obs}
              limite={1000}
              onChange={(evento) => {
                definir({ obs: evento.target.value })
              }}
              erro={erroDe('obs')}
            />

            {editando ? null : (
              <CampoTexto
                rotulo="Parcelas"
                type="number"
                min={2}
                ajuda="Deixe em branco para lançamento único. A partir de 2, o valor é rateado."
                value={valores.parcelas}
                onChange={(evento) => {
                  // virar parcelado DESMARCA o "Já foi pago": voltar a lançamento único não pode
                  // trazer de volta, sozinha, uma baixa que a pessoa já não estava vendo marcada
                  const parcelas = evento.target.value
                  definir(ehParcelado(parcelas) ? { parcelas, pagar_agora: false } : { parcelas })
                }}
                erro={erroDe('parcelas')}
              />
            )}

            {ofereceJaPago ? (
              <CampoCheckbox
                rotulo="Já foi pago"
                marcado={pagaAgora}
                desabilitado={parcelado}
                aoMudar={(marcado) => {
                  definir({ pagar_agora: marcado })
                }}
                ajuda={parcelado ? RAZAO_DO_PARCELADO_SEM_PAGAR : EXPLICACAO_DO_JA_PAGO}
                erro={erroDe('pagar_agora')}
              />
            ) : null}

            {lancamentoPago !== null ? null : (
              <CampoCheckbox
                rotulo="Contábil"
                ajuda={
                  editando
                    ? undefined
                    : 'Se não marcar, aplica o padrão contábil da clínica.'
                }
                marcado={valores.contabil}
                aoMudar={(marcado) => {
                  definir({ contabil: marcado, contabilTocado: true })
                }}
              />
            )}

            {/* Os anexos valem no PAGO e no período fechado (D3): anexar não muda dinheiro. Cada
                arquivo é gravado na hora — não espera o "Salvar" do formulário. */}
            {lancamento !== null && podeVerAnexos ? (
              <div className="border-t border-linha pt-4">
                <SecaoAnexosDoLancamento lancamentoId={lancamento.id} />
              </div>
            ) : null}

            <div className="mt-2 flex justify-end gap-3">
              <Botao
                type="button"
                variante="secundario"
                tamanho="lg"
                disabled={salvando}
                onClick={aoFechar}
              >
                {emCicloFechado ? 'Fechar' : 'Cancelar'}
              </Botao>
              {emCicloFechado ? null : (
                // sem conta, categoria ou forma de pagamento o servidor recusaria com
                // 422 em campo obrigatório: a ação fica indisponível até haver o que escolher
                // (no PAGO eles não se escolhem: são leitura, e o que vai é só o vínculo e o texto)
                <Botao
                  type="submit"
                  tamanho="lg"
                  carregando={salvando}
                  disabled={lancamentoPago === null && faltaCatalogo}
                >
                  {/* a consequência no próprio botão (design, Riscos): quem marcou por engano lê antes de clicar */}
                  {editando ? 'Salvar' : pagaAgora ? 'Registrar como pago' : 'Registrar'}
                </Botao>
              )}
            </div>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
