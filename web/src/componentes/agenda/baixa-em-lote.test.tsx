import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { delay, HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaixaEmLote } from '@/componentes/agenda/baixa-em-lote'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { SELECAO_FICTICIA } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { PreviaDaBaixa, ResultadoDaBaixa } from '@/tipos'

expect.extend(toHaveNoViolations)

const ROTA_DA_PREVIA = '/api/agendamentos/baixa-em-lote/previa'
const ROTA_DA_EXECUCAO = '/api/agendamentos/baixa-em-lote'

/** A agenda está em quinta, 10 de setembro de 2026; hoje é o mesmo dia. */
const DATA_DA_AGENDA = '2026-09-10'

/** A prévia do design: 12 agendamentos, 9 crianças, 11 sessões, 1 sem pacote, 4 de fora. */
const PREVIA_PADRAO: PreviaDaBaixa = {
  status: { id: 3, nome: 'Finalizado', desconta_sessao: true, marca_falta: false },
  contagens: {
    agendamentos: 12,
    criancas: 9,
    sessoes_a_descontar: 11,
    sem_pacote: 1,
    ja_consumidas: 0,
    com_atendimento_registrado: 4,
  },
  recusados: [
    { id: 5811, inicio: '2026-09-10 19:00', motivo: 'ainda_nao_comecou' },
    { id: 5812, inicio: '2026-09-10 19:40', motivo: 'ainda_nao_comecou' },
    { id: 5790, inicio: '2026-09-09 09:00', motivo: 'sem_saldo' },
    { id: 5711, inicio: '2026-09-04 09:00', motivo: 'ciclo_fechado' },
  ],
  avisos: { evolucoes_vencidas: 0 },
  assinatura: 'a'.repeat(64),
  referencia: '2026-09-10 18:59',
}

/** Alvo que NÃO desconta: a API real devolve `avisos: {}` — a fixture espelha o contrato ao vivo. */
const PREVIA_DE_FALTA: PreviaDaBaixa = {
  ...PREVIA_PADRAO,
  status: { id: 4, nome: 'Falta Justificada', desconta_sessao: false, marca_falta: false },
  contagens: { ...PREVIA_PADRAO.contagens, sessoes_a_descontar: 0, sem_pacote: 0 },
  avisos: {},
}

const RESULTADO_PADRAO: ResultadoDaBaixa = {
  lote_id: '0192b7e4-5d1a-7c3e-9f00-3a1c2b4d5e6f',
  aplicados: 12,
  contagens: { criancas: 9, sessoes_descontadas: 11 },
  recusados: PREVIA_PADRAO.recusados,
}

/** A frase com que a API recusa `ate` no futuro (D3 — a baixa registra o que já aconteceu). */
const RECUSA_DO_ATE = 'A baixa só alcança o que já aconteceu: a data final não pode passar de hoje.'

/** O 422 em `ate`: o alcance é recusado e nenhuma prévia chega. */
function recusaDoAteNoFuturo() {
  return msw.post(ROTA_DA_PREVIA, () =>
    HttpResponse.json({ message: 'erro', errors: { ate: [RECUSA_DO_ATE] } }, { status: 422 }),
  )
}

/** O `Skeleton` é `aria-hidden`: quem ouve só sabe da carga pelo `aria-busy` do container. */
const regioesOcupadas = () => document.body.querySelectorAll('[aria-busy="true"]')

/** Responde a prévia conforme o `status_id` pedido — o teste de troca de status depende disso. */
function previaPorStatus(porStatus: Record<number, PreviaDaBaixa> = { 3: PREVIA_PADRAO, 4: PREVIA_DE_FALTA }) {
  return msw.post(ROTA_DA_PREVIA, async ({ request }) => {
    const corpo = (await request.json()) as { status_id: number }
    const previa = porStatus[corpo.status_id]

    return previa === undefined ? new HttpResponse(null, { status: 422 }) : HttpResponse.json(previa)
  })
}

interface OpcoesDeRender {
  permissoes?: string[]
  status?: typeof SELECAO_FICTICIA.status
  aoLocalizarAgendamento?: (id: number, data: string) => void
  aoFechar?: () => void
}

/** A árvore inteira — separada do `render` para o teste de re-render do pai poder repeti-la. */
function arvore({
  status = SELECAO_FICTICIA.status,
  aoLocalizarAgendamento = vi.fn(),
  aoFechar = vi.fn(),
}: Omit<OpcoesDeRender, 'permissoes'> = {}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter>
          <BaixaEmLote
            aberto
            aoFechar={aoFechar}
            profissionalId={7}
            nomeDoProfissional="Ana Fictícia"
            dataDaAgenda={DATA_DA_AGENDA}
            hoje={DATA_DA_AGENDA}
            status={status}
            aoLocalizarAgendamento={aoLocalizarAgendamento}
          />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>
  )
}

function renderizar({ permissoes = ['agenda.editar'], ...opcoes }: OpcoesDeRender = {}) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(arvore(opcoes))
}

const botaoDeAplicar = () => screen.findByRole('button', { name: /^Aplicar “/ }, { timeout: 2000 })

beforeEach(() => {
  queryClient.clear()
})

describe('BaixaEmLote — o diálogo abre com o primeiro status marcado e a prévia do dia', () => {
  it('deve carregar a prévia sozinho ao abrir, com "Finalizado" marcado e "Dia à vista" escolhido', async () => {
    // ARRANGE — "Finalizado" (ordem 3) é o primeiro aplicável em lote; "Falta Justificada" (4) o segundo
    servidor.use(previaPorStatus())

    // ACT — nenhum clique
    renderizar()

    // ASSERT — o rádio nativo marcado, a consequência derivada da flag, o alcance do dia e o número
    expect(screen.getByRole('radio', { name: 'Finalizado' })).toBeChecked()
    expect(screen.getByText('Desconta uma sessão do pacote de cada criança.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dia à vista', pressed: true })).toBeInTheDocument()
    expect(screen.getByText('quinta, 10 de setembro')).toBeInTheDocument()
    expect(await botaoDeAplicar()).toHaveTextContent('Aplicar “Finalizado” em 12')
  })

  it('deve mostrar agendamentos, crianças, sessões e as frases de consequência com concordância explícita', async () => {
    // ARRANGE
    servidor.use(previaPorStatus())

    // ACT
    renderizar()

    // ASSERT — nunca "(s)"
    expect(await screen.findByText('12 agendamentos · 9 crianças')).toBeInTheDocument()
    expect(screen.getByText('11 sessões serão descontadas dos pacotes.')).toBeInTheDocument()
    expect(screen.getByText('1 sem pacote — só muda o status.')).toBeInTheDocument()
    expect(screen.getByText('4 já têm atendimento registrado.')).toBeInTheDocument()
    // sem "de 9 pacotes": `criancas` conta também quem está sem pacote, e a prévia não devolve
    // pacotes distintos — "2 sessões de 3 pacotes" era número que não existe (achado do gate)
    expect(
      screen.getByText('Isso desconta 11 sessões do saldo dos pacotes. Desfazer depois é criança por criança, pelo card.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/de 9 pacotes/)).not.toBeInTheDocument()
  })

  it('deve trocar a consequência e recarregar a prévia ao marcar outro status', async () => {
    // ARRANGE
    servidor.use(previaPorStatus())
    renderizar()
    await botaoDeAplicar()

    // ACT — marca "Falta Justificada"
    await userEvent.click(screen.getByRole('radio', { name: 'Falta Justificada' }))

    // ASSERT — a prévia anterior cai NA HORA; a nova chega para o status novo
    expect(screen.queryByRole('button', { name: /^Aplicar “/ })).not.toBeInTheDocument()
    expect(screen.getByText('Só muda o status.')).toBeInTheDocument()
    expect(await botaoDeAplicar()).toHaveTextContent('Aplicar “Falta Justificada” em 12')
    expect(screen.getByText('Nenhuma sessão será descontada.')).toBeInTheDocument()
    expect(screen.queryByText(/Isso desconta/)).not.toBeInTheDocument()
  })

  it('deve contar os últimos 7 dias para trás a partir da data da agenda, e dizer que não é a semana civil', async () => {
    // ARRANGE
    servidor.use(previaPorStatus())
    renderizar()
    await botaoDeAplicar()

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Últimos 7 dias' }))

    // ASSERT — 04/09 a 10/09
    expect(
      screen.getByText(
        'de 04/09 a 10/09, contando para trás a partir da data da agenda — não é a semana de segunda a domingo.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Aplicar “/ })).not.toBeInTheDocument()
  })

  it('deve abrir no estado vazio quando nenhum status é aplicável, com o atalho só para quem edita status', async () => {
    // ARRANGE — nenhum status marcado; o botão da barra não some, o diálogo diz o caminho
    const semAplicaveis = SELECAO_FICTICIA.status.map((item) => ({ ...item, aplicavel_em_lote: false }))

    // ACT
    renderizar({ status: semAplicaveis, permissoes: ['agenda.editar', 'status_agendamento.editar'] })

    // ASSERT — o texto, o atalho, e só "Cancelar" no rodapé
    expect(screen.getByText(/Nenhum status está marcado como aplicável em lote/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir status de agendamento' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Atualizar os números' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Aplicar “/ })).not.toBeInTheDocument()
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('não deve oferecer o atalho do estado vazio sem status_agendamento.editar', () => {
    // ARRANGE / ACT
    const semAplicaveis = SELECAO_FICTICIA.status.map((item) => ({ ...item, aplicavel_em_lote: false }))
    renderizar({ status: semAplicaveis, permissoes: ['agenda.editar'] })

    // ASSERT
    expect(screen.queryByRole('link', { name: 'Abrir status de agendamento' })).not.toBeInTheDocument()
  })
})

describe('BaixaEmLote — a prévia É a confirmação', () => {
  it('deve agrupar os recusados por motivo traduzido, cada um com data, hora e "Ver na agenda"', async () => {
    // ARRANGE
    servidor.use(previaPorStatus())

    // ACT
    renderizar()
    await botaoDeAplicar()

    // ASSERT — a chave de máquina não chega à tela; nome de criança tampouco
    expect(screen.getByText('Ficam de fora:')).toBeInTheDocument()
    expect(screen.getByText('Ainda não começou (2)')).toBeInTheDocument()
    expect(screen.getByText('Sem saldo no pacote (1)')).toBeInTheDocument()
    expect(screen.getByText('Produção do período já fechada (1)')).toBeInTheDocument()
    expect(screen.queryByText(/ciclo_fechado|sem_saldo/)).not.toBeInTheDocument()
    expect(screen.getByText('qui 10/09 · 19:00')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Ver o agendamento de sex 04/09 às 09:00 na agenda' }),
    ).toBeInTheDocument()
  })

  it('deve chamar aoLocalizarAgendamento com o id e a data ao acionar "Ver na agenda"', async () => {
    // ARRANGE
    servidor.use(previaPorStatus())
    const aoLocalizarAgendamento = vi.fn()
    renderizar({ aoLocalizarAgendamento })
    await botaoDeAplicar()

    // ACT — o recusado de 04/09, enquanto a agenda mostra 10/09
    await userEvent.click(screen.getByRole('button', { name: 'Ver o agendamento de sex 04/09 às 09:00 na agenda' }))

    // ASSERT
    expect(aoLocalizarAgendamento).toHaveBeenCalledWith(5711, '2026-09-04')
  })

  it('não deve oferecer o botão de aplicar quando a prévia conta zero', async () => {
    // ARRANGE
    servidor.use(
      msw.post(ROTA_DA_PREVIA, () =>
        HttpResponse.json({
          ...PREVIA_PADRAO,
          contagens: { ...PREVIA_PADRAO.contagens, agendamentos: 0, criancas: 0, sessoes_a_descontar: 0, sem_pacote: 0, com_atendimento_registrado: 0 },
          recusados: [],
        }),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — no painel E na região viva (o leitor de tela ouve a mesma frase)
    expect(await screen.findAllByText(/Nada em aberto nesse alcance/)).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Aplicar “/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Atualizar os números' })).toBeInTheDocument()
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('não deve dizer "já está com baixa" quando zero elegíveis convive com recusados em aberto', async () => {
    // ARRANGE — manhã do dia à vista: todos os em aberto ainda não começaram, ou estão sem saldo
    servidor.use(
      msw.post(ROTA_DA_PREVIA, () =>
        HttpResponse.json({
          ...PREVIA_PADRAO,
          contagens: { ...PREVIA_PADRAO.contagens, agendamentos: 0, criancas: 0, sessoes_a_descontar: 0, sem_pacote: 0, com_atendimento_registrado: 0 },
          recusados: [
            { id: 5811, inicio: '2026-09-10 19:00', motivo: 'ainda_nao_comecou' },
            { id: 5790, inicio: '2026-09-10 09:00', motivo: 'sem_saldo' },
          ],
        }),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — a caixa nomeia os 2 em aberto e aponta para "Ficam de fora"; a região viva diz o número
    expect(
      await screen.findByText(
        'Nenhum dos 2 agendamentos em aberto nesse alcance pode receber a baixa agora — veja os motivos em “Ficam de fora”.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/já está com baixa/)).not.toBeInTheDocument()
    expect(screen.getByText('Ficam de fora:')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Prévia: nenhum agendamento pode receber a baixa agora, 2 ficam de fora',
    )
    expect(screen.queryByRole('button', { name: /^Aplicar “/ })).not.toBeInTheDocument()
  })

  it('deve rolar a caixa da prévia à vista UMA vez por prévia, não a cada render do pai', async () => {
    // ARRANGE — a agenda re-renderiza sozinha a cada minuto; a rolagem não pode acompanhar
    const rolagem = vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView')
    servidor.use(previaPorStatus())
    const { rerender } = renderizar()
    await botaoDeAplicar()
    const chamadasAoCarregar = rolagem.mock.calls.length

    // ACT — o pai re-renderiza sem nenhuma mudança na prévia
    rerender(arvore())
    rerender(arvore())

    // ASSERT
    expect(chamadasAoCarregar).toBe(1)
    expect(rolagem).toHaveBeenCalledTimes(1)
    rolagem.mockRestore()
  })

  it('deve rolar DE NOVO quando a prévia nova chega pelo 409 previa_desatualizada', async () => {
    // ARRANGE — a prévia nova substitui a lida SEM passar pelo skeleton; o que mudou precisa
    // estar à vista tanto quanto o primeiro número (a rolagem é por prévia, não por "tem prévia").
    // QUAL elemento é o alvo, com o aviso do 409 na tela, é o teste da recusa que ouve
    const rolagem = vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView')
    servidor.use(
      previaPorStatus(),
      msw.post(ROTA_DA_EXECUCAO, () =>
        HttpResponse.json(
          {
            erro: 'previa_desatualizada',
            message: 'A agenda mudou desde que você conferiu os números. Confira e confirme de novo.',
            previa: { ...PREVIA_PADRAO, contagens: { ...PREVIA_PADRAO.contagens, agendamentos: 11 }, assinatura: 'b'.repeat(64) },
          },
          { status: 409 },
        ),
      ),
    )
    renderizar()
    const aplicar = await botaoDeAplicar()
    expect(rolagem).toHaveBeenCalledTimes(1)

    // ACT — a execução volta 409 com a prévia nova (agora são 11)
    await userEvent.click(aplicar)
    await screen.findByRole('button', { name: 'Aplicar “Finalizado” em 11' })

    // ASSERT — outra prévia, outra rolagem
    expect(rolagem).toHaveBeenCalledTimes(2)
    rolagem.mockRestore()
  })

  it('não deve dobrar a recusa num toast quando ela já pousou no campo e no aviso geral', async () => {
    // ARRANGE — 422 em `ate`: campo "Até" + aviso geral já mostram a frase dentro do diálogo
    servidor.use(
      msw.post(ROTA_DA_PREVIA, () =>
        HttpResponse.json(
          { message: 'erro', errors: { ate: ['A operação alcançaria 172 agendamentos em aberto e o máximo por baixa é 100. Estreite as datas.'] } },
          { status: 422 },
        ),
      ),
    )
    renderizar()
    await screen.findAllByText(/Estreite as datas/)

    // ACT — em "Escolher datas" o campo existe; a prévia recarrega e recusa de novo
    await userEvent.click(screen.getByRole('button', { name: 'Escolher datas' }))

    // ASSERT — na TELA INTEIRA (o toast do hook sairia fora do diálogo): aviso geral + campo, nada mais
    await waitFor(
      () => {
        expect(screen.getAllByText(/Estreite as datas/)).toHaveLength(2)
      },
      { timeout: 2000 },
    )
    expect(screen.getAllByText(/Estreite as datas/).every((elemento) => elemento.closest('[role="dialog"]') !== null)).toBe(true)
  })

  it('deve subir ao aviso geral a recusa de "De" quando o campo não está na tela', async () => {
    // ARRANGE — sem toast como rede, uma chave sem widget não pode sumir: "De" só existe em "Escolher datas"
    servidor.use(
      msw.post(ROTA_DA_PREVIA, () =>
        HttpResponse.json({ message: 'erro', errors: { de: ['A data inicial é inválida.'] } }, { status: 422 }),
      ),
    )

    // ACT — "Dia à vista" (o padrão) não tem o campo "De"
    renderizar()

    // ASSERT
    expect(await screen.findByRole('alert')).toHaveTextContent('A data inicial é inválida.')
  })

  it('deve informar as evoluções vencidas sem esconder o botão', async () => {
    // ARRANGE — a trava mora no registro de atendimento, não aqui (D8)
    servidor.use(
      msw.post(ROTA_DA_PREVIA, () => HttpResponse.json({ ...PREVIA_PADRAO, avisos: { evolucoes_vencidas: 3 } })),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Ana Fictícia tem 3 evoluções vencidas. A baixa não mexe nisso.')).toBeInTheDocument()
    expect(await botaoDeAplicar()).toBeInTheDocument()
  })

  it('não deve mostrar aviso de evoluções quando o alvo não desconta e `avisos` vem vazio', async () => {
    // ARRANGE — contrato real: a chave `evolucoes_vencidas` é OMITIDA para alvo não-descontante
    servidor.use(previaPorStatus({ 3: PREVIA_DE_FALTA }))

    // ACT
    renderizar()

    // ASSERT — a prévia carrega inteira e nenhuma frase de evolução aparece
    expect(await screen.findByText('Nenhuma sessão será descontada.')).toBeInTheDocument()
    expect(screen.queryByText(/evoluç(ão|ões) vencida/)).not.toBeInTheDocument()
    expect(await botaoDeAplicar()).toBeInTheDocument()
  })

  it('deve anunciar a prévia por uma região viva que já existe antes da mensagem', async () => {
    // ARRANGE — criar a região junto com o conteúdo é o anti-padrão que falha em leitores de tela
    servidor.use(previaPorStatus())

    // ACT
    renderizar()

    // ASSERT — a região existe VAZIA na montagem, depois anuncia os marcos
    expect(screen.getByRole('status')).toHaveTextContent('')
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Prévia: 12 agendamentos, 9 crianças, 11 sessões serão descontadas, 4 ficam de fora',
      )
    })
  })

  it('deve manter as ações no rodapé fixo, fora do corpo rolável', async () => {
    // ARRANGE
    servidor.use(previaPorStatus())
    renderizar()

    // ACT
    const aplicar = await botaoDeAplicar()

    // ASSERT — o rodapé do Dialog é <footer>
    expect(aplicar.closest('footer')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Atualizar os números' }).closest('footer')).not.toBeNull()
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('deve pousar a recusa do teto no campo "Até" E no aviso geral, sem oferecer o botão', async () => {
    // ARRANGE — 422 em `ate` com o alcance e o teto
    servidor.use(
      msw.post(ROTA_DA_PREVIA, () =>
        HttpResponse.json(
          {
            message: 'erro',
            errors: { ate: ['A operação alcançaria 172 agendamentos em aberto e o máximo por baixa é 100. Estreite as datas.'] },
          },
          { status: 422 },
        ),
      ),
    )
    renderizar()
    await screen.findAllByText(/Estreite as datas/)

    // ACT — em "Escolher datas" o campo "Até" existe e recebe a mesma mensagem (a prévia recarrega)
    await userEvent.click(screen.getByRole('button', { name: 'Escolher datas' }))
    expect(screen.getByRole('textbox', { name: 'Até' })).toBeInTheDocument()

    // ASSERT — DENTRO do diálogo (o toast do hook de erros fica fora): aviso geral + campo
    const dialogo = screen.getByRole('dialog')
    await waitFor(
      () => {
        expect(within(dialogo).getAllByText(/Estreite as datas/)).toHaveLength(2)
      },
      { timeout: 2000 },
    )
    expect(screen.queryByRole('button', { name: /^Aplicar “/ })).not.toBeInTheDocument()
  })

  it('deve mostrar a recusa do status sob "Marcar como", nunca engolida', async () => {
    // ARRANGE — no desmarque, a chave `status_id` sem widget SUMIA; aqui o widget existe
    servidor.use(
      msw.post(ROTA_DA_PREVIA, () =>
        HttpResponse.json(
          {
            message: 'erro',
            errors: { status_id: ['Este status não está marcado como aplicável em lote. Marque em Cadastros › Status de agendamento.'] },
          },
          { status: 422 },
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — dentro do fieldset "Marcar como"
    const grupo = await screen.findByRole('group', { name: 'Marcar como' })
    expect(await within(grupo).findByText(/não está marcado como aplicável em lote/)).toBeInTheDocument()
  })

  it('deve dizer "Fora do seu escopo de profissional." no 403', async () => {
    // ARRANGE — colega e inexistente respondem igual; a tela é dona do texto
    servidor.use(msw.post(ROTA_DA_PREVIA, () => HttpResponse.json({ message: 'Fora do seu escopo de profissional.' }, { status: 403 })))

    // ACT
    renderizar()

    // ASSERT — no aviso geral (role=alert), não só no toast
    expect(await screen.findByRole('alert')).toHaveTextContent('Fora do seu escopo de profissional.')
  })
})

describe('BaixaEmLote — a recusa também chega a quem ouve', () => {
  it('deve marcar o campo "Até" como inválido e apontá-lo para a mensagem quando o servidor recusa a data', async () => {
    // ARRANGE — sem isto a frase existia na tela e o campo seguia são para o leitor de tela (3.3.1)
    servidor.use(recusaDoAteNoFuturo())
    renderizar()
    await screen.findAllByText(RECUSA_DO_ATE)

    // ACT — só em "Escolher datas" o campo existe; a prévia recarrega e recusa de novo
    await userEvent.click(screen.getByRole('button', { name: 'Escolher datas' }))

    // ASSERT — a pele de erro e a descrição apontando para o `role="alert"` do campo
    const campo = screen.getByRole('textbox', { name: 'Até' })
    await waitFor(
      () => {
        expect(campo).toHaveAttribute('aria-invalid', 'true')
      },
      { timeout: 2000 },
    )
    const idDaMensagem = campo.getAttribute('aria-describedby')
    const mensagem = idDaMensagem === null ? null : document.getElementById(idDaMensagem)
    expect(mensagem).toHaveTextContent(RECUSA_DO_ATE)
    expect(mensagem).toHaveAttribute('role', 'alert')
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('não deve marcar como recusado o campo que o servidor aceitou', async () => {
    // ARRANGE — prévia que responde 200: nenhuma recusa na tela
    servidor.use(previaPorStatus())
    renderizar()
    await botaoDeAplicar()

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Escolher datas' }))

    // ASSERT — nem "De" nem "Até" carregam a pele de erro ou uma descrição
    for (const rotulo of ['De', 'Até']) {
      const campo = screen.getByRole('textbox', { name: rotulo })
      expect(campo).not.toHaveAttribute('aria-invalid')
      expect(campo).not.toHaveAttribute('aria-describedby')
    }
  })

  it('não deve deixar a caixa da prévia ocupada para sempre quando o alcance é recusado', async () => {
    // ARRANGE — 422: a prévia não vem. A caixa seguia com `aria-busy`, e a região nunca terminava
    // de carregar para quem ouve — a mensagem acima resolvia só para quem enxerga (4.1.3)
    servidor.use(recusaDoAteNoFuturo())

    // ACT
    renderizar()
    await screen.findAllByText(RECUSA_DO_ATE)

    // ASSERT — nenhuma região ocupada na tela inteira, e a recusa segue dita e com caminho de volta
    await waitFor(() => {
      expect(regioesOcupadas()).toHaveLength(0)
    })
    expect(screen.getByRole('button', { name: 'Atualizar os números' })).toBeInTheDocument()
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('deve anunciar a caixa como ocupada enquanto a prévia está em voo', async () => {
    // ARRANGE — o outro lado da mesma regra: carregando de verdade, a região diz que está ocupada
    servidor.use(
      msw.post(ROTA_DA_PREVIA, async () => {
        await delay(80)

        return HttpResponse.json(PREVIA_PADRAO)
      }),
    )

    // ACT
    renderizar()

    // ASSERT — ocupada durante o voo, livre quando os números pousam
    await waitFor(() => {
      expect(regioesOcupadas()).toHaveLength(1)
    })
    expect(await botaoDeAplicar()).toBeInTheDocument()
    expect(regioesOcupadas()).toHaveLength(0)
  })

  it('deve rolar até o AVISO do 409, nunca até a caixa que fica abaixo dele', async () => {
    // ARRANGE — a 390 a rolagem da caixa empurrava "A agenda mudou…" para fora da vista (medido
    // em 0 px visíveis): quem enxerga via o número mudar sem ler o porquê
    const rolagem = vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView')
    servidor.use(
      previaPorStatus(),
      msw.post(ROTA_DA_EXECUCAO, () =>
        HttpResponse.json(
          {
            erro: 'previa_desatualizada',
            message: 'A agenda mudou desde que você conferiu os números. Confira e confirme de novo.',
            previa: { ...PREVIA_PADRAO, contagens: { ...PREVIA_PADRAO.contagens, agendamentos: 11 }, assinatura: 'b'.repeat(64) },
          },
          { status: 409 },
        ),
      ),
    )
    renderizar()
    const aplicar = await botaoDeAplicar()

    // ACT
    await userEvent.click(aplicar)
    const aviso = await screen.findByText(
      'A agenda mudou desde que você conferiu: agora são 11. Confira e confirme de novo.',
    )

    // ASSERT — a segunda rolagem tem o aviso como alvo
    await waitFor(() => {
      expect(rolagem).toHaveBeenCalledTimes(2)
    })
    expect(rolagem.mock.contexts.at(-1)).toBe(aviso)
    rolagem.mockRestore()
  })
})

describe('BaixaEmLote — "Atualizar os números" responde mesmo quando os números não mudam', () => {
  it('deve carimbar, na caixa e para quem ouve, a hora da parede da clínica em que os números foram conferidos', async () => {
    // ARRANGE — a hora vem da `referencia` do SERVIDOR ('2026-09-10 18:59'), que a API calcula
    // com `now(clinica.timezone)`. Por isso o teste pode afirmar 18:59 seja qual for o relógio
    // desta máquina: o carimbo é a parede da clínica (§13), nunca o relógio do navegador
    servidor.use(previaPorStatus())

    // ACT
    renderizar()
    await botaoDeAplicar()

    // ASSERT — a mesma frase nos dois canais, e é a hora do payload
    expect(screen.getByText('Números conferidos às 18:59.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Números conferidos às 18:59.')
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('deve produzir mudança na tela e anúncio novo quando a reconferência devolve números idênticos', async () => {
    // ARRANGE — o caso do dono do produto ao vivo: a prévia responde em ~30 ms e com os MESMOS
    // números, então a tela ficava idêntica e "aperto em atualizar não faz nada"
    let pedidos = 0
    servidor.use(
      msw.post(ROTA_DA_PREVIA, () => {
        pedidos += 1

        return HttpResponse.json(PREVIA_PADRAO)
      }),
    )
    const numerosNaCaixa = '12 agendamentos · 9 crianças'
    renderizar()
    await botaoDeAplicar()
    expect(screen.getByText(numerosNaCaixa)).toBeInTheDocument()

    // ACT — o clique do relato
    const comecou = Date.now()
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar os números' }))

    // ASSERT — a caixa troca pelo skeleton e a região viva ESVAZIA: é a mudança que o clique produz
    expect(screen.queryByText(numerosNaCaixa)).not.toBeInTheDocument()
    expect(screen.queryByText('Números conferidos às 18:59.')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('')
    expect(regioesOcupadas().length).toBeGreaterThan(0)

    // ... e os números só voltam depois de tempo bastante para a batida ser vista — e OUVIDA: a
    // região ficou VAZIA todo esse tempo, então a mesma frase voltando é conteúdo novo para o
    // leitor de tela, não uma mutação coalescida em 30 ms (o defeito se repetindo no áudio)
    await waitFor(() => {
      expect(screen.getByText(numerosNaCaixa)).toBeInTheDocument()
    })
    expect(Date.now() - comecou).toBeGreaterThanOrEqual(400)
    // o carimbo tem teste só dele (acima): aqui a regra provada é a BATIDA, não a hora
    expect(screen.getByRole('status')).toHaveTextContent(
      'Prévia: 12 agendamentos, 9 crianças, 11 sessões serão descontadas, 4 ficam de fora',
    )
    // duas prévias de verdade, e a segunda com o payload idêntico ao da primeira
    expect(pedidos).toBe(2)
  })
})

describe('BaixaEmLote — o resultado é mostrado, não só confirmado', () => {
  it('deve trocar o corpo pelo resultado, levar o foco ao título e anunciar', async () => {
    // ARRANGE
    servidor.use(previaPorStatus(), msw.post(ROTA_DA_EXECUCAO, () => HttpResponse.json(RESULTADO_PADRAO)))
    renderizar()

    // ACT — sem nenhuma segunda confirmação
    await userEvent.click(await botaoDeAplicar())

    // ASSERT
    const titulo = await screen.findByRole('heading', { level: 3 })
    expect(titulo).toHaveTextContent('12 agendamentos marcados como “Finalizado”.')
    await waitFor(() => {
      expect(titulo).toHaveFocus()
    })
    expect(screen.getByText('11 sessões descontadas · 9 crianças.')).toBeInTheDocument()
    expect(screen.getByText('Baixa aplicada na agenda de Ana Fictícia')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Baixa aplicada: 12 agendamentos')
    expect(screen.getByText('Ficaram de fora:')).toBeInTheDocument()
    // o botão ÚNICO do rodapé (o X do cabeçalho do Dialog também se chama "Fechar")
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Fechar' }).filter((botao) => botao.closest('footer') !== null),
    ).toHaveLength(1)
    expect(screen.queryByText(/Nada muda antes de você ver os números/)).not.toBeInTheDocument()
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('não deve puxar o foco de volta ao título quando o pai re-renderiza sem gesto (2.4.3)', async () => {
    // ARRANGE — resultado pousado, foco levado pela pessoa até "Fechar"
    servidor.use(previaPorStatus(), msw.post(ROTA_DA_EXECUCAO, () => HttpResponse.json(RESULTADO_PADRAO)))
    const { rerender } = renderizar()
    await userEvent.click(await botaoDeAplicar())
    const titulo = await screen.findByRole('heading', { level: 3 })
    await waitFor(() => {
      expect(titulo).toHaveFocus()
    })
    const fechar = screen.getAllByRole('button', { name: 'Fechar' }).find((botao) => botao.closest('footer') !== null)
    fechar?.focus()
    expect(fechar).toHaveFocus()

    // ACT — o relógio da agenda (1×/min) e o resize re-renderizam o pai sem nenhuma ação
    rerender(arvore())
    rerender(arvore())

    // ASSERT — o foco fica onde a pessoa o deixou
    expect(fechar).toHaveFocus()
    expect(titulo).not.toHaveFocus()
  })

  it('deve dizer quantos ficaram de fora por uma recusa que a prévia não antecipou', async () => {
    // ARRANGE — a prévia contou 12; o domínio recusou 1 na execução (faturado no estorno)
    servidor.use(
      previaPorStatus(),
      msw.post(ROTA_DA_EXECUCAO, () =>
        HttpResponse.json({
          ...RESULTADO_PADRAO,
          aplicados: 11,
          contagens: { criancas: 8, sessoes_descontadas: 10 },
          recusados: [
            ...PREVIA_PADRAO.recusados,
            {
              id: 5744,
              inicio: '2026-09-08 10:00',
              motivo: 'Agendamento faturado não pode ter a sessão estornada — exclua ou estorne o lançamento primeiro.',
            },
          ],
        }),
      ),
    )
    renderizar()

    // ACT
    await userEvent.click(await botaoDeAplicar())

    // ASSERT — a frase de diferença e a frase crua do domínio como título do grupo
    expect(
      await screen.findByText('1 ficou de fora por uma recusa que a prévia não antecipou — veja o motivo abaixo.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Agendamento faturado não pode ter a sessão estornada.*\(1\)/)).toBeInTheDocument()
  })

  it('deve invalidar a agenda UMA vez e não anunciar sucesso por toast', async () => {
    // ARRANGE
    servidor.use(previaPorStatus(), msw.post(ROTA_DA_EXECUCAO, () => HttpResponse.json(RESULTADO_PADRAO)))
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries')
    renderizar()

    // ACT
    await userEvent.click(await botaoDeAplicar())
    await screen.findByRole('heading', { level: 3 })

    // ASSERT
    const chamadasDaAgenda = invalidar.mock.calls.filter(
      ([opcoes]) => JSON.stringify(opcoes?.queryKey) === JSON.stringify(['agenda']),
    )
    expect(chamadasDaAgenda).toHaveLength(1)
    expect(screen.queryByText(/sucesso/i)).not.toBeInTheDocument()
    invalidar.mockRestore()
  })

  it('deve recarregar a prévia nova e avisar quando a agenda mudou (409 previa_desatualizada)', async () => {
    // ARRANGE — nada gravado; o corpo volta com a prévia nova (agora são 11)
    servidor.use(
      previaPorStatus(),
      msw.post(ROTA_DA_EXECUCAO, () =>
        HttpResponse.json(
          {
            erro: 'previa_desatualizada',
            message: 'A agenda mudou desde que você conferiu os números. Confira e confirme de novo.',
            previa: { ...PREVIA_PADRAO, contagens: { ...PREVIA_PADRAO.contagens, agendamentos: 11 }, assinatura: 'b'.repeat(64) },
          },
          { status: 409 },
        ),
      ),
    )
    renderizar()

    // ACT
    await userEvent.click(await botaoDeAplicar())

    // ASSERT — o aviso, o número novo no botão, a região viva; e NÃO é o conflito genérico
    expect(
      await screen.findByText('A agenda mudou desde que você conferiu: agora são 11. Confira e confirme de novo.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar “Finalizado” em 11' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/agora são 11/)
    expect(screen.queryByText(/alterado por outra pessoa/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: /marcados como/ })).not.toBeInTheDocument()
  })

  it('deve traduzir a corrida com o fechamento do ciclo (409 ciclo_em_alteracao)', async () => {
    // ARRANGE
    servidor.use(
      previaPorStatus(),
      msw.post(ROTA_DA_EXECUCAO, () =>
        HttpResponse.json({ erro: 'ciclo_em_alteracao', message: 'x' }, { status: 409 }),
      ),
    )
    renderizar()

    // ACT
    await userEvent.click(await botaoDeAplicar())

    // ASSERT
    expect(
      (await screen.findAllByText('A produção deste período está sendo fechada agora — tente de novo em instantes.')).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('deve enviar a assinatura e a referência da prévia lida', async () => {
    // ARRANGE — D5: o número que ela leu é o número que roda
    let corpoEnviado: Record<string, unknown> | null = null
    servidor.use(
      previaPorStatus(),
      msw.post(ROTA_DA_EXECUCAO, async ({ request }) => {
        corpoEnviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(RESULTADO_PADRAO)
      }),
    )
    renderizar()

    // ACT
    await userEvent.click(await botaoDeAplicar())
    await screen.findByRole('heading', { level: 3 })

    // ASSERT
    expect(corpoEnviado).toEqual({
      profissional_id: 7,
      status_id: 3,
      de: DATA_DA_AGENDA,
      ate: DATA_DA_AGENDA,
      assinatura: 'a'.repeat(64),
      referencia: '2026-09-10 18:59',
    })
  })
})
