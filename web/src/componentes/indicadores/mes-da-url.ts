import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

import { mesNoAlcance } from '@/componentes/indicadores/periodo-dos-indicadores'
import { ehMesValido } from '@/lib/meses'

/**
 * O MÊS de um painel, guardado na URL (`?mes=`) — da área de Indicadores e da ficha do profissional.
 * Guardar em store sobreviveria à troca de tela, mas não ao link copiado, nem ao Voltar, nem ao F5: e a
 * clínica manda link de tela por mensagem.
 *
 * Mês ausente ou malformado vale o corrente. Mês FUTURO (o "Próximo mês" no mês corrente, um link
 * editado) ou anterior a 2000 levava os painéis a 422 e os cartões a um "Tentar novamente" sem saída
 * (CR-IND-17): vira o corrente, e a URL se corrige junto (`replace`) — o link copiado dali em diante é
 * o do mês que a tela mostra.
 *
 * Em arquivo sem componente para não quebrar o fast refresh.
 */
export function useMesDaUrl(
  mesCorrente: string,
  /**
   * O fuso da clínica já chegou? Na virada do mês, o fuso provisório (São Paulo) poderia achar "futuro"
   * o mês que, na parede da clínica, já é o corrente — e a correção ficaria gravada no link.
   */
  fusoConhecido: boolean,
): { mes: string; trocarMes: (proximo: string) => void } {
  const [parametros, setParametros] = useSearchParams()
  const mesDaUrl = parametros.get('mes')
  const pedido = mesDaUrl !== null && ehMesValido(mesDaUrl) ? mesDaUrl : null
  const foraDoAlcance = pedido !== null && mesNoAlcance(pedido, mesCorrente) !== pedido
  const mes = pedido === null || foraDoAlcance ? mesCorrente : pedido

  function trocarMes(proximo: string): void {
    const proximos = new URLSearchParams(parametros)
    proximos.set('mes', mesNoAlcance(proximo, mesCorrente))
    setParametros(proximos, { replace: true })
  }

  useEffect(() => {
    if (foraDoAlcance && fusoConhecido) {
      setParametros(
        (atuais) => {
          const proximos = new URLSearchParams(atuais)
          proximos.set('mes', mesCorrente)

          return proximos
        },
        { replace: true },
      )
    }
  }, [foraDoAlcance, fusoConhecido, mesCorrente, setParametros])

  return { mes, trocarMes }
}
