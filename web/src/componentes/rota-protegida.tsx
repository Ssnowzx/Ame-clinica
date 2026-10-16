import { Navigate, Outlet } from 'react-router-dom'

import { useAuthStore } from '@/stores/auth-store'

export function RotaProtegida() {
  const usuario = useAuthStore((estado) => estado.usuario)
  const carregandoSessao = useAuthStore((estado) => estado.carregandoSessao)

  if (carregandoSessao) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-texto-suave">Carregando…</p>
      </main>
    )
  }

  if (usuario === null) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
