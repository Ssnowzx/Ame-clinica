import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CampoMencao, type ValorComMencoes } from '@/componentes/tarefas/campo-mencao'
import type { ParticipanteDoMural } from '@/tipos'

const PARTICIPANTES: ParticipanteDoMural[] = [
  { id: 1, nome: 'Ana Clara Fictícia' },
  { id: 2, nome: 'José Fictício' },
]

function Ambiente({ aoSubmeter }: { aoSubmeter?: () => void }) {
  const [valor, setValor] = useState<ValorComMencoes>({ texto: '', escolhidos: [] })
  return (
    <div>
      <CampoMencao
        rotulo="Novo comentário"
        valor={valor}
        participantes={PARTICIPANTES}
        aoMudar={setValor}
        aoSubmeter={aoSubmeter}
      />
      <output data-testid="escolhidos">{valor.escolhidos.map((e) => e.id).join(',')}</output>
    </div>
  )
}

describe('CampoMencao', () => {
  it('deve sugerir no @, navegar por teclado e inserir a menção com Enter', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    render(<Ambiente />)
    const area = screen.getByRole('combobox', { name: 'Novo comentário' })

    // ACT — digita @jo (sem acento; o filtro normaliza)
    await usuaria.type(area, 'chamando @jo')

    // ASSERT — a opção certa aparece, navegável
    const opcao = await screen.findByRole('option', { name: 'José Fictício' })
    expect(opcao).toBeInTheDocument()

    // ACT — Enter insere a menção e registra o escolhido
    await usuaria.keyboard('{Enter}')
    expect(area).toHaveValue('chamando @José Fictício ')
    expect(screen.getByTestId('escolhidos')).toHaveTextContent('2')
  })

  it('deve tirar do payload a menção apagada do texto', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    render(<Ambiente />)
    const area = screen.getByRole('combobox', { name: 'Novo comentário' })
    await usuaria.type(area, '@jo')
    await usuaria.keyboard('{Enter}')
    expect(screen.getByTestId('escolhidos')).toHaveTextContent('2')

    // ACT — apaga o nome inteiro
    await usuaria.clear(area)

    // ASSERT — o texto é a fonte da verdade
    expect(screen.getByTestId('escolhidos')).toHaveTextContent('')
  })

  it('deve enviar com Enter e quebrar linha com Shift+Enter', async () => {
    // ARRANGE
    const aoSubmeter = vi.fn()
    const usuaria = userEvent.setup()
    render(<Ambiente aoSubmeter={aoSubmeter} />)
    const area = screen.getByRole('combobox', { name: 'Novo comentário' })

    // ACT + ASSERT — Shift+Enter quebra linha SEM enviar
    await usuaria.type(area, 'primeira linha')
    await usuaria.keyboard('{Shift>}{Enter}{/Shift}')
    expect(aoSubmeter).not.toHaveBeenCalled()
    expect(area).toHaveValue('primeira linha\n')

    // Enter puro envia
    await usuaria.keyboard('{Enter}')
    expect(aoSubmeter).toHaveBeenCalledTimes(1)
  })

  it('deve fechar as sugestões com Escape sem inserir nada', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    render(<Ambiente />)
    const area = screen.getByRole('combobox', { name: 'Novo comentário' })
    await usuaria.type(area, '@ana')
    await screen.findByRole('option', { name: 'Ana Clara Fictícia' })

    // ACT
    await usuaria.keyboard('{Escape}')

    // ASSERT
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(area).toHaveValue('@ana')
  })
})
