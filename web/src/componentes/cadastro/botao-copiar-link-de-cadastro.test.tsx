import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BotaoCopiarLinkDeCadastro } from '@/componentes/cadastro/botao-copiar-link-de-cadastro'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

const LINK_LIGADO = { slug: 'abc123', ativo: true, url: 'https://clinica.exemplo/cadastro/abc123' }

function renderizar(permissoes: string[]) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <BotaoCopiarLinkDeCadastro />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('BotaoCopiarLinkDeCadastro — o link onde a atendente está', () => {
  afterEach(() => {
    queryClient.clear()
    vi.restoreAllMocks()
  })

  it('deve copiar o endereço para quem cadastra crianças, com o link ligado', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/cadastro-online/link', () => HttpResponse.json(LINK_LIGADO)))
    // o `setup()` do user-event instala a própria área de transferência — é ela que se lê
    const usuario = userEvent.setup()
    renderizar(['pacientes.criar'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Copiar link do cadastro' }))

    // ASSERT
    expect(await navigator.clipboard.readText()).toBe(LINK_LIGADO.url)
    expect(await screen.findByText('Link do cadastro copiado.')).toBeInTheDocument()
  })

  it('deve não aparecer com o link desligado — endereço que não responde não se manda à família', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/cadastro-online/link', () => HttpResponse.json({ ...LINK_LIGADO, ativo: false })))
    renderizar(['pacientes.criar'])

    // ACT + ASSERT: a consulta termina e o botão continua ausente
    await waitFor(() => {
      expect(queryClient.getQueryState(['link-de-cadastro'])?.status).toBe('success')
    })
    expect(screen.queryByRole('button', { name: 'Copiar link do cadastro' })).not.toBeInTheDocument()
  })

  it('deve nem consultar o endereço para quem não pode pegá-lo', async () => {
    // ARRANGE
    const chamou = vi.fn()
    servidor.use(
      msw.get('/api/cadastro-online/link', () => {
        chamou()

        return HttpResponse.json(LINK_LIGADO)
      }),
    )

    // ACT
    renderizar(['agenda.ver'])

    // ASSERT: a consulta existe DESLIGADA (nunca buscou), e só então "não chamou" prova algo —
    // afirmar logo depois do render passaria mesmo com a consulta ligada (SEC-LR-F3)
    await waitFor(() => {
      expect(queryClient.getQueryState(['link-de-cadastro'])?.fetchStatus).toBe('idle')
    })
    expect(queryClient.getQueryState(['link-de-cadastro'])?.status).toBe('pending')
    expect(screen.queryByRole('button', { name: 'Copiar link do cadastro' })).not.toBeInTheDocument()
    expect(chamou).not.toHaveBeenCalled()
  })
})
