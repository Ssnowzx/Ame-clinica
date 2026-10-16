import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CardPreCadastro } from '@/componentes/lista-espera/card-pre-cadastro'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { pacienteFicticio, reguaFicticia } from '@/test/dados-cadastros'
import { servidor } from '@/test/servidor-msw'

/**
 * O BALCÃO OBEDECE À RÉGUA (achado CR-B2, metade cliente).
 *
 * O bloqueante original: com `sexo` escondido, o pré-cadastro ficava IMPOSSÍVEL. O card
 * mandava a chave incondicionalmente e o servidor recusa a presença dela — escolher um
 * valor dava 422, deixar vazio virava `null` no `ConvertEmptyStringsToNull` e dava 422
 * igual. Não havia caminho de criação.
 *
 * O servidor está provado nos dois estados (`ListagemLeAReguaTest`); este arquivo é a rede
 * do lado cliente, que faltava — apagar o `pedeSexo` mantinha a suíte inteira verde.
 *
 * Dados 100% FICTÍCIOS (LGPD).
 */

function renderizar(regua = reguaFicticia()) {
  servidor.use(
    msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
    msw.get('/api/campos-cadastro/:formulario', () => HttpResponse.json(regua)),
  )

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <CardPreCadastro aoCriar={vi.fn()} aoCancelar={vi.fn()} />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Card de pré-cadastro — a régua alcança o balcão', () => {
  it('deve pedir o sexo enquanto a clínica o mostra no cadastro', async () => {
    // ARRANGE + ACT
    renderizar()

    // ASSERT
    expect(await screen.findByLabelText(/^Sexo/)).toBeInTheDocument()
  })

  it('NÃO deve pedir nem ENVIAR o sexo que a clínica escondeu', async () => {
    // ARRANGE — o servidor recusa a PRESENÇA da chave, com qualquer valor
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null

    renderizar(reguaFicticia({ sexo: { desabilitado: true } }))
    servidor.use(
      msw.post('/api/pacientes/pre-cadastro', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(pacienteFicticio(), { status: 201 })
      }),
    )

    // ACT
    await usuario.type(await screen.findByLabelText(/^Nome/), 'Criança Fictícia do Balcão')
    await usuario.type(screen.getByLabelText(/Telefone/), '48999990000')
    await usuario.click(screen.getByRole('button', { name: 'Criar e selecionar' }))

    // ASSERT — o campo some da tela E a chave some do payload
    expect(screen.queryByLabelText(/^Sexo/)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    const payload = enviado as unknown as Record<string, unknown>
    expect(Object.keys(payload)).not.toContain('sexo')
    expect(Object.keys(payload)).toContain('nome')
    expect(Object.keys(payload)).toContain('telefone')
  })
  it('deve avisar o telefone que não recebe WhatsApp, sem impedir o pré-cadastro', async () => {
    // ARRANGE — change telefone-que-chega-no-whatsapp
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    renderizar()
    servidor.use(
      msw.post('/api/pacientes/pre-cadastro', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(pacienteFicticio(), { status: 201 })
      }),
    )
    await usuario.type(await screen.findByLabelText(/^Nome/), 'Criança Fictícia do Balcão')
    const telefone = screen.getByLabelText(/Telefone/)

    // ACT
    await usuario.type(telefone, '(49) 49912-3456')
    await usuario.tab()

    // ASSERT
    expect(telefone).toHaveAccessibleDescription(/não recebe WhatsApp/)

    // ACT
    await usuario.selectOptions(screen.getByLabelText(/^Sexo/), 'feminino')
    await usuario.click(screen.getByRole('button', { name: 'Criar e selecionar' }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).toMatchObject({ telefone: '(49) 49912-3456' })
    })
  })
})
