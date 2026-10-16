import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaEspecialidades } from '@/paginas/pagina-especialidades'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Especialidade } from '@/tipos'

const TUDO = [
  'especialidades.ver',
  'especialidades.criar',
  'especialidades.editar',
  'especialidades.excluir',
]

const FONO: Especialidade = {
  id: 1,
  updated_at: '2026-07-15T10:00:00.000000Z',
  nome: 'Fonoaudiologia',
  cor: '#A85550',
  tempo_sessao: 40,
  exige_termo: false,
  oculta_agendamento_online: false,
}

function renderizar(permissoes: string[] = TUDO) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/especialidades']}>
          <PaginaEspecialidades />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Catálogo — voltar aos Cadastros (padrão do sistema)', () => {
  it('deve oferecer no topo o link de voltar para /cadastros', async () => {
    // ARRANGE + ACT: sem ele, a única saída de uma tela de cadastro é a seta do navegador
    renderizar()

    // ASSERT: a seta é decorativa (aria-hidden) — o nome acessível é só "Cadastros"
    const voltar = await screen.findByRole('link', { name: 'Cadastros' })
    expect(voltar).toHaveAttribute('href', '/cadastros')
  })
})

describe('Catálogo — exclusão recusada por uso', () => {
  it('deve mostrar a recusa no diálogo e manter o registro na lista', async () => {
    // ARRANGE: a recusa vem com a chave da ENTIDADE (`especialidade`), que não é
    // campo de formulário nenhum. Ela cai em `gerais` — e precisa APARECER onde a
    // pessoa está olhando, não só num toast que passa.
    servidor.use(
      msw.get('/api/especialidades', () => HttpResponse.json([FONO])),
      msw.delete('/api/especialidades/:id', () =>
        HttpResponse.json(
          {
            message: 'Recusado.',
            errors: {
              especialidade: [
                'Esta especialidade está vinculada a outros cadastros e não pode ser excluída.',
              ],
            },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Fonoaudiologia')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Excluir' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: /Excluir especialidade/i }))

    // ASSERT
    expect(
      await within(dialog).findByText(
        'Esta especialidade está vinculada a outros cadastros e não pode ser excluída.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Fonoaudiologia')).toBeInTheDocument()
  })

  it('deve nomear o alvo no diálogo — nunca "este registro"', async () => {
    // ARRANGE (§2)
    servidor.use(msw.get('/api/especialidades', () => HttpResponse.json([FONO])))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Fonoaudiologia')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Excluir' }))

    // ASSERT
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Excluir Fonoaudiologia?')).toBeInTheDocument()
  })
})

describe('Catálogo — permissão é experiência; o servidor decide', () => {
  it('deve esconder as ações de quem só pode ver', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/especialidades', () => HttpResponse.json([FONO])))

    // ACT
    renderizar(['especialidades.ver'])
    await screen.findByText('Fonoaudiologia')

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cadastrar especialidade/i })).not.toBeInTheDocument()
  })
})

describe('Catálogo — conflito de edição (concorrência otimista)', () => {
  it('deve avisar no 409, oferecer Recarregar e re-hidratar o formulário com a versão atual', async () => {
    // ARRANGE — a lista serve a versão VELHA; outra pessoa salvou no meio (o PUT
    // leva 409); o Recarregar refaz a leitura e re-hidrata com a versão NOVA
    const usuario = userEvent.setup()
    let noServidor: Especialidade = FONO
    let ifMatchRecebido: string | null = null
    let putsRecebidos = 0
    servidor.use(
      msw.get('/api/especialidades', () => HttpResponse.json([noServidor])),
      msw.put('/api/especialidades/:id', ({ request }) => {
        putsRecebidos += 1
        ifMatchRecebido = request.headers.get('If-Match')
        return HttpResponse.json(
          { message: 'Este registro foi alterado por outra pessoa enquanto você editava.' },
          { status: 409 },
        )
      }),
    )
    renderizar()

    // ACT — abre a edição (hidrata da linha, com o token dela) e tenta salvar
    await screen.findByText('Fonoaudiologia')
    await usuario.click(screen.getByRole('button', { name: /Editar/i }))
    const dialog = await screen.findByRole('alertdialog')
    const campoNome = within(dialog).getByRole('textbox', { name: /Nome/i })
    await usuario.clear(campoNome)
    await usuario.type(campoNome, 'Fonoaudiologia Renomeada')
    // ...enquanto isso, outra pessoa salvou: o servidor já tem outra versão
    noServidor = { ...FONO, nome: 'Fonoaudiologia da Colega', updated_at: '2026-07-15T10:05:00.000000Z' }
    await usuario.click(within(dialog).getByRole('button', { name: /^Salvar$/i }))

    // ASSERT — o PUT levou o token da linha que hidratou (verbatim)...
    expect(ifMatchRecebido).toBe(FONO.updated_at)
    // ...e o conflito NÃO vira laço: exatamente UM PUT por gesto (SEC-OCC-07/I3)
    expect(putsRecebidos).toBe(1)

    // ...o aviso de conflito aparece DENTRO do diálogo, com a saída
    const recarregar = await within(dialog).findByRole('button', { name: 'Recarregar' })
    expect(within(dialog).getByText(/alterado por outra pessoa/)).toBeInTheDocument()

    // ACT 2 — recarrega: o formulário re-hidrata com a versão da colega
    await usuario.click(recarregar)
    await waitFor(() => {
      expect(within(dialog).getByRole('textbox', { name: /Nome/i })).toHaveValue('Fonoaudiologia da Colega')
    })
  })
})
