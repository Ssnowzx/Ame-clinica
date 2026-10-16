import { QueryClient } from '@tanstack/react-query'

import { ErroDeApi } from '@/lib/http'

/** Catálogos (status, especialidades, profissionais, feriados, config) mudam raramente. */
export const TEMPO_CATALOGO_MS = 10 * 60 * 1000
/** A agenda muda o tempo todo — mas não a cada foco de janela. */
export const TEMPO_AGENDA_MS = 30 * 1000
/**
 * O sino reconsulta SOZINHO neste intervalo (alertas-do-mural, design D6): o
 * alerta chega com a tela parada, sem depender de navegação/foco. Constante da
 * FERRAMENTA — não é regra clínica da §13.
 */
export const TEMPO_SINO_MS = 60 * 1000

/**
 * Cliente único da aplicação. É singleton porque o `clear()` no logout e na
 * sessão expirada precisa alcançar TODO o cache (T-sag-08): o balcão é máquina
 * compartilhada e o cache guarda dado de menor.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx é resposta do servidor, não falha transitória: repetir só atrasa a
      // tela (e um 401 em laço é o pesadelo do interceptor)
      retry: (tentativas, erro) => {
        if (erro instanceof ErroDeApi && erro.motivo !== 'rede' && erro.motivo !== 'servidor') {
          return false
        }
        return tentativas < 1
      },
      refetchOnWindowFocus: false,
    },
  },
})
