import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'

import { PainelAprovacoes } from '@/componentes/administracao/painel-aprovacoes'
import { CampoDeConfiguracao } from '@/componentes/administracao/campo-de-configuracao'
import { FormularioNivel } from '@/componentes/administracao/formulario-nivel'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { configuracaoFicticia } from '@/test/dados-configuracoes'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { AprovacaoDeAcesso, Configuracao } from '@/tipos'

expect.extend(toHaveNoViolations)

function pendencia(sobrescritas: Partial<AprovacaoDeAcesso> = {}): AprovacaoDeAcesso {
  return {
    id: 7,
    tipo: 'editar_nivel',
    alvo: { id: 3, rotulo: 'Recepção Fictícia' },
    payload: { nome: 'Recepção Fictícia', permissoes: ['agenda.ver', 'pacientes.ver'], base_versao: '2026-07-18 10:00:00' },
    solicitante: { id: 99, nome: 'Outra Admin Fictícia' },
    status: 'pendente',
    decidido_por: null,
    decidido_em: null,
    criado_em: '2026-07-18 10:00',
    voce_pode_aprovar: true,
    ...sobrescritas,
  }
}

function renderizarPainel(permissoes: string[] = ['niveis_permissao.ver', 'niveis_permissao.editar']) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <PainelAprovacoes />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Painel de Aprovações — maker-checker (AP-13)', () => {
  it('deve listar a pendência com aprovar/recusar para OUTRO administrador', async () => {
    // ARRANGE — solicitante id 99 ≠ usuário logado (id 1)
    servidor.use(msw.get('/api/aprovacoes-de-acesso', () => HttpResponse.json([pendencia()])))
    const { container } = renderizarPainel()

    // ASSERT
    expect(await screen.findByText('Recepção Fictícia')).toBeInTheDocument()
    expect(screen.getByText(/2 permissões/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeEnabled()
    // não é o solicitante — cancelar não aparece
    expect(screen.queryByRole('button', { name: 'Cancelar pendência' })).not.toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve trocar o "Aprovar" pelo motivo quando a pendência envolve acesso que a pessoa não tem', async () => {
    // ARRANGE — o servidor diz (trava-de-usuarios-e-niveis); recusar continua com quem decide
    servidor.use(
      msw.get('/api/aprovacoes-de-acesso', () => HttpResponse.json([pendencia({ voce_pode_aprovar: false })])),
    )
    renderizarPainel()

    // ASSERT
    expect(await screen.findByText(/^Esta mudança envolve acesso que você não tem/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeEnabled()
  })

  it('deve mostrar ao PRÓPRIO solicitante o motivo e só o cancelar (cortesia — a regra é do servidor)', async () => {
    // ARRANGE — solicitante = usuário logado (usuarioFicticio.id = 1)
    servidor.use(
      msw.get('/api/aprovacoes-de-acesso', () =>
        HttpResponse.json([pendencia({ solicitante: { id: usuarioFicticio.id, nome: 'Operadora Fictícia' } })]),
      ),
    )
    renderizarPainel()

    // ASSERT — sem aprovar/recusar; com o motivo e o cancelar
    expect(await screen.findByText(/Você pediu esta mudança/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar pendência' })).toBeInTheDocument()
  })

  it('deve aprovar com confirmação, avisar e recarregar a lista', async () => {
    // ARRANGE
    let aprovada = false
    servidor.use(
      msw.get('/api/aprovacoes-de-acesso', () =>
        HttpResponse.json([aprovada ? pendencia({ status: 'aprovada', decidido_por: { id: 1, nome: 'Operadora Fictícia' } }) : pendencia()]),
      ),
      msw.post('/api/aprovacoes-de-acesso/7/aprovar', () => {
        aprovada = true
        return HttpResponse.json(pendencia({ status: 'aprovada' }))
      }),
    )
    renderizarPainel()
    await screen.findByRole('button', { name: 'Aprovar' })

    // ACT — aprovar passa pela confirmação explícita
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar mudança' }))

    // ASSERT — aplicada + lista recarregada mostra decidida
    expect(await screen.findByText('Pendência aprovada e aplicada.')).toBeInTheDocument()
    await waitFor(() => expect(aprovada).toBe(true))
    expect(await screen.findByText('Aprovada')).toBeInTheDocument()
  })

  it('deve exibir a recusa do SERVIDOR quando a decisão falha (a regra não é o botão)', async () => {
    // ARRANGE — o servidor recusa (ex.: pendência obsoleta) com a mensagem de 422
    servidor.use(
      msw.get('/api/aprovacoes-de-acesso', () => HttpResponse.json([pendencia()])),
      msw.post('/api/aprovacoes-de-acesso/7/aprovar', () =>
        HttpResponse.json(
          { message: 'Pendência obsoleta.', errors: { aprovacao: ['Esta pendência ficou obsoleta: o nível foi alterado depois do pedido.'] } },
          { status: 422 },
        ),
      ),
    )
    renderizarPainel()
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar mudança' }))

    // ASSERT — a mensagem do servidor chega a quem clicou
    expect(await screen.findByText(/ficou obsoleta/)).toBeInTheDocument()
  })

  it('deve mostrar o vazio com a explicação do mecanismo', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/aprovacoes-de-acesso', () => HttpResponse.json([])))
    renderizarPainel()

    // ASSERT
    expect(await screen.findByText('Nenhuma pendência de aprovação.')).toBeInTheDocument()
  })

  it('deve mostrar o erro com tentar de novo — e recarregar quando o servidor volta', async () => {
    // ARRANGE — primeiro 500; o retry encontra o servidor de pé
    let disponivel = false
    servidor.use(
      msw.get('/api/aprovacoes-de-acesso', () =>
        disponivel ? HttpResponse.json([pendencia()]) : HttpResponse.json({ message: 'erro' }, { status: 500 }),
      ),
    )
    renderizarPainel()

    // ASSERT — estado de erro com a ação obrigatória
    expect(
      await screen.findByText('Não foi possível carregar as pendências de aprovação.', undefined, { timeout: 4000 }),
    ).toBeInTheDocument()

    // ACT — tentar de novo com o servidor de volta
    disponivel = true
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    // ASSERT
    expect(await screen.findByText('Recepção Fictícia')).toBeInTheDocument()
  })
})

describe('Formulário de nível governado (202)', () => {
  it('deve avisar "enviada para aprovação" quando salvar responde 202 — as permissões vigentes não mudam', async () => {
    // ARRANGE — edição de nível com a dupla ligada no servidor
    servidor.use(
      msw.get('/api/permissoes', () => HttpResponse.json({ permissoes: ['agenda.ver', 'pacientes.ver'] })),
      msw.put('/api/niveis-permissao/3', () => HttpResponse.json(pendencia(), { status: 202 })),
    )
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['niveis_permissao.ver', 'niveis_permissao.editar'] },
      carregandoSessao: false,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <FormularioNivel
            nivel={{ id: 3, nome: 'Recepção Fictícia', permissoes: ['agenda.ver'], updated_at: '2026-07-18 10:00:00' }}
            aoConcluir={() => undefined}
            aoCancelar={() => undefined}
          />
        </ProvedorToast>
      </QueryClientProvider>,
    )
    await screen.findByRole('checkbox', { name: /pacientes/i })

    // ACT — marca mais uma permissão e salva
    await userEvent.click(screen.getByRole('checkbox', { name: /pacientes/i }))
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))

    // ASSERT — o aviso diz a verdade: nada aplicou ainda
    expect(await screen.findByText('Mudança enviada para aprovação.')).toBeInTheDocument()
  })
})

describe('Configuração de segurança governada (202)', () => {
  it('deve avisar "enviada para aprovação" e reverter o toggle quando desligar responde 202', async () => {
    // ARRANGE — a flag está LIGADA; desligar vira pendência (o valor vigente não muda)
    const config: Configuracao = configuracaoFicticia({ chave: 'seguranca.aprovacao_dupla', rotulo: 'Exigir aprovação de dois administradores nas mudanças de acesso', tipo: 'bool', valor: true })
    servidor.use(
      msw.put('/api/configuracoes', () =>
        HttpResponse.json(pendencia({ tipo: 'configurar_seguranca', alvo: { id: 0, rotulo: 'seguranca.aprovacao_dupla' } }), { status: 202 }),
      ),
    )
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['configuracoes.ver', 'configuracoes.editar'] },
      carregandoSessao: false,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <CampoDeConfiguracao config={config} alvos={[]} finalizam={[]} alvosCarregou podeEditar />
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ACT — desmarcar o toggle
    await userEvent.click(screen.getByRole('checkbox'))

    // ASSERT — aviso de pendência e o toggle VOLTA ao vigente (ligado)
    expect(await screen.findByText('Mudança enviada para aprovação.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())
  })
})
