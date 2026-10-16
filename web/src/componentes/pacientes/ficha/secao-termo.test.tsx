import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { SecaoTermo } from '@/componentes/pacientes/ficha/secao-termo'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { pacienteFicticio } from '@/test/dados-cadastros'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { ConsentimentoDoPaciente } from '@/tipos'

const VIGENTE = { id: 2, titulo: 'Regulamento dos Atendimentos', versao: 2 }

function aceite(sobrescritas: Partial<ConsentimentoDoPaciente> = {}): ConsentimentoDoPaciente {
  return {
    termo: 'Regulamento dos Atendimentos',
    versao: 2,
    termo_id: 2,
    responsavel: 'Responsável Fictícia',
    forma: 'papel',
    registrado_por: 1,
    aceito_em: '2026-07-20T13:00:00+00:00',
    ...sobrescritas,
  }
}

function renderizar(
  consentimentos: ConsentimentoDoPaciente[],
  termo: typeof VIGENTE | null = VIGENTE,
  permissoes: string[] = ['pacientes.ver', 'pacientes.editar'],
) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })
  servidor.use(
    msw.get('/api/pacientes/:id', () =>
      HttpResponse.json(pacienteFicticio({ consentimentos_json: consentimentos })),
    ),
    msw.get('/api/termos-consentimento/vigente', () => HttpResponse.json({ termo })),
  )

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/pacientes/1/termo']}>
          <SecaoTermo pacienteId={1} />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Seção Contrato/Termo da ficha', () => {
  it('deve mostrar o aceite da versão em vigor com responsável, data e forma', async () => {
    // ARRANGE + ACT
    renderizar([aceite()])

    // ASSERT
    expect(await screen.findByText(/Aceito por Responsável Fictícia/)).toBeInTheDocument()
    expect(screen.getByText(/assinado em papel/)).toBeInTheDocument()
    expect(screen.queryByText('Aceite pendente.')).not.toBeInTheDocument()
  })

  it('deve apontar pendência quando o aceite é de uma versão ANTERIOR', async () => {
    // ARRANGE — a família aceitou a v1; a clínica publicou a v2
    renderizar([aceite({ termo_id: 1, versao: 1 })])

    // ASSERT — pendente diante da régua atual, mas o histórico preserva a v1
    expect(await screen.findByText('Aceite pendente.')).toBeInTheDocument()
    expect(screen.getByText(/v1/)).toBeInTheDocument()
  })

  it('deve tratar consentimento antigo sem versão como histórico, nunca como aceite do vigente', async () => {
    // ARRANGE — registro anterior ao termo versionado (texto livre, sem `termo_id`)
    renderizar([
      { termo: 'Termo antigo fictício', responsavel: 'Responsável Fictícia', aceito_em: '2026-01-10T12:00:00+00:00' },
    ])

    // ASSERT
    expect(await screen.findByText('Aceite pendente.')).toBeInTheDocument()
    expect(screen.getByText(/Termo antigo fictício/)).toBeInTheDocument()
  })

  it('deve mostrar o histórico com as duas versões aceitas', async () => {
    // ARRANGE
    renderizar([aceite({ termo: 'Regulamento dos Atendimentos', termo_id: 1, versao: 1 }), aceite()])

    // ASSERT
    const itens = await screen.findAllByRole('listitem')
    expect(itens).toHaveLength(2)
    expect(itens[0]).toHaveTextContent('v1')
    expect(itens[1]).toHaveTextContent('v2')
  })

  it('não deve oferecer formulário de registro — a seção é leitura', async () => {
    // ARRANGE — registrar é edição do cadastro; duas portas seriam duas regras
    renderizar([])

    // ASSERT
    await screen.findByText('Aceite pendente.')
    expect(screen.queryByLabelText(/Responsável que aceitou/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Registrar aceite/ })).not.toBeInTheDocument()
    // ...mas leva até onde se registra
    expect(screen.getByRole('button', { name: /Registrar no cadastro/ })).toBeInTheDocument()
  })

  it('deve dizer que não há régua quando a clínica não publicou termo', async () => {
    // ARRANGE
    renderizar([], null)

    // ASSERT
    expect(await screen.findByText('Nenhum termo em vigor')).toBeInTheDocument()
    expect(screen.queryByText('Aceite pendente.')).not.toBeInTheDocument()
  })

  it('deve manter o histórico visível mesmo sem versão em vigor', async () => {
    // ARRANGE — a prova de quem já aceitou não some porque a régua saiu de vigor:
    // esconder o aceite seria a seção deixar de fazer a única coisa que ela faz
    renderizar([aceite({ termo_id: 1, versao: 1 })], null)

    // ASSERT
    expect(await screen.findByText('Nenhum termo em vigor')).toBeInTheDocument()
    const itens = screen.getAllByRole('listitem')
    expect(itens).toHaveLength(1)
    expect(itens[0]).toHaveTextContent('v1')
    expect(itens[0]).toHaveTextContent('Responsável Fictícia')
  })

  it('deve mostrar erro com nova tentativa quando a leitura falha — nunca "sem aceite"', async () => {
    // ARRANGE
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['pacientes.ver'] },
      carregandoSessao: false,
    })
    servidor.use(
      msw.get('/api/pacientes/:id', () => new HttpResponse(null, { status: 500 })),
      msw.get('/api/termos-consentimento/vigente', () => HttpResponse.json({ termo: VIGENTE })),
    )

    // ACT
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter initialEntries={['/pacientes/1/termo']}>
            <SecaoTermo pacienteId={1} />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ASSERT
    expect(
      await screen.findByText('Não foi possível carregar o termo deste paciente.', undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Aceite pendente.')).not.toBeInTheDocument()
  })
})

describe('Seção Contrato/Termo — sem termo em vigor, o caminho (o-sistema-avisa-o-que-falta)', () => {
  const QUEM_PUBLICA = ['pacientes.ver', 'pacientes.editar', 'termos_consentimento.ver', 'termos_consentimento.criar']
  const ROTULO_DO_CAMINHO = 'Publicar em Cadastros › Termo de consentimento'
  const POR_QUE = /^A clínica ainda não publicou o contrato terapêutico\./

  it('deve levar à publicação do termo quem pode publicar, no fim da frase que diz por quê', async () => {
    // ARRANGE + ACT
    renderizar([], null, QUEM_PUBLICA)

    // ASSERT — uma frase só: a linha à parte repetia o parágrafo (gate DQA-AVI-05)
    await screen.findByText('Nenhum termo em vigor')
    const caminho = screen.getByRole('link', { name: ROTULO_DO_CAMINHO })
    expect(caminho).toHaveAttribute('href', '/termos')
    expect(screen.getByText(POR_QUE)).toContainElement(caminho)
    expect(screen.getAllByText(/aceite a cobrar|passa a ser cobrado/)).toHaveLength(1)
  })

  it('deve dizer a quem pedir, sem link, a quem não pode publicar termo', async () => {
    // ARRANGE + ACT — quem só edita o cadastro levaria 403 na tela de termos; e "criar" sem "ver"
    // não abre a tela
    renderizar([], null, ['pacientes.ver', 'pacientes.editar', 'termos_consentimento.criar'])

    // ASSERT
    await screen.findByText('Nenhum termo em vigor')
    expect(screen.getByText(POR_QUE)).toHaveTextContent(/Peça a quem administra o sistema para publicar o termo\.$/)
    expect(screen.queryByRole('link', { name: ROTULO_DO_CAMINHO })).not.toBeInTheDocument()
  })

  it('não deve mostrar o caminho quando há termo em vigor', async () => {
    // ARRANGE + ACT
    renderizar([aceite()], VIGENTE, QUEM_PUBLICA)

    // ASSERT
    await screen.findByText(/Aceito por Responsável Fictícia/)
    expect(screen.queryByRole('link', { name: ROTULO_DO_CAMINHO })).not.toBeInTheDocument()
  })

  it('deve abrir a seção com as mesmas requisições, com e sem termo em vigor (nenhuma requisição nova)', async () => {
    // ARRANGE — o aviso sai da leitura do termo vigente que a seção já faz (D6)
    async function requisicoesAoAbrir(termo: typeof VIGENTE | null): Promise<string[]> {
      queryClient.clear()
      const pedidas: string[] = []
      const anotar = ({ request }: { request: Request }): void => {
        pedidas.push(`${request.method} ${new URL(request.url).pathname}`)
      }
      servidor.events.on('request:start', anotar)
      const { unmount } = renderizar([], termo, QUEM_PUBLICA)
      await screen.findByText(termo === null ? 'Nenhum termo em vigor' : 'Aceite pendente.')
      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0)
      })
      servidor.events.removeListener('request:start', anotar)
      unmount()
      return pedidas.sort()
    }

    // ACT
    const comAviso = await requisicoesAoAbrir(null)
    const semAviso = await requisicoesAoAbrir(VIGENTE)

    // ASSERT
    expect(comAviso.length).toBeGreaterThan(0)
    expect(comAviso).toEqual(semAviso)
  })
})
