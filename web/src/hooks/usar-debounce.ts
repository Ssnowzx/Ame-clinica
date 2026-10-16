import { useEffect, useState } from 'react'

/**
 * Atrasa a propagação de um valor.
 *
 * Na busca de paciente isso não é só performance: sem debounce, digitar "Ana
 * Beatriz" dispara ~10 requisições, cada uma com um prefixo do **nome de um
 * menor** na query string — e o access log guarda todas (SEC-A4). Reduzir o
 * volume não substitui o scrub do log (gatilho do deploy), mas para de
 * multiplicá-lo.
 *
 * @param valor - Valor que muda a cada tecla
 * @param atrasoMs - Silêncio necessário antes de propagar
 */
function useDebounce<T>(valor: T, atrasoMs = 300): T {
  const [atrasado, setAtrasado] = useState(valor)

  useEffect(() => {
    const cronometro = setTimeout(() => {
      setAtrasado(valor)
    }, atrasoMs)

    return () => {
      clearTimeout(cronometro)
    }
  }, [valor, atrasoMs])

  return atrasado
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração
export { useDebounce as usarDebounce }
