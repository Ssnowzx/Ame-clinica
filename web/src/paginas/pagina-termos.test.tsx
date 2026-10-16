import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaTermos } from '@/paginas/pagina-termos'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { VersaoDoTermo } from '@/tipos'

const TUDO = [
  'termos_consentimento.ver',
  'termos_consentimento.criar',
  'termos_consentimento.editar',
  'termos_consentimento.excluir',
]

function versao(sobrescritas: Partial<VersaoDoTermo> = {}): VersaoDoTermo {
  return {
    id: 1,
    titulo: 'Regulamento dos Atendimentos',
    versao: 1,
    vigente: true,
    aceites_total: 0,
    updated_at: '2026-07-25T10:00:00.000000Z',
    ...sobrescritas,
  }
}

function renderizar(permissoes: string[] = TUDO) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/termos']}>
          <PaginaTermos />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Termo de consentimento — lista e seus quatro estados', () => {
  it('deve listar as versões com situação e contagem de aceites', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/termos-consentimento', () =>
        HttpResponse.json([
          versao({ id: 2, versao: 2, vigente: true, aceites_total: 3 }),
          versao({ id: 1, versao: 1, vigente: false, aceites_total: 12 }),
        ]),
      ),
    )

    // ACT
    renderizar()
    const linhaVigente = await screen.findByRole('row', { name: /v2/ })

    // ASSERT
    expect(within(linhaVigente).getByText('Em vigor')).toBeInTheDocument()
    expect(within(linhaVigente).getByText('3')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /v1/ })).getByText('Aposentada')).toBeInTheDocument()
  })

  it('deve mostrar erro com "tentar novamente" quando a lista falha — nunca "vazio"', async () => {
    // ARRANGE — falha de rede não pode virar "nenhum termo publicado"
    servidor.use(msw.get('/api/termos-consentimento', () => new HttpResponse(null, { status: 500 })))

    // ACT
    renderizar()

    // ASSERT
    expect(
      await screen.findByText('Não foi possível carregar.', undefined, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tentar novamente/i })).toBeInTheDocument()
    expect(screen.queryByText('Nenhum termo publicado')).not.toBeInTheDocument()
  })

  it('deve dizer o próximo passo quando nenhuma versão foi publicada', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/termos-consentimento', () => HttpResponse.json([])))

    // ACT
    renderizar()

    // ASSERT — o vazio nomeia a consequência (sem termo, não se registra aceite)
    expect(await screen.findByText('Nenhum termo publicado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Publicar primeira versão/ })).toBeInTheDocument()
  })
})

describe('Termo de consentimento — publicar', () => {
  it('deve pedir confirmação enunciando a consequência ANTES de chamar a API', async () => {
    // ARRANGE — publicar troca a régua cobrada da clínica inteira
    const usuario = userEvent.setup()
    const chamadas: unknown[] = []
    servidor.use(
      msw.get('/api/termos-consentimento', () => HttpResponse.json([versao()])),
      msw.post('/api/termos-consentimento', async ({ request }) => {
        chamadas.push(await request.json())
        return HttpResponse.json(versao({ id: 2, versao: 2 }), { status: 201 })
      }),
    )
    renderizar()
    await screen.findByRole('row', { name: /v1/ })

    // ACT — preencher e submeter NÃO publica: abre a confirmação
    await usuario.click(screen.getByRole('button', { name: 'Publicar nova versão' }))
    await usuario.type(await screen.findByLabelText(/Título/), 'Regulamento dos Atendimentos')
    await usuario.type(screen.getByLabelText(/Texto do termo/), 'Texto fictício da versão 2.')
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }))

    // ASSERT — nenhuma requisição ainda, e a confirmação diz o que muda
    const confirmacao = await screen.findByRole('alertdialog')
    expect(chamadas).toHaveLength(0)
    expect(within(confirmacao).getByText(/Termos pendentes/)).toBeInTheDocument()
    expect(within(confirmacao).getByText(/continuam válidos/)).toBeInTheDocument()

    // ACT — confirmar
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Publicar versão' }))

    // ASSERT
    await waitFor(() => {
      expect(chamadas).toHaveLength(1)
    })
    expect(chamadas[0]).toEqual({
      titulo: 'Regulamento dos Atendimentos',
      texto: 'Texto fictício da versão 2.',
    })
  })
})

describe('Termo de consentimento — versão aceita é prova', () => {
  it('não deve oferecer corrigir nem excluir uma versão com aceites', async () => {
    // ARRANGE — o servidor recusa (é a autoridade); oferecer um botão que sempre
    // falha faria o usuário descobrir a regra pelo erro
    servidor.use(
      msw.get('/api/termos-consentimento', () => HttpResponse.json([versao({ aceites_total: 4 })])),
    )

    // ACT
    renderizar()
    const linha = await screen.findByRole('row', { name: /v1/ })

    // ASSERT
    expect(within(linha).getByRole('button', { name: /Ler/ })).toBeInTheDocument()
    expect(within(linha).queryByRole('button', { name: /Corrigir/ })).not.toBeInTheDocument()
    expect(within(linha).queryByRole('button', { name: /Excluir/ })).not.toBeInTheDocument()
  })

  it('deve mostrar a recusa do servidor no campo, e não como erro genérico', async () => {
    // ARRANGE — corrida: a versão ganhou um aceite entre a lista e o salvamento
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/termos-consentimento', () => HttpResponse.json([versao()])),
      msw.get('/api/termos-consentimento/1', () =>
        HttpResponse.json({ ...versao(), texto: 'Texto fictício da v1.' }),
      ),
      msw.put('/api/termos-consentimento/1', () =>
        HttpResponse.json(
          {
            message: 'Esta versão já foi aceita.',
            errors: { texto: ['Esta versão já foi aceita por pacientes e não pode ser alterada.'] },
          },
          { status: 422 },
        ),
      ),
    )
    renderizar()
    await screen.findByRole('row', { name: /v1/ })

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Corrigir/ }))
    const campoTexto = await screen.findByLabelText(/Texto do termo/)
    await waitFor(() => {
      expect(campoTexto).toHaveValue('Texto fictício da v1.')
    })
    await usuario.type(campoTexto, ' Correção.')
    await usuario.click(screen.getByRole('button', { name: 'Salvar correção' }))

    // ASSERT — a mensagem pousa NO CAMPO (o toast também a mostra, mas ele passa;
    // a instrução tem de ficar onde a pessoa está olhando)
    const formulario = await screen.findByRole('dialog')
    const erroDoCampo = await within(formulario).findByRole('alert')
    expect(erroDoCampo).toHaveTextContent(/não pode ser alterada/)
    expect(campoTexto).toHaveAccessibleDescription(/não pode ser alterada/)
  })
})

describe('Termo de consentimento — leitura', () => {
  it('deve exibir o texto como TEXTO, nunca como HTML', async () => {
    // ARRANGE — o texto é entrada de administrador; renderizá-lo como marcação
    // transformaria o campo numa porta de injeção
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/termos-consentimento', () => HttpResponse.json([versao()])),
      msw.get('/api/termos-consentimento/1', () =>
        HttpResponse.json({ ...versao(), texto: '<b>Regra fictícia</b> em negrito.' }),
      ),
    )
    renderizar()
    await screen.findByRole('row', { name: /v1/ })

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Ler/ }))
    const dialogo = await screen.findByRole('dialog')

    // ASSERT — a marcação aparece literal, e nenhum <b> foi criado
    expect(await within(dialogo).findByText(/<b>Regra fictícia<\/b> em negrito\./)).toBeInTheDocument()
    expect(dialogo.querySelector('b')).toBeNull()
  })
})

describe('Termo de consentimento — afordância segue a permissão', () => {
  it('deve esconder toda escrita de quem só tem ver', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/termos-consentimento', () => HttpResponse.json([versao()])))

    // ACT
    renderizar(['termos_consentimento.ver'])
    await screen.findByRole('row', { name: /v1/ })

    // ASSERT — ler continua; publicar, corrigir e excluir somem
    expect(screen.getByRole('button', { name: /Ler/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publicar nova versão' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Corrigir/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Excluir/ })).not.toBeInTheDocument()
  })
})
