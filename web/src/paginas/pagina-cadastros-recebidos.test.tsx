import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { PaginaCadastrosRecebidos } from '@/paginas/pagina-cadastros-recebidos'
import { queryClient } from '@/lib/query-client'
import { servidor } from '@/test/servidor-msw'
import type { EnvioNaFila } from '@/tipos'

/**
 * A fila de conferência (change `cadastro-online-do-paciente`).
 *
 * O que estes testes perseguem é a regra que governa a tela: **tudo aqui é texto de estranho**.
 * Nenhum valor do envio pode virar endereço de link, de imagem ou de estilo — o esquema do
 * endereço viria de quem enviou, e quem clica é alguém da clínica.
 */
const ENVIO: EnvioNaFila = {
  id: 7,
  enviado_em: '2026-09-01 14:30:00',
  dados: {
    nome: 'Criança Fictícia Enviada',
    nascimento: '2018-03-15',
    sexo: 'feminino',
    cpf: '39053344705',
    contatos_json: [{ tipo: 'celular', valor: '48999998888' }],
  },
}

const navegar = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navegar,
}))

const REGUA = {
  formulario: 'paciente',
  secoes: [{ secao: 'identificacao', rotulo: 'Identificação' }],
  campos: [
    { campo: 'nascimento', rotulo: 'Data de nascimento', secao: 'identificacao', lista: false, obrigatorio: true, desabilitado: false, online: true },
    { campo: 'contatos_json', rotulo: 'Telefones e e-mails', secao: 'contatos', lista: true, obrigatorio: false, desabilitado: false, online: true },
  ],
}

function prepararFila(envios: EnvioNaFila[] = [ENVIO], comRegua = true) {
  servidor.use(
    msw.get('/api/cadastro-online/fila', () => HttpResponse.json({ data: envios, total: envios.length })),
    msw.get('/api/campos-cadastro/:formulario', () =>
      comRegua ? HttpResponse.json(REGUA) : new HttpResponse(null, { status: 500 }),
    ),
  )
}

function renderizar() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter>
          <PaginaCadastrosRecebidos />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('Cadastros recebidos — a fila de conferência', () => {
  it('deve mostrar o envio com a data em português', async () => {
    // ARRANGE
    prepararFila()

    // ACT
    renderizar()

    // ASSERT — a data chega no formato da API e sai no de quem lê
    expect(await screen.findByRole('heading', { name: 'Criança Fictícia Enviada' })).toBeInTheDocument()
    expect(screen.getByText('15/03/2018')).toBeInTheDocument()
    expect(screen.getByText('Feminino')).toBeInTheDocument()
  })

  it('NÃO deve transformar contato do envio em link', async () => {
    // ARRANGE — o esquema do endereço viria de quem enviou, e quem clicaria é alguém da clínica
    prepararFila()

    // ACT
    renderizar()
    await screen.findByRole('heading', { name: 'Criança Fictícia Enviada' })

    // ASSERT — o telefone aparece, e não é `href` de nada
    expect(screen.getByText(/48999998888/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve mostrar quem já está cadastrado, com o motivo da coincidência', async () => {
    // ARRANGE — é o oposto do oráculo da porta pública: aqui quem lê já tem permissão para saber
    // quem é paciente da clínica
    prepararFila([
      {
        ...ENVIO,
        parecidos: [{ id: 3, nome: 'Criança Fictícia Já Cadastrada', coincide_por: 'cpf' }],
      },
    ])

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Criança Fictícia Já Cadastrada')).toBeInTheDocument()
    expect(screen.getByText(/mesmo CPF/)).toBeInTheDocument()
  })

  it('NÃO deve mostrar o bloco de parecidos quando o servidor não o manda', async () => {
    // ARRANGE — para quem não tem `pacientes.ver`, o bloco vem AUSENTE, não vazio: lista vazia
    // diria "procurei e não achei", que já é resposta
    prepararFila([ENVIO])

    // ACT
    renderizar()
    await screen.findByRole('heading', { name: 'Criança Fictícia Enviada' })

    // ASSERT
    expect(screen.queryByText(/já está cadastrado/)).not.toBeInTheDocument()
  })

  it('deve explicar o vazio em vez de mostrar uma lista em branco', async () => {
    // ARRANGE
    prepararFila([])

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhum cadastro esperando')).toBeInTheDocument()
    expect(screen.getByText(/preencher o formulário pelo link/)).toBeInTheDocument()
  })

  it('deve oferecer nova tentativa quando a fila não carrega', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/cadastro-online/fila', () => HttpResponse.error()))

    // ACT
    renderizar()

    // ASSERT — a política da casa repete uma vez antes de desistir em falha de rede, então o
    // estado de erro leva mais que o padrão do `findBy` para aparecer
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/não foi possível carregar/i)
    expect(screen.getByRole('button', { name: /tentar/i })).toBeInTheDocument()
  })

  it('deve ACEITAR abrindo o cadastro pré-preenchido, sem criar paciente aqui', async () => {
    // ARRANGE — é a decisão de desenho que impede um segundo caminho de criação de paciente
    prepararFila()
    servidor.use(
      msw.post('/api/cadastro-online/fila/7/aceitar', () =>
        HttpResponse.json({ id: 7, dados: ENVIO.dados }),
      ),
    )
    renderizar()
    await screen.findByRole('heading', { name: 'Criança Fictícia Enviada' })

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Aceitar e abrir cadastro' }))

    // ASSERT — leva ao formulário de sempre, com o rascunho
    await waitFor(() => {
      expect(navegar).toHaveBeenCalledWith('/pacientes/novo', {
        state: { preenchido: ENVIO.dados, envio: 7 },
      })
    })
  })

  it('deve tirar o RÓTULO do campo da régua, não de uma lista mantida aqui', async () => {
    // ARRANGE — lista paralela mantida à mão foi o que botou nome de coluna na tela: a régua
    // padrão liga `contatos_json`, e o mapa antigo não o conhecia
    prepararFila()

    // ACT
    renderizar()

    // ASSERT — o rótulo é o que o SERVIDOR chama, e nenhum nome de coluna sobra na tela
    expect(await screen.findByText('Data de nascimento')).toBeInTheDocument()
    expect(screen.getByText('Telefones e e-mails')).toBeInTheDocument()
    expect(screen.queryByText(/_json/)).not.toBeInTheDocument()
  })

  it('NÃO deve mostrar nome de coluna quando a régua não carrega', async () => {
    // ARRANGE — a rede de reserva: falha da régua não pode virar "contatos_json" na tela
    prepararFila([ENVIO], false)

    // ACT
    renderizar()

    // ASSERT
    await screen.findByRole('heading', { name: 'Criança Fictícia Enviada' })
    expect(screen.queryByText(/_json/)).not.toBeInTheDocument()
    expect(screen.getByText('Contatos')).toBeInTheDocument()
  })

  it('deve dizer no vazio ONDE o link é gerenciado', async () => {
    // ARRANGE — quem abre a fila vazia precisa saber por onde o formulário é ligado; sem isso a
    // tela diz que não há nada e não diz o que fazer a respeito
    prepararFila([])

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText(/Configurações . Cadastro pelo link/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir Configurações' })).toBeInTheDocument()
  })

  it('deve exigir MOTIVO para descartar', async () => {
    // ARRANGE — decisão sem razão registrada é decisão que ninguém consegue revisar depois
    prepararFila()
    renderizar()
    await screen.findByRole('heading', { name: 'Criança Fictícia Enviada' })

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar cadastro' }))

    // ASSERT — o diálogo continua aberto, com o erro no campo
    expect(screen.getByRole('textbox', { name: /Motivo/ }))
      .toHaveAccessibleDescription(/por que este cadastro está sendo descartado/)
  })
})
