import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'

import { CampoDeConfiguracao } from '@/componentes/administracao/campo-de-configuracao'
import { MENSAGEM_DE_COBRANCA_VAZIA } from '@/componentes/administracao/campo-mensagem-de-cobranca'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { configuracaoFicticia } from '@/test/dados-configuracoes'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

expect.extend(toHaveNoViolations)

const PADRAO =
  'Olá, {responsavel}! Aqui é da {clinica}. Passando para lembrar do pagamento de {valor} referente a {crianca}, com vencimento em {vencimento}. Se já pagou, desconsidere. Obrigada!'

const ROTULO = 'Mensagem de cobrança pelo WhatsApp'

/** A chave como o catálogo a publica: o widget sai do FORMATO, nunca da chave. */
const MENSAGEM = configuracaoFicticia({
  chave: 'financeiro.mensagem_cobranca',
  rotulo: ROTULO,
  secao: 'financeiro',
  bloco: 'financeiro',
  tipo: 'string',
  valor: PADRAO,
  formato: 'mensagem_cobranca',
})

function renderizar(podeEditar = true) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, marca: { ...usuarioFicticio.marca, nome: 'Clínica Exemplo' } },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <CampoDeConfiguracao config={MENSAGEM} alvos={[]} finalizam={[]} alvosCarregou podeEditar={podeEditar} />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

function previa(): HTMLElement {
  const titulo = screen.getByRole('heading', { name: 'Prévia com dados de exemplo' })
  const regiao = titulo.closest('section')
  if (regiao === null) {
    throw new Error('a prévia não está numa seção')
  }
  return regiao
}

beforeEach(() => {
  queryClient.clear()
})

describe('Mensagem de cobrança — a prévia', () => {
  it('deve mostrar o texto com uma criança e um valor de exemplo', () => {
    // ARRANGE + ACT
    renderizar()

    // ASSERT
    expect(previa()).toHaveTextContent(
      'Olá, Juliana! Aqui é da Clínica Exemplo. Passando para lembrar do pagamento de R$ 450,00 referente a Pedro, com vencimento em 10/10/2026.',
    )
  })

  it('deve acompanhar o que a clínica digita, e deixar a marca errada à vista', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar()
    const campo = screen.getByRole('textbox', { name: ROTULO })

    // ACT
    await usuario.clear(campo)
    // no user-event só a chave que ABRE se escapa (`{{`); a que fecha é literal
    await usuario.type(campo, 'Oi, {{responsavel}: {{paciente} deve {{valor}.')

    // ASSERT — `{paciente}` fica cru, do jeito que chegaria à família
    expect(previa()).toHaveTextContent('Oi, Juliana: {paciente} deve R$ 450,00.')
  })

  it('deve dizer as marcas aceitas junto do campo', () => {
    // ARRANGE + ACT
    renderizar()

    // ASSERT
    const campo = screen.getByRole('textbox', { name: ROTULO })
    expect(campo).toHaveAccessibleDescription(/\{responsavel\}.*\{crianca\}.*\{valor\}.*\{vencimento\}.*\{clinica\}/)
  })
})

describe('Mensagem de cobrança — salvar', () => {
  it('deve gravar o texto e mostrar no campo a recusa que nomeia a marca', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const enviados: unknown[] = []
    servidor.use(
      msw.put('/api/configuracoes', async ({ request }) => {
        enviados.push(await request.json())
        return HttpResponse.json(
          { message: 'inválido', errors: { valor: ['Marca desconhecida: {paciente}. Use {responsavel}, {crianca}, {valor}, {vencimento}, {clinica}.'] } },
          { status: 422 },
        )
      }),
    )
    renderizar()
    const campo = screen.getByRole('textbox', { name: ROTULO })
    await usuario.clear(campo)
    await usuario.type(campo, 'Olá {{paciente}')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    expect(await screen.findByText(/Marca desconhecida: \{paciente\}/)).toBeInTheDocument()
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    expect(enviados).toEqual([{ chave: 'financeiro.mensagem_cobranca', valor: 'Olá {paciente}' }])
  })

  it('deve segurar o Salvar e dizer por quê quando o texto fica vazio', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar()
    const campo = screen.getByRole('textbox', { name: ROTULO })

    // ACT
    await usuario.clear(campo)

    // ASSERT
    expect(await screen.findByText(MENSAGEM_DE_COBRANCA_VAZIA)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('deve limitar o texto ao teto do servidor', () => {
    // ARRANGE + ACT
    renderizar()

    // ASSERT
    expect(screen.getByRole('textbox', { name: ROTULO })).toHaveAttribute('maxLength', '1000')
  })

  it('deve só mostrar, sem Salvar, a quem não edita configurações', () => {
    // ARRANGE + ACT
    renderizar(false)

    // ASSERT
    expect(screen.getByRole('textbox', { name: ROTULO })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument()
    expect(previa()).toHaveTextContent('Juliana')
  })
})

describe('Mensagem de cobrança — acessibilidade', () => {
  it('deve passar no axe com a prévia', async () => {
    // ARRANGE
    const { container } = renderizar()

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })

  it('deve passar no axe com o erro do texto vazio', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { container } = renderizar()
    await usuario.clear(screen.getByRole('textbox', { name: ROTULO }))
    await waitFor(() => {
      expect(screen.getByText(MENSAGEM_DE_COBRANCA_VAZIA)).toBeInTheDocument()
    })

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })
})
