import { Link } from 'react-router-dom'

import { useAuthStore } from '@/stores/auth-store'
import type { ReferenciaDoItem } from '@/tipos'

/**
 * Nome do paciente nas listas de drill: porta para a ficha SÓ com a permissão do
 * destino (F-02) — sem `pacientes.ver`, o MESMO nome fica texto puro.
 */
export function NomeDoPaciente({ paciente }: { paciente: ReferenciaDoItem | null }) {
  const podeVerFicha = useAuthStore((estado) => estado.temPermissao('pacientes.ver'))
  if (paciente === null) {
    return <>—</>
  }
  if (!podeVerFicha) {
    return <>{paciente.nome ?? '—'}</>
  }

  return (
    <Link
      to={`/pacientes/${paciente.id}`}
      className="rounded-controle font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
    >
      {paciente.nome ?? '—'}
    </Link>
  )
}
