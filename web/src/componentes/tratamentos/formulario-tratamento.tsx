import { useQuery } from '@tanstack/react-query'
import { AlertDialog } from 'radix-ui'
import { useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'

import { AvisoDePreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarMutacaoDeTratamento } from '@/hooks/usar-mutacao-de-tratamento'
import { CAMINHOS } from '@/lib/caminhos-dos-cadastros'
import { chaves } from '@/lib/chaves-query'
import { devolverOFoco, levarOFocoParaDentro } from '@/lib/foco-do-dialogo'
import { opcoesDeProfissional } from '@/lib/profissionais'
import {
  convenios as servicoDeConvenios,
  especialidades as servicoDeEspecialidades,
  servicosDoConvenio,
} from '@/servicos/catalogos-de-apoio'
import { listarProfissionais } from '@/servicos/catalogos'
import { buscarTratamento } from '@/servicos/tratamentos'
import type { CaminhoDoCadastro } from '@/lib/caminhos-dos-cadastros'
import type { PayloadTratamento, SituacaoDoTratamento, TratamentoDetalhe } from '@/tipos'

interface Valores {
  convenio_id: string
  especialidade_id: string
  profissional_id: string
  servico_id: string
  matricula: string
  guia: string
  sessoes_total: string
  data_inicio: string
  validade_dias: string
  pedido_emitido_em: string
  pedido_sessoes_por_semana: string
  status: SituacaoDoTratamento
}

/**
 * Os valores do cadastro do paciente que o pacote NOVO herda.
 *
 * Herança só na CRIAÇÃO, e nunca na edição: um pacote existente guarda o que valia
 * quando foi vendido, e reescrevê-lo com o convênio de hoje apagaria a base do que já
 * foi faturado (change convenio-no-cadastro-do-paciente, D2).
 */
export interface PadraoDoCadastro {
  convenioId: number | null
  carteirinha: string | null
}

function valoresIniciais(tratamento?: TratamentoDetalhe, padrao?: PadraoDoCadastro): Valores {
  return {
    convenio_id:
      tratamento === undefined
        ? (padrao?.convenioId != null ? String(padrao.convenioId) : '')
        : String(tratamento.convenio_id),
    especialidade_id: tratamento === undefined ? '' : String(tratamento.especialidade_id),
    profissional_id: tratamento === undefined ? '' : String(tratamento.profissional_id),
    servico_id:
      tratamento?.servico_id === null || tratamento?.servico_id === undefined
        ? ''
        : String(tratamento.servico_id),
    // na criação, a carteirinha do CADASTRO; na edição, a do pacote — nunca a de hoje
    matricula: tratamento === undefined ? (padrao?.carteirinha ?? '') : (tratamento.matricula ?? ''),
    guia: tratamento?.guia ?? '',
    sessoes_total: String(tratamento?.sessoes_total ?? 10),
    data_inicio: tratamento?.data_inicio ?? '',
    validade_dias:
      tratamento?.validade_dias === null || tratamento?.validade_dias === undefined
        ? ''
        : String(tratamento.validade_dias),
    // LER do registro, como matrícula/guia: hidratar vazio faria o PUT gravar
    // `null` por cima do pedido na edição mais banal (a lição do SEC-TR-14)
    pedido_emitido_em: tratamento?.pedido_emitido_em ?? '',
    pedido_sessoes_por_semana:
      tratamento?.pedido_sessoes_por_semana === null
        || tratamento?.pedido_sessoes_por_semana === undefined
        ? ''
        : String(tratamento.pedido_sessoes_por_semana),
    status: tratamento?.status ?? 'andamento',
  }
}

interface FrasesDaFalta {
  /** Nada cadastrado. */
  vazio: string
  /** Há cadastro, mas nenhum ativo — só nos catálogos que têm `ativo`. */
  semAtivo?: string
}

/**
 * O que falta em cada seletor obrigatório do pacote (change `o-sistema-avisa-o-que-falta`).
 *
 * "Vazio" tem duas caras: nada cadastrado, ou só cadastro inativo — o convênio desativado e o
 * profissional desligado continuam na lista do servidor. As duas mandam ao mesmo cadastro, mas não
 * são a mesma frase. A especialidade não tem `ativo`: para ela só existe a primeira cara.
 */
const FRASES_DO_CATALOGO_VAZIO = {
  convenio: {
    vazio: 'Nenhum convênio cadastrado — o particular também é um convênio.',
    semAtivo: 'Nenhum convênio ativo: os cadastrados estão inativos.',
  },
  especialidade: { vazio: 'Nenhuma especialidade cadastrada.' },
  profissional: {
    vazio: 'Nenhum profissional cadastrado.',
    semAtivo: 'Nenhum profissional ativo: os cadastrados estão desligados.',
  },
} as const satisfies Record<string, FrasesDaFalta>

/**
 * A frase do que falta no catálogo, ou `null` quando há o que escolher.
 *
 * `undefined` é a lista que não CHEGOU (em voo, ou recusada): sem ela a tela não sabe nada, e
 * "nenhum cadastrado" durante o carregamento — ou num 403 — seria uma frase falsa. Sem `ehAtivo`,
 * todo item conta como ativo (o catálogo que não tem a flag).
 */
function oQueFalta<T>(
  itens: readonly T[] | undefined,
  frases: FrasesDaFalta,
  ehAtivo: (item: T) => boolean = () => true,
): string | null {
  if (itens === undefined) {
    return null
  }
  if (itens.length === 0) {
    return frases.vazio
  }
  if (itens.some(ehAtivo)) {
    return null
  }

  return frases.semAtivo ?? frases.vazio
}

export interface FormularioTratamentoProps {
  pacienteId: number
  /** Em edição; `undefined` cadastra um pacote novo */
  tratamentoId?: number
  /** O convênio vigente do cadastro — pré-preenche o pacote NOVO, e pode ser trocado */
  padraoDoCadastro?: PadraoDoCadastro
  aoFechar: () => void
}

/**
 * O pacote de sessões de UMA criança.
 *
 * **A edição carrega o DETALHE, nunca o item da lista.** `matricula` e `guia` (os
 * identificadores do menor no convênio) são omitidos da listagem de propósito —
 * minimização. Montar o formulário sobre o item da lista faria os dois nascerem
 * vazios e o `PUT` gravar `null` por cima: o dado sumiria em silêncio, na operação
 * mais corriqueira da tela, e sem recuperação — a auditoria mascara justamente
 * esses campos, então nem o valor antigo ficaria registrado (gate SEC-TR-14).
 *
 * Três coisas que este formulário NÃO faz, e não são esquecimento:
 * - **não tem campo de sessões realizadas** — o único caminho de escrita dela é a
 *   reconciliação do atendimento;
 * - **não recalcula saldo nem vencimento** — os dois vêm prontos do servidor (o
 *   vencimento no fuso da clínica);
 * - **não deixa trocar o paciente** — o pacote pertence à criança em cuja página
 *   ele foi aberto (o servidor recusa a troca, e a tela não oferece o botão).
 */
export function FormularioTratamento({
  pacienteId,
  tratamentoId,
  padraoDoCadastro,
  aoFechar,
}: FormularioTratamentoProps) {
  const refDisparador = useRef<HTMLElement | null>(null)
  const refConteudo = useRef<HTMLDivElement>(null)
  const detalhe = useQuery({
    queryKey: chaves.tratamento(tratamentoId ?? 0),
    queryFn: () => buscarTratamento(tratamentoId as number),
    enabled: tratamentoId !== undefined,
    // NADA sobrevive ao fechamento do diálogo.
    //
    // Sem isto, o cache do detalhe vive 5 minutos (gcTime padrão) e a REABERTURA do
    // formulário monta sobre o dado VELHO: o `useState` de `FormularioCarregado`
    // inicializa uma vez, e o `useQuery` já devolve `isSuccess` no primeiro render
    // (cache quente) — o refetch em background atualiza o cache, nunca o formulário.
    // A segunda edição seguida REVERTIA a primeira, matrícula e guia inclusive.
    //
    // A chave do detalhe HOJE é `['tratamentos', id]` e a invalidação da lista a ALCANÇA
    // (change `consertos-de-classe` — antes era `['tratamento', id]`, singular, e nenhuma
    // invalidação de lista chegava aqui). **Mas invalidar não basta**, e é por isso que o
    // `gcTime: 0` continua: query INATIVA invalidada só fica *stale* — no remount o
    // `useQuery` devolve o dado do cache no PRIMEIRO render, e é nele que o `useState`
    // hidrata. O refetch chega depois, atualiza o cache e não toca o formulário.
    //
    // Duas defesas independentes para o mesmo dado. Nenhuma é redundante.
    gcTime: 0,
  })

  // o formulário só monta com o DETALHE em mãos: o `useState` inicializa uma vez,
  // e inicializar com dado pela metade é o que apagava matrícula e guia
  if (tratamentoId !== undefined && !detalhe.isSuccess) {
    return (
      <AlertDialog.Root open onOpenChange={aoFechar}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-(--z-scrim) bg-texto/40" />
          <AlertDialog.Content
            ref={refConteudo}
            className="fixed left-1/2 top-1/2 z-(--z-dialogo) w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-janela bg-superficie-elevada p-6 shadow-e3"
            onOpenAutoFocus={(evento) => {
              levarOFocoParaDentro(evento, refConteudo.current, refDisparador)
            }}
            onCloseAutoFocus={(evento) => {
              devolverOFoco(evento, refDisparador)
            }}
          >
            <AlertDialog.Title className="text-titulo font-semibold text-texto">
              Editar tratamento
            </AlertDialog.Title>
            <AlertDialog.Description className="sr-only">
              Carregando o tratamento.
            </AlertDialog.Description>
            {detalhe.isError ? (
              <EstadoErro
                className="mt-4"
                mensagem="Não foi possível carregar este tratamento."
                aoTentarNovamente={() => {
                  void detalhe.refetch()
                }}
              />
            ) : (
              <Skeleton className="mt-4 h-64 w-full" />
            )}
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    )
  }

  return (
    <FormularioCarregado
      pacienteId={pacienteId}
      tratamento={detalhe.data}
      padraoDoCadastro={padraoDoCadastro}
      refDisparador={refDisparador}
      aoFechar={aoFechar}
    />
  )
}

interface FormularioCarregadoProps {
  pacienteId: number
  tratamento?: TratamentoDetalhe
  padraoDoCadastro?: PadraoDoCadastro
  /** Quem abriu o formulário — guardado pelo diálogo que abriu primeiro (o do carregamento, na edição) */
  refDisparador: RefObject<HTMLElement | null>
  aoFechar: () => void
}

function FormularioCarregado({
  pacienteId,
  tratamento,
  padraoDoCadastro,
  refDisparador,
  aoFechar,
}: FormularioCarregadoProps) {
  const refConteudo = useRef<HTMLDivElement>(null)
  const [valores, setValores] = useState<Valores>(() => valoresIniciais(tratamento, padraoDoCadastro))
  const { erros, criar, atualizar, salvando } = usarMutacaoDeTratamento()

  const listaDeConvenios = useQuery({
    queryKey: chaves.convenios(),
    queryFn: servicoDeConvenios.listar,
  })
  const listaDeEspecialidades = useQuery({
    queryKey: chaves.especialidades(),
    queryFn: servicoDeEspecialidades.listar,
  })
  const listaDeProfissionais = useQuery({
    queryKey: chaves.profissionais(),
    queryFn: listarProfissionais,
  })

  // Num pacote NOVO, só o que está ativo (como a transferência faz com as contas, D3): oferecer o
  // convênio desativado contradizia o aviso "nenhum convênio ativo" (gate CR-AVI-06). Na EDIÇÃO, o
  // gravado continua no seletor mesmo inativo — senão o campo abriria vazio e perderia o valor.
  const criando = tratamento === undefined
  const convenioGravado = tratamento?.convenio_id ?? null
  const profissionalGravado = tratamento?.profissional_id ?? null
  const conveniosOferecidos = (listaDeConvenios.data ?? []).filter(
    (convenio) => convenio.ativo || convenio.id === convenioGravado,
  )
  // A herança do cadastro só vale se o convênio é oferecido. O vigente da criança pode ter sido
  // desativado depois: fora das opções, o navegador mostraria OUTRO convênio no seletor enquanto o
  // pacote seria gravado com o inativo. Então o campo abre vazio, e a pessoa escolhe.
  const convenioEscolhido =
    criando
    && listaDeConvenios.isSuccess
    && !conveniosOferecidos.some((convenio) => String(convenio.id) === valores.convenio_id)
      ? ''
      : valores.convenio_id

  // o convênio do cadastro da criança, desativado depois: o campo abre vazio, e diz POR QUÊ — sem isso,
  // o convênio de sempre sumia calado, e a matrícula dele ficava preenchida (gate CR-AVI-R2-03)
  const convenioHerdadoInativo =
    criando && convenioEscolhido === '' && valores.convenio_id !== ''
      ? ((listaDeConvenios.data ?? []).find((convenio) => String(convenio.id) === valores.convenio_id) ?? null)
      : null

  const convenioId = Number(convenioEscolhido)
  const listaDeServicos = useQuery({
    queryKey: chaves.servicosDoConvenio(convenioId),
    queryFn: () => servicosDoConvenio(convenioId).listar(),
    enabled: Number.isInteger(convenioId) && convenioId > 0,
    // A tabela de preços do convênio decide o VALOR do pacote. Servida do cache, o formulário
    // ofereceria um serviço que a clínica acabou de remover — ou um preço antigo. A regra do
    // detalhe é sem exceção (re-review r8).
    gcTime: 0,
  })

  // O aviso sai dos catálogos que o formulário JÁ carrega — nenhuma requisição a mais (D6). Só no
  // pacote NOVO: a edição abre com o valor gravado, que continua no seletor (como na transferência).
  const faltaConvenio = oQueFalta(
    criando ? listaDeConvenios.data : undefined,
    FRASES_DO_CATALOGO_VAZIO.convenio,
    (convenio) => convenio.ativo,
  )
  const faltaEspecialidade = oQueFalta(
    criando ? listaDeEspecialidades.data : undefined,
    FRASES_DO_CATALOGO_VAZIO.especialidade,
  )
  const faltaProfissional = oQueFalta(
    criando ? listaDeProfissionais.data : undefined,
    FRASES_DO_CATALOGO_VAZIO.profissional,
    (profissional) => profissional.ativo,
  )

  /**
   * O caminho entra na `ajuda` do seletor (vai para o `aria-describedby`) — em TEXTO, sem link (design
   * D7): o diálogo vive no cadastro da criança (`/pacientes/:id/editar`), e seguir um link jogaria fora
   * o que foi digitado lá e aqui (gate CR-AVI-03).
   */
  function avisoDaFalta(frase: string | null, para: CaminhoDoCadastro): ReactNode {
    return frase === null ? undefined : <AvisoDePreRequisito para={para} oQueFalta={frase} semLink />
  }

  function definir(parciais: Partial<Valores>): void {
    setValores((anteriores) => ({ ...anteriores, ...parciais }))
  }

  function montarPayload(): PayloadTratamento {
    return {
      paciente_id: pacienteId,
      convenio_id: Number(convenioEscolhido),
      especialidade_id: Number(valores.especialidade_id),
      profissional_id: Number(valores.profissional_id),
      servico_id: valores.servico_id === '' ? null : Number(valores.servico_id),
      // `tipo` não vai porque não EXISTE mais na fronteira (SEC-TR-17): coluna de um
      // valor só, sem leitor. Antes, mandar `null` nela derrubava todo cadastro com 422.
      matricula: valores.matricula === '' ? null : valores.matricula,
      guia: valores.guia === '' ? null : valores.guia,
      sessoes_total: Number(valores.sessoes_total),
      // o `<input type="date">` já devolve `Y-m-d`: vai cru. Passar por `new Date()`
      // introduziria fuso e sufixo, e o servidor exige o formato EXATO
      data_inicio: valores.data_inicio === '' ? null : valores.data_inicio,
      validade_dias: valores.validade_dias === '' ? null : Number(valores.validade_dias),
      // como a data de início: `Y-m-d` CRU do <input type="date">. `pedido_vence_em`
      // NUNCA vai — é derivado no servidor (validade em meses do convênio, D4)
      pedido_emitido_em: valores.pedido_emitido_em === '' ? null : valores.pedido_emitido_em,
      pedido_sessoes_por_semana:
        valores.pedido_sessoes_por_semana === ''
          ? null
          : Number(valores.pedido_sessoes_por_semana),
      status: valores.status,
    }
  }

  function submeter(evento: FormEvent): void {
    evento.preventDefault()
    const fechar = { onSuccess: aoFechar }

    if (tratamento === undefined) {
      criar.mutate(montarPayload(), fechar)
      return
    }
    atualizar.mutate({ id: tratamento.id, payload: montarPayload(), versao: tratamento.updated_at }, fechar)
  }

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
            {tratamento === undefined ? 'Novo tratamento' : 'Editar tratamento'}
          </AlertDialog.Title>
          <AlertDialog.Description className="sr-only">
            O pacote de sessões desta criança.
          </AlertDialog.Description>

          <form onSubmit={submeter} className="mt-5 flex flex-col gap-4">
            <AvisoErro mensagens={erros.gerais} />

            {tratamento !== undefined ? (
              <p className="rounded-superficie border border-linha bg-fundo p-3 text-meta text-texto-suave">
                <strong className="font-semibold text-texto">
                  {tratamento.sessoes_realizadas} de {tratamento.sessoes_total} sessões realizadas
                </strong>{' '}
                — o total não pode ficar abaixo disso, e as realizadas só mudam pelo atendimento.
              </p>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/*
                "DESTE PACOTE", e não só "Convênio" (design D2 da change
                convenio-no-cadastro-do-paciente).

                O cadastro da criança agora tem um convênio próprio — o vigente. Este aqui
                é o do pacote, e os dois PODEM divergir sem que nenhum esteja errado. Com
                os dois rotulados igual, a recepção abre este diálogo achando que está
                corrigindo o cadastro, ou lê a divergência como defeito e vai "consertar" o
                histórico.
              */}
              <CampoSelect
                rotulo="Convênio deste pacote"
                obrigatorio
                value={convenioEscolhido}
                onChange={(evento) => {
                  // trocar o convênio invalida o serviço (ele é da tabela do convênio)
                  definir({ convenio_id: evento.target.value, servico_id: '' })
                }}
                placeholder="Selecione…"
                opcoes={conveniosOferecidos.map((convenio) => ({
                  valor: String(convenio.id),
                  rotulo: convenio.nome,
                }))}
                ajuda={
                  avisoDaFalta(faltaConvenio, CAMINHOS.convenio)
                  ?? (convenioHerdadoInativo === null
                    ? undefined
                    : `O convênio do cadastro, “${convenioHerdadoInativo.nome}”, está inativo: escolha outro e confira a matrícula.`)
                }
                erro={erros.campos.get('convenio_id')}
              />

              <CampoSelect
                rotulo="Especialidade"
                obrigatorio
                value={valores.especialidade_id}
                onChange={(evento) => {
                  definir({ especialidade_id: evento.target.value })
                }}
                placeholder="Selecione…"
                opcoes={(listaDeEspecialidades.data ?? []).map((especialidade) => ({
                  valor: String(especialidade.id),
                  rotulo: especialidade.nome,
                }))}
                ajuda={avisoDaFalta(faltaEspecialidade, CAMINHOS.especialidade)}
                erro={erros.campos.get('especialidade_id')}
              />

              <CampoSelect
                rotulo="Profissional"
                obrigatorio
                value={valores.profissional_id}
                onChange={(evento) => {
                  definir({ profissional_id: evento.target.value })
                }}
                placeholder="Selecione…"
                // os ativos e, na edição, o gravado mesmo desligado (a autoria do pacote diz a verdade)
                opcoes={opcoesDeProfissional(listaDeProfissionais.data ?? [], profissionalGravado)}
                ajuda={avisoDaFalta(faltaProfissional, CAMINHOS.profissional)}
                erro={erros.campos.get('profissional_id')}
              />

              <CampoSelect
                rotulo="Serviço"
                value={valores.servico_id}
                onChange={(evento) => {
                  definir({ servico_id: evento.target.value })
                }}
                opcoes={[
                  { valor: '', rotulo: 'Sem serviço' },
                  ...(listaDeServicos.data ?? []).map((servico) => ({
                    valor: String(servico.id),
                    rotulo: servico.procedimento,
                  })),
                ]}
                ajuda="Da tabela de preços do convênio escolhido."
                erro={erros.campos.get('servico_id')}
              />

              <CampoTexto
                rotulo="Total de sessões"
                obrigatorio
                type="number"
                min={1}
                max={1000}
                value={valores.sessoes_total}
                onChange={(evento) => {
                  definir({ sessoes_total: evento.target.value })
                }}
                erro={erros.campos.get('sessoes_total')}
              />

              <CampoSelect
                rotulo="Situação"
                value={valores.status}
                onChange={(evento) => {
                  definir({ status: evento.target.value as SituacaoDoTratamento })
                }}
                opcoes={[
                  { valor: 'andamento', rotulo: 'Em andamento' },
                  { valor: 'parado', rotulo: 'Parado' },
                  { valor: 'finalizado', rotulo: 'Finalizado' },
                ]}
                erro={erros.campos.get('status')}
              />

              <CampoTexto
                rotulo="Início"
                type="date"
                value={valores.data_inicio}
                onChange={(evento) => {
                  definir({ data_inicio: evento.target.value })
                }}
                ajuda="É a âncora da validade — sem ela, o pacote nunca vence."
                erro={erros.campos.get('data_inicio')}
              />

              <CampoTexto
                rotulo="Validade (dias)"
                type="number"
                min={1}
                max={3650}
                value={valores.validade_dias}
                onChange={(evento) => {
                  definir({ validade_dias: evento.target.value })
                }}
                erro={erros.campos.get('validade_dias')}
              />

              {/* Pedido médico (limites-e-pedidos, D4): a emissão é DADO; o vencimento é
                  derivado no SERVIDOR pela validade em meses do convênio — a tela não conta */}
              <CampoTexto
                rotulo="Pedido médico emitido em"
                type="date"
                value={valores.pedido_emitido_em}
                onChange={(evento) => {
                  definir({ pedido_emitido_em: evento.target.value })
                }}
                ajuda="O vencimento é calculado pela validade em meses cadastrada no convênio."
                erro={erros.campos.get('pedido_emitido_em')}
              />

              <CampoTexto
                rotulo="Sessões por semana do pedido"
                type="number"
                min={1}
                max={40}
                value={valores.pedido_sessoes_por_semana}
                onChange={(evento) => {
                  definir({ pedido_sessoes_por_semana: evento.target.value })
                }}
                ajuda="Quando o pedido fixa a quantidade semanal, este número substitui a regra semanal do convênio na agenda."
                erro={erros.campos.get('pedido_sessoes_por_semana')}
              />

              {/* matrícula e guia são identificadores do MENOR no convênio: existem
                  aqui e em lugar nenhum mais (nunca em lista, nunca em URL) */}
              <CampoTexto
                rotulo="Matrícula neste pacote"
                value={valores.matricula}
                onChange={(evento) => {
                  definir({ matricula: evento.target.value })
                }}
                erro={erros.campos.get('matricula')}
              />

              <CampoTexto
                rotulo="Guia"
                value={valores.guia}
                onChange={(evento) => {
                  definir({ guia: evento.target.value })
                }}
                erro={erros.campos.get('guia')}
              />
            </div>

            <div className="mt-2 flex justify-end gap-3">
              <Botao
                type="button"
                variante="secundario"
                tamanho="lg"
                disabled={salvando}
                onClick={aoFechar}
              >
                Cancelar
              </Botao>
              <Botao type="submit" tamanho="lg" carregando={salvando}>
                {tratamento === undefined ? 'Cadastrar' : 'Salvar'}
              </Botao>
            </div>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
