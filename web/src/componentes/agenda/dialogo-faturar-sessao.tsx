import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { AvisoDePreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { CAMINHOS } from '@/lib/caminhos-dos-cadastros'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import { Dialog } from '@/componentes/ui/dialog'
import { ehLancamentoPago, usarMutacaoDeFaturamento } from '@/hooks/usar-mutacao-de-faturamento'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel } from '@/lib/datas'
import { formatarBRL, paraDecimalDaApi } from '@/lib/dinheiro'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { listarCategorias, listarContas, listarTiposPagamento } from '@/servicos/financeiro'
import { useAuthStore } from '@/stores/auth-store'
import type { CardAgendamento, LancamentoFaturado, PayloadFaturamento } from '@/tipos'

export interface DialogoFaturarSessaoProps {
  aberto: boolean
  card: CardAgendamento
  aoFechar: () => void
}

/** Os campos do diálogo como strings de formulário (select vazio = `''`). */
interface ValoresFaturamento {
  categoria_id: string
  subcategoria_id: string
  tipo_pagamento_id: string
  conta_id: string
  desconto: string
  vencimento: string
  obs: string
  /** "Já foi pago" (caixa-do-dia-a-dia) — desmarcado por padrão */
  pagar_agora: boolean
}

const VAZIO: ValoresFaturamento = {
  categoria_id: '',
  subcategoria_id: '',
  tipo_pagamento_id: '',
  conta_id: '',
  desconto: '',
  vencimento: '',
  obs: '',
  pagar_agora: false,
}

/** O que "Já foi pago" faz aqui (design D8): fatura E dá baixa, agora. */
export const EXPLICACAO_DO_JA_PAGO_NA_SESSAO =
  'A família já pagou: a sessão é faturada e o lançamento já nasce pago, com a data de hoje.'

const AVISO_CATALOGOS =
  'Não foi possível carregar contas, categorias ou formas de pagamento. Você pode não ter permissão para vê-las — fale com o administrador.'

/** `""` no campo acessório → OMITIDO do payload (nunca enviado como string vazia). */
function decimalOpcional(entrada: string): string | undefined {
  const convertido = paraDecimalDaApi(entrada)
  return convertido === '' ? undefined : convertido
}

/**
 * Fatura a sessão de um agendamento a partir do painel da agenda (change
 * faturar-pelo-painel-da-agenda). Pede só o que a rota exige — categoria de receita,
 * forma de pagamento e conta — e os opcionais; NÃO tem campo de valor: o preço é do
 * servidor (T-fin-15), e a tela o mostra quando ele responde.
 *
 * Nenhuma regra de elegibilidade vive aqui (§13): sessão consumida, serviço definido,
 * convênio particular e "já faturado" são vereditos da rota, e o motivo que ela devolve
 * é o que o aviso mostra — na chave `agendamento_id`, que não é campo, logo em `gerais`.
 */
export function DialogoFaturarSessao({ aberto, card, aoFechar }: DialogoFaturarSessaoProps) {
  const [valores, setValores] = useState<ValoresFaturamento>(VAZIO)
  const [lancado, setLancado] = useState<LancamentoFaturado | null>(null)
  const { erros, limparErros, faturar, faturando } = usarMutacaoDeFaturamento()
  // faturar já pago é também dar baixa: a API exige `lancamentos.pagar` — sem ela, a opção não existe
  const podeDarBaixa = useAuthStore((estado) => estado.temPermissao('lancamentos.pagar'))
  const pagaAgora = podeDarBaixa && valores.pagar_agora

  const contas = useQuery({
    queryKey: chaves.contas(),
    queryFn: listarContas,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: aberto,
  })
  const categorias = useQuery({
    queryKey: chaves.categorias(),
    queryFn: listarCategorias,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: aberto,
  })
  const tiposPagamento = useQuery({
    queryKey: chaves.tiposPagamento(),
    queryFn: listarTiposPagamento,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: aberto,
  })

  // Os catálogos têm permissão PRÓPRIA (contas.ver/categorias.ver/tipos_pagamento.ver),
  // distinta de lancamentos.criar. Sem elas a API responde 403 — e um select vazio e
  // mudo faria o diálogo "nascer morto" sem explicar (mesmo aviso do formulário de lançamento).
  const catalogosComErro = contas.isError || categorias.isError || tiposPagamento.isError

  // faturamento é RECEITA: a API recusa categoria de despesa
  const categoriasDeReceita = useMemo(
    () => (categorias.data ?? []).filter((categoria) => categoria.tipo === 'receita'),
    [categorias.data],
  )
  const categoriaEscolhida = categoriasDeReceita.find(
    (categoria) => String(categoria.id) === valores.categoria_id,
  )

  // Catálogo VAZIO não é catálogo com erro (mesmo regime do formulário de lançamento):
  // a consulta respondeu "não há nada", e um seletor mudo em "Selecione…" não diz o que
  // fazer. Aqui só a categoria de RECEITA conta — faturamento é receita.
  const contaVazia = contas.isSuccess && contas.data.length === 0
  const tipoPagamentoVazio = tiposPagamento.isSuccess && tiposPagamento.data.length === 0
  const semCategoriaDeReceita = categorias.isSuccess && categoriasDeReceita.length === 0
  const faltaCatalogo = contaVazia || tipoPagamentoVazio || semCategoriaDeReceita

  function definir(parciais: Partial<ValoresFaturamento>): void {
    setValores((anteriores) => ({ ...anteriores, ...parciais }))
  }

  function paraPayload(): PayloadFaturamento {
    const desconto = decimalOpcional(valores.desconto)
    const obs = valores.obs.trim()
    return {
      categoria_id: Number(valores.categoria_id),
      ...(valores.subcategoria_id === '' ? {} : { subcategoria_id: Number(valores.subcategoria_id) }),
      tipo_pagamento_id: Number(valores.tipo_pagamento_id),
      conta_id: Number(valores.conta_id),
      ...(desconto === undefined ? {} : { desconto }),
      ...(valores.vencimento === '' ? {} : { vencimento: valores.vencimento }),
      ...(obs === '' ? {} : { obs }),
      // desmarcado, a chave nem viaja: o faturamento fica exatamente como era
      ...(pagaAgora ? { pagar_agora: true } : {}),
    }
  }

  function submeter(evento: FormEvent): void {
    evento.preventDefault()
    if (catalogosComErro || faltaCatalogo) return
    faturar.mutate(
      { agendamentoId: card.id, payload: paraPayload() },
      {
        onSuccess: (lancamento) => {
          setLancado(lancamento)
        },
      },
    )
  }

  function fechar(): void {
    setValores(VAZIO)
    setLancado(null)
    limparErros()
    aoFechar()
  }

  const erroDe = (campo: string): string | undefined => erros.campos.get(campo)
  // 403 = permissão OU escopo (SEC-VP-13: o profissional escopado não fatura sessão alheia).
  // O dicionário do `http` diz "sem acesso"; aqui o motivo ganha o contexto do gesto.
  const mensagensGerais =
    erros.motivo === 'sem_acesso'
      ? ['Você não tem permissão para faturar este atendimento — ou ele é de outro profissional.']
      : erros.gerais
  const crianca = card.paciente?.nome_social ?? card.paciente?.nome ?? 'a criança'
  const idFormulario = 'formulario-faturar-sessao'

  if (lancado !== null) {
    // o que o SERVIDOR devolveu decide o anúncio: `pago_em` preenchido é a sessão já paga
    const pago = ehLancamentoPago(lancado)
    return (
      <Dialog
        aberto={aberto}
        aoMudarAberto={(estaAberto) => {
          if (!estaAberto) fechar()
        }}
        titulo={pago ? 'Sessão faturada e paga' : 'Sessão faturada'}
        descricao={
          pago
            ? 'O lançamento de receita foi criado no financeiro, já pago.'
            : 'O lançamento de receita foi criado no financeiro.'
        }
        rodape={
          <div className="flex flex-wrap justify-end gap-2">
            <Botao variante="secundario" asChild>
              <Link to="/financeiro">Ver no financeiro</Link>
            </Botao>
            {/* "Voltar ao agendamento" (o painel continua aberto por baixo), não "Fechar": o X do
                Dialog já se chama Fechar, e dois botões com o mesmo nome confundem leitor de tela. */}
            {/* O botão "Faturar" que tinha o foco desmontou com a troca de estado: o foco vai
                para a ação principal do estado novo, não para o contêiner do diálogo. */}
            <Botao type="button" onClick={fechar} autoFocus>
              Voltar ao agendamento
            </Botao>
          </div>
        }
      >
        <p className="text-corpo text-texto">
          Lançado no financeiro:{' '}
          <strong className="tabular-nums">{formatarBRL(lancado.liquido)}</strong>
        </p>
        <p className="mt-2 text-corpo text-texto-suave">
          Sessão de {crianca} em {dataHoraLegivel(card.inicio)}. O valor veio da tabela de serviços do
          tratamento;{' '}
          {pago
            ? 'o pagamento já está registrado, com a data de hoje.'
            : 'a baixa do pagamento é feita na tela do financeiro.'}
        </p>
      </Dialog>
    )
  }

  return (
    <Dialog
      aberto={aberto}
      aoMudarAberto={(estaAberto) => {
        if (!estaAberto && !faturando) fechar()
      }}
      titulo="Faturar sessão"
      descricao={`Lança no financeiro a sessão de ${crianca} em ${dataHoraLegivel(card.inicio)}. O valor vem da tabela de serviços.`}
      rodape={
        <div className="flex flex-wrap justify-end gap-2">
          <Botao type="button" variante="secundario" onClick={fechar} disabled={faturando}>
            Cancelar
          </Botao>
          <Botao
            type="submit"
            form={idFormulario}
            carregando={faturando}
            disabled={faltaCatalogo}
          >
            {pagaAgora ? 'Faturar como pago' : 'Faturar'}
          </Botao>
        </div>
      }
    >
      <form id={idFormulario} onSubmit={submeter} className="flex flex-col gap-4">
        {/* `agendamento_id` não é campo: a recusa de elegibilidade (sessão não consumida,
            sem serviço, convênio na esteira, já faturado) chega por `gerais`. */}
        <AvisoErro mensagens={mensagensGerais} />
        {catalogosComErro ? <AvisoErro mensagens={[AVISO_CATALOGOS]} /> : null}

        <p className="text-corpo text-texto-suave">
          Sessão de <strong className="text-texto">{crianca}</strong> em {dataHoraLegivel(card.inicio)}. O valor
          é o da tabela de serviços do tratamento — não se digita aqui.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* a mensagem mora DENTRO da célula do campo: sob a grade de duas colunas
              ela pousava debaixo do campo vizinho, e apontava para o lugar errado */}
          <div className="flex flex-col gap-1">
            <CampoSelect
              rotulo="Categoria"
              obrigatorio
              placeholder="Selecione a categoria"
              value={valores.categoria_id}
              onChange={(evento) => {
                definir({ categoria_id: evento.target.value, subcategoria_id: '' })
              }}
              opcoes={categoriasDeReceita.map((categoria) => ({
                valor: String(categoria.id),
                rotulo: categoria.nome,
              }))}
              erro={erroDe('categoria_id')}
              ajuda={
                semCategoriaDeReceita ? (
                  <AvisoDePreRequisito
                    para={CAMINHOS.categoria}
                    oQueFalta={
                      categorias.data.length === 0
                        ? 'Nenhuma categoria cadastrada.'
                        : 'Nenhuma categoria de receita cadastrada.'
                    }
                    aoNavegar={fechar}
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
                    aoNavegar={fechar}
                  />
                ) : undefined
              }
            />
          </div>
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
              // O atalho NAVEGA, e sair da rota fecha o diálogo — o agendamento continua
              // onde estava, e a operadora volta pela agenda.
              ajuda={
                contaVazia ? (
                  <AvisoDePreRequisito
                    para={CAMINHOS.conta}
                    oQueFalta="Nenhuma conta cadastrada."
                    aoNavegar={fechar}
                  />
                ) : undefined
              }
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            rotulo="Desconto (R$)"
            inputMode="decimal"
            placeholder="0,00"
            ajuda="Opcional. O teto de desconto é configuração da clínica."
            value={valores.desconto}
            onChange={(evento) => {
              definir({ desconto: evento.target.value })
            }}
            erro={erroDe('desconto')}
          />
          <CampoTexto
            rotulo="Vencimento"
            type="date"
            ajuda="Opcional. Vazio = o padrão do financeiro."
            value={valores.vencimento}
            onChange={(evento) => {
              definir({ vencimento: evento.target.value })
            }}
            erro={erroDe('vencimento')}
          />
        </div>

        {podeDarBaixa ? (
          <CampoCheckbox
            rotulo="Já foi pago"
            marcado={valores.pagar_agora}
            aoMudar={(marcado) => {
              definir({ pagar_agora: marcado })
            }}
            ajuda={EXPLICACAO_DO_JA_PAGO_NA_SESSAO}
            erro={erroDe('pagar_agora')}
          />
        ) : null}

        <CampoTextoLongo
          rotulo="Observação"
          limite={1000}
          value={valores.obs}
          onChange={(evento) => {
            definir({ obs: evento.target.value })
          }}
          erro={erroDe('obs')}
        />
      </form>
    </Dialog>
  )
}
