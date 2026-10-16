import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SecaoAnexos } from '@/componentes/pacientes/ficha/secao-anexos'
import { queryClient } from '@/lib/query-client'
import { baixarAnexo } from '@/servicos/anexos'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { AnexoDoPaciente } from '@/tipos'

// O download por blob real esbarra em limitação do interceptor XHR do jsdom
// (Blob sem .stream()); o SERVIDOR do download é provado no Feature (AB-04/07).
// Aqui o mock parcial prova o FLUXO da tela: clique → serviço → blob → âncora.
vi.mock('@/servicos/anexos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/servicos/anexos')>()),
  baixarAnexo: vi.fn(async () => new Blob(['%PDF-1.4 ficticio'], { type: 'application/pdf' })),
}))

const TUDO = ['anexos.ver', 'anexos.criar', 'anexos.excluir']

function anexoFicticio(sobrescreve: Partial<AnexoDoPaciente> = {}): AnexoDoPaciente {
  return {
    id: 9,
    nome: 'encaminhamento-ficticio.pdf',
    mime: 'application/pdf',
    tamanho: 348160,
    criado_em: '2026-07-18 10:00',
    criado_por: { id: 1, nome: 'Operadora Fictícia' },
    ...sobrescreve,
  }
}

function renderizar(permissoes: string[] = TUDO) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SecaoAnexos pacienteId={1} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

afterEach(() => {
  // jsdom não tem createObjectURL — o teste do download o define; sem restaurar,
  // o stub vaza para os demais arquivos da suite (CR nit r1)
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('Seção Anexos — metadados na lista, ações por permissão', () => {
  it('deve listar nome, tamanho legível, data e autor', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/1/anexos', () => HttpResponse.json([anexoFicticio()])),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('encaminhamento-ficticio.pdf')).toBeInTheDocument()
    expect(screen.getByText('340 KB')).toBeInTheDocument()
    expect(screen.getByText('18/07/2026 às 10:00')).toBeInTheDocument()
    expect(screen.getByText('Operadora Fictícia')).toBeInTheDocument()
  })

  it('deve NÃO renderizar envio sem anexos.criar nem excluir sem anexos.excluir', async () => {
    // ARRANGE — só leitura
    servidor.use(
      msw.get('/api/pacientes/1/anexos', () => HttpResponse.json([anexoFicticio()])),
    )

    // ACT
    renderizar(['anexos.ver'])

    // ASSERT — baixar existe; anexar e excluir não são promessa
    await screen.findByText('encaminhamento-ficticio.pdf')
    expect(screen.getByRole('button', { name: /Baixar/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Anexar documento/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Excluir/ })).not.toBeInTheDocument()
  })

  it('deve declarar os limites ANTES do erro e mostrar o 422 legível do servidor', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/pacientes/1/anexos', () => HttpResponse.json([])),
      msw.post('/api/pacientes/1/anexos', () =>
        HttpResponse.json(
          { message: 'inválido', errors: { arquivo: ['Formato não aceito. Envie PDF, JPEG ou PNG.'] } },
          { status: 422 },
        ),
      ),
    )
    const { container } = renderizar()
    expect(await screen.findByText('PDF, JPEG ou PNG · até 10 MB')).toBeInTheDocument()

    // ACT — a extensão passa no accept do input; quem recusa (pelo CONTEÚDO) é o servidor
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await usuario.upload(
      input as HTMLInputElement,
      new File(['<html>não sou pdf</html>'], 'mentiroso.pdf', { type: 'application/pdf' }),
    )

    // ASSERT
    expect(await screen.findByText('Formato não aceito. Envie PDF, JPEG ou PNG.')).toBeInTheDocument()
  })

  it('deve ter um só "Anexar documento" para o leitor de tela — o campo de arquivo fica fora da árvore', async () => {
    // ARRANGE + ACT
    servidor.use(msw.get('/api/pacientes/1/anexos', () => HttpResponse.json([])))
    const { container } = renderizar()
    expect(await screen.findByText('PDF, JPEG ou PNG · até 10 MB')).toBeInTheDocument()

    // ASSERT — o botão é o controle; o `input` escondido não tem nome
    const campo = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(campo).toHaveAttribute('hidden')
    expect(campo).not.toHaveAttribute('aria-label')
    expect(screen.queryByLabelText('Anexar documento')).not.toBeInTheDocument()
  })

  it('deve enviar o arquivo e recarregar a lista', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let listagens = 0
    servidor.use(
      msw.get('/api/pacientes/1/anexos', () => {
        listagens += 1
        return HttpResponse.json(listagens > 1 ? [anexoFicticio({ nome: 'novo-ficticio.pdf' })] : [])
      }),
      // o multipart REAL (campo `arquivo`) é provado no Feature da API; ler o
      // formData aqui esbarra em limitação do interceptor XHR do jsdom
      msw.post('/api/pacientes/1/anexos', () =>
        HttpResponse.json(anexoFicticio({ nome: 'novo-ficticio.pdf' }), { status: 201 }),
      ),
    )
    const { container } = renderizar()
    await screen.findByText('Nenhum documento anexado')

    // ACT
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await usuario.upload(
      input as HTMLInputElement,
      new File(['%PDF-1.4 ficticio'], 'novo-ficticio.pdf', { type: 'application/pdf' }),
    )

    // ASSERT — a lista foi invalidada e recarregou com o novo
    expect(await screen.findByText('novo-ficticio.pdf')).toBeInTheDocument()
  })

  it('deve excluir com confirmação destrutiva nomeando o anexo', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let exclusoes = 0
    servidor.use(
      msw.get('/api/pacientes/1/anexos', () =>
        HttpResponse.json(exclusoes === 0 ? [anexoFicticio()] : []),
      ),
      msw.delete('/api/anexos/9', () => {
        exclusoes += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderizar()
    await screen.findByText('encaminhamento-ficticio.pdf')

    // ACT — excluir abre a confirmação nomeada; confirmar dispara o DELETE
    await usuario.click(screen.getByRole('button', { name: /Excluir encaminhamento/ }))
    expect(
      await screen.findByText('Excluir o anexo "encaminhamento-ficticio.pdf"?'),
    ).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Excluir anexo' }))

    // ASSERT
    await waitFor(() => {
      expect(exclusoes).toBe(1)
    })
    expect(await screen.findByText('Nenhum documento anexado')).toBeInTheDocument()
  })

  it('deve baixar pelo caminho autenticado (blob), nunca URL de storage', async () => {
    // ARRANGE — jsdom não tem createObjectURL: espiar SÓ os métodos (nunca trocar a
    // classe URL global — axios/MSW dependem de `new URL()`)
    const usuario = userEvent.setup()
    const criarUrl = vi.fn(() => 'blob:ficticio')
    URL.createObjectURL = criarUrl as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL
    servidor.use(
      msw.get('/api/pacientes/1/anexos', () => HttpResponse.json([anexoFicticio()])),
    )
    renderizar()
    await screen.findByText('encaminhamento-ficticio.pdf')

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Baixar encaminhamento/ }))

    // ASSERT — o serviço autenticado foi chamado com o id e o blob virou download
    await waitFor(() => {
      expect(vi.mocked(baixarAnexo)).toHaveBeenCalledWith(9)
    })
    expect(criarUrl).toHaveBeenCalledTimes(1)
  })

  it('deve mostrar o estado vazio nomeado', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/pacientes/1/anexos', () => HttpResponse.json([])))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhum documento anexado')).toBeInTheDocument()
  })

  it('deve mostrar erro da lista com retry', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/1/anexos', () =>
        HttpResponse.json({ message: 'Erro.' }, { status: 500 }),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — o 500 sofre 1 retry com backoff antes de assentar
    expect(
      await screen.findByRole('button', { name: 'Tentar novamente' }, { timeout: 4000 }),
    ).toBeInTheDocument()
  })
})
