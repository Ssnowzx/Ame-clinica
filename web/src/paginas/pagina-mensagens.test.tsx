import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { delay, HttpResponse, http as msw } from 'msw'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ExigePermissao } from '@/componentes/acesso-negado'
import { ProvedorToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { queryClient } from '@/lib/query-client'
import { PaginaMensagens } from '@/paginas/pagina-mensagens'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Conversa, EstadoDaConexao, Mensagem, TemplateDeMensagem } from '@/tipos'

expect.extend(toHaveNoViolations)

/** O "voltar" do navegador (gesto, botão, `history.back`) — fora da página, como na vida real. */
function VoltarDoNavegador() {
  const navegar = useNavigate()
  return (
    <button type="button" onClick={() => void navegar(-1)}>
      voltar do navegador (dublê)
    </button>
  )
}

/** Dados 100% FICTÍCIOS (LGPD — menores). */
function conversa(sobrescritas: Partial<Conversa> = {}): Conversa {
  return {
    id: 1,
    telefone: '+5511987654321',
    nome_perfil: 'Perfil Fictício',
    paciente: { id: 7, nome: 'Criança Fictícia', nome_social: null },
    nao_lidas: 2,
    sem_lembretes: false,
    arquivada: false,
    janela_expira_em: new Date(Date.now() + 3_600_000).toISOString(),
    janela_aberta: true,
    ultima_mensagem_em: new Date().toISOString(),
    ...sobrescritas,
  }
}

function mensagem(sobrescritas: Partial<Mensagem> = {}): Mensagem {
  return {
    id: 10,
    direcao: 'recebida',
    tipo: 'texto',
    corpo: 'Bom dia, posso remarcar?',
    template_nome: null,
    status: 'recebida',
    erro_motivo: null,
    automatica: false,
    enviada_por: null,
    expurgada: false,
    midia: null,
    mapa_url: null,
    tipo_original: null,
    em: new Date().toISOString(),
    ...sobrescritas,
  }
}

function prepararApi({
  conexao = 'conectado' as EstadoDaConexao,
  conversas = [conversa()],
  mensagens = [mensagem()],
  temAnteriores = false,
  aoEnviar,
}: {
  conexao?: EstadoDaConexao
  conversas?: Conversa[]
  mensagens?: Mensagem[]
  temAnteriores?: boolean
  aoEnviar?: (corpo: unknown) => void
} = {}) {
  servidor.use(
    msw.get('/api/mensagens/conversas', () =>
      HttpResponse.json({ conexao, conversas, pagina: 1, ultima_pagina: 1, total: conversas.length }),
    ),
    msw.get('/api/mensagens/conversas/:id', ({ request }) => {
      // `?antes=<id>` é a paginação para trás da thread
      const antes = new URL(request.url).searchParams.get('antes')
      if (antes !== null) {
        return HttpResponse.json({
          conversa: conversas[0],
          tem_anteriores: false,
          mensagens: [mensagem({ id: 1, corpo: 'mensagem antiga ficticia' })],
        })
      }
      return HttpResponse.json({ conversa: conversas[0], tem_anteriores: temAnteriores, mensagens })
    }),
    msw.get('/api/mensagens/templates', () =>
      HttpResponse.json([
        {
          nome: 'lembrete_agendamento',
          idioma: 'pt_BR',
          categoria: 'UTILITY',
          corpo: 'Olá {{1}}, lembrando da sua sessão em {{2}}.',
          variaveis: ['1', '2'],
          aprovado: true,
          sincronizado_em: null,
        },
      ]),
    ),
    msw.post('/api/mensagens/conversas/:id/mensagens', async ({ request }) => {
      aoEnviar?.(await request.json())
      return HttpResponse.json({ id: 99, status: 'pendente', tipo: 'texto', corpo: null }, { status: 201 })
    }),
  )
}

function renderizar(permissoes: string[] = ['mensagens.ver', 'mensagens.responder'], rota = '/mensagens') {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[rota]}>
          <ExigePermissao permissao="mensagens.ver">
            <PaginaMensagens />
          </ExigePermissao>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

it('deve listar as conversas mostrando SÓ o nome da criança', async () => {
  // ARRANGE — a aba fica aberta o dia inteiro num balcão de recepção
  prepararApi()

  // ACT
  renderizar()

  // ASSERT
  expect(await screen.findByText('Criança Fictícia')).toBeInTheDocument()
  expect(screen.getByLabelText('2 não lidas')).toBeInTheDocument()
})

it('deve avisar que o WhatsApp NÃO está conectado, com o caminho para conectar', async () => {
  // ARRANGE — o estado de hoje: sistema pronto, credencial ainda não colada
  prepararApi({ conexao: 'nao_conectado' })

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder', 'mensagens.conectar'])

  // ASSERT
  expect(await screen.findByText(/WhatsApp não conectado/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Conectar o número/ })).toHaveAttribute(
    'href',
    '/configuracoes/whatsapp',
  )
})

it('NÃO deve oferecer a tela de conexão a quem não pode conectar', async () => {
  // ARRANGE — link para uma tela que a pessoa não pode abrir é frustração pura
  prepararApi({ conexao: 'nao_conectado' })

  // ACT
  renderizar(['mensagens.ver'])

  // ASSERT
  expect(await screen.findByText(/Fale com o administrador/)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Conectar o número/ })).not.toBeInTheDocument()
})

it('deve enviar texto livre com a janela ABERTA', async () => {
  // ARRANGE
  const enviados: unknown[] = []
  prepararApi({ aoEnviar: (corpo) => enviados.push(corpo) })
  const usuario = userEvent.setup()

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
  await usuario.type(await screen.findByLabelText('Mensagem para a família'), 'Claro, pode trazer!')
  await usuario.click(screen.getByRole('button', { name: /^Enviar$/ }))

  // ASSERT
  await waitFor(() => expect(enviados).toHaveLength(1))
  expect(enviados[0]).toEqual({ tipo: 'texto', corpo: 'Claro, pode trazer!' })
})

it('deve TROCAR o campo livre pelo seletor de template quando a janela fecha', async () => {
  // ARRANGE — deixar a recepção escrever para tomar 422 depois é o que faz alguém achar
  // que o sistema quebrou
  prepararApi({ conversas: [conversa({ janela_aberta: false, janela_expira_em: new Date(Date.now() - 1000).toISOString() })] })

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')

  // ASSERT
  expect(await screen.findByLabelText(/Template aprovado/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Mensagem para a família')).not.toBeInTheDocument()
  expect(screen.getByText(/Janela de 24/)).toBeInTheDocument()
})

it('deve montar a PRÉVIA do template com as variáveis preenchidas', async () => {
  // ARRANGE — a prévia mostra o texto que a família vai ler
  prepararApi({ conversas: [conversa({ janela_aberta: false })] })
  const usuario = userEvent.setup()

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
  await usuario.selectOptions(await screen.findByLabelText(/Template aprovado/), 'lembrete_agendamento')
  await usuario.type(screen.getByLabelText('Variável {{1}}'), 'Ana')
  await usuario.type(screen.getByLabelText('Variável {{2}}'), 'quarta às 14h')

  // ASSERT
  expect(screen.getByTestId('previa-do-template')).toHaveTextContent(
    'Olá Ana, lembrando da sua sessão em quarta às 14h.',
  )
})

it('deve manter na thread a mensagem que FALHOU, com motivo e reenvio', async () => {
  // ARRANGE — silêncio é o pior resultado para quem acha que avisou a família
  prepararApi({
    mensagens: [
      mensagem({
        id: 11,
        direcao: 'enviada',
        status: 'falhou',
        erro_motivo: 'Número não é um usuário do WhatsApp.',
        corpo: 'Lembrete de amanhã',
      }),
    ],
  })

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')

  // ASSERT
  expect(await screen.findByText('Número não é um usuário do WhatsApp.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Tentar novamente/ })).toBeInTheDocument()
})

it('deve identificar o lembrete AUTOMÁTICO na thread', async () => {
  // ARRANGE — a recepção precisa ver que o sistema já avisou, para não ligar de novo
  prepararApi({
    mensagens: [mensagem({ id: 12, direcao: 'enviada', automatica: true, status: 'entregue', corpo: 'Lembrete' })],
  })

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')

  // ASSERT
  expect(await screen.findByText('Mensagem automática')).toBeInTheDocument()
})

it('NÃO deve mostrar o campo de escrita a quem só LÊ', async () => {
  // ARRANGE
  prepararApi()

  // ACT
  renderizar(['mensagens.ver'], '/mensagens?conversa=1')

  // ASSERT — o nome aparece na lista E no cabeçalho da conversa aberta; o que importa
  // aqui é que o campo de escrita NÃO existe
  await screen.findAllByText('Criança Fictícia')
  expect(screen.queryByLabelText('Mensagem para a família')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Enviar$/ })).not.toBeInTheDocument()
})

it('deve SUSPENDER a atualização periódica quando a aba fica oculta', async () => {
  // ARRANGE — vinte abas esquecidas numa recepção bateriam no servidor a noite inteira
  let consultas = 0
  servidor.use(
    msw.get('/api/mensagens/conversas', () => {
      consultas += 1
      return HttpResponse.json({ conexao: 'conectado', conversas: [conversa()] })
    }),
    msw.get('/api/mensagens/templates', () => HttpResponse.json([])),
  )
  vi.useFakeTimers({ shouldAdvanceTime: true })

  // ACT
  renderizar()
  await waitFor(() => expect(consultas).toBe(1))

  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(40_000)

  // ASSERT — nenhuma consulta a mais com a aba escondida
  expect(consultas).toBe(1)
  vi.useRealTimers()
})

it('deve mostrar o toque num botão do lembrete como "Tocou em", e não como tipo não suportado', async () => {
  // ARRANGE — a família tocou em "✅ Confirmo" no lembrete (change lembrete-com-botoes-de-resposta)
  prepararApi({ mensagens: [mensagem({ id: 30, tipo: 'botao', corpo: '✅ Confirmo' })] })

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')

  // ASSERT — o texto do botão, dito como toque; nada de "tipo não suportado"
  expect(await screen.findByText('Tocou em: ✅ Confirmo')).toBeInTheDocument()
  expect(screen.queryByText('Mensagem de tipo não suportado.')).not.toBeInTheDocument()
})

it('deve abrir a conversa apontada pelo deep-link do centro de notificações', async () => {
  // ARRANGE
  prepararApi()

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')

  // ASSERT
  // espera a THREAD resolver antes de olhar dentro do painel: a região existe desde o
  // primeiro render (com skeleton), e assertar nela cedo demais testa o esqueleto
  const naTela = await screen.findByText('Bom dia, posso remarcar?')
  const painel = screen.getByRole('region', { name: 'Conversa selecionada' })
  expect(painel).toContainElement(naTela)
})

it('deve passar na auditoria de acessibilidade', async () => {
  // ARRANGE
  prepararApi()

  // ACT
  const { container } = renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
  await screen.findByText('Bom dia, posso remarcar?')

  // ASSERT
  expect(await axe(container)).toHaveNoViolations()
})

it('deve carregar mensagens ANTERIORES sob demanda, sem arrastar a conversa inteira', async () => {
  // ARRANGE — dois anos de acompanhamento acumulam milhares de mensagens, e a thread relê
  // a cada 8 s: a janela é o que impede cada ciclo de arrastar tudo pela rede
  prepararApi({ temAnteriores: true })
  const usuario = userEvent.setup()

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
  await usuario.click(await screen.findByRole('button', { name: /Carregar mensagens anteriores/ }))

  // ASSERT — a mensagem antiga entra ANTES da janela recente, e a recente continua lá
  expect(await screen.findByText('mensagem antiga ficticia')).toBeInTheDocument()
  expect(screen.getByText('Bom dia, posso remarcar?')).toBeInTheDocument()
})

it('NÃO deve oferecer "carregar anteriores" quando a conversa cabe inteira na janela', async () => {
  // ARRANGE — botão que não faz nada é ruído
  prepararApi({ temAnteriores: false })

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')

  // ASSERT
  await screen.findByText('Bom dia, posso remarcar?')
  expect(screen.queryByRole('button', { name: /Carregar mensagens anteriores/ })).not.toBeInTheDocument()
})

it('deve paginar a lista quando há mais conversas que uma página', async () => {
  // ARRANGE — com ~400 pacientes ativos, passar de uma página é certeza; um corte mudo
  // esconderia famílias sem ninguém saber
  servidor.use(
    msw.get('/api/mensagens/conversas', ({ request }) => {
      const pagina = Number(new URL(request.url).searchParams.get('page') ?? 1)
      return HttpResponse.json({
        conexao: 'conectado',
        conversas: [conversa({ id: pagina, paciente: { id: pagina, nome: `Criança ${pagina}`, nome_social: null } })],
        pagina,
        ultima_pagina: 3,
        total: 120,
      })
    }),
    msw.get('/api/mensagens/templates', () => HttpResponse.json([])),
  )
  const usuario = userEvent.setup()

  // ACT
  renderizar()
  expect(await screen.findByText('Criança 1')).toBeInTheDocument()
  await usuario.click(screen.getByRole('button', { name: 'Próxima página' }))

  // ASSERT — e o total fica visível: a recepção sabe quantas conversas existem
  expect(await screen.findByText('Criança 2')).toBeInTheDocument()
  // o total é anunciado pelo componente do design system, em role="status"
  expect(screen.getByRole('status')).toHaveTextContent('120')
})

it('deve manter o campo de envio VISÍVEL e desabilitado quando o canal cai', async () => {
  // ARRANGE — a spec diz "desabilitadas com o motivo em texto — nunca um botão que erra ao
  // clicar". Sumir com o campo deixa a pessoa procurando o que aconteceu, e o aviso do topo
  // fica a ~700 px do ponto da ação (achado do gate de design)
  prepararApi({ conexao: 'nao_conectado' })

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')

  // ASSERT — `aria-disabled`, não `disabled`: o botão continua FOCÁVEL e o motivo segue
  // alcançável pelo leitor de tela (com `disabled`, o foco cai no body e o porquê some)
  expect(await screen.findByLabelText('Mensagem para a família')).toBeDisabled()

  const enviar = screen.getByRole('button', { name: /^Enviar$/ })
  expect(enviar).toHaveAttribute('aria-disabled', 'true')
  expect(enviar).toHaveAccessibleDescription('O WhatsApp da clínica não está conectado.')
  expect(screen.getByRole('button', { name: 'Anexar arquivo' })).toHaveAttribute('aria-disabled', 'true')
})

it('NÃO deve perder o foco ao bloquear a ação — o motivo tem de continuar alcançável', async () => {
  // ARRANGE — `disabled` tira o elemento do ciclo de foco no instante do clique: a pessoa
  // perde o lugar na tela E o porquê ao mesmo tempo (achado do gate de a11y)
  prepararApi({ conexao: 'nao_conectado' })

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
  const enviar = await screen.findByRole('button', { name: /^Enviar$/ })
  enviar.focus()

  // ASSERT — focável mesmo bloqueado
  expect(enviar).toHaveFocus()
})

it('NÃO deve o relógio anunciar janela aberta com o canal desconectado', async () => {
  // ARRANGE — "resta 39 min para responder livremente" com o canal caído é mentira na tela
  prepararApi({ conexao: 'nao_conectado' })

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')

  // ASSERT
  // frase própria do relógio (o aviso do topo também diz "nada pode ser enviado")
  expect(await screen.findByText(/Enquanto o WhatsApp não estiver conectado/)).toBeInTheDocument()
  expect(screen.queryByText(/resta .* para responder/)).not.toBeInTheDocument()
})

it('NÃO deve oferecer "Tentar novamente" com o canal desconectado', async () => {
  // ARRANGE — é literalmente o botão que erra ao clicar
  prepararApi({
    conexao: 'nao_conectado',
    mensagens: [mensagem({ id: 11, direcao: 'enviada', status: 'falhou', erro_motivo: 'Falhou.' })],
  })

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')

  // ASSERT — o motivo continua visível; a ação, não
  expect(await screen.findByText('Falhou.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Tentar novamente/ })).not.toBeInTheDocument()
})

it('deve VINCULAR o paciente pela própria aba, sem beco sem saída', async () => {
  // ARRANGE — antes era um link para `/pacientes?vincular=<id>` que ninguém lia: a recepção
  // caía na lista de pacientes sem contexto, sem ação e sem volta
  const vinculados: unknown[] = []
  prepararApi({ conversas: [conversa({ paciente: null })] })
  servidor.use(
    msw.get('/api/pacientes', () =>
      HttpResponse.json({ data: [{ id: 7, nome: 'Criança Fictícia', nome_social: null }], current_page: 1, last_page: 1, per_page: 20, total: 1 }),
    ),
    msw.post('/api/mensagens/conversas/:id/vincular', async ({ request }) => {
      vinculados.push(await request.json())
      return HttpResponse.json(conversa())
    }),
  )
  const usuario = userEvent.setup()

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
  await usuario.click(await screen.findByRole('button', { name: /Vincular paciente/ }))
  await usuario.type(await screen.findByLabelText('Nome do paciente'), 'Cri')
  await usuario.click(await screen.findByRole('button', { name: 'Criança Fictícia' }))

  // ASSERT
  await waitFor(() => expect(vinculados).toHaveLength(1))
  expect(vinculados[0]).toEqual({ paciente_id: 7 })
})

it('deve mostrar o TRECHO da última mensagem na lista', async () => {
  // ARRANGE — é o que faz decidir de relance qual conversa espera resposta
  prepararApi({ conversas: [conversa({ trecho: 'Bom dia, posso remarcar?' })] })

  // ACT
  renderizar()

  // ASSERT
  expect(await screen.findByText('Bom dia, posso remarcar?')).toBeInTheDocument()
})

describe('a conversa no celular (conversa-legivel)', () => {
  it('deve tirar da vista, abaixo de lg, o cabeçalho da página quando há conversa aberta', async () => {
    // ARRANGE — título, frase e busca comiam 150 px de um celular em que a conversa ficava com 98
    prepararApi()

    // ACT
    renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await screen.findByText('Bom dia, posso remarcar?')

    // ASSERT — o jsdom não aplica media query: o que se confere é a classe de cada lado do
    // limiar. O `h1` continua no documento (para o leitor de tela); a busca sai de vez
    const titulo = screen.getByRole('heading', { level: 1, name: 'Mensagens' })
    expect(titulo.closest('header')).toHaveClass('max-lg:sr-only')
    expect(screen.getByLabelText('Buscar conversa').closest('.max-w-xs')).toHaveClass('max-lg:hidden')
  })

  it('deve manter o cabeçalho da página, com a busca, quando nenhuma conversa está aberta', async () => {
    // ARRANGE — na lista, a busca é o caminho para achar a família
    prepararApi()

    // ACT
    renderizar()
    await screen.findByText('Criança Fictícia')

    // ASSERT
    const titulo = screen.getByRole('heading', { level: 1, name: 'Mensagens' })
    expect(titulo.closest('header')).not.toHaveClass('max-lg:sr-only')
    expect(screen.getByLabelText('Buscar conversa').closest('.max-w-xs')).not.toHaveClass('max-lg:hidden')
  })

  it('deve silenciar os lembretes pelo "Mais ações", anunciando o estado', async () => {
    // ARRANGE
    const pedidos: unknown[] = []
    prepararApi()
    servidor.use(
      msw.post('/api/mensagens/conversas/:id/lembretes', async ({ request }) => {
        pedidos.push(await request.json())
        return HttpResponse.json(conversa({ sem_lembretes: true }))
      }),
    )
    const usuario = userEvent.setup()

    // ACT
    renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: 'Mais ações' }))
    const silenciar = await screen.findByRole('menuitemcheckbox', { name: 'Silenciar lembretes' })
    const estadoAntes = silenciar.getAttribute('aria-checked')
    await usuario.click(silenciar)

    // ASSERT — ligado/desligado é ESTADO do item, não troca de nome; e o toast diz o estado NOVO
    // (A11Y-CL-09 — prova por mutação: o texto antigo, "Preferência de lembretes atualizada", cai)
    expect(estadoAntes).toBe('false')
    await waitFor(() => expect(pedidos).toEqual([{ sem_lembretes: true }]))
    expect(await screen.findByText('Lembretes silenciados.')).toBeInTheDocument()
  })

  it('deve dizer "Lembretes reativados" ao desligar o silêncio', async () => {
    // ARRANGE — a conversa já está silenciada
    prepararApi({ conversas: [conversa({ sem_lembretes: true })] })
    servidor.use(
      msw.post('/api/mensagens/conversas/:id/lembretes', () => HttpResponse.json(conversa({ sem_lembretes: false }))),
    )
    const usuario = userEvent.setup()

    // ACT
    renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: 'Mais ações' }))
    await usuario.click(await screen.findByRole('menuitemcheckbox', { name: 'Silenciar lembretes', checked: true }))

    // ASSERT
    expect(await screen.findByText('Lembretes reativados.')).toBeInTheDocument()
  })

  it('NÃO deve esconder o resto da página enquanto "Mais ações" está aberto', async () => {
    // ARRANGE — o menu MODAL marcava a página inteira `aria-hidden`, e o axe acusava (A11Y-CL-01)
    prepararApi()
    const usuario = userEvent.setup()

    // ACT
    renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: 'Mais ações' }))
    await screen.findByRole('menu')

    // ASSERT — prova por mutação: com o menu modal, a thread some da árvore acessível e o
    // `getByRole` abaixo não a acha
    expect(screen.getByRole('log', { name: 'Mensagens da conversa' })).toBeInTheDocument()
    // o `body` inteiro, porque o menu mora num portal; só as regras WCAG — a de "landmark" é boa
    // prática, e aqui não há o shell com o `<main>` em volta da página
    const regrasWcag = { runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }
    expect(await axe(document.body, regrasWcag)).toHaveNoViolations()
  })

  it('deve devolver o foco ao "Mais ações" quando o menu fecha com Esc', async () => {
    // ARRANGE
    prepararApi()
    const usuario = userEvent.setup()

    // ACT — pelo teclado, como quem não usa o toque
    renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    const gatilho = await screen.findByRole('button', { name: 'Mais ações' })
    gatilho.focus()
    await usuario.keyboard('{Enter}')
    await screen.findByRole('menu')
    await usuario.keyboard('{Escape}')

    // ASSERT
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(gatilho).toHaveFocus()
  })

  it('deve arquivar a conversa pelo "Mais ações"', async () => {
    // ARRANGE
    let arquivou = false
    prepararApi()
    servidor.use(
      msw.post('/api/mensagens/conversas/:id/arquivar', () => {
        arquivou = true
        return HttpResponse.json(conversa({ arquivada: true }))
      }),
    )
    const usuario = userEvent.setup()

    // ACT
    renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: 'Mais ações' }))
    await usuario.click(await screen.findByRole('menuitem', { name: 'Arquivar' }))

    // ASSERT
    await waitFor(() => expect(arquivou).toBe(true))
    expect(await screen.findByText('Conversa arquivada.')).toBeInTheDocument()
  })

  it('deve abrir o vínculo pelo "Mais ações" e devolver o foco ao menu quando o diálogo fecha', async () => {
    // ARRANGE — o item do menu sai da árvore quando o menu fecha: sem destino explícito, o foco
    // do diálogo voltaria a um nó morto, isto é, ao `<body>`
    prepararApi({ conversas: [conversa({ paciente: null })] })
    servidor.use(
      msw.get('/api/pacientes', () =>
        HttpResponse.json({ data: [], current_page: 1, last_page: 1, per_page: 20, total: 0 }),
      ),
    )
    const usuario = userEvent.setup()

    // ACT
    renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    const gatilho = await screen.findByRole('button', { name: 'Mais ações' })
    await usuario.click(gatilho)
    await usuario.click(await screen.findByRole('menuitem', { name: 'Vincular paciente' }))
    expect(await screen.findByRole('dialog', { name: 'Vincular a um paciente' })).toBeInTheDocument()
    await usuario.keyboard('{Escape}')

    // ASSERT
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(gatilho).toHaveFocus())
  })

  it('NÃO deve oferecer "Mais ações" a quem só lê', async () => {
    // ARRANGE — ação que a pessoa não pode fazer não aparece, nem escondida num menu
    prepararApi()

    // ACT
    renderizar(['mensagens.ver'], '/mensagens?conversa=1')
    await screen.findByText('Bom dia, posso remarcar?')

    // ASSERT — a volta para a lista continua: ela não é ação sobre a conversa
    expect(screen.queryByRole('button', { name: 'Mais ações' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voltar para as conversas' })).toBeInTheDocument()
  })

  it('deve voltar para a lista pelo cabeçalho da conversa', async () => {
    // ARRANGE — no celular a lista fica escondida enquanto a conversa está aberta
    prepararApi()
    const usuario = userEvent.setup()

    // ACT
    renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: 'Voltar para as conversas' }))

    // ASSERT
    expect(await screen.findByText('Nenhuma conversa aberta')).toBeInTheDocument()
  })

  it('deve oferecer a volta para a lista quando a conversa não abre', async () => {
    // ARRANGE — com a lista e o cabeçalho da página fora da vista, o erro sem volta era beco
    prepararApi()
    servidor.use(
      msw.get('/api/mensagens/conversas/:id', () => HttpResponse.json({ message: 'Não encontrada.' }, { status: 404 })),
    )
    const usuario = userEvent.setup()

    // ACT
    renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: 'Voltar para as conversas' }))

    // ASSERT
    expect(await screen.findByText('Nenhuma conversa aberta')).toBeInTheDocument()
  })
})

describe('o foco no mestre-detalhe (A11Y-CL-03)', () => {
  it('deve levar o foco ao item da conversa que fechou, ao voltar para a lista', async () => {
    // ARRANGE — abaixo de lg o Voltar some junto com a conversa, e o foco caía no <body>
    prepararApi()
    const usuario = userEvent.setup()

    // ACT
    const { container } = renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: 'Voltar para as conversas' }))

    // ASSERT — prova por mutação: sem o efeito da volta, o foco fica no <body>
    await waitFor(() => expect(container.querySelector('[data-conversa="1"]')).toHaveFocus())
  })

  it('deve levar o foco ao título da página quando a conversa fechada não está na lista', async () => {
    // ARRANGE — chegou-se à conversa 1 pelo centro de notificações; a lista mostra outra
    prepararApi({ conversas: [conversa({ id: 2, paciente: { id: 8, nome: 'Outra Criança Fictícia', nome_social: null } })] })
    servidor.use(
      msw.get('/api/mensagens/conversas/:id', () =>
        HttpResponse.json({ conversa: conversa(), tem_anteriores: false, mensagens: [mensagem()] }),
      ),
    )
    const usuario = userEvent.setup()

    // ACT
    renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: 'Voltar para as conversas' }))

    // ASSERT
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Mensagens' })).toHaveFocus())
  })

  it('deve levar o foco ao nome da conversa quando o item clicado some da tela', async () => {
    // ARRANGE — abaixo de lg, abrir a conversa esconde a lista. O jsdom não tem caixa para
    // elemento nenhum, então o item clicado conta como "sumiu" — é o caso do celular
    prepararApi()
    const usuario = userEvent.setup()

    // ACT
    const { container } = renderizar()
    await screen.findByText('Criança Fictícia')
    const item = container.querySelector<HTMLElement>('[data-conversa="1"]')
    if (item === null) throw new Error('o item da conversa não está na lista')
    await usuario.click(item)

    // ASSERT — prova por mutação: sem o efeito da abertura, o foco fica no item escondido
    const titulo = await screen.findByRole('heading', { level: 2, name: 'Criança Fictícia' })
    await waitFor(() => expect(titulo).toHaveFocus())
  })

  it('NÃO deve mover o foco quando o item clicado continua visível', async () => {
    // ARRANGE — em tela larga a lista fica ao lado da conversa: o item clicado segue na tela, e
    // puxar o foco para o título tiraria quem navega pela lista do lugar (CRL2-08). O jsdom não
    // tem caixa para nada; aqui o item ganha uma, como no navegador
    prepararApi()
    const usuario = userEvent.setup()
    const { container } = renderizar()
    await screen.findByText('Criança Fictícia')
    const item = container.querySelector<HTMLElement>('[data-conversa="1"]')
    if (item === null) throw new Error('o item da conversa não está na lista')
    Object.defineProperty(item, 'getClientRects', { value: () => ({ length: 1 }) })

    // ACT
    await usuario.click(item)
    await screen.findByRole('heading', { level: 2, name: 'Criança Fictícia' })
    await screen.findByText('Bom dia, posso remarcar?')

    // ASSERT — prova por mutação: sem a guarda `focoPerdido`, o foco pula para o título
    expect(item).toHaveFocus()
  })

  it('deve levar o foco ao Voltar quando a conversa aberta pela lista não carrega', async () => {
    // ARRANGE — sem nome para focar, a única saída da tela é o Voltar (A11Y-CL2-04)
    prepararApi()
    servidor.use(
      msw.get('/api/mensagens/conversas/:id', () => HttpResponse.json({ message: 'Não encontrada.' }, { status: 404 })),
    )
    const usuario = userEvent.setup()
    const { container } = renderizar()
    await screen.findByText('Criança Fictícia')
    const item = container.querySelector<HTMLElement>('[data-conversa="1"]')
    if (item === null) throw new Error('o item da conversa não está na lista')

    // ACT
    await usuario.click(item)

    // ASSERT — prova por mutação: sem o ramo do erro, o foco fica no item escondido
    const voltar = await screen.findByRole('button', { name: 'Voltar para as conversas' })
    await waitFor(() => expect(voltar).toHaveFocus())
  })

  it('deve levar o foco ao item da conversa quando ela fecha pelo VOLTAR DO NAVEGADOR', async () => {
    // ARRANGE — o gesto de voltar e o `history.back` não passam pelo botão da tela (A11Y-CL2-03)
    prepararApi()
    useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: ['mensagens.ver', 'mensagens.responder'] }, carregandoSessao: false })
    const usuario = userEvent.setup()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter initialEntries={['/mensagens', '/mensagens?conversa=1']} initialIndex={1}>
            <VoltarDoNavegador />
            <PaginaMensagens />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
    await screen.findByText('Bom dia, posso remarcar?')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'voltar do navegador (dublê)' }))

    // ASSERT — prova por mutação: sem olhar a TRANSIÇÃO de `selecionada`, o foco não chega ao item
    await waitFor(() => expect(container.querySelector('[data-conversa="1"]')).toHaveFocus())
  })

  it('deve fechar o diálogo de vínculo quando a conversa muda por fora', async () => {
    // ARRANGE — com o diálogo aberto na conversa 1, o voltar do navegador (ou um link do centro de
    // notificações) troca a conversa. O diálogo ficava aberto sobre a outra e vinculava a ERRADA
    prepararApi({ conversas: [conversa({ paciente: null })] })
    servidor.use(
      msw.get('/api/pacientes', () =>
        HttpResponse.json({ data: [], current_page: 1, last_page: 1, per_page: 20, total: 0 }),
      ),
    )
    useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: ['mensagens.ver', 'mensagens.responder'] }, carregandoSessao: false })
    const usuario = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter initialEntries={['/mensagens', '/mensagens?conversa=1']} initialIndex={1}>
            <VoltarDoNavegador />
            <PaginaMensagens />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
    await usuario.click(await screen.findByRole('button', { name: /Vincular paciente/ }))
    expect(await screen.findByRole('dialog', { name: 'Vincular a um paciente' })).toBeInTheDocument()

    // ACT — o modal esconde o resto da página; o voltar do navegador vem de fora dele
    fireEvent.click(screen.getByRole('button', { name: 'voltar do navegador (dublê)', hidden: true }))

    // ASSERT — prova por mutação: com o diálogo aberto por booleano, ele continua na tela
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('deve levar o foco ao link da ficha depois de vincular, porque o botão Vincular some', async () => {
    // ARRANGE — o servidor passa a responder a conversa COM paciente depois do vínculo, e a
    // releitura DEMORA, como na rede de verdade: o diálogo fecha antes de ela chegar
    let vinculada = false
    prepararApi({ conversas: [conversa({ paciente: null })] })
    servidor.use(
      msw.get('/api/mensagens/conversas/:id', async () => {
        if (vinculada) await new Promise((resolver) => setTimeout(resolver, 300))
        return HttpResponse.json({
          conversa: vinculada ? conversa() : conversa({ paciente: null }),
          tem_anteriores: false,
          mensagens: [mensagem()],
        })
      }),
      msw.get('/api/pacientes', () =>
        HttpResponse.json({ data: [{ id: 7, nome: 'Criança Fictícia', nome_social: null }], current_page: 1, last_page: 1, per_page: 20, total: 1 }),
      ),
      msw.post('/api/mensagens/conversas/:id/vincular', () => {
        vinculada = true
        return HttpResponse.json(conversa())
      }),
    )
    const usuario = userEvent.setup()

    // ACT — pelo botão de tela larga
    renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: /Vincular paciente/ }))
    await usuario.type(await screen.findByLabelText('Nome do paciente'), 'Cri')
    await usuario.click(await screen.findByRole('button', { name: 'Criança Fictícia' }))

    // ASSERT — prova por mutação: sem preferir a ficha (ou sem pôr o paciente no cabeçalho antes
    // de o diálogo fechar), o foco volta ao botão que deixou de existir, isto é, ao <body>
    const ficha = await screen.findByRole('link', { name: 'Abrir a ficha do paciente' })
    await waitFor(() => expect(ficha).toHaveFocus())
  })
})

describe('o histórico da thread (conversa-legivel)', () => {
  it('NÃO deve levar as mensagens antigas de uma família para a conversa de outra', async () => {
    // ARRANGE — as anteriores de A JÁ chegaram; depois a recepção abre B (CRL2-02)
    const familiaA = conversa({ id: 1, paciente: { id: 7, nome: 'Criança Fictícia A', nome_social: null } })
    const familiaB = conversa({ id: 2, paciente: { id: 8, nome: 'Criança Fictícia B', nome_social: null } })
    prepararApi({ conversas: [familiaA, familiaB] })
    servidor.use(
      msw.get('/api/mensagens/conversas/:id', ({ params, request }) => {
        if (new URL(request.url).searchParams.get('antes') !== null) {
          return HttpResponse.json({ conversa: familiaA, tem_anteriores: false, mensagens: [mensagem({ id: 1, corpo: 'antiga da família A' })] })
        }
        const eA = params.id === '1'
        return HttpResponse.json({
          conversa: eA ? familiaA : familiaB,
          tem_anteriores: eA,
          mensagens: [mensagem({ id: eA ? 10 : 20, corpo: eA ? 'recente da família A' : 'recente da família B' })],
        })
      }),
    )
    const usuario = userEvent.setup()

    // ACT
    const { container } = renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: /Carregar mensagens anteriores/ }))
    await screen.findByText('antiga da família A')
    const itemB = container.querySelector<HTMLElement>('[data-conversa="2"]')
    if (itemB === null) throw new Error('a conversa B não está na lista')
    await usuario.click(itemB)
    await screen.findByText('recente da família B')

    // ASSERT — prova por mutação: sem zerar o histórico na troca, a antiga de A aparece em B
    expect(screen.queryByText('antiga da família A')).not.toBeInTheDocument()
  })

  it('deve dizer o motivo quando "Carregar anteriores" falha, sem rejeição solta', async () => {
    // ARRANGE — antes, a falha era uma promessa rejeitada sem dono e um clique mudo (CRL2-09)
    prepararApi({ temAnteriores: true })
    servidor.use(
      msw.get('/api/mensagens/conversas/:id', ({ request }) =>
        new URL(request.url).searchParams.get('antes') !== null
          ? HttpResponse.json({ errors: { antes: ['Conversa não encontrada.'] } }, { status: 422 })
          : HttpResponse.json({ conversa: conversa(), tem_anteriores: true, mensagens: [mensagem()] }),
      ),
    )
    const usuario = userEvent.setup()

    // ACT
    renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: /Carregar mensagens anteriores/ }))

    // ASSERT — prova por mutação: sem o `catch`, nenhum toast (e o Vitest acusa a rejeição)
    expect(await screen.findByText('Conversa não encontrada.')).toBeInTheDocument()
  })

  it('NÃO deve pôr o paciente de uma família no cabeçalho de outra quando o vínculo termina depois', async () => {
    // ARRANGE — o vínculo de A fica no ar; a recepção fecha o diálogo e abre B; aí o servidor
    // responde. A releitura de B demora, como na rede (SEC-CL2-03)
    let liberar: () => void = () => undefined
    const portao = new Promise<void>((resolver) => {
      liberar = resolver
    })
    let respondeu = false
    const familiaA = conversa({ id: 1, paciente: null, nome_perfil: 'Perfil Fictício A' })
    const familiaB = conversa({ id: 2, paciente: null, nome_perfil: 'Perfil Fictício B' })
    prepararApi({ conversas: [familiaA, familiaB] })
    servidor.use(
      msw.get('/api/mensagens/conversas/:id', async ({ params }) => {
        if (respondeu) await new Promise((resolver) => setTimeout(resolver, 300))
        return HttpResponse.json({ conversa: params.id === '1' ? familiaA : familiaB, tem_anteriores: false, mensagens: [mensagem()] })
      }),
      msw.get('/api/pacientes', () =>
        HttpResponse.json({ data: [{ id: 7, nome: 'Criança Fictícia A', nome_social: null }], current_page: 1, last_page: 1, per_page: 20, total: 1 }),
      ),
      msw.post('/api/mensagens/conversas/:id/vincular', async () => {
        await portao
        respondeu = true
        return HttpResponse.json(conversa({ id: 1, paciente: { id: 7, nome: 'Criança Fictícia A', nome_social: null } }))
      }),
    )
    const usuario = userEvent.setup()

    // ACT
    const { container } = renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: /Vincular paciente/ }))
    await usuario.type(await screen.findByLabelText('Nome do paciente'), 'Cri')
    await usuario.click(await screen.findByRole('button', { name: 'Criança Fictícia A' }))
    await usuario.keyboard('{Escape}')
    const itemB = container.querySelector<HTMLElement>('[data-conversa="2"]')
    if (itemB === null) throw new Error('a conversa B não está na lista')
    await usuario.click(itemB)
    await screen.findByRole('heading', { level: 2, name: 'Perfil Fictício B' })
    liberar()
    await screen.findByText('Conversa vinculada ao paciente.')

    // ASSERT — prova por mutação: gravando na conversa ABERTA, o cabeçalho de B mostra A
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Perfil Fictício B')
    expect(screen.queryByRole('link', { name: 'Abrir a ficha do paciente' })).not.toBeInTheDocument()
  })

  it('NÃO deve pôr na conversa de uma família as mensagens antigas de outra', async () => {
    // ARRANGE — a resposta de "Carregar anteriores" da família A chega DEPOIS de a recepção abrir
    // a conversa da família B. Era gravada sem conferir a conversa: vazamento entre famílias
    let liberar: () => void = () => undefined
    const portao = new Promise<void>((resolver) => {
      liberar = resolver
    })
    const familiaA = conversa({ id: 1, paciente: { id: 7, nome: 'Criança Fictícia A', nome_social: null } })
    const familiaB = conversa({ id: 2, paciente: { id: 8, nome: 'Criança Fictícia B', nome_social: null } })
    prepararApi({ conversas: [familiaA, familiaB] })
    servidor.use(
      msw.get('/api/mensagens/conversas/:id', async ({ params, request }) => {
        if (new URL(request.url).searchParams.get('antes') !== null) {
          await portao
          return HttpResponse.json({
            conversa: familiaA,
            tem_anteriores: false,
            mensagens: [mensagem({ id: 1, corpo: 'mensagem antiga da família A' })],
          })
        }
        const eA = params.id === '1'
        // o MESMO id nas duas conversas, de propósito: a âncora do pedido (a 10) continua na tela
        // depois da troca, e só a guarda da GERAÇÃO separa as famílias. Na vida real os ids não
        // se repetem, e a âncora também barraria — aqui cada guarda é provada sozinha
        return HttpResponse.json({
          conversa: eA ? familiaA : familiaB,
          tem_anteriores: eA,
          mensagens: [mensagem({ id: 10, corpo: eA ? 'recente da família A' : 'recente da família B' })],
        })
      }),
    )
    const usuario = userEvent.setup()

    // ACT — pede as anteriores de A e, antes da resposta, abre B
    const { container } = renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: /Carregar mensagens anteriores/ }))
    const itemB = container.querySelector<HTMLElement>('[data-conversa="2"]')
    if (itemB === null) throw new Error('a conversa B não está na lista')
    await usuario.click(itemB)
    await screen.findByText('recente da família B')
    liberar()
    await new Promise((resolver) => setTimeout(resolver, 50))

    // ASSERT — prova por mutação: sem a conferência da geração, a mensagem de A aparece em B
    expect(screen.queryByText('mensagem antiga da família A')).not.toBeInTheDocument()
    expect(screen.getByText('recente da família B')).toBeInTheDocument()
  })

  it('NÃO deve abrir um buraco no histórico quando a mensagem nova empurra a janela', async () => {
    // ARRANGE — a janela é das N mais recentes. Com histórico carregado, a mais antiga dela saía
    // pelo topo e sumia entre as anteriores e a janela nova
    let janela = [mensagem({ id: 10, corpo: 'janela dez' }), mensagem({ id: 11, corpo: 'janela onze' })]
    prepararApi()
    servidor.use(
      msw.get('/api/mensagens/conversas/:id', ({ request }) => {
        if (new URL(request.url).searchParams.get('antes') !== null) {
          return HttpResponse.json({ conversa: conversa(), tem_anteriores: false, mensagens: [mensagem({ id: 5, corpo: 'antiga cinco' })] })
        }
        return HttpResponse.json({ conversa: conversa(), tem_anteriores: true, mensagens: janela })
      }),
    )
    const usuario = userEvent.setup()

    // ACT — carrega as anteriores; depois chega a 12 e a janela vira 11–12
    renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
    await usuario.click(await screen.findByRole('button', { name: /Carregar mensagens anteriores/ }))
    await screen.findByText('antiga cinco')
    janela = [mensagem({ id: 11, corpo: 'janela onze' }), mensagem({ id: 12, corpo: 'janela doze' })]
    await queryClient.invalidateQueries({ queryKey: ['conversas'] })
    await screen.findByText('janela doze')

    // ASSERT — a 10 continua entre a 5 e a 11. Prova por mutação: sem guardar o que sai pelo topo,
    // "janela dez" some
    const textos = screen.getAllByText(/^(antiga cinco|janela (dez|onze|doze))$/).map((no) => no.textContent)
    expect(textos).toEqual(['antiga cinco', 'janela dez', 'janela onze', 'janela doze'])
  })
})

it('deve dar à página uma altura mínima, para o zoom de 400% rolar o documento em vez de esmagar', async () => {
  // ARRANGE — a 320×256 CSS (zoom de 400%) a altura contida ficava com 144 px e a conversa sumia
  // (A11Y-CL-04). O COMPORTAMENTO (o documento rola abaixo do piso e não rola acima dele) não é
  // provável no jsdom: ele não aplica CSS (`css: false`) nem calcula altura. A prova é a medição
  // no navegador (375×548, 360×560, 390×658 e 320×256); aqui fica a guarda da classe
  prepararApi()

  // ACT
  renderizar(['mensagens.ver', 'mensagens.responder'], '/mensagens?conversa=1')
  await screen.findByText('Bom dia, posso remarcar?')

  // ASSERT — prova por mutação: sem o piso, cai
  const titulo = screen.getByRole('heading', { level: 1, name: 'Mensagens' })
  expect(titulo.closest('header')?.parentElement).toHaveClass('min-h-[22rem]')
})

describe('a conversa sem template aprovado (o-sistema-avisa-o-que-falta)', () => {
  const QUEM_RESPONDE = ['mensagens.ver', 'mensagens.responder']
  const QUEM_RESPONDE_E_CONECTA = [...QUEM_RESPONDE, 'mensagens.conectar']
  const JANELA_FECHADA = conversa({ janela_aberta: false, janela_expira_em: new Date(Date.now() - 1000).toISOString() })
  const O_QUE_FALTA = /Nenhum template aprovado pela Meta foi sincronizado/
  const CAMINHO = 'Abrir Configurações › WhatsApp'

  /** Um template ainda EM ANÁLISE na Meta: existe, mas não sai. Fictício. */
  const SO_EM_ANALISE: TemplateDeMensagem[] = [
    {
      nome: 'boas_vindas_ficticio',
      idioma: 'pt_BR',
      categoria: 'UTILITY',
      corpo: 'Olá {{1}}.',
      variaveis: ['1'],
      aprovado: false,
      sincronizado_em: null,
    },
  ]

  function comTemplates(templates: TemplateDeMensagem[]): void {
    prepararApi({ conversas: [JANELA_FECHADA] })
    servidor.use(msw.get('/api/mensagens/templates', () => HttpResponse.json(templates)))
  }

  async function campoDeEnvio(): Promise<HTMLElement> {
    const seletor = await screen.findByLabelText(/Template aprovado/)
    const formulario = seletor.closest('form')
    if (formulario === null) {
      throw new Error('o seletor de template está fora do formulário de envio')
    }
    return formulario
  }

  it('deve dizer o que falta e levar à conexão do WhatsApp quem pode conectar', async () => {
    // ARRANGE
    comTemplates(SO_EM_ANALISE)

    // ACT
    renderizar(QUEM_RESPONDE_E_CONECTA, '/mensagens?conversa=1')
    const envio = await campoDeEnvio()

    // ASSERT — a razão é a ajuda do seletor, ligada a ele
    await waitFor(() => {
      expect(within(envio).getByLabelText(/Template aprovado/)).toHaveAccessibleDescription(O_QUE_FALTA)
    })
    expect(within(envio).getByRole('link', { name: CAMINHO })).toHaveAttribute('href', '/configuracoes/whatsapp')
  })

  it('deve dizer a quem pedir, sem link, a quem não pode conectar', async () => {
    // ARRANGE — a conexão vive sob `mensagens.conectar`: o link daria 403
    comTemplates([])

    // ACT
    renderizar(QUEM_RESPONDE, '/mensagens?conversa=1')
    const envio = await campoDeEnvio()

    // ASSERT
    expect(await within(envio).findByText(/Peça a quem administra o WhatsApp da clínica\./)).toBeInTheDocument()
    expect(within(envio).getByText(O_QUE_FALTA)).toBeInTheDocument()
    expect(within(envio).queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve deixar "Enviar template" indisponível dizendo por quê, e focável', async () => {
    // ARRANGE — antes, `aria-disabled` sem descrição: o botão ficava mudo
    comTemplates(SO_EM_ANALISE)
    renderizar(QUEM_RESPONDE, '/mensagens?conversa=1')
    const envio = await campoDeEnvio()
    const enviar = within(envio).getByRole('button', { name: 'Enviar template' })

    // ACT
    enviar.focus()

    // ASSERT
    expect(enviar).toHaveAttribute('aria-disabled', 'true')
    await waitFor(() => {
      expect(enviar).toHaveAccessibleDescription(O_QUE_FALTA)
    })
    expect(enviar).toHaveFocus()
  })

  it('deve somar o motivo do canal caído ao da falta de template', async () => {
    // ARRANGE — os dois impedimentos ao mesmo tempo: nenhum some
    prepararApi({ conexao: 'nao_conectado', conversas: [JANELA_FECHADA] })
    servidor.use(msw.get('/api/mensagens/templates', () => HttpResponse.json([])))

    // ACT
    renderizar(QUEM_RESPONDE, '/mensagens?conversa=1')
    const envio = await campoDeEnvio()

    // ASSERT
    const enviar = within(envio).getByRole('button', { name: 'Enviar template' })
    await waitFor(() => {
      expect(enviar).toHaveAccessibleDescription(/O WhatsApp da clínica não está conectado\./)
    })
    expect(enviar).toHaveAccessibleDescription(O_QUE_FALTA)
  })

  it('não deve dizer que falta template enquanto a lista ainda carrega', async () => {
    // ARRANGE — lista vazia por estar a caminho não é "nenhum aprovado"
    prepararApi({ conversas: [JANELA_FECHADA] })
    servidor.use(
      msw.get('/api/mensagens/templates', async () => {
        await delay('infinite')
        return HttpResponse.json([])
      }),
    )

    // ACT
    renderizar(QUEM_RESPONDE_E_CONECTA, '/mensagens?conversa=1')
    const envio = await campoDeEnvio()

    // ASSERT
    expect(within(envio).queryByText(O_QUE_FALTA)).not.toBeInTheDocument()
    expect(within(envio).getByRole('button', { name: 'Enviar template' })).not.toHaveAccessibleDescription(O_QUE_FALTA)
  })

  it('não deve dizer que falta template quando a lista de templates responde com erro', async () => {
    // ARRANGE — 403 (ou a rede) não diz se há aprovado: "nenhum aprovado" seria frase falsa (gate CR-AVI-10)
    prepararApi({ conversas: [JANELA_FECHADA] })
    servidor.use(
      msw.get('/api/mensagens/templates', () => HttpResponse.json({ message: 'Sem permissão.' }, { status: 403 })),
    )

    // ACT
    renderizar(QUEM_RESPONDE_E_CONECTA, '/mensagens?conversa=1')
    const envio = await campoDeEnvio()
    await waitFor(() => {
      expect(queryClient.getQueryState(chaves.templatesDeMensagem())?.status).toBe('error')
    })

    // ASSERT
    expect(within(envio).queryByText(O_QUE_FALTA)).not.toBeInTheDocument()
    expect(within(envio).queryByRole('link', { name: CAMINHO })).not.toBeInTheDocument()
    expect(within(envio).getByRole('button', { name: 'Enviar template' })).not.toHaveAccessibleDescription(O_QUE_FALTA)
  })

  it('não deve mudar nada quando há template aprovado', async () => {
    // ARRANGE — o `prepararApi` traz um aprovado
    prepararApi({ conversas: [JANELA_FECHADA] })

    // ACT
    renderizar(QUEM_RESPONDE_E_CONECTA, '/mensagens?conversa=1')
    const envio = await campoDeEnvio()
    await within(envio).findByRole('option', { name: 'lembrete_agendamento' })

    // ASSERT
    expect(within(envio).queryByText(O_QUE_FALTA)).not.toBeInTheDocument()
    expect(within(envio).queryByRole('link', { name: CAMINHO })).not.toBeInTheDocument()
  })

  it('deve abrir a conversa com as mesmas requisições, com e sem template aprovado (nenhuma requisição nova)', async () => {
    // ARRANGE — o aviso sai da lista de templates que a página já carrega (D6)
    async function requisicoesAoAbrir(aprovado: boolean): Promise<string[]> {
      queryClient.clear()
      if (aprovado) {
        prepararApi({ conversas: [JANELA_FECHADA] })
      } else {
        comTemplates(SO_EM_ANALISE)
      }
      const pedidas: string[] = []
      const anotar = ({ request }: { request: Request }): void => {
        pedidas.push(`${request.method} ${new URL(request.url).pathname}`)
      }
      servidor.events.on('request:start', anotar)
      const { unmount } = renderizar(QUEM_RESPONDE_E_CONECTA, '/mensagens?conversa=1')
      await campoDeEnvio()
      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0)
      })
      servidor.events.removeListener('request:start', anotar)
      unmount()
      return pedidas.sort()
    }

    // ACT
    const comAviso = await requisicoesAoAbrir(false)
    const semAviso = await requisicoesAoAbrir(true)

    // ASSERT
    expect(comAviso.length).toBeGreaterThan(0)
    expect(comAviso).toEqual(semAviso)
  })

  it('deve passar no axe com o aviso, com e sem a permissão de conectar', async () => {
    for (const permissoes of [QUEM_RESPONDE_E_CONECTA, QUEM_RESPONDE]) {
      // ARRANGE
      queryClient.clear()
      comTemplates([])
      const { container, unmount } = renderizar(permissoes, '/mensagens?conversa=1')

      // ACT
      const envio = await campoDeEnvio()
      await within(envio).findByText(O_QUE_FALTA)

      // ASSERT
      expect(await axe(container)).toHaveNoViolations()
      unmount()
    }
  })
})
