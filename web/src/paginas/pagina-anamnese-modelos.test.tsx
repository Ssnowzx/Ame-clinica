import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaAnamneseModelos } from '@/paginas/pagina-anamnese-modelos'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { AnamneseModelo } from '@/tipos'

const TUDO = [
  'anamnese_modelos.ver',
  'anamnese_modelos.criar',
  'anamnese_modelos.editar',
  'anamnese_modelos.excluir',
]

function modelo(sobrescritas: Partial<AnamneseModelo> = {}): AnamneseModelo {
  return {
    id: 1,
    updated_at: '2026-07-20T10:00:00.000000Z',
    titulo: 'Anamnese ABA',
    especialidade_id: null,
    ativo: true,
    campos_json: [
      { id: 'queixa', tipo: 'texto', rotulo: 'Queixa principal', obrigatorio: true },
    ],
    ...sobrescritas,
  }
}

const LISTA: AnamneseModelo[] = [
  modelo(),
  modelo({
    id: 2,
    titulo: 'Anamnese Fono',
    ativo: false,
    campos_json: [
      { id: 'fala', tipo: 'texto', rotulo: 'Desenvolvimento da fala', obrigatorio: false },
      { id: 'nivel', tipo: 'opcoes', rotulo: 'Nível', obrigatorio: true, opcoes: ['Leve', 'Grave'] },
    ],
  }),
]

function renderizar(permissoes: string[] = TUDO) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/anamnese-modelos']}>
          <PaginaAnamneseModelos />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

async function abrirCriacao(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(screen.getByRole('button', { name: 'Cadastrar modelo' }))
  return screen.findByRole('alertdialog')
}

beforeEach(() => {
  queryClient.clear()
})

describe('Modelos de anamnese — lista e seus quatro estados', () => {
  it('deve listar os modelos com título, contagem de campos e situação', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/anamnese-modelos', () => HttpResponse.json(LISTA)))

    // ACT
    renderizar()
    const linhaAba = await screen.findByRole('row', { name: /Anamnese ABA/ })

    // ASSERT: a contagem de campos e a situação vêm por linha
    expect(within(linhaAba).getByText('1')).toBeInTheDocument()
    expect(within(linhaAba).getByText('Ativo')).toBeInTheDocument()
    const linhaFono = screen.getByRole('row', { name: /Anamnese Fono/ })
    expect(within(linhaFono).getByText('Inativo')).toBeInTheDocument()
  })

  it('deve mostrar erro com "tentar novamente" quando a lista falha — nunca "vazio"', async () => {
    // ARRANGE: falha de rede não pode virar "nenhum modelo"
    servidor.use(msw.get('/api/anamnese-modelos', () => new HttpResponse(null, { status: 500 })))

    // ACT
    renderizar()

    // ASSERT (o 500 re-tenta 1× com backoff — o erro leva mais que o timeout padrão)
    expect(
      await screen.findByText('Não foi possível carregar.', undefined, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tentar novamente/i })).toBeInTheDocument()
    expect(screen.queryByText('Nenhum modelo de anamnese')).not.toBeInTheDocument()
  })

  it('deve mostrar o estado vazio quando não há modelo', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/anamnese-modelos', () => HttpResponse.json([])))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhum modelo de anamnese')).toBeInTheDocument()
  })
})

describe('Modelos de anamnese — afordância segue a permissão', () => {
  it('deve esconder toda escrita de quem só tem ver', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/anamnese-modelos', () => HttpResponse.json(LISTA)))

    // ACT
    renderizar(['anamnese_modelos.ver'])
    await screen.findByRole('row', { name: /Anamnese ABA/ })

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Cadastrar modelo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Inativar|Ativar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('deve oferecer editar mas não excluir para quem não tem excluir', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/anamnese-modelos', () => HttpResponse.json(LISTA)))

    // ACT
    renderizar(['anamnese_modelos.ver', 'anamnese_modelos.criar', 'anamnese_modelos.editar'])
    const linha = await screen.findByRole('row', { name: /Anamnese ABA/ })

    // ASSERT
    expect(within(linha).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(within(linha).queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})

describe('Modelos de anamnese — builder de campos', () => {
  it('deve revelar as opções só no tipo "Opções"', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/anamnese-modelos', () => HttpResponse.json(LISTA)))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('row', { name: /Anamnese ABA/ })

    // ACT
    const dialog = await abrirCriacao(usuario)
    const tipo = within(dialog).getByRole('combobox', { name: /Tipo/i })
    await usuario.selectOptions(tipo, 'opcoes')

    // ASSERT: o sub-editor de opções aparece
    expect(within(dialog).getByRole('button', { name: 'Adicionar opção' })).toBeInTheDocument()

    // ACT 2: voltar para texto o esconde
    await usuario.selectOptions(tipo, 'texto')

    // ASSERT 2
    expect(within(dialog).queryByRole('button', { name: 'Adicionar opção' })).not.toBeInTheDocument()
  })

  it('deve reordenar os campos ao mover para cima', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/anamnese-modelos', () => HttpResponse.json(LISTA)))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('row', { name: /Anamnese ABA/ })
    const dialog = await abrirCriacao(usuario)

    // ACT: dois campos "Primeiro" e "Segundo", depois sobe o 2º
    await usuario.click(within(dialog).getByRole('button', { name: 'Adicionar campo' }))
    const rotulos = () => within(dialog).getAllByRole('textbox', { name: /Rótulo do campo/i })
    await usuario.type(rotulos()[0], 'Primeiro')
    await usuario.type(rotulos()[1], 'Segundo')
    await usuario.click(within(dialog).getByRole('button', { name: /Mover o campo 2 para cima/i }))

    // ASSERT: a ordem inverteu
    expect(rotulos()[0]).toHaveValue('Segundo')
    expect(rotulos()[1]).toHaveValue('Primeiro')
  })

  it('deve bloquear o envio de um modelo sem nenhum campo', async () => {
    // ARRANGE
    let postou = false
    servidor.use(
      msw.get('/api/anamnese-modelos', () => HttpResponse.json(LISTA)),
      msw.post('/api/anamnese-modelos', () => {
        postou = true
        return HttpResponse.json(modelo(), { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('row', { name: /Anamnese ABA/ })
    const dialog = await abrirCriacao(usuario)

    // ACT: remove o único campo, dá título e tenta salvar
    await usuario.type(within(dialog).getByRole('textbox', { name: /Título do modelo/i }), 'Vazio')
    await usuario.click(within(dialog).getByRole('button', { name: /Remover o campo 1/i }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT: bloqueou no cliente e não tocou a rede
    expect(within(dialog).getByText('Adicione ao menos um campo ao modelo.')).toBeInTheDocument()
    expect(postou).toBe(false)
  })

  it('deve criar o modelo enviando o campos_json tipado', async () => {
    // ARRANGE
    let corpo: { titulo: string; campos_json: unknown[] } | null = null
    servidor.use(
      msw.get('/api/anamnese-modelos', () => HttpResponse.json(LISTA)),
      msw.post('/api/anamnese-modelos', async ({ request }) => {
        corpo = (await request.json()) as { titulo: string; campos_json: unknown[] }
        return HttpResponse.json(modelo({ id: 9, titulo: corpo.titulo }), { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('row', { name: /Anamnese ABA/ })
    const dialog = await abrirCriacao(usuario)

    // ACT
    await usuario.type(
      within(dialog).getByRole('textbox', { name: /Título do modelo/i }),
      'Anamnese Inicial',
    )
    await usuario.type(within(dialog).getByRole('textbox', { name: /Rótulo do campo/i }), 'Queixa principal')
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT: o payload chegou com o campo tipado e id derivado do rótulo
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo!.titulo).toBe('Anamnese Inicial')
    expect(corpo!.campos_json).toEqual([
      { id: 'queixa_principal', tipo: 'texto', rotulo: 'Queixa principal', obrigatorio: false },
    ])
  })

  it('deve PRESERVAR o id do campo e mandar o If-Match ao editar (ANM-SNAPSHOT + concorrência)', async () => {
    // ARRANGE: renomear um campo já respondido NÃO pode trocar seu id — isso orfanaria
    // a resposta na leitura da anamnese. O `idOriginal` é preservado; só o rótulo muda. E
    // a edição pelo form leva o `updated_at` no If-Match (concorrência otimista).
    let corpo: { campos_json: Array<{ id: string; rotulo: string }> } | null = null
    let versao: string | null = null
    servidor.use(
      msw.get('/api/anamnese-modelos', () => HttpResponse.json(LISTA)),
      msw.put('/api/anamnese-modelos/:id', async ({ request }) => {
        versao = request.headers.get('If-Match')
        corpo = (await request.json()) as { campos_json: Array<{ id: string; rotulo: string }> }
        return HttpResponse.json(modelo())
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    const linha = await screen.findByRole('row', { name: /Anamnese ABA/ })

    // ACT: abrir a edição e renomear o campo cujo id persistido é 'queixa'
    await usuario.click(within(linha).getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const rotulo = within(dialog).getByRole('textbox', { name: /Rótulo do campo/i })
    await usuario.clear(rotulo)
    await usuario.type(rotulo, 'Queixa inicial')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT: o id continua 'queixa' (NÃO vira 'queixa_inicial'); só o rótulo mudou;
    // e a versão que hidratou a linha foi no If-Match
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo!.campos_json[0].id).toBe('queixa')
    expect(corpo!.campos_json[0].rotulo).toBe('Queixa inicial')
    expect(versao).toBe('2026-07-20T10:00:00.000000Z')
  })

  it('deve comunicar o conflito de versão sem sobrescrever, na edição', async () => {
    // ARRANGE: o PUT volta 409 (outra pessoa alterou o modelo enquanto este editava)
    servidor.use(
      msw.get('/api/anamnese-modelos', () => HttpResponse.json(LISTA)),
      msw.put('/api/anamnese-modelos/:id', () =>
        HttpResponse.json({ message: 'Conflito.' }, { status: 409 }),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    const linha = await screen.findByRole('row', { name: /Anamnese ABA/ })

    // ACT
    await usuario.click(within(linha).getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const rotulo = within(dialog).getByRole('textbox', { name: /Rótulo do campo/i })
    await usuario.clear(rotulo)
    await usuario.type(rotulo, 'Outro rótulo')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT: a tela avisa do conflito NO formulário e o diálogo permanece aberto
    expect(await within(dialog).findByText(/alterado por outra pessoa/i)).toBeInTheDocument()
  })
})

describe('Modelos de anamnese — a API é a autoridade', () => {
  it('deve ancorar o 422 de título duplicado no campo título', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/anamnese-modelos', () => HttpResponse.json(LISTA)),
      msw.post('/api/anamnese-modelos', () =>
        HttpResponse.json(
          { message: 'Recusado.', errors: { titulo: ['Já existe um modelo de anamnese com este título.'] } },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('row', { name: /Anamnese ABA/ })
    const dialog = await abrirCriacao(usuario)

    // ACT: um modelo válido no cliente, recusado no servidor
    await usuario.type(within(dialog).getByRole('textbox', { name: /Título do modelo/i }), 'Anamnese ABA')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Rótulo do campo/i }), 'Queixa')
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT: a mensagem aparece no formulário, o diálogo permanece
    expect(
      await within(dialog).findByText('Já existe um modelo de anamnese com este título.'),
    ).toBeInTheDocument()
  })

  it('deve mostrar a recusa de exclusão por uso e manter o modelo na lista', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/anamnese-modelos', () => HttpResponse.json(LISTA)),
      msw.delete('/api/anamnese-modelos/:id', () =>
        HttpResponse.json(
          {
            message: 'Recusado.',
            errors: { anamnese_modelo: ['Este modelo está vinculado a anamneses e não pode ser excluído.'] },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    const linha = await screen.findByRole('row', { name: /Anamnese ABA/ })

    // ACT
    await usuario.click(within(linha).getByRole('button', { name: 'Excluir' }))
    const confirmacao = await screen.findByRole('alertdialog')
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Excluir modelo' }))

    // ASSERT: a recusa aparece NO diálogo (também há o toast) e o modelo continua listado
    expect(
      await within(confirmacao).findByText(
        'Este modelo está vinculado a anamneses e não pode ser excluído.',
      ),
    ).toBeInTheDocument()
    // a linha fica sob `aria-hidden` com o diálogo aberto — `getByText` a encontra mesmo assim
    expect(screen.getByText('Anamnese ABA')).toBeInTheDocument()
  })
})

describe('Modelos de anamnese — ativar/inativar sem abrir o form', () => {
  it('deve reenviar o payload completo com ativo invertido', async () => {
    // ARRANGE
    let corpo: { ativo: boolean; campos_json: unknown[]; titulo: string } | null = null
    let versao: string | null = null
    servidor.use(
      msw.get('/api/anamnese-modelos', () => HttpResponse.json(LISTA)),
      msw.put('/api/anamnese-modelos/:id', async ({ request }) => {
        versao = request.headers.get('If-Match')
        corpo = (await request.json()) as { ativo: boolean; campos_json: unknown[]; titulo: string }
        return HttpResponse.json(modelo({ ativo: false }))
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    const linha = await screen.findByRole('row', { name: /Anamnese ABA/ })

    // ACT: inativar o modelo ativo
    await usuario.click(within(linha).getByRole('button', { name: 'Inativar' }))

    // ASSERT: manda o payload inteiro, com ativo=false e a versão no If-Match
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo!.ativo).toBe(false)
    expect(corpo!.titulo).toBe('Anamnese ABA')
    expect(corpo!.campos_json).toEqual(LISTA[0].campos_json)
    expect(versao).toBe('2026-07-20T10:00:00.000000Z')
  })
})
