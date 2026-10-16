import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { SecaoAnamnese } from '@/componentes/pacientes/ficha/secao-anamnese'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import {
  anamneseDaListaFicticia,
  anamneseFicticia,
  modeloFicticio,
  paginaDeAnamneses,
} from '@/test/dados-anamnese'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

const TUDO = ['anamneses.ver', 'anamneses.criar', 'anamneses.editar', 'anamnese_modelos.ver']

function renderizar(permissoes: string[] = TUDO) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <SecaoAnamnese pacienteId={1} />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Seção Anamnese — a lista é só metadados (art. 11)', () => {
  it('deve listar por modelo e data, sem NUNCA exibir respostas na linha', async () => {
    // ARRANGE — a resposta existe no detalhe, mas o index não a traz; a linha não pode revelá-la
    let leituras = 0
    servidor.use(
      msw.get('/api/pacientes/1/anamneses', () =>
        HttpResponse.json(paginaDeAnamneses([anamneseDaListaFicticia()])),
      ),
      msw.get('/api/anamneses/:id', () => {
        leituras += 1
        return HttpResponse.json(anamneseFicticia())
      }),
    )

    // ACT
    renderizar()

    // ASSERT — metadados presentes; a resposta 'Fala fictícia...' NÃO aparece; nenhum show em render
    expect(await screen.findByText('Triagem Fictícia')).toBeInTheDocument()
    expect(screen.getByText('10/07/2026 às 09:30')).toBeInTheDocument()
    expect(screen.queryByText(/Fala fictícia/)).not.toBeInTheDocument()
    expect(leituras).toBe(0)
  })

  it('deve NÃO disparar leitura (show) em hover nem em foco de uma linha (SEC-ANM-07)', async () => {
    // ARRANGE — auditoria-em-massa-por-mouseover é o risco; só o clique deliberado lê
    const usuario = userEvent.setup()
    let leituras = 0
    servidor.use(
      msw.get('/api/pacientes/1/anamneses', () =>
        HttpResponse.json(paginaDeAnamneses([anamneseDaListaFicticia()])),
      ),
      msw.get('/api/anamneses/:id', () => {
        leituras += 1
        return HttpResponse.json(anamneseFicticia())
      }),
    )
    renderizar()
    const abrir = await screen.findByRole('button', { name: /Abrir anamnese de Triagem Fictícia/ })

    // ACT — hover e foco na linha/ação
    await usuario.hover(abrir)
    await usuario.tab()

    // ASSERT — nenhuma leitura auditada foi disparada
    expect(leituras).toBe(0)
  })

  it('deve abrir UMA anamnese com UM GET /anamneses/{id} ao clicar em Abrir', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let leituras = 0
    servidor.use(
      msw.get('/api/pacientes/1/anamneses', () =>
        HttpResponse.json(paginaDeAnamneses([anamneseDaListaFicticia()])),
      ),
      msw.get('/api/anamnese-modelos', () => HttpResponse.json([modeloFicticio()])),
      msw.get('/api/anamneses/:id', () => {
        leituras += 1
        return HttpResponse.json(anamneseFicticia())
      }),
    )
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Abrir anamnese de Triagem Fictícia/ }))

    // ASSERT — a leitura acontece uma vez, e a resposta aparece (por rótulo) no diálogo
    expect(await screen.findByText('Fala fictícia da triagem')).toBeInTheDocument()
    expect(leituras).toBe(1)
  })
})

describe('Seção Anamnese — os quatro estados da lista', () => {
  it('deve mostrar o estado de carregando antes dos dados', () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/1/anamneses', () =>
        HttpResponse.json(paginaDeAnamneses([anamneseDaListaFicticia()])),
      ),
    )

    // ACT
    const { container } = renderizar()

    // ASSERT — o container dos skeletons anuncia carregando à TA
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('deve mostrar o VAZIO com próxima ação quando não há anamneses', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/1/anamneses', () => HttpResponse.json(paginaDeAnamneses([]))),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhuma anamnese registrada')).toBeInTheDocument()
  })

  it('deve mostrar ERRO com repetir, e nunca "0 anamneses", numa recusa (403 não re-tenta)', async () => {
    // ARRANGE — contador que exibe "0" numa falha diria "sem anamneses" (mentira clínica)
    servidor.use(
      msw.get('/api/pacientes/1/anamneses', () => new HttpResponse(null, { status: 403 })),
    )

    // ACT
    renderizar()

    // ASSERT
    const erro = await screen.findByRole('alert')
    expect(erro).toHaveTextContent(/Não foi possível carregar/)
    expect(screen.queryByText('0 anamneses')).not.toBeInTheDocument()
  })
})

describe('Seção Anamnese — "Nova" pela conjunção de permissões (SEC-ANM-04)', () => {
  beforeEach(() => {
    servidor.use(
      msw.get('/api/pacientes/1/anamneses', () => HttpResponse.json(paginaDeAnamneses([]))),
    )
  })

  it('deve oferecer "Nova anamnese" ativa com anamneses.criar E anamnese_modelos.ver', async () => {
    // ARRANGE + ACT
    renderizar(['anamneses.ver', 'anamneses.criar', 'anamnese_modelos.ver'])

    // ASSERT — botão presente e habilitado (há dois: header e estado vazio)
    const botoes = await screen.findAllByRole('button', { name: 'Nova anamnese' })
    expect(botoes.length).toBeGreaterThan(0)
    botoes.forEach((botao) => expect(botao).toBeEnabled())
  })

  it('deve DEGRADAR desabilitada com motivo sem anamnese_modelos.ver', async () => {
    // ARRANGE + ACT — tem criar, não tem ver-modelos: não promete um form que não popula
    renderizar(['anamneses.ver', 'anamneses.criar'])

    // ASSERT
    const botoes = await screen.findAllByRole('button', { name: 'Nova anamnese' })
    botoes.forEach((botao) => expect(botao).toBeDisabled())
    expect(
      screen.getAllByText(/É preciso acesso aos modelos de anamnese/).length,
    ).toBeGreaterThan(0)
  })

  it('deve NÃO oferecer "Nova anamnese" sem anamneses.criar', async () => {
    // ARRANGE + ACT
    renderizar(['anamneses.ver'])

    // ASSERT
    await screen.findByText('Nenhuma anamnese registrada')
    expect(screen.queryByRole('button', { name: 'Nova anamnese' })).not.toBeInTheDocument()
  })
})

describe('Seção Anamnese — criar a partir de um modelo ativo', () => {
  const CRIAR = ['anamneses.ver', 'anamneses.criar', 'anamnese_modelos.ver']

  it('deve oferecer SÓ modelos ativos na criação (a API recusa inativo)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/pacientes/1/anamneses', () => HttpResponse.json(paginaDeAnamneses([]))),
      msw.get('/api/anamnese-modelos', () =>
        HttpResponse.json([
          modeloFicticio({ id: 1, titulo: 'Ativo Fictício', ativo: true }),
          modeloFicticio({ id: 2, titulo: 'Inativo Fictício', ativo: false }),
        ]),
      ),
    )
    renderizar(CRIAR)

    // ACT — abre "Nova anamnese"
    await usuario.click((await screen.findAllByRole('button', { name: 'Nova anamnese' }))[0])

    // ASSERT — só o ativo é oferecido
    expect(await screen.findByRole('option', { name: 'Ativo Fictício' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Inativo Fictício' })).not.toBeInTheDocument()
  })

  it('deve criar enviando modelo_id + respostas_json tipadas (POST)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let postBody: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/pacientes/1/anamneses', () => HttpResponse.json(paginaDeAnamneses([]))),
      msw.get('/api/anamnese-modelos', () =>
        HttpResponse.json([
          modeloFicticio({
            campos_json: [{ id: 'queixa', tipo: 'texto', rotulo: 'Queixa principal', obrigatorio: true }],
          }),
        ]),
      ),
      msw.post('/api/pacientes/1/anamneses', async ({ request }) => {
        postBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(anamneseFicticia(), { status: 201 })
      }),
    )
    renderizar(CRIAR)

    // ACT — escolhe modelo, preenche e salva
    await usuario.click((await screen.findAllByRole('button', { name: 'Nova anamnese' }))[0])
    await usuario.selectOptions(await screen.findByLabelText(/Modelo de anamnese/), 'Triagem Fictícia')
    await usuario.type(await screen.findByLabelText(/Queixa principal/), 'Fala fictícia nova')
    await usuario.click(screen.getByRole('button', { name: 'Salvar anamnese' }))

    // ASSERT — o POST leva modelo_id + respostas_json (só isso)
    await waitFor(() => expect(postBody).not.toBeNull())
    expect(postBody).toEqual({ modelo_id: 1, respostas_json: { queixa: 'Fala fictícia nova' } })
  })
})

describe('Seção Anamnese — sem modelo ativo, a saída (o-sistema-avisa-o-que-falta)', () => {
  const CRIAR = ['anamneses.ver', 'anamneses.criar', 'anamnese_modelos.ver']
  const CRIAR_E_CADASTRAR_MODELO = [...CRIAR, 'anamnese_modelos.criar']
  const SO_INATIVO = [modeloFicticio({ id: 2, titulo: 'Inativo Fictício', ativo: false })]

  function renderizarComRotas(permissoes: string[], modelos: ReturnType<typeof modeloFicticio>[]) {
    servidor.use(
      msw.get('/api/pacientes/1/anamneses', () => HttpResponse.json(paginaDeAnamneses([]))),
      msw.get('/api/anamnese-modelos', () => HttpResponse.json(modelos)),
    )
    useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

    return render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter initialEntries={['/pacientes/1/anamnese']}>
            <SecaoAnamnese pacienteId={1} />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
  }

  async function abrirNova(usuario: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await usuario.click((await screen.findAllByRole('button', { name: 'Nova anamnese' }))[0])
    return screen.findByRole('dialog', { name: 'Nova anamnese' })
  }

  it('deve oferecer "Cadastrar modelo de anamnese" a quem pode cadastrar, sem o "Salvar" mudo', async () => {
    // ARRANGE — só há modelo inativo: nada a preencher
    const usuario = userEvent.setup()
    renderizarComRotas(CRIAR_E_CADASTRAR_MODELO, SO_INATIVO)

    // ACT
    const dialogo = await abrirNova(usuario)

    // ASSERT — a saída, e nenhum "Salvar" desabilitado mudo; o "Fechar" é o do cabeçalho, um só
    expect(await within(dialogo).findByRole('heading', { name: 'Nenhum modelo de anamnese ativo' })).toBeInTheDocument()
    expect(within(dialogo).getByRole('link', { name: 'Cadastrar modelo de anamnese' })).toHaveAttribute(
      'href',
      '/anamnese-modelos',
    )
    expect(within(dialogo).queryByRole('button', { name: 'Salvar anamnese' })).not.toBeInTheDocument()
    expect(within(dialogo).queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
    expect(within(dialogo).getAllByRole('button', { name: 'Fechar' })).toHaveLength(1)
  })

  it('deve fechar o diálogo ao seguir o caminho para o cadastro de modelos', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarComRotas(CRIAR_E_CADASTRAR_MODELO, [])
    const dialogo = await abrirNova(usuario)

    // ACT
    await usuario.click(await within(dialogo).findByRole('link', { name: 'Cadastrar modelo de anamnese' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('deve dizer a quem pedir, sem link, a quem não pode cadastrar modelo', async () => {
    // ARRANGE — quem só preenche levaria 403 no cadastro de modelos
    const usuario = userEvent.setup()
    renderizarComRotas(CRIAR, SO_INATIVO)

    // ACT
    const dialogo = await abrirNova(usuario)

    // ASSERT
    expect(await within(dialogo).findByText('Peça a quem administra o sistema para cadastrar.')).toBeInTheDocument()
    expect(within(dialogo).queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve descrever o diálogo pelo aviso, para quem usa leitor de tela ouvir o motivo ao abrir', async () => {
    // ARRANGE — o foco abre no "Fechar": sem descrição, o leitor dizia só "Nova anamnese" (A11Y-AVI-03)
    const usuario = userEvent.setup()
    renderizarComRotas(CRIAR, SO_INATIVO)

    // ACT
    const dialogo = await abrirNova(usuario)
    await within(dialogo).findByRole('heading', { name: 'Nenhum modelo de anamnese ativo' })

    // ASSERT — o que falta, por quê e a quem pedir
    expect(dialogo).toHaveAccessibleDescription(
      /^Nenhum modelo de anamnese ativo\s*A anamnese é preenchida a partir de um modelo ativo do cadastro de modelos\.\s*Peça a quem administra o sistema para cadastrar\.$/,
    )
  })

  it('não deve descrever o diálogo pelo aviso quando há modelo ativo', async () => {
    // ARRANGE + ACT — o caso comum: nada muda
    const usuario = userEvent.setup()
    renderizarComRotas(CRIAR_E_CADASTRAR_MODELO, [modeloFicticio()])
    const dialogo = await abrirNova(usuario)
    await within(dialogo).findByRole('option', { name: 'Triagem Fictícia' })

    // ASSERT
    expect(dialogo).toHaveAccessibleDescription('')
  })

  it('deve manter "Cancelar" e "Salvar anamnese" quando há modelo ativo', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarComRotas(CRIAR_E_CADASTRAR_MODELO, [modeloFicticio()])

    // ACT
    const dialogo = await abrirNova(usuario)

    // ASSERT
    await within(dialogo).findByRole('option', { name: 'Triagem Fictícia' })
    expect(within(dialogo).getByRole('button', { name: 'Salvar anamnese' })).toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(within(dialogo).queryByRole('link', { name: 'Cadastrar modelo de anamnese' })).not.toBeInTheDocument()
  })

  it('deve abrir o diálogo com as mesmas requisições, com e sem modelo ativo (nenhuma requisição nova)', async () => {
    // ARRANGE — o aviso sai da lista de modelos que o diálogo já busca ao abrir (D6)
    async function requisicoesAoAbrir(modelos: ReturnType<typeof modeloFicticio>[]): Promise<string[]> {
      queryClient.clear()
      const usuario = userEvent.setup()
      const { unmount } = renderizarComRotas(CRIAR_E_CADASTRAR_MODELO, modelos)
      await screen.findByText('Nenhuma anamnese registrada')
      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0)
      })
      const pedidas: string[] = []
      const anotar = ({ request }: { request: Request }): void => {
        pedidas.push(`${request.method} ${new URL(request.url).pathname}`)
      }
      servidor.events.on('request:start', anotar)
      const dialogo = await abrirNova(usuario)
      await within(dialogo).findByRole(modelos.some((modelo) => modelo.ativo) ? 'combobox' : 'heading', {
        name: /Modelo de anamnese|Nenhum modelo de anamnese ativo/,
      })
      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0)
      })
      servidor.events.removeListener('request:start', anotar)
      unmount()
      return pedidas.sort()
    }

    // ACT
    const comAviso = await requisicoesAoAbrir(SO_INATIVO)
    const semAviso = await requisicoesAoAbrir([modeloFicticio()])

    // ASSERT
    expect(comAviso.length).toBeGreaterThan(0)
    expect(comAviso).toEqual(semAviso)
  })
})
