import { PainelLancamentos } from '@/componentes/financeiro/painel-lancamentos'

interface SecaoFinanceiroProps {
  pacienteId: number
}

/**
 * Seção Financeiro da ficha (change `financeiro-na-ficha`) — os lançamentos de caixa do
 * paciente, sob `lancamentos.ver`. Reusa o `PainelLancamentos` do módulo financeiro,
 * FIXANDO o filtro por interessado no paciente da ficha: nenhuma tela nova, nenhuma
 * lista paralela. Não há "novo lançamento" aqui — criar é ação da tela global
 * `/financeiro`, onde o interessado é escolhido (o `PainelLancamentos` nasce sem criação
 * quando não recebe `criando`).
 */
export function SecaoFinanceiro({ pacienteId }: SecaoFinanceiroProps) {
  return <PainelLancamentos interessado={{ tipo: 'paciente', id: pacienteId }} />
}
