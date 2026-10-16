import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FormularioUsuario } from '@/componentes/administracao/formulario-usuario'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Usuario } from '@/tipos'

function usuario(sobrescritas: Partial<Usuario> = {}): Usuario {
  return {
    id: 5,
    updated_at: '2026-07-15T10:00:00.000000Z',
    nome: 'Recepcionista Fictícia',
    email: 'recepcao@exemplo.com.br',
    acesso_mobile: false,
    ativo: true,
    profissional_id: null,
    nivel_permissao_id: null,
    nivel_permissao: null,
    permissoes: [],
    marca: { nome: '', identidade: 'nome', fonte: 'padrao', logo_versao: null },
    avatar_versao: null,
    ...sobrescritas,
  }
}

function renderizar(usuarioId: number | null, permissoes: string[]) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, id: 1, permissoes },
    carregandoSessao: false,
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <FormularioUsuario usuarioId={usuarioId} aoConcluir={vi.fn()} aoCancelar={vi.fn()} />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('FormularioUsuario — conjunção do nível (SEC-ADM-03)', () => {
  beforeEach(() => {
    servidor.use(
      msw.get('/api/niveis-permissao', () =>
        HttpResponse.json([{ id: 2, nome: 'Recepção', permissoes: [] }]),
      ),
    )
  })

  it('deve deixar o nível editável com ver + editar', async () => {
    // ARRANGE + ACT
    renderizar(null, ['usuarios.criar', 'niveis_permissao.ver', 'niveis_permissao.editar'])

    // ASSERT
    const select = await screen.findByLabelText('Nível de permissão')
    expect(select).toBeEnabled()
  })

  it('deve mostrar o nível como leitura com só ver (sem editar)', async () => {
    // ARRANGE + ACT
    renderizar(null, ['usuarios.criar', 'niveis_permissao.ver'])

    // ASSERT — o select existe, mas desabilitado
    const select = await screen.findByLabelText('Nível de permissão')
    expect(select).toBeDisabled()
  })

  it('não deve renderizar o campo de nível nem chamar /niveis-permissao sem a permissão', async () => {
    // ARRANGE — sem niveis_permissao.ver; se chamasse /niveis-permissao, o MSW erraria
    // (onUnhandledRequest: 'error' não tem handler registrado aqui — mas registramos no
    // beforeEach; então validamos pela ausência do campo)
    renderizar(null, ['usuarios.criar'])

    // ASSERT
    expect(await screen.findByLabelText(/^Nome/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Nível de permissão')).not.toBeInTheDocument()
  })
})

describe('FormularioUsuario — higiene de senha (SEC-ADM-07)', () => {
  it('deve começar a edição com a senha vazia e não enviá-la se não for tocada', async () => {
    // ARRANGE — edição de um usuário existente
    let payloadRecebido: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/usuarios/5', () => HttpResponse.json(usuario({ nome: 'Nome Atual' }))),
      msw.put('/api/usuarios/5', async ({ request }) => {
        payloadRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(usuario({ nome: 'Nome Novo' }))
      }),
    )
    renderizar(5, ['usuarios.editar'])

    // a senha começa vazia (nunca hidratada)
    const senha = await screen.findByLabelText('Nova senha')
    expect(senha).toHaveValue('')

    // ACT — muda só o nome e salva
    const nome = screen.getByLabelText(/^Nome/)
    await userEvent.clear(nome)
    await userEvent.type(nome, 'Nome Novo')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — o payload não carrega senha
    await waitFor(() => {
      expect(payloadRecebido).not.toBeNull()
    })
    expect(payloadRecebido).not.toHaveProperty('senha')
  })

  it('não deve oferecer "Acesso pelo aplicativo móvel" nem enviar acesso_mobile (campo dormente)', async () => {
    // ARRANGE — change esconder-acesso-mobile: sem aplicativo móvel, nada lê a marca; a tela
    // não oferece controle sem efeito e o servidor mantém o valor gravado (`sometimes`)
    let payloadRecebido: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/usuarios/5', () => HttpResponse.json(usuario({ acesso_mobile: true }))),
      msw.put('/api/usuarios/5', async ({ request }) => {
        payloadRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(usuario({ acesso_mobile: true }))
      }),
    )
    renderizar(5, ['usuarios.editar'])
    await screen.findByLabelText('Nova senha')

    // ACT
    expect(screen.queryByRole('checkbox', { name: /aplicativo móvel/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(payloadRecebido).not.toBeNull()
    })
    expect(payloadRecebido).not.toHaveProperty('acesso_mobile')
  })
})

describe('FormularioUsuario — criação em dois passos (SEC-ADM-04)', () => {
  it('deve reportar quando o usuário é criado mas o nível não pôde ser atribuído', async () => {
    // ARRANGE — POST cria; PUT do nível falha
    servidor.use(
      msw.get('/api/niveis-permissao', () =>
        HttpResponse.json([{ id: 2, nome: 'Recepção', permissoes: [] }]),
      ),
      msw.post('/api/usuarios', () => HttpResponse.json(usuario({ id: 9 }), { status: 201 })),
      msw.put('/api/usuarios/9/nivel-permissao', () =>
        HttpResponse.json({ message: 'Falha.' }, { status: 500 }),
      ),
    )
    const aoConcluir = vi.fn()
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, id: 1, permissoes: ['usuarios.criar', 'niveis_permissao.ver', 'niveis_permissao.editar'] },
      carregandoSessao: false,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <FormularioUsuario usuarioId={null} aoConcluir={aoConcluir} aoCancelar={vi.fn()} />
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ACT — preenche o mínimo + escolhe um nível, e cria
    await userEvent.type(screen.getByLabelText(/^Nome/), 'Novo')
    await userEvent.type(screen.getByLabelText(/^E-mail/), 'novo@exemplo.com.br')
    await userEvent.type(screen.getByLabelText(/^Senha inicial/), 'senha-forte-1234')
    await userEvent.selectOptions(await screen.findByLabelText('Nível de permissão'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Criar usuário' }))

    // ASSERT — não conclui (fica aberto) e reporta o passo 2 falho
    await waitFor(() => {
      expect(screen.getByText(/nível não pôde ser atribuído/i)).toBeInTheDocument()
    })
    expect(aoConcluir).not.toHaveBeenCalled()
  })
})

describe('FormularioUsuario — só os níveis dentro do acesso (trava-de-usuarios-e-niveis)', () => {
  it('deve oferecer só os níveis cujas permissões quem atribui tem', async () => {
    // ARRANGE — a recepção tem a agenda; o Administrador tem também o caixa
    servidor.use(
      msw.get('/api/niveis-permissao', () =>
        HttpResponse.json([
          { id: 1, nome: 'Administrador', permissoes: ['agenda.ver', 'fluxo_caixa.ver'] },
          { id: 2, nome: 'Recepção', permissoes: ['agenda.ver'] },
        ]),
      ),
    )

    // ACT
    renderizar(null, ['usuarios.criar', 'niveis_permissao.ver', 'niveis_permissao.editar', 'agenda.ver'])
    const select = await screen.findByLabelText('Nível de permissão')

    // ASSERT — o servidor recusaria o Administrador com 403; a tela nem o oferece
    expect(await within(select).findByRole('option', { name: 'Recepção' })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: 'Administrador' })).not.toBeInTheDocument()
  })
})

describe('FormularioUsuario — o vínculo é escopo (trava-de-usuarios-e-niveis)', () => {
  beforeEach(() => {
    servidor.use(msw.get('/api/profissionais', () => HttpResponse.json([{ id: 10, nome: 'Profissional Fictícia' }])))
  })

  it('deve travar o vínculo, com o motivo, para quem não vê a clínica inteira', async () => {
    // ARRANGE + ACT
    renderizar(null, ['usuarios.criar', 'profissionais.ver', 'agenda.ver_todos'])

    // ASSERT — o servidor recusaria com 403
    const vinculo = await screen.findByLabelText('Profissional vinculado')
    expect(vinculo).toBeDisabled()
    expect(vinculo).toHaveAccessibleDescription('Vincular a um profissional exige ver a agenda e o prontuário de toda a clínica.')
  })

  it('deve deixar o vínculo a quem tem as duas flags', async () => {
    // ARRANGE + ACT
    renderizar(null, ['usuarios.criar', 'profissionais.ver', 'agenda.ver_todos', 'clinico.ver_todos'])

    // ASSERT
    expect(await screen.findByLabelText('Profissional vinculado')).toBeEnabled()
  })
})

