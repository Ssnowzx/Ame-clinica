import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { delay, HttpResponse, http as msw } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AJUDA_DO_ANEXO,
  RECUSA_DO_TAMANHO,
  SecaoAnexosDoLancamento,
} from '@/componentes/financeiro/anexos-do-lancamento'
import { chaves } from '@/lib/chaves-query'
import { queryClient } from '@/lib/query-client'
import { baixarAnexoDoLancamento } from '@/servicos/anexos-do-lancamento'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { AnexoDoLancamento } from '@/tipos'

expect.extend(toHaveNoViolations)

// O download por blob real esbarra no interceptor XHR do jsdom (Blob sem `.stream()`); o SERVIDOR
// do download é provado no Feature da API. Aqui o mock parcial prova o FLUXO: clique → serviço → blob.
vi.mock('@/servicos/anexos-do-lancamento', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/servicos/anexos-do-lancamento')>()),
  baixarAnexoDoLancamento: vi.fn(async () => new Blob(['%PDF-1.4 ficticio'], { type: 'application/pdf' })),
}))

const QUEM_EDITA = ['lancamentos.ver', 'lancamentos.editar']

/** Arquivos e nomes 100% fictícios. */
function anexoFicticio(sobrescritas: Partial<AnexoDoLancamento> = {}): AnexoDoLancamento {
  return {
    id: 9,
    nome: 'comprovante-ficticio.pdf',
    mime: 'application/pdf',
    tamanho: 348160,
    criado_em: '2026-09-24 10:00',
    criado_por: { id: 1, nome: 'Operadora Fictícia' },
    ...sobrescritas,
  }
}

function renderizar(permissoes: string[] = QUEM_EDITA) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <SecaoAnexosDoLancamento lancamentoId={1} />
    </QueryClientProvider>,
  )
}

function campoDeArquivo(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')
  if (input === null) {
    throw new Error('o campo de arquivo não foi renderizado')
  }
  return input
}

beforeEach(() => {
  queryClient.clear()
})

afterEach(() => {
  // jsdom não tem createObjectURL — o teste do download o define; sem restaurar, vaza
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('Anexos do lançamento — os quatro estados', () => {
  it('deve listar nome, tamanho, data e quem enviou', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/lancamentos/1/anexos', () => HttpResponse.json([anexoFicticio()])))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('comprovante-ficticio.pdf')).toBeInTheDocument()
    expect(screen.getByText('340 KB · 24/09/2026 às 10:00 · Operadora Fictícia')).toBeInTheDocument()
  })

  it('deve dizer que não há arquivo e apontar o próximo passo a quem pode anexar', async () => {
    // ARRANGE — o default do servidor de teste é a lista vazia

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText(/Nenhum arquivo anexado\. Use "Anexar arquivo"/)).toBeInTheDocument()
  })

  it('deve mostrar a falha com nova tentativa — falha não vira "nenhum arquivo"', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/lancamentos/1/anexos', () => new HttpResponse(null, { status: 500 })))

    // ACT
    renderizar()

    // ASSERT
    const erro = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(within(erro).getByText('Não foi possível carregar os anexos.')).toBeInTheDocument()
    expect(within(erro).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
    expect(screen.queryByText(/Nenhum arquivo anexado/)).not.toBeInTheDocument()
  })

  it('deve reservar a caixa da lista enquanto carrega', () => {
    // ARRANGE — a lista nunca responde neste teste
    servidor.use(
      msw.get('/api/lancamentos/1/anexos', async () => {
        await delay('infinite')
        return HttpResponse.json([])
      }),
    )

    // ACT
    const { container } = renderizar()

    // ASSERT
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })
})

describe('Anexos do lançamento — as ações seguem a permissão', () => {
  it('deve deixar baixar e não oferecer anexar nem excluir a quem só vê', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/lancamentos/1/anexos', () => HttpResponse.json([anexoFicticio()])))

    // ACT
    renderizar(['lancamentos.ver'])

    // ASSERT
    await screen.findByText('comprovante-ficticio.pdf')
    expect(screen.getByRole('button', { name: 'Baixar comprovante-ficticio.pdf' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anexar arquivo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Excluir/ })).not.toBeInTheDocument()
  })
})

describe('Anexos do lançamento — anexar', () => {
  it('deve dizer os tipos e o tamanho aceitos, ligados ao botão', async () => {
    // ARRANGE + ACT
    renderizar()

    // ASSERT
    const ajuda = await screen.findByText(AJUDA_DO_ANEXO)
    const botao = screen.getByRole('button', { name: 'Anexar arquivo' })
    expect(botao.getAttribute('aria-describedby')).toContain(ajuda.id)
  })

  it('deve mostrar a recusa do servidor no campo, com a razão', async () => {
    // ARRANGE — a extensão passa no seletor; quem recusa pelo CONTEÚDO é o servidor
    const usuario = userEvent.setup()
    servidor.use(
      msw.post('/api/lancamentos/1/anexos', () =>
        HttpResponse.json(
          {
            message: 'inválido',
            errors: { arquivo: ['Formato não aceito. Envie PDF, imagem (JPEG, PNG, WEBP) ou o XML da nota fiscal.'] },
          },
          { status: 422 },
        ),
      ),
    )
    const { container } = renderizar()
    await screen.findByText(/Nenhum arquivo anexado/)

    // ACT
    await usuario.upload(
      campoDeArquivo(container),
      new File(['MZ executavel ficticio'], 'nota.pdf', { type: 'application/pdf' }),
    )

    // ASSERT — a razão pousa sob o botão e é descrição DELE
    const recusa = await screen.findByText(/Formato não aceito/)
    expect(screen.getByRole('button', { name: 'Anexar arquivo' }).getAttribute('aria-describedby')).toContain(
      recusa.closest('p')?.id,
    )
  })

  it('deve ter um só "Anexar arquivo" para o leitor de tela — o campo de arquivo fica fora da árvore', async () => {
    // ARRANGE + ACT
    const { container } = renderizar()
    await screen.findByText(/Nenhum arquivo anexado/)

    // ASSERT — o botão é o controle; o `input` escondido não tem nome nem descrição
    const campo = campoDeArquivo(container)
    expect(campo).toHaveAttribute('hidden')
    expect(campo).not.toHaveAttribute('aria-label')
    expect(campo).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByLabelText('Anexar arquivo')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Anexar arquivo' })).toHaveLength(1)
  })

  it('deve recusar acima de 10 MB antes de enviar', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let envios = 0
    servidor.use(
      msw.post('/api/lancamentos/1/anexos', () => {
        envios += 1
        return HttpResponse.json(anexoFicticio(), { status: 201 })
      }),
    )
    const { container } = renderizar()
    await screen.findByText(/Nenhum arquivo anexado/)
    const grande = new File(['%PDF-1.4'], 'nota-grande.pdf', { type: 'application/pdf' })
    Object.defineProperty(grande, 'size', { value: 10 * 1024 * 1024 + 1 })

    // ACT
    await usuario.upload(campoDeArquivo(container), grande)

    // ASSERT
    expect(await screen.findByText(RECUSA_DO_TAMANHO)).toBeInTheDocument()
    expect(envios).toBe(0)
  })

  it('deve enviar o arquivo no campo `arquivo` e recarregar a lista', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let listagens = 0
    servidor.use(
      msw.get('/api/lancamentos/1/anexos', () => {
        listagens += 1
        return HttpResponse.json(listagens > 1 ? [anexoFicticio({ nome: 'nfe-ficticia.xml', mime: 'text/xml' })] : [])
      }),
      // o multipart REAL é provado no Feature da API; ler o formData aqui esbarra no jsdom
      msw.post('/api/lancamentos/1/anexos', () =>
        HttpResponse.json(anexoFicticio({ nome: 'nfe-ficticia.xml', mime: 'text/xml' }), { status: 201 }),
      ),
    )
    const { container } = renderizar()
    await screen.findByText(/Nenhum arquivo anexado/)

    // ACT
    await usuario.upload(
      campoDeArquivo(container),
      new File(['<?xml version="1.0"?><nfeProc/>'], 'nfe-ficticia.xml', { type: 'text/xml' }),
    )

    // ASSERT
    expect(await screen.findByText('nfe-ficticia.xml')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('"nfe-ficticia.xml" anexado.')
  })

  it('deve atualizar o selo da LISTA sem refazer o detalhe do formulário aberto', async () => {
    // ARRANGE — refazer o detalhe trocaria o `updated_at` que o "Salvar" leva no If-Match: a
    // edição de outra pessoa no meio seria sobrescrita em silêncio
    const usuario = userEvent.setup()
    servidor.use(
      msw.post('/api/lancamentos/1/anexos', () => HttpResponse.json(anexoFicticio(), { status: 201 })),
    )
    queryClient.setQueryData(chaves.lancamentos({ pagina: 1 }), { data: [] })
    queryClient.setQueryData(chaves.lancamento(1), { id: 1 })
    const { container } = renderizar()
    await screen.findByText(/Nenhum arquivo anexado/)

    // ACT
    await usuario.upload(
      campoDeArquivo(container),
      new File(['%PDF-1.4 ficticio'], 'comprovante-ficticio.pdf', { type: 'application/pdf' }),
    )

    // ASSERT
    await waitFor(() => {
      expect(queryClient.getQueryState(chaves.lancamentos({ pagina: 1 }))?.isInvalidated).toBe(true)
    })
    expect(queryClient.getQueryState(chaves.lancamento(1))?.isInvalidated).toBe(false)
  })
})

describe('Anexos do lançamento — excluir e baixar', () => {
  it('deve excluir com confirmação nomeada e devolver o foco a "Anexar arquivo"', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let exclusoes = 0
    servidor.use(
      msw.get('/api/lancamentos/1/anexos', () => HttpResponse.json(exclusoes === 0 ? [anexoFicticio()] : [])),
      msw.delete('/api/lancamentos/anexos/9', () => {
        exclusoes += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderizar()
    await screen.findByText('comprovante-ficticio.pdf')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Excluir comprovante-ficticio.pdf' }))
    expect(await screen.findByText('Excluir o anexo "comprovante-ficticio.pdf"?')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Excluir anexo' }))

    // ASSERT — o botão do item sumiu com ele: o foco não cai no `body`
    expect(await screen.findByText(/Nenhum arquivo anexado/)).toBeInTheDocument()
    expect(exclusoes).toBe(1)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Anexar arquivo' })).toHaveFocus()
    })
  })

  it('deve manter a recusa da exclusão dentro da confirmação', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/lancamentos/1/anexos', () => HttpResponse.json([anexoFicticio()])),
      msw.delete('/api/lancamentos/anexos/9', () => new HttpResponse(null, { status: 403 })),
    )
    renderizar()
    await screen.findByText('comprovante-ficticio.pdf')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Excluir comprovante-ficticio.pdf' }))
    await usuario.click(await screen.findByRole('button', { name: 'Excluir anexo' }))

    // ASSERT
    const dialogo = await screen.findByRole('alertdialog')
    expect(await within(dialogo).findByText('Você não tem acesso a este recurso.')).toBeInTheDocument()
  })

  it('deve refazer a lista quando a exclusão é recusada — o anexo pode já ter saído', async () => {
    // ARRANGE — outra pessoa excluiu o anexo antes: o DELETE volta 404, e a lista nova já não o tem
    const usuario = userEvent.setup()
    let listagens = 0
    servidor.use(
      msw.get('/api/lancamentos/1/anexos', () => {
        listagens += 1
        return HttpResponse.json(listagens === 1 ? [anexoFicticio()] : [])
      }),
      msw.delete('/api/lancamentos/anexos/9', () => HttpResponse.json({ message: 'Não encontrado.' }, { status: 404 })),
    )
    renderizar()
    await screen.findByText('comprovante-ficticio.pdf')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Excluir comprovante-ficticio.pdf' }))
    await usuario.click(await screen.findByRole('button', { name: 'Excluir anexo' }))

    // ASSERT — a recusa fica na confirmação, e a lista por trás é relida do servidor
    await waitFor(() => {
      expect(listagens).toBe(2)
    })
    expect(within(await screen.findByRole('alertdialog')).getByRole('alert')).toBeInTheDocument()
  })

  it('deve baixar pelo caminho autenticado (blob), nunca por URL de armazenamento', async () => {
    // ARRANGE — espiar SÓ os métodos (axios/MSW dependem de `new URL()`)
    const usuario = userEvent.setup()
    const criarUrl = vi.fn(() => 'blob:ficticio')
    URL.createObjectURL = criarUrl as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL
    servidor.use(msw.get('/api/lancamentos/1/anexos', () => HttpResponse.json([anexoFicticio()])))
    renderizar(['lancamentos.ver'])
    await screen.findByText('comprovante-ficticio.pdf')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Baixar comprovante-ficticio.pdf' }))

    // ASSERT
    await waitFor(() => {
      expect(vi.mocked(baixarAnexoDoLancamento)).toHaveBeenCalledWith(9)
    })
    expect(criarUrl).toHaveBeenCalledTimes(1)
  })
})

describe('Anexos do lançamento — acessibilidade', () => {
  it('deve passar no axe com a lista e as ações', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/lancamentos/1/anexos', () => HttpResponse.json([anexoFicticio()])))
    const { container } = renderizar()
    await screen.findByText('comprovante-ficticio.pdf')

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })

  it('deve passar no axe com a recusa no campo', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(
      msw.post('/api/lancamentos/1/anexos', () =>
        HttpResponse.json({ message: 'inválido', errors: { arquivo: ['Formato não aceito.'] } }, { status: 422 }),
      ),
    )
    const { container } = renderizar()
    await screen.findByText(/Nenhum arquivo anexado/)
    await usuario.upload(campoDeArquivo(container), new File(['x'], 'x.pdf', { type: 'application/pdf' }))
    await screen.findByText('Formato não aceito.')

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })
})
