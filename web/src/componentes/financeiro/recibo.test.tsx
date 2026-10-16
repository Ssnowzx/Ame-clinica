import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { HttpResponse, http as msw } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'

import { Recibo } from '@/componentes/financeiro/recibo'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { LancamentoCaixa } from '@/tipos'

function lancamento(sobrescritas: Partial<LancamentoCaixa> = {}): LancamentoCaixa {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    tipo: 'receita',
    competencia: '2026-07-01',
    vencimento: '2026-07-10',
    categoria_id: 1,
    subcategoria_id: null,
    valor: '100.00',
    juros: '0.00',
    multa: '0.00',
    desconto: '0.00',
    liquido: '100.00',
    tipo_pagamento_id: 1,
    conta_id: 1,
    contabil: true,
    documento: null,
    agendamento_id: null,
    grupo_parcelamento: null,
    parcela: null,
    parcelas_total: null,
    pago_em: '2026-07-10 14:00',
    interessado: { tipo: 'paciente', id: 10, nome: 'Ana Beatriz' },
    obs: null,
    ...sobrescritas,
  }
}

function renderizar(lanc: LancamentoCaixa, permissoes: string[] = ['lancamentos.ver']) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <Recibo lancamento={lanc} aoFechar={() => undefined} />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Recibo — texto livre é escapado (fecha REC)', () => {
  it('deve renderizar obs com HTML como TEXTO literal, nunca como markup', async () => {
    // ARRANGE — obs hostil: se o recibo usasse dangerouslySetInnerHTML, isto injetaria markup
    const hostil = '<script>alert(1)</script><b>x</b>'

    // ACT
    const { container } = renderizar(lancamento({ obs: hostil }), ['lancamentos.ver'])

    // ASSERT — o conteúdo aparece como texto; nenhum <script>/<b> foi criado a partir dele
    expect(await screen.findByText(hostil)).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
    expect(document.querySelectorAll('[data-impresso] b')).toHaveLength(0)
  })

  it('deve escapar o campo documento (texto livre) do lançamento', async () => {
    // ARRANGE
    const documento = '<img src=x onerror=alert(1)>'

    // ACT
    renderizar(lancamento({ documento }), ['lancamentos.ver'])

    // ASSERT — o texto sai literal; nenhum <img> nasceu do campo
    expect(await screen.findByText(documento)).toBeInTheDocument()
    expect(document.querySelectorAll('[data-impresso] img')).toHaveLength(0)
  })
})

describe('Recibo — degrada quando falta permissão', () => {
  it('deve omitir o CPF quando o autor não pode ler o cadastro do paciente', async () => {
    // ARRANGE — sem `pacientes.ver`, a busca do documento nem dispara
    servidor.use(
      msw.get('/api/pacientes/:id', () =>
        HttpResponse.json({ id: 10, nome: 'Ana', nome_social: null, cpf: '12345678900' }),
      ),
    )

    // ACT — só lancamentos.ver
    renderizar(lancamento(), ['lancamentos.ver'])
    await screen.findByText('Ana Beatriz')

    // ASSERT — o nome (mínimo, já no lançamento) aparece; o CPF, não
    expect(screen.queryByText(/12345678900/)).not.toBeInTheDocument()
    expect(screen.queryByText(/CPF\/CNPJ/)).not.toBeInTheDocument()
  })

  it('deve mostrar o CPF quando o autor tem permissão para lê-lo', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/:id', () =>
        HttpResponse.json({ id: 10, nome: 'Ana', nome_social: null, cpf: '12345678900' }),
      ),
    )

    // ACT
    renderizar(lancamento(), ['lancamentos.ver', 'pacientes.ver'])

    // ASSERT
    expect(await screen.findByText(/12345678900/)).toBeInTheDocument()
  })
})

/**
 * GUARDA MECÂNICA do REC — nenhuma superfície do financeiro imprime HTML de texto
 * livre. `dangerouslySetInnerHTML` é o vetor que o gatilho nomeia; a guarda o
 * reprova por varredura de fonte, então introduzi-lo (erodir o piso) deixa isto
 * vermelho — e não depende de alguém lembrar da regra na próxima tela.
 */
describe('Financeiro — dangerouslySetInnerHTML é proibido', () => {
  it('deve não usar dangerouslySetInnerHTML em nenhum componente do financeiro', () => {
    // ARRANGE — sem comentários: senão a guarda casa o token do JSDoc que EXPLICA a proibição
    const semComentarios = (fonte: string): string =>
      fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    const raiz = join(process.cwd(), 'src', 'componentes', 'financeiro')
    const doFinanceiro = readdirSync(raiz)
      .filter((nome) => (nome.endsWith('.tsx') || nome.endsWith('.ts')) && !nome.includes('.test.'))
      .map((nome) => join(raiz, nome))
    // a PÁGINA mora em src/paginas/ — o describe fala "no recibo E na tela" (SEC-FIN-03)
    const arquivos = [...doFinanceiro, join(process.cwd(), 'src', 'paginas', 'pagina-financeiro.tsx')]

    // ACT
    const infratores = arquivos.filter((caminho) =>
      semComentarios(readFileSync(caminho, 'utf-8')).includes('dangerouslySetInnerHTML'),
    )

    // ASSERT
    expect(infratores).toEqual([])
  })
})
