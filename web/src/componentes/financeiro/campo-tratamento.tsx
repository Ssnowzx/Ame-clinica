import { useQuery } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { AvisoDePreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { Etiqueta } from '@/componentes/ui/etiqueta'
import { ListaDescricao } from '@/componentes/ui/lista-descricao'
import { usarNomesDoTratamento } from '@/hooks/usar-nomes-do-tratamento'
import { caminhoDoPacoteDoPaciente } from '@/lib/caminhos-dos-cadastros'
import { chaves } from '@/lib/chaves-query'
import { rotuloDoTratamentoDoPagamento } from '@/lib/rotulo-de-tratamento'
import { listarTratamentos } from '@/servicos/tratamentos'
import { useAuthStore } from '@/stores/auth-store'
import type { CaminhoDoCadastro } from '@/lib/caminhos-dos-cadastros'

/** A página cheia da listagem de tratamentos (`per_page` vai até 100 no servidor). */
const POR_PAGINA = 100

/** A razão do campo só de leitura no lançamento que veio de "Faturar sessão". */
export const RAZAO_DO_FATURAMENTO = 'Definido pelo faturamento da sessão.'

/**
 * A razão do campo só de leitura no lançamento PAGO para quem não dá baixa (SEC-RPP-03): trocar
 * o tratamento de um pagamento já recebido move o dinheiro entre profissionais no fechamento do
 * mês, e o servidor exige `lancamentos.pagar` para isso.
 */
export const RAZAO_DO_PAGO_SEM_BAIXA = 'Trocar o tratamento de um lançamento pago é de quem dá baixa nos pagamentos.'

const AJUDA_DO_TRATAMENTO = 'É por ele que o pagamento chega ao profissional em "Recebido por profissional".'
const SEM_PERMISSAO = 'Listar os tratamentos precisa da permissão de ver tratamentos.'
const SEM_TRATAMENTO = { valor: '', rotulo: 'Sem tratamento' }

/** O que falta quando a lista da criança chegou vazia — o aviso acrescenta o caminho para o pacote. */
export const CRIANCA_SEM_TRATAMENTO = 'Esta criança não tem tratamento cadastrado.'

/** O selo do tratamento que o SERVIDOR sugeriu e ninguém mexeu ainda (design D2). */
export const SELO_DA_SUGESTAO = 'Sugerido pelo sistema'

/** A consequência de deixar a receita de uma criança sem tratamento — é o que a clínica via no fim do mês. */
export const AVISO_SEM_PROFISSIONAL =
  'Sem tratamento, este pagamento fica em "Sem profissional" no Recebido por profissional.'

export interface CampoTratamentoProps {
  /** A criança dos tratamentos. `null` só no faturado cujo interessado gravado não é paciente. */
  pacienteId: number | null
  /** `''` = sem tratamento */
  valor: string
  aoMudar: (valor: string) => void
  /**
   * A razão quando o vínculo NÃO se muda daqui: o lançamento de "Faturar sessão" (o vínculo é do
   * servidor) ou o pago, para quem não dá baixa. O campo vira leitura, com a razão; `null` = editável.
   */
  somenteLeitura: string | null
  erro?: string
  /**
   * O valor veio da SUGESTÃO do servidor e ninguém mexeu nele ainda (change
   * `vincular-pagamentos-ao-tratamento`). Só o selo: quem decide o que vai no corpo é o formulário.
   */
  sugerido?: boolean
  /**
   * É RECEITA: vazio aqui leva o pagamento para "Sem profissional" no fim do mês, e o campo diz
   * isso. Numa despesa não há o que avisar.
   */
  avisarSemProfissional?: boolean
  /** Fecha o diálogo do formulário ao seguir o caminho para cadastrar o pacote. */
  aoNavegar?: () => void
}

/**
 * O tratamento do dinheiro (change `recebido-por-profissional`): é por ele que o pagamento de um
 * pacote chega ao profissional, e sem ele o pagamento cai em "Sem profissional".
 *
 * O valor atual SEMPRE tem opção, esteja a lista em voo, em erro ou sem ele. Sem isso o `<select>`
 * desenha outra coisa e a tela mente sobre o que vai enviar — a lição CR-TNE-01 do formulário de
 * agendamento, onde a lista em voo desvinculava o pacote em silêncio. Aqui quem envia é o estado
 * do formulário, nunca o que o `<select>` estiver mostrando.
 */
export function CampoTratamento({
  pacienteId,
  valor,
  aoMudar,
  somenteLeitura,
  erro,
  sugerido = false,
  avisarSemProfissional = false,
  aoNavegar,
}: CampoTratamentoProps) {
  const podeVer = useAuthStore((estado) => estado.temPermissao('tratamentos.ver'))
  const ativo = podeVer && pacienteId !== null
  const filtro = { paciente_id: pacienteId ?? 0, por_pagina: POR_PAGINA }
  const tratamentos = useQuery({
    queryKey: chaves.tratamentos(filtro),
    queryFn: () => listarTratamentos(filtro),
    enabled: ativo,
  })
  const nomes = usarNomesDoTratamento(ativo)

  const lista = tratamentos.data?.data ?? []
  const opcoesDaLista = lista.map((tratamento) => ({
    valor: String(tratamento.id),
    rotulo: rotuloDoTratamentoDoPagamento(tratamento, nomes, lista),
  }))
  const rotuloDoAtual = opcoesDaLista.find((opcao) => opcao.valor === valor)?.rotulo
  // "Vai para" sai do MESMO catálogo de nomes do rótulo — sem o nome, a linha não é inventada
  const profissionalDoAtual = lista.find((tratamento) => String(tratamento.id) === valor)?.profissional_id
  const vaiPara = nomes.profissionais.find((profissional) => profissional.id === profissionalDoAtual)?.nome
  // `isLoading`, não `isPending`: sem a permissão a consulta nem sai, e uma consulta desabilitada
  // fica `isPending` para sempre no TanStack v5 — seria "carregando" eterno
  const rotuloDoGravado = tratamentos.isLoading
    ? 'Carregando o tratamento deste lançamento…'
    : tratamentos.isError
      ? 'Tratamento deste lançamento — não foi possível carregar a lista'
      : 'Tratamento deste lançamento'

  if (somenteLeitura !== null) {
    return (
      <div className="flex flex-col gap-2">
        <ListaDescricao
          itens={[
            {
              rotulo: 'Tratamento',
              larguraTotal: true,
              valor: (
                <>
                  {valor === '' ? 'Sem tratamento' : (rotuloDoAtual ?? rotuloDoGravado)}
                  <span className="block text-meta text-texto-suave">{somenteLeitura}</span>
                </>
              ),
            },
          ]}
        />
        <AvisoErro mensagens={erro === undefined ? [] : [erro]} />
      </div>
    )
  }

  const opcoes = [
    SEM_TRATAMENTO,
    ...opcoesDaLista,
    ...(valor !== '' && rotuloDoAtual === undefined ? [{ valor, rotulo: rotuloDoGravado }] : []),
  ]

  return (
    <CampoSelect
      rotulo="Tratamento"
      value={valor}
      opcoes={opcoes}
      disabled={!podeVer}
      onChange={(evento) => {
        aoMudar(evento.target.value)
      }}
      ajuda={
        <>
          {sugerido ? (
            <Etiqueta tom="info" tamanho="sm" className="mr-2">
              {SELO_DA_SUGESTAO}
            </Etiqueta>
          ) : null}
          {ajudaDoCampo({
            podeVer,
            carregando: tratamentos.isLoading,
            comErro: tratamentos.isError,
            vazio: tratamentos.isSuccess && lista.length === 0,
            tentarNovamente: () => {
              void tratamentos.refetch()
            },
            escolhido: valor !== '',
            vaiPara,
            caminhoDoPacote: pacienteId === null ? null : caminhoDoPacoteDoPaciente(pacienteId),
            aoNavegar,
          })}
          {avisarSemProfissional && valor === '' ? (
            <span className="mt-1 flex items-start gap-1 text-alerta-texto">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              {AVISO_SEM_PROFISSIONAL}
            </span>
          ) : null}
        </>
      }
      erro={erro}
    />
  )
}

interface EstadoDaLista {
  podeVer: boolean
  carregando: boolean
  comErro: boolean
  vazio: boolean
  tentarNovamente: () => void
  /** Há tratamento no campo (escolhido ou sugerido). */
  escolhido: boolean
  /** O profissional do tratamento no campo, quando o catálogo de nomes o alcança. */
  vaiPara: string | undefined
  /** Onde se cadastra o pacote da criança; `null` sem criança. */
  caminhoDoPacote: CaminhoDoCadastro | null
  aoNavegar?: () => void
}

/**
 * A ajuda diz o estado da lista — e só afirma algo sobre a CRIANÇA quando a lista chegou: "não tem
 * tratamento" durante o carregamento seria uma frase falsa sobre uma criança real (SEC-TNE-04).
 *
 * Com a lista na mão e um tratamento no campo, ela diz para QUEM o dinheiro vai: a clínica lançava
 * sem saber que o campo decidia o profissional (change `vincular-pagamentos-ao-tratamento`).
 *
 * Com a lista vazia, ela diz o que falta e o CAMINHO para o pacote — o link a quem pode cadastrar,
 * a quem pedir a quem não pode (change `o-sistema-avisa-o-que-falta`). Sai da lista que o campo já
 * carregou: nenhuma requisição a mais.
 */
function ajudaDoCampo({
  podeVer,
  carregando,
  comErro,
  vazio,
  tentarNovamente,
  escolhido,
  vaiPara,
  caminhoDoPacote,
  aoNavegar,
}: EstadoDaLista): ReactNode {
  if (!podeVer) {
    return SEM_PERMISSAO
  }
  if (carregando) {
    return 'Carregando os tratamentos da criança…'
  }
  if (comErro) {
    return (
      <>
        Não foi possível carregar os tratamentos da criança.{' '}
        <Botao variante="fantasma" tamanho="sm" onClick={tentarNovamente}>
          Tentar novamente
        </Botao>
      </>
    )
  }
  if (vazio) {
    return caminhoDoPacote === null ? (
      <span>{CRIANCA_SEM_TRATAMENTO}</span>
    ) : (
      <AvisoDePreRequisito para={caminhoDoPacote} oQueFalta={CRIANCA_SEM_TRATAMENTO} aoNavegar={aoNavegar} />
    )
  }
  if (escolhido && vaiPara !== undefined) {
    return <span>{`Vai para: ${vaiPara}`}</span>
  }

  return AJUDA_DO_TRATAMENTO
}
