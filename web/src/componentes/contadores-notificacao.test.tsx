import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it } from 'vitest'

import { ContadoresNotificacao } from '@/componentes/contadores-notificacao'
import { derivarDoCard } from '@/lib/card-agendamento'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import { cardFicticio } from '@/test/dados-agenda'
import type { BlocoTarefas, EventoDoMural, ItemPacoteAcabando } from '@/tipos'

/** Bloco fictício do mural — dados 100% inventados (LGPD). */
function blocoDeTarefas(sobrescritas: Partial<BlocoTarefas> = {}): BlocoTarefas {
  return { total: 0, minhas: [], mencoes: [], demandas_abertas: [], eventos: [], ...sobrescritas }
}

function evento(sobrescritas: Partial<EventoDoMural> & Pick<EventoDoMural, 'id' | 'tipo'>): EventoDoMural {
  return {
    tarefa_id: 10,
    titulo: 'Organizar arquivo fictício',
    autor: 'Colega Fictícia',
    dados: null,
    quando: '2026-07-27 09:00',
    ...sobrescritas,
  }
}

function renderizar(permissoes: string[] = ['tarefas.ver']) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter>
          <ContadoresNotificacao />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

it('deve acender a pílula de novidades e narrar cada evento no painel', async () => {
  // ARRANGE — três tipos de evento no bloco
  servidor.use(
    msw.get('/api/notificacoes', () =>
      HttpResponse.json({
        tarefas: blocoDeTarefas({
          total: 3,
          eventos: [
            evento({ id: 1, tipo: 'atribuicao' }),
            evento({ id: 2, tipo: 'status', dados: { de: 'a_fazer', para: 'concluida' } }),
            evento({ id: 3, tipo: 'comentario' }),
          ],
        }),
      }),
    ),
  )

  // ACT
  renderizar()

  // ASSERT — pílula com a contagem; painel narra por tipo e aponta para a tarefa
  await screen.findByText('3 novidades')
  await userEvent.click(screen.getByRole('button', { name: /Tarefas da equipe/ }))
  expect(screen.getByText('Colega Fictícia atribuiu você')).toBeInTheDocument()
  expect(screen.getByText('Colega Fictícia concluiu')).toBeInTheDocument()
  expect(screen.getByText('Colega Fictícia comentou')).toBeInTheDocument()
  const linha = screen.getByRole('link', { name: /atribuiu você/ })
  expect(linha).toHaveAttribute('href', '/tarefas?tarefa=10')
  expect(screen.getByRole('link', { name: 'Abrir o mural' })).toHaveAttribute('href', '/tarefas')
})

it('deve narrar a demanda assumida e a coluna de destino pelo rótulo humano', async () => {
  // ARRANGE
  servidor.use(
    msw.get('/api/notificacoes', () =>
      HttpResponse.json({
        tarefas: blocoDeTarefas({
          total: 2,
          eventos: [
            evento({ id: 1, tipo: 'atribuicao', dados: { assumida: true } }),
            evento({ id: 2, tipo: 'status', dados: { de: 'a_fazer', para: 'em_andamento' } }),
          ],
        }),
      }),
    ),
  )

  // ACT
  renderizar()

  // ASSERT — "assumiu" ≠ "atribuiu"; slug nunca aparece
  await screen.findByText('2 novidades')
  await userEvent.click(screen.getByRole('button', { name: /Tarefas da equipe/ }))
  expect(screen.getByText('Colega Fictícia assumiu a demanda')).toBeInTheDocument()
  expect(screen.getByText('Colega Fictícia moveu para Em andamento')).toBeInTheDocument()
  expect(screen.queryByText(/em_andamento/)).not.toBeInTheDocument()
})

it('deve marcar todas como lidas e apagar a pílula', async () => {
  // ARRANGE — o POST troca a resposta do centro para "sem eventos"
  let marcou = false
  servidor.use(
    msw.get('/api/notificacoes', () =>
      HttpResponse.json({
        tarefas: blocoDeTarefas(
          marcou
            ? { total: 1, minhas: [{ id: 10, titulo: 'Organizar arquivo fictício', coluna: 'a_fazer', prazo: null }] }
            : { total: 2, eventos: [evento({ id: 1, tipo: 'atribuicao' })] },
        ),
      }),
    ),
    msw.post('/api/tarefas/eventos/ler-todos', () => {
      marcou = true
      return new HttpResponse(null, { status: 204 })
    }),
  )

  // ACT
  renderizar()

  // ASSERT
  await screen.findByText('1 novidade')
  await userEvent.click(screen.getByRole('button', { name: /Tarefas da equipe/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }))
  await waitFor(() => expect(marcou).toBe(true))
  await waitFor(() => expect(screen.queryByText('1 novidade')).not.toBeInTheDocument())
})

it('deve recolher o bloco zerado e sem novidade em "Em dia", ainda com a porta para o mural', async () => {
  // ARRANGE
  servidor.use(
    msw.get('/api/notificacoes', () =>
      HttpResponse.json({ tarefas: blocoDeTarefas({ total: 0 }) }),
    ),
  )

  // ACT
  renderizar()

  // ASSERT — zero não ocupa a tira: o contador some e "Em dia" o guarda, com o destino
  const emDia = await screen.findByRole('button', { name: /Em dia: 1 bloco/ })
  expect(screen.queryByRole('button', { name: /Tarefas da equipe/ })).not.toBeInTheDocument()
  expect(screen.queryByText(/novidade/)).not.toBeInTheDocument()
  await userEvent.click(emDia)
  expect(screen.getByText('Nada pendente em:')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Tarefas da equipe' })).toHaveAttribute('href', '/tarefas')
})

it('deve manter na tira o bloco zerado que tem novidade não lida', async () => {
  // ARRANGE: total 0 mas um evento por ler — a pílula é o sinal, e ela precisa da tira
  servidor.use(
    msw.get('/api/notificacoes', () =>
      HttpResponse.json({ tarefas: blocoDeTarefas({ total: 0, eventos: [evento({ id: 1, tipo: 'atribuicao' })] }) }),
    ),
  )

  // ACT
  renderizar()

  // ASSERT
  expect(await screen.findByRole('button', { name: /Tarefas da equipe/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Em dia/ })).not.toBeInTheDocument()
})


/**
 * PACOTES ACABANDO no centro de notificações (change alerta-de-fim-de-pacote, tarefas 3.5/3.6).
 */

/** Item do bloco como o servidor manda — 100% fictício (LGPD: nunca dado de criança real). */
function pacoteAcabando(sobrescritas: Partial<ItemPacoteAcabando> = {}): ItemPacoteAcabando {
  return {
    tratamento_id: 77,
    paciente: { id: 5, nome: 'Paciente Fictício', nome_social: null },
    convenio: { id: 2, nome: 'Convênio Fictício', particular: false },
    especialidade: { id: 3, nome: 'Fonoaudiologia' },
    sessoes_total: 10,
    sessoes_saldo: 1,
    ...sobrescritas,
  }
}

it('deve contar os pacotes no fim e abrir a fila com quem cobrar', async () => {
  // ARRANGE — dois pacotes no limiar, um deles particular
  servidor.use(
    msw.get('/api/notificacoes', () =>
      HttpResponse.json({
        pacotes_acabando: {
          total: 2,
          itens: [
            pacoteAcabando(),
            pacoteAcabando({
              tratamento_id: 78,
              paciente: { id: 6, nome: 'Outro Fictício', nome_social: 'Fictício Social' },
              convenio: { id: 9, nome: 'Particular', particular: true },
              sessoes_total: 8,
              sessoes_saldo: 2,
            }),
          ],
        },
      }),
    ),
  )

  // ACT
  renderizar(['tratamentos.ver'])
  await userEvent.click(await screen.findByRole('button', { name: /Pacotes acabando/ }))

  // ASSERT — quem, de que pacote, quanto falta. O nome SOCIAL vence o de registro.
  expect(screen.getByText('Paciente Fictício')).toBeInTheDocument()
  expect(screen.getByText('Fictício Social')).toBeInTheDocument()
  expect(screen.getByText(/falta 1 sessão · 9 de 10/)).toBeInTheDocument()
  expect(screen.getByText(/faltam 2 sessões · 6 de 8/)).toBeInTheDocument()
  // a MESMA escada do card: com saldo, âmbar
  expect(screen.getByText(/falta 1 sessão · 9 de 10/)).toHaveClass('text-alerta-texto')
  // convênio particular aparece como "Particular", nunca o nome cru do registro
  expect(screen.getByText(/Fonoaudiologia · Convênio Fictício/)).toBeInTheDocument()
})

it('deve mostrar o pacote ZERADO em vermelho, e dizer "sem saldo"', async () => {
  /*
   * ARRANGE — saldo 0 é `<= 2`, então ele ENTRA no bloco: pacote de 10 com 10 realizadas e
   * status ainda `andamento` é estado terminal normal. O ramo existia sem teste, e uma
   * "simplificação" da frase faria a fila exibir "faltam 0 sessões" com a suíte verde.
   */
  servidor.use(
    msw.get('/api/notificacoes', () =>
      HttpResponse.json({
        pacotes_acabando: {
          total: 1,
          itens: [pacoteAcabando({ sessoes_total: 10, sessoes_saldo: 0 })],
        },
      }),
    ),
  )

  // ACT
  renderizar(['tratamentos.ver'])
  await userEvent.click(await screen.findByRole('button', { name: /Pacotes acabando/ }))

  // ASSERT — nunca "faltam 0 sessões"; e o tom sobe para o que bloqueia
  const linha = screen.getByText(/sem saldo · 10 de 10/)
  expect(linha).toBeInTheDocument()
  expect(linha).toHaveClass('text-perigo-texto')
  expect(screen.queryByText(/faltam 0/)).not.toBeInTheDocument()
})

it('deve levar à lista de tratamentos, que já abre no recorte Acabando', async () => {
  // ARRANGE
  servidor.use(
    msw.get('/api/notificacoes', () =>
      HttpResponse.json({ pacotes_acabando: { total: 1, itens: [pacoteAcabando()] } }),
    ),
  )

  // ACT
  renderizar(['tratamentos.ver'])
  await userEvent.click(await screen.findByRole('button', { name: /Pacotes acabando/ }))

  // ASSERT — D5: tela que já existe, sem rota nova
  expect(screen.getByRole('link', { name: 'Ver tratamentos acabando' })).toHaveAttribute(
    'href',
    '/tratamentos',
  )
})

it('deve contar os pedidos de desmarque e levar à agenda de cada dia, sem nome de criança', async () => {
  // ARRANGE — três sessões em dois dias (change lembrete-com-botoes-de-resposta, 5.1)
  servidor.use(
    msw.get('/api/notificacoes', () =>
      HttpResponse.json({
        pedidos_de_desmarque: {
          total: 3,
          itens: [
            { dia: '2026-09-29', total: 2 },
            { dia: '2026-09-30', total: 1 },
          ],
        },
      }),
    ),
  )

  // ACT
  renderizar(['agenda.ver'])
  const contador = await screen.findByRole('button', { name: /Pediram para desmarcar/ })
  await userEvent.click(contador)

  // ASSERT — o número é de SESSÕES; cada dia é uma porta para a agenda daquele dia
  expect(contador).toHaveTextContent('3')
  const primeiroDia = screen.getByRole('link', { name: /terça-feira, 29 de setembro de 2026/ })
  expect(primeiroDia).toHaveAttribute('href', '/agenda?data=2026-09-29&visao=geral')
  expect(primeiroDia).toHaveTextContent('2 sessões')
  expect(screen.getByRole('link', { name: /quarta-feira, 30 de setembro de 2026/ })).toHaveTextContent('1 sessão')
  // os dois itens cobrem as três sessões: nada de "Mostrando 2 de 3"
  expect(screen.queryByText(/Mostrando/)).not.toBeInTheDocument()
})

it('deve começar o nome acessível de cada contador pelo rótulo que se lê na tela (2.5.3)', async () => {
  // ARRANGE — o bloco novo e um antigo: o nome é montado num lugar só, e o defeito era dos dois
  servidor.use(
    msw.get('/api/notificacoes', () =>
      HttpResponse.json({
        pedidos_de_desmarque: { total: 3, itens: [{ dia: '2026-09-29', total: 3 }] },
        informativos: { total: 2, itens: [] },
      }),
    ),
  )

  // ACT
  renderizar(['agenda.ver'])

  // ASSERT — "clicar em Desmarques", por voz, precisa achar o botão que diz "Desmarques 3"
  expect(await screen.findByRole('button', { name: /Pediram para desmarcar/ })).toHaveAccessibleName(
    'Desmarques 3, Pediram para desmarcar',
  )
  expect(screen.getByRole('button', { name: /Informativos/ })).toHaveAccessibleName('Avisos 2, Informativos')
})

it('não deve mostrar o bloco de pedidos de desmarque quando ele não chega', async () => {
  // ARRANGE — sem `agenda.ver` o servidor OMITE o bloco (ausência não é zero)
  servidor.use(msw.get('/api/notificacoes', () => HttpResponse.json({ pacotes_acabando: { total: 0, itens: [] } })))

  // ACT
  renderizar(['tratamentos.ver'])
  await screen.findByRole('button', { name: /Em dia/ })

  // ASSERT
  expect(screen.queryByRole('button', { name: /Pediram para desmarcar/ })).not.toBeInTheDocument()
})

it('deve guardar o bloco zerado sob "Em dia" sem perder o nome dele', async () => {
  // ARRANGE
  servidor.use(
    msw.get('/api/notificacoes', () =>
      HttpResponse.json({ pacotes_acabando: { total: 0, itens: [] } }),
    ),
  )

  // ACT
  renderizar(['tratamentos.ver'])
  await userEvent.click(await screen.findByRole('button', { name: /Em dia/ }))

  // ASSERT: nomeado, sem contador próprio na tira
  expect(screen.queryByRole('button', { name: /Pacotes acabando/ })).not.toBeInTheDocument()
  expect(screen.getByText('Nada pendente em:')).toBeInTheDocument()
  expect(screen.getByText('Pacotes acabando')).toBeInTheDocument()
})

it('deve realçar no CARD exatamente o que o bloco contou (D4)', () => {
  /*
   * ARRANGE — a divergência que dói: o contador diz "2 pacotes acabando" e a recepcionista
   * abre a agenda e não vê card realçado nenhum.
   *
   * Isto ficou MAIS forte do que era: o veredito do card agora vem do MESMO servidor que conta
   * o bloco, lendo as mesmas colunas e o mesmo limiar de `configuracoes`. O que este teste
   * guarda é o último elo — que a tela vista o veredito que recebeu.
   */
  const doBloco = pacoteAcabando({ sessoes_total: 10, sessoes_saldo: 2 })

  // ACT — o mesmo tratamento, na forma que a agenda recebe
  const comoCard = cardFicticio({
    tratamento_total: doBloco.sessoes_total,
    tratamento_saldo: doBloco.sessoes_saldo,
    tratamento_realce: 'acabando',
  })

  // ASSERT
  expect(derivarDoCard(comoCard).realce).toBe('acabando')
  expect(derivarDoCard(cardFicticio({ tratamento_realce: 'sem-saldo' })).realce).toBe('sem-saldo')
})

it('NÃO deve declarar limiar de pacote nenhum no front', () => {
  /*
   * ARRANGE — o limiar era uma constante do front, depois virou DUAS, e por fim virou uma
   * constante em dois RUNTIMES, guardada por um teste que abria o `.php` e comparava por
   * regex. Aquilo funcionava, e era o sintoma: a regra tinha virado código em vez de dado.
   *
   * Agora ela é `tratamentos.saldo_alerta_sessoes` em `configuracoes`, o servidor decide e
   * manda o veredito pronto. Esta guarda existe para o número não voltar a nascer aqui — a
   * tela que "só precisa saber o limiar" é como ele nasceu das outras vezes.
   */
  const raiz = join(process.cwd(), 'src')
  // captura QUALQUER constante em caixa alta e testa o NOME depois — a primeira versão
  // embutia a palavra-chave no meio do padrão e exigia um caractere antes dela, de modo que
  // `SALDO_DE_ALERTA` não casava: a guarda passava sem olhar nada
  const CONSTANTES = /\bconst ([A-Z][A-Z0-9_]*)\s*=/g
  // domínio do PACOTE, não a palavra "limiar" solta: `LIMIAR_MOUSE_PX` e `LIMIAR_DE_ARRASTO`
  // são limiares de pixel do arrasto e não têm nada com isto.
  // Limitação declarada: casa por NOME. Um `const N = 2` sem nome falante escapa; varrer por
  // valor gritaria em todo `= 2` do produto, e guarda que grita falso é guarda que se desliga.
  const DO_LIMIAR = /SALDO|ACABANDO|PACOTE/
  const declaracoes: string[] = []

  // ACT
  for (const entrada of readdirSync(raiz, { recursive: true, withFileTypes: true })) {
    // teste FORA: este arquivo cita nomes de exemplo no comentário acima, e a guarda pegaria
    // a si mesma. Teste não declara regra de produto.
    if (!entrada.isFile() || !/\.tsx?$/.test(entrada.name) || /\.test\.tsx?$/.test(entrada.name)) {
      continue
    }
    const caminho = join(entrada.parentPath, entrada.name)
    // comentário explica a regra o tempo todo e não declara nada
    const semComentarios = readFileSync(caminho, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    for (const achado of semComentarios.matchAll(CONSTANTES)) {
      if (DO_LIMIAR.test(achado[1])) {
        declaracoes.push(`${relative(raiz, caminho)} — ${achado[1]}`)
      }
    }
  }

  // ASSERT — nenhuma. O número vive em `configuracoes`, no servidor.
  expect(declaracoes).toEqual([])
})
