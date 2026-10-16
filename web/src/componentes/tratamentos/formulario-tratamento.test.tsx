import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { delay, HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BlocoDeTratamentos } from '@/componentes/tratamentos/bloco-de-tratamentos'
import { ProvedorToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { profissionalFicticio } from '@/test/dados-cadastros'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Convenio, Especialidade, Profissional, TratamentoDaLista, TratamentoDetalhe } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * "Novo tratamento" diz o que falta (change `o-sistema-avisa-o-que-falta`): cada seletor obrigatório
 * cujo catálogo chegou vazio — ou sem nenhum ativo — diz o que falta e mostra o caminho. O caminho vai em
 * TEXTO, sem link (design D7): o diálogo vive no cadastro da criança, e seguir um link jogaria fora o que
 * foi digitado (gate CR-AVI-03). Dados FICTÍCIOS.
 */

const QUEM_CADASTRA_TRATAMENTO = ['tratamentos.ver', 'tratamentos.criar', 'tratamentos.editar']
const QUEM_CADASTRA_TUDO = [
  ...QUEM_CADASTRA_TRATAMENTO,
  'convenios.ver',
  'convenios.criar',
  'especialidades.ver',
  'especialidades.criar',
  'profissionais.ver',
  'profissionais.criar',
]
const PEDIDO = 'Peça a quem administra o sistema para cadastrar.'

const CONVENIO_FICTICIO: Convenio = {
  id: 1,
  nome: 'Convênio Fictício',
  particular: false,
  ativo: true,
  registro_ans: null,
  codigo_operadora: null,
  versao_tiss: null,
  guia_sequencial: false,
  alerta_agend_mesmo_dia: false,
  flags_tiss_json: null,
  pedido_validade_meses: null,
  ciclo_dia_corte: null,
  ciclo_tipo_corte: null,
  updated_at: '2026-01-01T00:00:00.000000Z',
}

const ESPECIALIDADE_FICTICIA: Especialidade = {
  id: 1,
  nome: 'Especialidade Fictícia',
  cor: '#A85550',
  tempo_sessao: 40,
  exige_termo: false,
  oculta_agendamento_online: false,
  updated_at: '2026-01-01T00:00:00.000000Z',
}

interface Catalogos {
  convenios: Convenio[]
  especialidades: Especialidade[]
  profissionais: Profissional[]
}

const CATALOGOS_CHEIOS: Catalogos = {
  convenios: [CONVENIO_FICTICIO],
  especialidades: [ESPECIALIDADE_FICTICIA],
  profissionais: [profissionalFicticio()],
}

/** A forma da LISTAGEM — sem matrícula, guia nem pedido (detail-only). */
function tratamento(sobrescritas: Partial<TratamentoDaLista> = {}): TratamentoDaLista {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    paciente_id: 10,
    convenio_id: 1,
    especialidade_id: 1,
    profissional_id: 1,
    servico_id: null,
    sessoes_total: 10,
    sessoes_realizadas: 2,
    realce: 'nenhum',
    sessoes_saldo: 8,
    vencido: false,
    data_inicio: '2026-06-01',
    validade_dias: 180,
    pedido_vence_em: null,
    pedido_vencido: false,
    status: 'andamento',
    ...sobrescritas,
  }
}

function detalhe(): TratamentoDetalhe {
  return { ...tratamento(), matricula: null, guia: null, pedido_emitido_em: null, pedido_sessoes_por_semana: null }
}

function pagina(itens: TratamentoDaLista[]) {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}

/** Os catálogos que o formulário já carrega — cheios por padrão; quem testa a falta esvazia um. */
function comServidor(sobrescritas: Partial<Catalogos> = {}, tratamentos: TratamentoDaLista[] = []): void {
  const catalogos = { ...CATALOGOS_CHEIOS, ...sobrescritas }
  servidor.use(
    msw.get('/api/convenios', () => HttpResponse.json(catalogos.convenios)),
    msw.get('/api/especialidades', () => HttpResponse.json(catalogos.especialidades)),
    msw.get('/api/profissionais', () => HttpResponse.json(catalogos.profissionais)),
    msw.get('/api/convenios/:id/servicos', () => HttpResponse.json([])),
    msw.get('/api/tratamentos', () => HttpResponse.json(pagina(tratamentos))),
    msw.get('/api/tratamentos/1', () => HttpResponse.json(detalhe())),
  )
}

function renderizar(permissoes: string[]) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter>
          <BlocoDeTratamentos pacienteId={10} />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

async function abrirNovoTratamento(usuario: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await usuario.click(await screen.findByRole('button', { name: /Novo tratamento/ }))
  return screen.findByRole('alertdialog', { name: 'Novo tratamento' })
}

/** O que o leitor de tela ouve junto do seletor: o primeiro id do `aria-describedby` (a ajuda). */
function descricaoDo(seletor: HTMLElement): HTMLElement | null {
  const primeiroId = seletor.getAttribute('aria-describedby')?.split(' ')[0]
  return primeiroId === undefined ? null : document.getElementById(primeiroId)
}

interface Seletor {
  campo: keyof Catalogos
  rotulo: RegExp
  frase: string
  /** Onde cadastrar, escrito — para quem tem a permissão */
  instrucao: string
}

const SELETORES: Seletor[] = [
  {
    campo: 'convenios',
    rotulo: /^Convênio deste pacote/,
    frase: 'Nenhum convênio cadastrado — o particular também é um convênio.',
    instrucao: 'Cadastre em Cadastros › Convênios e serviços.',
  },
  {
    campo: 'especialidades',
    rotulo: /^Especialidade/,
    frase: 'Nenhuma especialidade cadastrada.',
    instrucao: 'Cadastre em Cadastros › Especialidades.',
  },
  {
    campo: 'profissionais',
    rotulo: /^Profissional/,
    frase: 'Nenhum profissional cadastrado.',
    instrucao: 'Cadastre em Profissionais.',
  },
]

beforeEach(() => {
  queryClient.clear()
})

describe('Novo tratamento — o seletor obrigatório diz o que falta (o-sistema-avisa-o-que-falta)', () => {
  it.each(SELETORES)(
    'deve dizer onde cadastrar, em texto e sem link, quando o catálogo de $campo está vazio e a pessoa pode cadastrar',
    async ({ campo, rotulo, frase, instrucao }) => {
      // ARRANGE
      comServidor({ [campo]: [] })
      const usuario = userEvent.setup()
      renderizar(QUEM_CADASTRA_TUDO)

      // ACT
      const dialogo = await abrirNovoTratamento(usuario)
      const seletor = within(dialogo).getByRole('combobox', { name: rotulo })

      // ASSERT — o caminho mora na descrição DO seletor, e nada leva para fora do cadastro da criança
      await waitFor(() => {
        expect(descricaoDo(seletor)?.textContent).toBe(`${frase} ${instrucao}`)
      })
      expect(within(dialogo).queryByRole('link')).not.toBeInTheDocument()
    },
  )

  it.each(SELETORES)(
    'deve dizer a quem pedir, sem link, quando o catálogo de $campo está vazio e a pessoa não pode cadastrar',
    async ({ campo, rotulo, frase }) => {
      // ARRANGE — "criar" sem "ver" não basta: a tela do cadastro responderia 403
      comServidor({ [campo]: [] })
      const usuario = userEvent.setup()
      renderizar([...QUEM_CADASTRA_TRATAMENTO, 'convenios.criar', 'especialidades.criar', 'profissionais.criar'])

      // ACT
      const dialogo = await abrirNovoTratamento(usuario)
      const seletor = within(dialogo).getByRole('combobox', { name: rotulo })

      // ASSERT
      await waitFor(() => {
        expect(descricaoDo(seletor)?.textContent).toBe(`${frase} ${PEDIDO}`)
      })
      expect(within(dialogo).queryByRole('link')).not.toBeInTheDocument()
    },
  )

  it.each(SELETORES)('deve não mudar nada no seletor de $campo quando o catálogo tem itens', async ({ rotulo }) => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_CADASTRA_TUDO)

    // ACT
    const dialogo = await abrirNovoTratamento(usuario)
    await within(dialogo).findByRole('option', { name: 'Profissional Fictício A' })
    await within(dialogo).findByRole('option', { name: 'Convênio Fictício' })
    await within(dialogo).findByRole('option', { name: 'Especialidade Fictícia' })

    // ASSERT — sem ajuda e sem erro, o seletor não tem descrição nenhuma
    expect(within(dialogo).getByRole('combobox', { name: rotulo })).not.toHaveAttribute('aria-describedby')
    expect(within(dialogo).queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve dizer que não há convênio ATIVO quando os cadastrados estão inativos', async () => {
    // ARRANGE — o convênio desativado continua na lista do servidor
    comServidor({ convenios: [{ ...CONVENIO_FICTICIO, ativo: false }] })
    const usuario = userEvent.setup()
    renderizar(QUEM_CADASTRA_TUDO)

    // ACT
    const dialogo = await abrirNovoTratamento(usuario)
    const seletor = within(dialogo).getByRole('combobox', { name: /^Convênio deste pacote/ })

    // ASSERT — e a frase não é contradita: o inativo não é oferecido
    await waitFor(() => {
      expect(descricaoDo(seletor)?.textContent).toBe(
        'Nenhum convênio ativo: os cadastrados estão inativos. Cadastre em Cadastros › Convênios e serviços.',
      )
    })
    expect(within(seletor).queryByRole('option', { name: 'Convênio Fictício' })).not.toBeInTheDocument()
  })

  it('deve dizer que não há profissional ATIVO quando os cadastrados estão desligados', async () => {
    // ARRANGE — o desligado continua no cadastro, mas não é oferecido para um pacote novo
    comServidor({ profissionais: [profissionalFicticio({ ativo: false })] })
    const usuario = userEvent.setup()
    renderizar(QUEM_CADASTRA_TUDO)

    // ACT
    const dialogo = await abrirNovoTratamento(usuario)
    const seletor = within(dialogo).getByRole('combobox', { name: /^Profissional/ })

    // ASSERT
    await waitFor(() => {
      expect(descricaoDo(seletor)?.textContent).toBe(
        'Nenhum profissional ativo: os cadastrados estão desligados. Cadastre em Profissionais.',
      )
    })
    expect(within(seletor).queryByRole('option', { name: /Profissional Fictício A/ })).not.toBeInTheDocument()
  })

  it('deve não dizer que falta nada enquanto o catálogo ainda está a caminho', async () => {
    // ARRANGE — "nenhum convênio cadastrado" antes de a lista chegar seria uma frase falsa
    comServidor()
    servidor.use(
      msw.get('/api/convenios', async () => {
        await delay('infinite')
        return HttpResponse.json([])
      }),
    )
    const usuario = userEvent.setup()
    renderizar(QUEM_CADASTRA_TUDO)

    // ACT
    const dialogo = await abrirNovoTratamento(usuario)
    await within(dialogo).findByRole('option', { name: 'Profissional Fictício A' })

    // ASSERT
    expect(within(dialogo).getByRole('combobox', { name: /^Convênio deste pacote/ })).not.toHaveAttribute('aria-describedby')
    expect(within(dialogo).queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve oferecer só os convênios e profissionais ATIVOS num pacote novo', async () => {
    // ARRANGE — um ativo e um inativo de cada (gate CR-AVI-06)
    comServidor({
      convenios: [CONVENIO_FICTICIO, { ...CONVENIO_FICTICIO, id: 2, nome: 'Convênio Fictício Inativo', ativo: false }],
      profissionais: [
        profissionalFicticio(),
        profissionalFicticio({ id: 2, nome: 'Profissional Fictício Desligado', ativo: false }),
      ],
    })
    const usuario = userEvent.setup()
    renderizar(QUEM_CADASTRA_TUDO)

    // ACT
    const dialogo = await abrirNovoTratamento(usuario)
    const convenio = within(dialogo).getByRole('combobox', { name: /^Convênio deste pacote/ })
    const profissional = within(dialogo).getByRole('combobox', { name: /^Profissional/ })
    await within(convenio).findByRole('option', { name: 'Convênio Fictício' })
    await within(profissional).findByRole('option', { name: 'Profissional Fictício A' })

    // ASSERT
    expect(within(convenio).queryByRole('option', { name: 'Convênio Fictício Inativo' })).not.toBeInTheDocument()
    expect(within(profissional).queryByRole('option', { name: /Profissional Fictício Desligado/ })).not.toBeInTheDocument()
  })

  it('deve abrir o pacote novo sem convênio quando o herdado do cadastro está inativo', async () => {
    // ARRANGE — fora das opções, o navegador mostraria outro convênio e o pacote seria gravado com o inativo
    comServidor({
      convenios: [CONVENIO_FICTICIO, { ...CONVENIO_FICTICIO, id: 2, nome: 'Convênio Fictício Inativo', ativo: false }],
    })
    const usuario = userEvent.setup()
    useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: QUEM_CADASTRA_TUDO }, carregandoSessao: false })
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter>
            <BlocoDeTratamentos pacienteId={10} padraoDoCadastro={{ convenioId: 2, carteirinha: null }} />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ACT
    const dialogo = await abrirNovoTratamento(usuario)
    const convenio = within(dialogo).getByRole('combobox', { name: /^Convênio deste pacote/ })
    await within(convenio).findByRole('option', { name: 'Convênio Fictício' })

    // ASSERT — e diz POR QUÊ o convênio de sempre não está ali (gate CR-AVI-R2-03)
    expect(convenio).toHaveValue('')
    expect(convenio).toHaveAccessibleDescription(
      'O convênio do cadastro, “Convênio Fictício Inativo”, está inativo: escolha outro e confira a matrícula.',
    )
  })

  it('deve não afirmar nada sobre o catálogo que respondeu com erro', async () => {
    // ARRANGE — 403 (ou a rede) não diz se há convênio: "nenhum convênio cadastrado" seria frase falsa
    comServidor()
    servidor.use(msw.get('/api/convenios', () => HttpResponse.json({ message: 'Sem permissão.' }, { status: 403 })))
    const usuario = userEvent.setup()
    renderizar(QUEM_CADASTRA_TUDO)

    // ACT
    const dialogo = await abrirNovoTratamento(usuario)
    await within(dialogo).findByRole('option', { name: 'Profissional Fictício A' })
    await waitFor(() => {
      expect(queryClient.getQueryState(chaves.convenios())?.status).toBe('error')
    })

    // ASSERT
    expect(within(dialogo).getByRole('combobox', { name: /^Convênio deste pacote/ })).not.toHaveAttribute('aria-describedby')
    expect(within(dialogo).queryByText(/^Nenhum/)).not.toBeInTheDocument()
  })

  it('deve não avisar na edição, que abre com o convênio e o profissional gravados mesmo inativos', async () => {
    // ARRANGE — o convênio foi desativado e a profissional saiu depois que o pacote foi vendido
    comServidor(
      {
        convenios: [{ ...CONVENIO_FICTICIO, ativo: false }],
        profissionais: [profissionalFicticio({ ativo: false })],
      },
      [tratamento()],
    )
    const usuario = userEvent.setup()
    renderizar(QUEM_CADASTRA_TUDO)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Editar tratamento' })
    await within(dialogo).findByRole('option', { name: 'Profissional Fictício A (desligado)' })
    await within(dialogo).findByRole('option', { name: 'Convênio Fictício' })

    // ASSERT
    expect(within(dialogo).getByRole('combobox', { name: /^Convênio deste pacote/ })).not.toHaveAttribute('aria-describedby')
    expect(within(dialogo).getByRole('combobox', { name: /^Profissional/ })).not.toHaveAttribute('aria-describedby')
  })

  it('deve abrir o diálogo com as mesmas requisições, com e sem os avisos (nenhuma requisição nova)', async () => {
    // ARRANGE — o aviso sai dos catálogos que o formulário já carrega (D6)
    async function requisicoesAoAbrir(catalogos: Partial<Catalogos>): Promise<string[]> {
      queryClient.clear()
      comServidor(catalogos)
      const usuario = userEvent.setup()
      const { unmount } = renderizar(QUEM_CADASTRA_TUDO)
      await screen.findByRole('button', { name: /Novo tratamento/ })
      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0)
      })
      const pedidas: string[] = []
      const anotar = ({ request }: { request: Request }): void => {
        pedidas.push(`${request.method} ${new URL(request.url).pathname}`)
      }
      servidor.events.on('request:start', anotar)
      const dialogo = await abrirNovoTratamento(usuario)
      await within(dialogo).findByRole('button', { name: 'Cadastrar' })
      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0)
      })
      servidor.events.removeListener('request:start', anotar)
      unmount()
      return pedidas.sort()
    }

    // ACT
    const comAvisos = await requisicoesAoAbrir({ convenios: [], especialidades: [], profissionais: [] })
    const semAvisos = await requisicoesAoAbrir({})

    // ASSERT — e a comparação não é trivial: o diálogo de fato pede os três catálogos
    expect(comAvisos).toContain('GET /api/convenios')
    expect(comAvisos).toEqual(semAvisos)
  })

  it('deve não ter violações axe com os três avisos no formulário', async () => {
    // ARRANGE
    comServidor({ convenios: [], especialidades: [], profissionais: [] })
    const usuario = userEvent.setup()
    renderizar(QUEM_CADASTRA_TUDO)

    // ACT
    const dialogo = await abrirNovoTratamento(usuario)
    await within(dialogo).findByText(/Cadastre em Profissionais\./)
    await within(dialogo).findByText(/Cadastre em Cadastros › Especialidades\./)
    await within(dialogo).findByText(/Cadastre em Cadastros › Convênios e serviços\./)

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  }, 30000)
})

/**
 * O `AlertDialog` do Radix só leva o foco ao `AlertDialog.Cancel`, e este formulário não tem um: abria com
 * o foco atrás do véu (gate A11Y-AVI-02). Dados FICTÍCIOS.
 */
describe('Formulário de tratamento — o foco entra no diálogo', () => {
  it('deve levar o foco para dentro ao abrir um pacote novo', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_CADASTRA_TUDO)

    // ACT
    const dialogo = await abrirNovoTratamento(usuario)

    // ASSERT — no primeiro controle, o convênio
    expect(dialogo).toContainElement(document.activeElement as HTMLElement)
    expect(document.activeElement).toBe(within(dialogo).getByRole('combobox', { name: /^Convênio deste pacote/ }))
  })

  it('deve levar o foco para dentro ao abrir a edição, depois de carregar o detalhe', async () => {
    // ARRANGE — o diálogo do carregamento dá lugar ao do formulário
    comServidor({}, [tratamento()])
    const usuario = userEvent.setup()
    renderizar(QUEM_CADASTRA_TUDO)

    // ACT — o combobox só existe no diálogo do formulário, não no do carregamento
    await usuario.click(await screen.findByRole('button', { name: 'Editar' }))
    const convenio = await screen.findByRole('combobox', { name: /^Convênio deste pacote/ })

    // ASSERT — e continua dentro depois que o diálogo do carregamento saiu
    await waitFor(() => {
      expect(document.activeElement).toBe(convenio)
    })
    await new Promise((resolver) => {
      setTimeout(resolver, 10)
    })
    expect(document.activeElement).toBe(convenio)
  })

  it('deve não puxar o foco de volta ao Editar quando o carregamento dá lugar ao formulário', async () => {
    // ARRANGE — o diálogo do carregamento também "fecha" na troca: devolver o foco ali tiraria a pessoa
    // do formulário por um instante (o leitor de tela anunciaria o botão, a página rolaria até ele)
    comServidor({}, [tratamento()])
    servidor.use(
      msw.get('/api/tratamentos/1', async () => {
        await delay(30)
        return HttpResponse.json(detalhe())
      }),
    )
    const usuario = userEvent.setup()
    renderizar(QUEM_CADASTRA_TUDO)
    const editar = await screen.findByRole('button', { name: 'Editar' })
    await usuario.click(editar)
    const focoNoEditar = vi.spyOn(editar, 'focus')

    // ACT — o detalhe chega, e o formulário toma o lugar do carregamento
    await screen.findByRole('button', { name: 'Salvar' })
    const dialogo = screen.getByRole('alertdialog', { name: 'Editar tratamento' })
    await new Promise((resolver) => {
      setTimeout(resolver, 10)
    })

    // ASSERT
    expect(focoNoEditar).not.toHaveBeenCalled()
    expect(dialogo).toContainElement(document.activeElement as HTMLElement)
  })

  it('deve devolver o foco a quem abriu ao cancelar', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_CADASTRA_TUDO)
    const abrir = await screen.findByRole('button', { name: /Novo tratamento/ })
    await usuario.click(abrir)
    const dialogo = await screen.findByRole('alertdialog', { name: 'Novo tratamento' })

    // ACT
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(abrir).toHaveFocus()
    })
  })

  it('deve devolver o foco ao Editar ao fechar a edição', async () => {
    // ARRANGE — quem abriu foi guardado pelo diálogo do carregamento, o primeiro a abrir
    comServidor({}, [tratamento()])
    const usuario = userEvent.setup()
    renderizar(QUEM_CADASTRA_TUDO)
    const editar = await screen.findByRole('button', { name: 'Editar' })
    await usuario.click(editar)
    await screen.findByRole('button', { name: 'Salvar' })

    // ACT
    await usuario.keyboard('{Escape}')

    // ASSERT
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(editar).toHaveFocus()
    })
  })
})
