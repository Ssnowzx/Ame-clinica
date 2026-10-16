import { useQuery } from '@tanstack/react-query'

import { chaves } from '@/lib/chaves-query'
import { conferirTelefone } from '@/servicos/pacientes'
import { useAuthStore } from '@/stores/auth-store'
import type { TelefoneEmUso } from '@/tipos'

/** Um minuto: tempo de terminar a ficha sem perguntar de novo pelo mesmo número. */
const TEMPO_DA_RESPOSTA_MS = 60 * 1000

/**
 * Os outros pacientes com este número (change telefone-que-chega-no-whatsapp, D6).
 *
 * Pergunta UMA vez por número (a forma canônica é a chave: com ou sem máscara é a mesma pergunta) e
 * só para quem pode ver pacientes — a fila faz pré-cadastro sem `pacientes.ver`, e para ela a
 * pergunta nem sai. Recusa ou falha de rede viram "nada a dizer": o alerta é ajuda, e nunca trava
 * o cadastro.
 *
 * @param forma - A forma canônica do número digitado; `null` = não pergunta (inválido ou em foco)
 * @param ignorarPacienteId - O próprio paciente em edição, que não conta como "outro"
 */
function useTelefoneEmUso(forma: string | null, ignorarPacienteId: number | null): TelefoneEmUso | null {
  const podeVer = useAuthStore((estado) => estado.temPermissao('pacientes.ver'))
  const consulta = useQuery({
    queryKey: chaves.telefoneEmUso(forma ?? '', ignorarPacienteId),
    queryFn: () => conferirTelefone(forma ?? '', ignorarPacienteId ?? undefined),
    enabled: podeVer && forma !== null,
    staleTime: TEMPO_DA_RESPOSTA_MS,
    retry: false,
  })

  // sem a permissão, nem o que estiver no cache aparece (gate r3, SEC-TEL-07)
  return forma === null || !podeVer ? null : (consulta.data ?? null)
}

export { useTelefoneEmUso as usarTelefoneEmUso }
