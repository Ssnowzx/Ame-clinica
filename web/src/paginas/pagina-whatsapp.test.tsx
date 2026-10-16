import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it } from 'vitest'

import { ExigePermissao } from '@/componentes/acesso-negado'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaWhatsapp } from '@/paginas/pagina-whatsapp'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { ConexaoWhatsapp } from '@/tipos'

expect.extend(toHaveNoViolations)

const DESCONECTADA: ConexaoWhatsapp = {
  estado: 'nao_conectado',
  phone_number_id: null,
  waba_id: null,
  numero_exibicao: null,
  token_final: null,
  ultimo_teste_em: null,
  ultimo_erro: null,
  webhook_url: 'https://exemplo.test/api/webhooks/whatsapp',
}

const CREDENCIAL = {
  'Phone Number ID': '123456789012345',
  'WABA ID': '987654321098765',
  'Access Token': 'EAAF_TOKEN_FICTICIO_PARA_TESTE_WXYZ',
  'App Secret': 'segredo_ficticio_do_app',
  'Verify Token': 'verify_ficticio_1234',
}

function prepararApi(conexao: ConexaoWhatsapp = DESCONECTADA, aoGravar?: (corpo: unknown) => void) {
  servidor.use(
    msw.get('/api/mensagens/conexao', () => HttpResponse.json(conexao)),
    msw.put('/api/mensagens/conexao', async ({ request }) => {
      aoGravar?.(await request.json())
      return HttpResponse.json({ ...conexao, estado: 'nao_conectado', token_final: 'WXYZ' })
    }),
    msw.post('/api/mensagens/conexao/testar', () =>
      HttpResponse.json({ ...conexao, estado: 'conectado', numero_exibicao: '+55 11 3333-4444' }),
    ),
  )
}

function renderizar(permissoes: string[] = ['mensagens.conectar']) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/configuracoes/whatsapp']}>
          <ExigePermissao permissao="mensagens.conectar">
            <PaginaWhatsapp />
          </ExigePermissao>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

it('deve mostrar a URL do webhook para colar no painel da Meta', async () => {
  // ARRANGE — pedir para alguém montar essa URL à mão é o passo onde o go-live trava
  prepararApi()

  // ACT
  renderizar()

  // ASSERT
  expect(await screen.findByText('https://exemplo.test/api/webhooks/whatsapp')).toBeInTheDocument()
  expect(screen.getByText('Não conectado')).toBeInTheDocument()
})

it('deve exigir os CINCO campos antes de deixar gravar', async () => {
  // ARRANGE — token novo com Phone Number ID antigo é o "manda e não chega" silencioso
  prepararApi()
  const usuario = userEvent.setup()

  // ACT
  renderizar()
  await usuario.type(await screen.findByLabelText(/Phone Number ID/), '123')

  // ASSERT
  expect(screen.getByRole('button', { name: 'Gravar credencial' })).toBeDisabled()
})

it('deve gravar a credencial e LIMPAR o formulário', async () => {
  // ARRANGE — o segredo entra e não sai: o formulário nunca é preenchido de volta
  const gravados: unknown[] = []
  prepararApi(DESCONECTADA, (corpo) => gravados.push(corpo))
  const usuario = userEvent.setup()

  // ACT
  renderizar()
  for (const [rotulo, valor] of Object.entries(CREDENCIAL)) {
    await usuario.type(await screen.findByLabelText(new RegExp(rotulo)), valor)
  }
  await usuario.click(screen.getByRole('button', { name: 'Gravar credencial' }))

  // ASSERT
  await waitFor(() => expect(gravados).toHaveLength(1))
  expect(gravados[0]).toEqual({
    phone_number_id: '123456789012345',
    waba_id: '987654321098765',
    access_token: 'EAAF_TOKEN_FICTICIO_PARA_TESTE_WXYZ',
    app_secret: 'segredo_ficticio_do_app',
    verify_token: 'verify_ficticio_1234',
  })
  await waitFor(() => expect(screen.getByLabelText(/Access Token/)).toHaveValue(''))
})

it('deve mascarar os campos de segredo na digitação', async () => {
  // ARRANGE — a tela de conexão é usada com alguém olhando por cima do ombro
  prepararApi()

  // ACT
  renderizar()

  // ASSERT
  for (const rotulo of ['Access Token', 'App Secret', 'Verify Token']) {
    expect(await screen.findByLabelText(new RegExp(rotulo))).toHaveAttribute('type', 'password')
  }
})

it('deve exibir SÓ os 4 últimos do token de uma conexão já gravada', async () => {
  // ARRANGE — o bastante para confirmar QUAL credencial está em uso
  prepararApi({
    ...DESCONECTADA,
    estado: 'conectado',
    phone_number_id: '123456789012345',
    numero_exibicao: '+55 11 3333-4444',
    token_final: 'WXYZ',
    ultimo_teste_em: '2026-08-12T12:00:00-03:00',
  })

  // ACT
  renderizar()

  // ASSERT
  expect(await screen.findByText(/…WXYZ/)).toBeInTheDocument()
  expect(screen.getByText(/Conectado/)).toBeInTheDocument()
})

it('deve mostrar o MOTIVO quando a Meta recusa a credencial', async () => {
  // ARRANGE — sem diagnóstico, o operador não distingue token expirado de número errado
  prepararApi({
    ...DESCONECTADA,
    estado: 'invalido',
    phone_number_id: '123456789012345',
    ultimo_erro: 'Error validating access token: Session has expired.',
  })

  // ACT
  renderizar()

  // ASSERT
  expect(await screen.findByRole('alert')).toHaveTextContent('Session has expired')
})

it('NÃO deve deixar sincronizar templates com o canal desconectado', async () => {
  // ARRANGE
  prepararApi()

  // ACT
  renderizar()

  // ASSERT
  expect(await screen.findByRole('button', { name: /Sincronizar templates/ })).toBeDisabled()
})

it('deve passar na auditoria de acessibilidade', async () => {
  // ARRANGE
  prepararApi()

  // ACT
  const { container } = renderizar()
  await screen.findByLabelText(/Phone Number ID/)

  // ASSERT
  expect(await axe(container)).toHaveNoViolations()
})
