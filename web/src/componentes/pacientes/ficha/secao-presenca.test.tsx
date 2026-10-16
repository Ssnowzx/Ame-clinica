import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'

import { SecaoPresenca } from '@/componentes/pacientes/ficha/secao-presenca'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { PresencaDoPaciente } from '@/tipos'

function presencaFicticia(sobrescreve: Partial<PresencaDoPaciente> = {}): PresencaDoPaciente {
  return {
    janela: { de: '2025-07-18', ate: '2026-07-18' },
    totais: { compareceu: 10, faltas: 2, outros: 1, total: 13 },
    taxa_comparecimento: '83.3',
    faltas_consecutivas: { consecutivas: 1, limite: 3 },
    ultima_falta_em: '2026-07-10',
    faltas: [
      {
        id: 5,
        data: '2026-07-10',
        status: { id: 4, nome: 'Não Compareceu', cor: '#dd6666', cor_borda: null, tipo: null },
      },
    ],
    // a quebra da cliente: soma (7+3) == totais.compareceu (10) — uma régua só
    sessoes_por_profissional: [
      {
        profissional: { id: 1, nome: 'Profissional Fictício Fono' },
        especialidade: { id: 1, nome: 'Fonoaudiologia Fictícia' },
        finalizadas: 7,
      },
      {
        profissional: { id: 2, nome: 'Profissional Fictício Psico' },
        especialidade: { id: 2, nome: 'Psicologia Fictícia' },
        finalizadas: 3,
      },
    ],
    ...sobrescreve,
  }
}

function renderizar() {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes: ['agenda.ver'] },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SecaoPresenca pacienteId={1} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Seção Presença — a tela exibe o que o servidor calculou', () => {
  it('deve exibir o resumo do payload sem recalcular nada', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/1/presenca', () => HttpResponse.json(presencaFicticia())),
    )

    // ACT
    renderizar()

    // ASSERT — taxa formatada (vírgula pt-BR), totais e sequência como vieram
    expect(await screen.findByText('83,3%')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1 de 3')).toBeInTheDocument()
    expect(screen.getByText(/Última falta: 10\/07\/2026/)).toBeInTheDocument()
    expect(screen.getByText('Não Compareceu')).toBeInTheDocument()
  })

  it('deve mostrar travessão quando a taxa vem null — nunca 0% fabricado', async () => {
    // ARRANGE — só "outros": sem base, sem percentual
    servidor.use(
      msw.get('/api/pacientes/1/presenca', () =>
        HttpResponse.json(
          presencaFicticia({
            taxa_comparecimento: null,
            totais: { compareceu: 0, faltas: 0, outros: 3, total: 3 },
            ultima_falta_em: null,
            faltas: [],
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/0,0%|0%/)).not.toBeInTheDocument()
  })

  it('deve declarar a amostra quando as faltas excedem o teto enviado', async () => {
    // ARRANGE — 60 faltas reais, 1 itemizada
    servidor.use(
      msw.get('/api/pacientes/1/presenca', () =>
        HttpResponse.json(
          presencaFicticia({
            totais: { compareceu: 10, faltas: 60, outros: 0, total: 70 },
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Mostrando 1 de 60 faltas.')).toBeInTheDocument()
  })

  it('deve mostrar o estado vazio nomeado sem histórico na janela', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/1/presenca', () =>
        HttpResponse.json(
          presencaFicticia({
            taxa_comparecimento: null,
            totais: { compareceu: 0, faltas: 0, outros: 0, total: 0 },
            ultima_falta_em: null,
            faltas: [],
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — nada de números fabricados
    expect(await screen.findByText('Nenhum agendamento nos últimos 12 meses')).toBeInTheDocument()
    expect(screen.queryByText('Taxa de comparecimento')).not.toBeInTheDocument()
  })

  it('deve alertar por TEXTO (além da cor) quando a sequência atinge o limite', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/1/presenca', () =>
        HttpResponse.json(
          presencaFicticia({ faltas_consecutivas: { consecutivas: 3, limite: 3 } }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — 1.4.1: o alerta fala, não só pinta
    expect(await screen.findByText('3 de 3')).toBeInTheDocument()
    expect(screen.getByText('no limite do alerta')).toBeInTheDocument()
  })

  it('deve nomear o branch sem faltas — e nenhum controle de check-in existe', async () => {
    // ARRANGE — histórico só de comparecimentos (o check-in real é da Fase 2)
    servidor.use(
      msw.get('/api/pacientes/1/presenca', () =>
        HttpResponse.json(
          presencaFicticia({
            taxa_comparecimento: '100.0',
            totais: { compareceu: 5, faltas: 0, outros: 0, total: 5 },
            ultima_falta_em: null,
            faltas: [],
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhuma falta nos últimos 12 meses.')).toBeInTheDocument()
    expect(screen.queryByText(/check-in/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /check-in|registrar presença/i })).not.toBeInTheDocument()
  })

  it('deve mostrar erro com retry quando a leitura falha', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/1/presenca', () =>
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

describe('Seção Presença — sessões por profissional (pedido da clínica)', () => {
  it('deve listar a quebra por profissional com a especialidade e as contagens', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/1/presenca', () => HttpResponse.json(presencaFicticia())),
    )

    // ACT
    renderizar()

    // ASSERT — nomes e números em TEXTO; a soma é o próprio "Compareceu" (10 = 7+3)
    expect(await screen.findByText('Profissional Fictício Fono')).toBeInTheDocument()
    expect(screen.getByText('Profissional Fictício Psico')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sessões por profissional' })).toBeInTheDocument()
  })

  it('deve filtrar a quebra por especialidade — o combo da cliente', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/1/presenca', () => HttpResponse.json(presencaFicticia())),
    )
    renderizar()
    await screen.findByText('Profissional Fictício Fono')

    // ACT — só a Psicologia
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por especialidade'), '2')

    // ASSERT — a Fono some da tabela; a Psico fica
    expect(screen.queryByText('Profissional Fictício Fono')).not.toBeInTheDocument()
    expect(screen.getByText('Profissional Fictício Psico')).toBeInTheDocument()

    // ACT 2 — voltar para todas
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por especialidade'), '')

    // ASSERT 2
    expect(screen.getByText('Profissional Fictício Fono')).toBeInTheDocument()
  })

  it('deve omitir a quebra (e o filtro) quando não há sessão finalizada', async () => {
    // ARRANGE — criança só com faltas/outros: o resumo conta a história sozinho
    servidor.use(
      msw.get('/api/pacientes/1/presenca', () =>
        HttpResponse.json(presencaFicticia({ sessoes_por_profissional: [] })),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('83,3%')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sessões por profissional' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Filtrar por especialidade')).not.toBeInTheDocument()
  })

  it('deve esconder o filtro com UMA especialidade só — não se filtra o que não varia', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/1/presenca', () =>
        HttpResponse.json(
          presencaFicticia({
            sessoes_por_profissional: [
              {
                profissional: { id: 1, nome: 'Profissional Fictício Fono' },
                especialidade: { id: 1, nome: 'Fonoaudiologia Fictícia' },
                finalizadas: 10,
              },
            ],
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Profissional Fictício Fono')).toBeInTheDocument()
    expect(screen.queryByLabelText('Filtrar por especialidade')).not.toBeInTheDocument()
  })

  it('deve zerar o filtro ao trocar de paciente — sem prender a tabela num recorte vazio', async () => {
    // ARRANGE — paciente 1 tem Fono+Psico; paciente 2 SÓ Fono (nem select ganha).
    // A ficha NÃO remonta na troca (busca do cabeçalho preserva a seção): sem o
    // remount por key, o filtro "Psicologia" do 1 prenderia o 2 em "nenhuma sessão".
    servidor.use(
      msw.get('/api/pacientes/1/presenca', () => HttpResponse.json(presencaFicticia())),
      msw.get('/api/pacientes/2/presenca', () =>
        HttpResponse.json(
          presencaFicticia({
            sessoes_por_profissional: [
              {
                profissional: { id: 9, nome: 'Profissional Fictício do Outro' },
                especialidade: { id: 1, nome: 'Fonoaudiologia Fictícia' },
                finalizadas: 4,
              },
            ],
          }),
        ),
      ),
    )
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['agenda.ver'] },
      carregandoSessao: false,
    })
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SecaoPresenca pacienteId={1} />
      </QueryClientProvider>,
    )
    await screen.findByText('Profissional Fictício Fono')

    // ACT — filtra Psicologia no paciente 1 e TROCA para o paciente 2
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por especialidade'), '2')
    expect(screen.queryByText('Profissional Fictício Fono')).not.toBeInTheDocument()
    rerender(
      <QueryClientProvider client={queryClient}>
        <SecaoPresenca pacienteId={2} />
      </QueryClientProvider>,
    )

    // ASSERT — a quebra do 2 aparece INTEIRA (filtro zerado pelo remount por key)
    expect(await screen.findByText('Profissional Fictício do Outro')).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma sessão nesta especialidade.')).not.toBeInTheDocument()
  })
})
