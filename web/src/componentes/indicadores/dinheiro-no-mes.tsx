import type { PainelDoDinheiro } from '@/tipos'

import { CartaoDoIndicador } from '@/componentes/indicadores/cartao-do-indicador'
import {
  EsqueletoDaAba,
  GradeDeCartoes,
  type EsqueletoDeCartao,
} from '@/componentes/indicadores/moldura-dos-indicadores'
import { LinhaDoPeriodo } from '@/componentes/indicadores/linha-do-periodo'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import {
  DEFINICAO_DO_A_RECEBER,
  DEFINICAO_DO_ATRASO,
  DEFINICAO_DO_RECEBIDO,
  DEFINICAO_DO_VALOR_MEDIO,
} from '@/lib/indicadores/definicoes'
import { compararMoeda, formatarMoeda, mesAntesDoHistorico, plural } from '@/lib/indicadores/frases'
import { usePainelDoDinheiro } from '@/lib/indicadores/paineis'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Os quatro cartões, sem frase (cada um já diz o número, a legenda e a comparação) — o esqueleto
 * reserva igual: a legenda quebra em duas no cartão estreito ("vence de hoje até o fim do mês"), e o atraso
 * tem a porta para quem abre o financeiro.
 */
function cartoesDoDinheiro(podeAbrirFinanceiro: boolean): readonly EsqueletoDeCartao[] {
  const semFrase = { linhasDaFrase: 0, linhasDaLegenda: [2, 2, 1] } as const

  return [
    { rotulo: 'Recebido', ...semFrase },
    { rotulo: 'A receber no mês', ...semFrase },
    { rotulo: 'A receber em atraso', ...semFrase, comPorta: podeAbrirFinanceiro },
    { rotulo: 'Valor médio por sessão', ...semFrase },
  ]
}

/** A grandeza que é uma FOTO do momento: no lugar da comparação, esta linha neutra (DQ-05). */
const DE_HOJE = 'situação de hoje'

/**
 * O topo da aba FINANCEIRO (change indicadores-profissionais): a linha do período e os quatro cartões
 * do painel do dinheiro — recebido, a receber no mês, em atraso e valor médio por sessão. Os gráficos
 * que a aba já tinha continuam embaixo. Mesma `fluxo_caixa.ver` da aba.
 *
 * No mês anterior ao histórico, a linha do período diz que não há dados e os cartões somem; os gráficos de
 * baixo seguem — eles leem o caixa do ano, que tem outra régua de tempo.
 */
export function DinheiroNoMes({ mes }: { mes: string }) {
  const consulta = usePainelDoDinheiro(mes)
  const podeAbrirFinanceiro = useAuthStore((estado) => estado.usuario?.permissoes.includes('lancamentos.ver') === true)

  if (consulta.isPending) {
    return (
      <EsqueletoDaAba titulo="Dinheiro no mês" cartoes={cartoesDoDinheiro(podeAbrirFinanceiro)} quadros={0} />
    )
  }
  if (consulta.isError) {
    return (
      <EstadoErro
        mensagem="Não foi possível carregar os números do dinheiro."
        aoTentarNovamente={() => void consulta.refetch()}
      />
    )
  }
  const painel = consulta.data
  if (mesAntesDoHistorico(painel)) {
    return <LinhaDoPeriodo base={painel} />
  }

  return (
    <>
      <LinhaDoPeriodo base={painel} />
      <CartoesDoDinheiro painel={painel} />
    </>
  )
}

/**
 * Os quatro cartões com a MESMA anatomia (DQ-05): número, legenda curta e a linha de baixo — a
 * comparação no que se compara (recebido, valor médio), "situação de hoje" no que é foto do momento
 * (o que ainda vai vencer, o que está em atraso).
 */
function CartoesDoDinheiro({ painel }: { painel: PainelDoDinheiro }) {
  const podeAbrirFinanceiro = useAuthStore((estado) => estado.usuario?.permissoes.includes('lancamentos.ver') === true)
  const { periodo } = painel

  return (
    <GradeDeCartoes quantidade={4}>
      <CartaoDoIndicador
        rotulo="Recebido"
        valor={formatarMoeda(painel.recebido.atual)}
        legenda="pelo regime de caixa"
        comparacao={compararMoeda(painel.recebido, periodo, 'subir-e-bom')}
        definicao={DEFINICAO_DO_RECEBIDO}
      />
      <CartaoDoIndicador
        rotulo="A receber no mês"
        valor={formatarMoeda(painel.a_receber_no_mes)}
        legenda="vence de hoje até o fim do mês"
        contexto={DE_HOJE}
        definicao={DEFINICAO_DO_A_RECEBER}
      />
      <CartaoDoIndicador
        rotulo="A receber em atraso"
        valor={formatarMoeda(painel.em_atraso.valor)}
        legenda={
          painel.em_atraso.quantidade === 0
            ? 'nenhuma receita vencida'
            : plural(painel.em_atraso.quantidade, 'receita vencida', 'receitas vencidas')
        }
        contexto={DE_HOJE}
        definicao={DEFINICAO_DO_ATRASO}
        porta={podeAbrirFinanceiro && painel.em_atraso.quantidade > 0 ? { para: '/financeiro', rotulo: 'Abrir o financeiro' } : undefined}
      />
      <CartaoDoIndicador
        rotulo="Valor médio por sessão"
        valor={painel.valor_medio_sessao.atual === null ? null : formatarMoeda(painel.valor_medio_sessao.atual)}
        legenda={painel.valor_medio_sessao.atual === null ? 'sem sessão faturada no período' : 'por sessão faturada'}
        comparacao={compararMoeda(painel.valor_medio_sessao, periodo, 'subir-e-bom')}
        definicao={DEFINICAO_DO_VALOR_MEDIO}
      />
    </GradeDeCartoes>
  )
}
