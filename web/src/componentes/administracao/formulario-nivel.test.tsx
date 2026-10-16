import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { FormularioNivel } from '@/componentes/administracao/formulario-nivel'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { usuarioFicticio, servidor } from '@/test/servidor-msw'
import type { NivelPermissao } from '@/tipos'

/**
 * Quem edita, por padrão, tem tudo o que os catálogos destes testes oferecem — a administradora. Desde
 * `trava-de-usuarios-e-niveis`, a caixa da permissão que a pessoa não tem nasce travada.
 */
const DA_ADMINISTRADORA = [
  'agenda.ver', 'agenda.ver_todos', 'auditoria.ver', 'ciclos.reabrir', 'ciclos.ver', 'clinico.ver_todos',
  'evolucoes.assinar_por_outro', 'evolucoes.ver', 'modulo_novo.ver', 'pacientes.ver', 'tratamentos.criar',
  'tratamentos.ver',
]

function renderizar(nivel: NivelPermissao | null, aoConcluir = vi.fn(), permissoes = DA_ADMINISTRADORA) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <FormularioNivel nivel={nivel} aoConcluir={aoConcluir} aoCancelar={vi.fn()} />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('FormularioNivel — round-trip integral (SEC-ADM-08)', () => {
  it('deve preservar o conjunto inteiro ao salvar sem tocar, inclusive permissão desconhecida e flag', async () => {
    // ARRANGE — o catálogo inclui um módulo desconhecido; o nível carrega ele + uma flag
    const catalogo = ['agenda.ver', 'modulo_novo.ver', 'agenda.ver_todos', 'clinico.ver_todos']
    const nivel: NivelPermissao = {
      id: 3,
      updated_at: '2026-07-15T10:00:00.000000Z',
      nome: 'Nível Herdado',
      permissoes: ['agenda.ver', 'modulo_novo.ver', 'agenda.ver_todos'],
    }
    let payloadRecebido: { permissoes: string[] } | null = null
    servidor.use(
      msw.get('/api/permissoes', () => HttpResponse.json({ permissoes: catalogo })),
      msw.put('/api/niveis-permissao/3', async ({ request }) => {
        payloadRecebido = (await request.json()) as { permissoes: string[] }
        return HttpResponse.json({ ...nivel })
      }),
    )
    renderizar(nivel)

    // espera a grade carregar
    await screen.findByRole('checkbox', { name: 'Agenda: Ver' })

    // ACT — salva sem tocar em nada
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — o conjunto persiste idêntico, sem strip silencioso
    await waitFor(() => {
      expect(payloadRecebido).not.toBeNull()
    })
    expect([...(payloadRecebido as unknown as { permissoes: string[] }).permissoes].sort()).toEqual(
      ['agenda.ver', 'agenda.ver_todos', 'modulo_novo.ver'].sort(),
    )
  })
})

describe('FormularioNivel — escopo fail-closed (SEC-ADM-09)', () => {
  it('deve preservar a permissão que saiu das colunas ao salvar sem tocar (D1)', async () => {
    // ARRANGE — `assinar_por_outro` e `reabrir` existem em UM módulo cada: com a change elas
    // saem das colunas e viram caixa rotulada. Sair da coluna não pode significar sair do payload
    const catalogo = [
      'agenda.ver',
      'evolucoes.ver',
      'evolucoes.assinar_por_outro',
      'ciclos.ver',
      'ciclos.reabrir',
    ]
    const nivel: NivelPermissao = {
      id: 7,
      updated_at: '2026-08-26T10:00:00.000000Z',
      nome: 'Faturamento',
      permissoes: ['agenda.ver', 'evolucoes.assinar_por_outro', 'ciclos.reabrir'],
    }
    let payloadRecebido: { permissoes: string[] } | null = null
    servidor.use(
      msw.get('/api/permissoes', () => HttpResponse.json({ permissoes: catalogo })),
      msw.put('/api/niveis-permissao/7', async ({ request }) => {
        payloadRecebido = (await request.json()) as { permissoes: string[] }
        return HttpResponse.json({ ...nivel })
      }),
    )
    renderizar(nivel)

    // a caixa fora das colunas está lá, marcada
    expect(await screen.findByRole('checkbox', { name: 'Ciclos de faturamento: Reabrir' })).toBeChecked()

    // ACT — salva sem tocar em nada
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — o conjunto volta inteiro (SEC-ADM-08)
    await waitFor(() => {
      expect(payloadRecebido).not.toBeNull()
    })
    expect([...(payloadRecebido as unknown as { permissoes: string[] }).permissoes].sort()).toEqual(
      ['agenda.ver', 'ciclos.reabrir', 'evolucoes.assinar_por_outro'].sort(),
    )
  })

  it('deve deixar o fieldset da grade encolher, para a rolagem horizontal ficar NA grade', async () => {
    // ARRANGE — o `fieldset` nasce com `min-inline-size: min-content` do navegador: sem
    // `min-w-0` ele fica do tamanho da grade e quem rola na horizontal em 390px é o CORPO do
    // diálogo. jsdom não calcula layout, então a guarda é sobre a classe que produz o efeito
    const catalogo = ['agenda.ver', 'pacientes.ver']
    servidor.use(msw.get('/api/permissoes', () => HttpResponse.json({ permissoes: catalogo })))
    renderizar(null)

    // ACT
    const grade = await screen.findByRole('checkbox', { name: 'Agenda: Ver' })

    // ASSERT
    const fieldset = grade.closest('fieldset')
    expect(fieldset?.className).toContain('min-w-0')
  })

  it('deve travar a caixa e a flag que quem edita não tem, e dizer por quê', async () => {
    // ARRANGE — a recepção vê a agenda, mas não a auditoria nem o prontuário da clínica
    servidor.use(
      msw.get('/api/permissoes', () =>
        HttpResponse.json({ permissoes: ['agenda.ver', 'auditoria.ver', 'agenda.ver_todos', 'clinico.ver_todos'] }),
      ),
    )

    // ACT
    renderizar(null, vi.fn(), ['agenda.ver', 'agenda.ver_todos'])

    // ASSERT
    expect(await screen.findByRole('checkbox', { name: 'Agenda: Ver' })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Auditoria: Ver' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /Operar a agenda e os pacotes de toda a clínica/ })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: /Ler o prontuário de toda a clínica/ })).toBeDisabled()
    expect(screen.getByText(/^As permissões que você não tem ficam travadas/)).toBeInTheDocument()
  })

  it('deve não travar nada nem mostrar o aviso a quem tem o catálogo inteiro', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/permissoes', () => HttpResponse.json({ permissoes: ['agenda.ver', 'auditoria.ver'] })))

    // ACT
    renderizar(null)

    // ASSERT
    expect(await screen.findByRole('checkbox', { name: 'Auditoria: Ver' })).toBeEnabled()
    expect(screen.queryByText(/^As permissões que você não tem ficam travadas/)).not.toBeInTheDocument()
  })

  it('deve nascer com as flags de escopo desmarcadas na criação', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/permissoes', () =>
        HttpResponse.json({ permissoes: ['agenda.ver', 'agenda.ver_todos', 'clinico.ver_todos'] }),
      ),
    )

    // ACT
    renderizar(null)

    // ASSERT — as duas flags aparecem na seção de escopo, desmarcadas
    const flagAgenda = await screen.findByRole('checkbox', { name: /Operar a agenda e os pacotes de toda a clínica/ })
    const flagClinico = screen.getByRole('checkbox', { name: /Ler o prontuário de toda a clínica/ })
    expect(flagAgenda).not.toBeChecked()
    expect(flagClinico).not.toBeChecked()
  })
})

describe('FormularioNivel — os avisos das flags de escopo (SEC-VP-37 / SEC-VP-25)', () => {
  it('deve avisar que o nível de balcão sem a flag operacional nasce cego, e calar ao marcá-la', async () => {
    // ARRANGE — a coluna Faturista da matriz antiga: tratamentos.* sem `agenda.ver_todos`
    servidor.use(
      msw.get('/api/permissoes', () =>
        HttpResponse.json({ permissoes: ['tratamentos.ver', 'tratamentos.criar', 'agenda.ver_todos', 'clinico.ver_todos'] }),
      ),
    )
    renderizar(null)
    const criarPacote = await screen.findByRole('checkbox', { name: 'Tratamentos: Criar' })

    // ACT — marca uma permissão operacional sem a flag
    await userEvent.click(criarPacote)

    // ASSERT — o aviso aparece DENTRO da região viva (anunciado, sem interromper: `status`, não `alert`)
    expect(screen.getByRole('status')).toHaveTextContent(/só funciona para usuários vinculados a um profissional/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // ACT — marca a flag operacional
    await userEvent.click(screen.getByRole('checkbox', { name: /Operar a agenda e os pacotes de toda a clínica/ }))

    // ASSERT — o aviso some
    expect(screen.queryByText(/só funciona para usuários vinculados a um profissional/)).not.toBeInTheDocument()
  })

  it('deve não avisar para um nível sem permissão operacional nenhuma', async () => {
    // ARRANGE — um nível só de auditoria não opera nada: o aviso seria ruído
    servidor.use(
      msw.get('/api/permissoes', () =>
        HttpResponse.json({ permissoes: ['auditoria.ver', 'agenda.ver_todos', 'clinico.ver_todos'] }),
      ),
    )
    renderizar(null)

    // ACT
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Auditoria: Ver' }))

    // ASSERT
    expect(screen.queryByText(/só funciona para usuários vinculados a um profissional/)).not.toBeInTheDocument()
  })

  it('deve avisar, ao marcar a flag clínica, que ela abre o prontuário inteiro e não resolve "marcar para colegas"', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/permissoes', () =>
        HttpResponse.json({ permissoes: ['agenda.ver', 'agenda.ver_todos', 'clinico.ver_todos'] }),
      ),
    )
    renderizar(null)
    const flagClinica = await screen.findByRole('checkbox', { name: /Ler o prontuário de toda a clínica/ })
    // a região viva existe VAZIA antes de qualquer aviso (é o que a torna observável)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    // ACT
    await userEvent.click(flagClinica)

    // ASSERT — na região viva, que já existia antes do clique
    expect(screen.getByRole('status')).toHaveTextContent(/abre o prontuário inteiro/)
  })
})
