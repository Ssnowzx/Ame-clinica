import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { BuscaDeOutroPaciente } from '@/componentes/pacientes/ficha/busca-de-outro-paciente'
import { queryClient } from '@/lib/query-client'
import { servidor } from '@/test/servidor-msw'

const PACIENTES = [
  { id: 13, nome: 'Criança Aberta Fictícia', nome_social: null, nascimento: '2018-01-01', necessidade: 'nenhuma', ativo: true },
  { id: 14, nome: 'Outra Criança Fictícia', nome_social: null, nascimento: '2019-02-02', necessidade: 'nenhuma', ativo: true },
]

/** Requisições ao cadastro — é com elas que se prova o que a tela NÃO pede. */
let chamadas: string[] = []

function renderizar(pacienteAberto = 13) {
  servidor.use(
    msw.get('/api/pacientes', ({ request }) => {
      chamadas.push(new URL(request.url).search)
      return HttpResponse.json({ data: PACIENTES, current_page: 1, last_page: 1, per_page: 20, total: 2 })
    }),
  )

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BuscaDeOutroPaciente secaoAtiva="painel" pacienteAberto={pacienteAberto} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
  chamadas = []
})

describe('BuscaDeOutroPaciente', () => {
  it('deve não consultar o cadastro enquanto ninguém abre a caixa', async () => {
    // ARRANGE + ACT: montar a ficha não é pedir para escolher — e o `index` do cadastro
    // devolve `nascimento` e `necessidade` (dado de saúde) de 50 crianças por página
    renderizar()

    // ASSERT
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /Pesquisar outro paciente/ })).toBeInTheDocument()
    })
    expect(chamadas).toEqual([])
  })

  it('NÃO deve girar o spinner com a caixa fechada', async () => {
    // ARRANGE + ACT — a consulta da lista é `enabled: aberto && !buscando`, e query DESABILITADA
    // fica `isPending` para sempre no TanStack v5: sem a guarda `aberto &&`, o campo fechado
    // exibia o spinner girando eternamente, e a ficha abria parecendo travada
    renderizar()

    // ASSERT — o spinner é o `LoaderCircle` do campo; fechado, a caixa mostra a seta
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /Pesquisar outro paciente/ })).toBeInTheDocument()
    })
    expect(document.querySelector('.animate-spin')).toBeNull()
  })

  it('deve listar ao abrir, sem oferecer o paciente que já está na tela', async () => {
    // ARRANGE: o campo se chama "pesquisar OUTRO paciente"
    const usuario = userEvent.setup()
    renderizar(13)

    // ACT
    await usuario.click(screen.getByRole('combobox', { name: /Pesquisar outro paciente/ }))

    // ASSERT
    expect(await screen.findByRole('option', { name: 'Outra Criança Fictícia' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Criança Aberta Fictícia' })).not.toBeInTheDocument()
  })

  it('deve pedir a página com teto próprio, e não o do cadastro', async () => {
    // ARRANGE: escolher um nome não justifica puxar 50 fichas com dado de saúde
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(screen.getByRole('combobox', { name: /Pesquisar outro paciente/ }))

    // ASSERT
    await waitFor(() => {
      expect(chamadas.length).toBeGreaterThan(0)
    })
    expect(chamadas[0]).toContain('per_page=20')
  })

  it('deve limpar o campo ao escolher — o nome do menor não pode virar busca', async () => {
    // ARRANGE: `/pacientes/:id/:secao` é a MESMA rota, então o componente não remonta; o nome
    // que sobrasse no campo viraria `?busca=<nome do menor>` 300ms depois (SEC-BPL-02)
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(screen.getByRole('combobox', { name: /Pesquisar outro paciente/ }))
    await usuario.click(await screen.findByRole('option', { name: 'Outra Criança Fictícia' }))

    // ASSERT
    expect(screen.getByRole('combobox', { name: /Pesquisar outro paciente/ })).toHaveValue('')
    await new Promise((resolver) => setTimeout(resolver, 400))
    expect(chamadas.filter((busca) => busca.includes('busca='))).toEqual([])
  })
})
