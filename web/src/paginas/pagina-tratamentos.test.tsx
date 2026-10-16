import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaTratamentos } from '@/paginas/pagina-tratamentos'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { TratamentoDaLista } from '@/tipos'

/** Forma REAL da LISTAGEM: sem os campos detail-only, com os derivados do pedido. */
function tratamento(sobrescritas: Partial<TratamentoDaLista> = {}): TratamentoDaLista {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    paciente_id: 10,
    convenio_id: 1,
    especialidade_id: 1,
    profissional_id: 1,
    servico_id: null,
    sessoes_total: 10,
    sessoes_realizadas: 9,
    realce: 'nenhum' as const,
    sessoes_saldo: 1,
    vencido: false,
    data_inicio: '2026-06-01',
    validade_dias: 180,
    pedido_vence_em: null,
    pedido_vencido: false,
    status: 'andamento',
    paciente: { id: 10, nome: 'Paciente Fictício', nome_social: null },
    ...sobrescritas,
  }
}

function pagina(itens: TratamentoDaLista[]) {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}

function renderizar(
  permissoes: string[] = ['tratamentos.ver', 'pacientes.ver'],
  caminho = '/tratamentos',
) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[caminho]}>
          <PaginaTratamentos />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Lista de tratamentos — o filtro é do SERVIDOR', () => {
  it('deve pedir ao servidor os que estão acabando, não filtrar depois de paginar', async () => {
    // ARRANGE: filtrar no cliente daria resposta ERRADA — a página é uma amostra, não o
    // conjunto. E recalcular `vencido` no navegador usaria o fuso do CLIENTE.
    const pedidos: string[] = []
    servidor.use(
      msw.get('/api/tratamentos', ({ request }) => {
        pedidos.push(new URL(request.url).search)
        return HttpResponse.json(pagina([tratamento()]))
      }),
    )

    // ACT
    renderizar()
    await screen.findByText('Paciente Fictício')

    // ASSERT: o recorte padrão pergunta ao servidor quem está acabando — e NÃO manda o
    // número. O limiar é dado da clínica (§13); a tela dizia `saldo_max=2` com uma constante
    // própria, que podia divergir do número do selo e do contador.
    expect(pedidos[0]).toContain('status=andamento')
    expect(pedidos[0]).toContain('acabando=1')
    expect(pedidos[0]).not.toContain('saldo_max')
  })

  it('deve trocar de recorte pedindo ao servidor de novo', async () => {
    // ARRANGE
    const pedidos: string[] = []
    servidor.use(
      msw.get('/api/tratamentos', ({ request }) => {
        pedidos.push(new URL(request.url).search)
        return HttpResponse.json(pagina([tratamento({ vencido: true })]))
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Paciente Fictício')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Vencidos' }))

    // ASSERT
    await waitFor(() => {
      expect(pedidos.some((busca) => busca.includes('vencido=1'))).toBe(true)
    })
  })
})

describe('Lista de tratamentos — o que ela mostra e o que ela esconde', () => {
  it('deve destacar quem está acabando com ícone e texto, nunca só cor', async () => {
    // ARRANGE (§2: cor jamais é o único canal)
    servidor.use(
      msw.get('/api/tratamentos', () =>
        HttpResponse.json(pagina([tratamento({ sessoes_saldo: 1, realce: 'acabando' })])),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Última sessão')).toBeInTheDocument()
  })

  it('deve marcar o vencido porque o servidor disse', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/tratamentos', () => HttpResponse.json(pagina([tratamento({ vencido: true })]))),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Vencido')).toBeInTheDocument()
  })

  it('deve não exibir matrícula nem guia — são identificadores do MENOR no convênio', async () => {
    // ARRANGE: a API os omite da listagem (minimização). A tela não os reintroduz —
    // mesmo que um dia venham no payload por engano.
    // os identificadores entram FORA do tipo de propósito: `TratamentoDaLista` não os
    // tem justamente porque a API não os manda — aqui se simula o serializer que
    // voltasse a mandá-los por engano, e a tela ainda assim não os exibe
    const comIdentificadores = { ...tratamento(), matricula: 'MAT-1', guia: 'G-1' }
    servidor.use(
      msw.get('/api/tratamentos', () => HttpResponse.json(pagina([comIdentificadores]))),
    )

    // ACT
    renderizar()
    await screen.findByText('Paciente Fictício')

    // ASSERT
    expect(screen.queryByText('MAT-1')).not.toBeInTheDocument()
    expect(screen.queryByText('G-1')).not.toBeInTheDocument()
  })

  it('deve não oferecer link para o cadastro a quem não pode abri-lo', async () => {
    // ARRANGE: o nome vem por whitelist (sem exigir `pacientes.ver`). Oferecer um caminho
    // que termina em "acesso negado" é mentir para a recepção.
    servidor.use(msw.get('/api/tratamentos', () => HttpResponse.json(pagina([tratamento()]))))

    // ACT
    renderizar(['tratamentos.ver'])
    await screen.findByText('Paciente Fictício')

    // ASSERT: o nome aparece; o link, não
    expect(screen.queryByRole('link', { name: 'Paciente Fictício' })).not.toBeInTheDocument()
  })

  it('deve levar ao cadastro quem tem permissão', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/tratamentos', () => HttpResponse.json(pagina([tratamento()]))))

    // ACT
    renderizar()

    // ASSERT
    const link = await screen.findByRole('link', { name: 'Paciente Fictício' })
    expect(link).toHaveAttribute('href', '/pacientes/10')
  })

  it('deve dizer que ninguém está acabando quando o recorte vem vazio', async () => {
    // ARRANGE: lista vazia aqui é BOA notícia — e a tela precisa dizer isso, não parecer
    // quebrada
    servidor.use(msw.get('/api/tratamentos', () => HttpResponse.json(pagina([]))))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhum tratamento acabando')).toBeInTheDocument()
  })

  it('deve mostrar erro com nova tentativa — falha de rede não é "nenhum tratamento"', async () => {
    // ARRANGE: a lição já registrada — falha de consulta NUNCA vira lista vazia
    servidor.use(
      msw.get('/api/tratamentos', () => new HttpResponse(null, { status: 500 })),
    )

    // ACT
    renderizar()

    // ASSERT
    const erro = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(within(erro).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
    expect(screen.queryByText('Nenhum tratamento acabando')).not.toBeInTheDocument()
  })

  it('deve recortar por profissional e dar a volta à ficha quando chega por ela', async () => {
    // ARRANGE — a porta da ficha chega com `?profissional_id=` (feedback do usuário:
    // não havia caminho de volta) — o recorte default vira "Todos"
    const filtrosPedidos: Array<string | null> = []
    servidor.use(
      msw.get('/api/tratamentos', ({ request }) => {
        filtrosPedidos.push(new URL(request.url).searchParams.get('profissional_id'))
        return HttpResponse.json(pagina([tratamento()]))
      }),
    )

    // ACT
    renderizar(['tratamentos.ver', 'pacientes.ver'], '/tratamentos?profissional_id=7')

    // ASSERT — o filtro vai ao servidor; a volta aponta à ficha; lixo na URL não quebra
    expect(await screen.findByRole('link', { name: /Ficha do profissional/ })).toHaveAttribute(
      'href',
      '/profissionais/7',
    )
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true')
    expect(filtrosPedidos).toContain('7')
  })
})
