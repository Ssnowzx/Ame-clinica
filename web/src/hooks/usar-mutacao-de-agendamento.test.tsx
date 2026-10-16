import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { ProvedorToast } from '@/componentes/ui/toast'
import { usarMutacaoDeAgendamento } from '@/hooks/usar-mutacao-de-agendamento'
import { queryClient } from '@/lib/query-client'
import { DIA_FICTICIO } from '@/test/dados-agenda'
import { servidor } from '@/test/servidor-msw'

/** Harness mínimo: um botão que cria, expondo o aviso de erro e o travamento. */
function Harness() {
  const { criar, erros, gravando } = usarMutacaoDeAgendamento()

  return (
    <>
      <AvisoErro mensagens={erros.gerais} />
      {erros.porCampo.profissional_id !== undefined ? (
        <p data-erro-profissional>{erros.porCampo.profissional_id}</p>
      ) : null}
      <Botao
        carregando={gravando}
        onClick={() => {
          criar.mutate({ inicio: `${DIA_FICTICIO} 08:00`, profissional_id: 1, paciente_id: 10 })
        }}
      >
        Marcar
      </Botao>
    </>
  )
}

function renderizarHarness() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <Harness />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('usarMutacaoDeAgendamento — escrita nunca é repetida sozinha (T-aes-01)', () => {
  it('deve não reexecutar o POST quando o servidor falha', async () => {
    // ARRANGE: um POST reexecutado é um agendamento DUPLICADO na agenda de uma
    // criança — repetir por conta própria é criar sessão fantasma
    const usuario = userEvent.setup()
    let tentativas = 0
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos', () => {
        tentativas++
        return new HttpResponse(null, { status: 500 })
      }),
    )
    renderizarHarness()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Marcar' }))
    await screen.findAllByRole('alert') // o aviso do formulário e o toast

    // ASSERT: exatamente UMA execução
    expect(tentativas).toBe(1)
  })

  it('deve executar uma única vez com dois cliques seguidos (T-aes-02)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let tentativas = 0
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos', async () => {
        tentativas++
        await new Promise((resolver) => setTimeout(resolver, 50))
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
      msw.get('/api/agenda', () => HttpResponse.json([])),
    )
    renderizarHarness()

    // ACT: dois cliques na sequência
    const botao = screen.getByRole('button', { name: 'Marcar' })
    await usuario.click(botao)
    await usuario.click(botao)

    // ASSERT: o botão trava enquanto grava
    await waitFor(() => {
      expect(tentativas).toBe(1)
    })
  })
})

describe('usarMutacaoDeAgendamento — nenhuma escrita falha em silêncio', () => {
  it('deve levar a recusa ao campo e avisar por toast', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos', () =>
        HttpResponse.json(
          { errors: { profissional_id: ['Horário ocupado do profissional.'] } },
          { status: 422 },
        ),
      ),
    )
    renderizarHarness()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Marcar' }))

    // ASSERT: a mensagem chega no campo que a causou
    await waitFor(() => {
      expect(document.querySelector('[data-erro-profissional]')).toHaveTextContent(
        'Horário ocupado do profissional.',
      )
    })
  })

  it('deve avisar por toast quando a recusa não é de campo', async () => {
    // ARRANGE: fluxos sem formulário (exclusão, chip) só têm o toast
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos', () =>
        HttpResponse.json(
          { errors: { recorrencia: ['Conflito de horário nas datas: 2026-07-18.'] } },
          { status: 422 },
        ),
      ),
    )
    renderizarHarness()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Marcar' }))

    // ASSERT: aparece no aviso do formulário E no toast — o fluxo sem
    // formulário (exclusão, chip) só tem o toast, e ele nunca pode faltar.
    //
    // Conta por TEXTO, não por `role="alert"`: o toast deixou de carregar `role` no `<li>`
    // (achado A11Y-RCD-10 — ele quebrava a semântica do `<ol>` do viewport, e o anúncio do
    // Radix sempre saiu por um `ToastAnnounce` separado, governado pelo `type`). O que este
    // teste protege é que a recusa CHEGA nos dois lugares, e isso continua verificável.
    const ocorrencias = await screen.findAllByText(/2026-07-18/)
    expect(ocorrencias).toHaveLength(2)
    expect(await screen.findByRole('alert')).toHaveTextContent('2026-07-18')
  })

  it('deve confirmar o sucesso e invalidar a agenda', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos', () => HttpResponse.json({ id: 1 }, { status: 201 })),
      msw.get('/api/agenda', () => HttpResponse.json([])),
    )
    queryClient.setQueryData(['agenda', { de: DIA_FICTICIO, ate: DIA_FICTICIO }], [])
    renderizarHarness()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Marcar' }))

    // ASSERT: o usuário vê a confirmação, e a grade é refeita
    expect(await screen.findByText('Agendamento criado.')).toBeInTheDocument()
    await waitFor(() => {
      const consulta = queryClient.getQueryCache().find({ queryKey: ['agenda', { de: DIA_FICTICIO, ate: DIA_FICTICIO }] })
      expect(consulta?.state.isInvalidated).toBe(true)
    })
  })

  it('deve anunciar quantos agendamentos a série criou', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos', () =>
        HttpResponse.json({ criados: 12, recorrencia_grupo_id: 'uuid-ficticio' }, { status: 201 }),
      ),
      msw.get('/api/agenda', () => HttpResponse.json([])),
    )
    renderizarHarness()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Marcar' }))

    // ASSERT
    expect(await screen.findByText('12 agendamentos criados na série.')).toBeInTheDocument()
  })
})

describe('usarMutacaoDeAgendamento — a criança sobreposta avisa sem virar erro (D4)', () => {
  it('deve mostrar o aviso ao lado do sucesso, sem marcar campo nenhum', async () => {
    // ARRANGE — clínica em `agenda.conflito_paciente = avisar`: a escrita PASSOU
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos', () =>
        HttpResponse.json({ id: 1, alerta_paciente: ['2026-09-01'] }, { status: 201 }),
      ),
      msw.get('/api/agenda', () => HttpResponse.json([])),
    )
    renderizarHarness()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Marcar' }))

    // ASSERT — os dois toasts, e nenhum campo em erro
    expect(await screen.findByText('Agendamento criado.')).toBeInTheDocument()
    expect(
      await screen.findByText('Atenção: esta criança já tem outro atendimento neste horário.'),
    ).toBeInTheDocument()
    expect(document.querySelector('[data-erro-profissional]')).toBeNull()
  })

  it('deve DIZER AS DATAS quando a série avisa', async () => {
    // ARRANGE — "avisou em alguma das 52" não é informação com a qual dê para trabalhar, e
    // contar ("em 2 datas") é a mesma não-informação: com o formulário fechado, a recepção não
    // tem como descobrir QUAIS (achado CR-A1 do gate)
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos', () =>
        HttpResponse.json(
          { criados: 4, recorrencia_grupo_id: 'uuid-ficticio', alerta_paciente: ['2026-09-01', '2026-09-08'] },
          { status: 201 },
        ),
      ),
      msw.get('/api/agenda', () => HttpResponse.json([])),
    )
    renderizarHarness()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Marcar' }))

    // ASSERT
    expect(
      await screen.findByText('Atenção: esta criança já tem outro atendimento em 01/09/2026, 08/09/2026.'),
    ).toBeInTheDocument()
  })

  it('deve dizer a DATA, e não "neste horário", quando a série conflita em uma só', async () => {
    // ARRANGE — o caso que apontava a data errada: série pedida para 01/09 com choque só em
    // 13/10 dizia "neste horário", e a recepção ia conferir 01/09, onde não havia nada
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos', () =>
        HttpResponse.json(
          { criados: 52, recorrencia_grupo_id: 'uuid-ficticio', alerta_paciente: ['2026-10-13'] },
          { status: 201 },
        ),
      ),
      msw.get('/api/agenda', () => HttpResponse.json([])),
    )
    renderizarHarness()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Marcar' }))

    // ASSERT
    expect(
      await screen.findByText('Atenção: esta criança já tem outro atendimento em 13/10/2026.'),
    ).toBeInTheDocument()
  })

  it('deve cortar a lista quando a série conflita em muitas datas', async () => {
    // ARRANGE — toast não é relatório: quatro datas e o resto contado
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos', () =>
        HttpResponse.json(
          {
            criados: 52,
            recorrencia_grupo_id: 'uuid-ficticio',
            alerta_paciente: ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06'],
          },
          { status: 201 },
        ),
      ),
      msw.get('/api/agenda', () => HttpResponse.json([])),
    )
    renderizarHarness()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Marcar' }))

    // ASSERT
    expect(
      await screen.findByText(
        'Atenção: esta criança já tem outro atendimento em 01/09/2026, 08/09/2026, 15/09/2026, 22/09/2026 e mais 2.',
      ),
    ).toBeInTheDocument()
  })

  it('não deve avisar quando o servidor não mandou alerta', async () => {
    // ARRANGE — guarda contra o aviso que aparece sempre (e por isso deixa de ser lido)
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos', () => HttpResponse.json({ id: 1 }, { status: 201 })),
      msw.get('/api/agenda', () => HttpResponse.json([])),
    )
    renderizarHarness()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Marcar' }))

    // ASSERT
    expect(await screen.findByText('Agendamento criado.')).toBeInTheDocument()
    expect(screen.queryByText(/já tem outro atendimento/)).toBeNull()
  })
})

describe('usarMutacaoDeAgendamento — conflito de edição invalida a leitura da linha (B1)', () => {
  it('deve invalidar a agenda no 409 — reabrir o card re-hidrata fresco, nunca 409 eterno', async () => {
    // ARRANGE — o card da grade hidrata o formulário; sem invalidar no conflito,
    // fechar e reabrir repetiria o MESMO token velho até um F5 (gate B1)
    const usuario = userEvent.setup()
    const invalidacoes = vi.spyOn(queryClient, 'invalidateQueries')
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.put('/api/agendamentos/:id', () =>
        HttpResponse.json({ message: 'conflito' }, { status: 409 }),
      ),
    )

    function HarnessDeEdicao() {
      const { atualizar, erros } = usarMutacaoDeAgendamento()

      return (
        <>
          <AvisoErro mensagens={erros.gerais} />
          <Botao
            onClick={() => {
              atualizar.mutate({
                id: 7,
                payload: { inicio: `${DIA_FICTICIO} 08:00`, profissional_id: 1 },
                versao: '2026-07-15T10:00:00.000000Z',
              })
            }}
          >
            Salvar edição
          </Botao>
        </>
      )
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <HarnessDeEdicao />
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Salvar edição' }))

    // ASSERT — o aviso aparece E a leitura que hidrata a linha foi invalidada
    await screen.findAllByText(/alterado por outra pessoa/)
    await waitFor(() => {
      expect(
        invalidacoes.mock.calls.some(
          ([filtro]) => JSON.stringify(filtro?.queryKey) === JSON.stringify(['agenda']),
        ),
      ).toBe(true)
    })
    invalidacoes.mockRestore()
  })
})
