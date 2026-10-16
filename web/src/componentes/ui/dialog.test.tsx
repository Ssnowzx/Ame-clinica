import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Dialog } from '@/componentes/ui/dialog'

// Harness com gatilho REAL: só assim dá para verificar o retorno de foco ao fechar.
function Harness({ variante }: { variante?: 'centrado' | 'sheet' }) {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <button type="button" onClick={() => { setAberto(true) }}>
        Abrir detalhe
      </button>
      <Dialog
        aberto={aberto}
        aoMudarAberto={setAberto}
        titulo="Detalhes do agendamento"
        variante={variante}
        rodape={<button type="button">Iniciar atendimento</button>}
      >
        <p>Ana S. — qui 14:00</p>
      </Dialog>
    </>
  )
}

async function abrir(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(screen.getByRole('button', { name: 'Abrir detalhe' }))
  return screen.getByRole('dialog')
}

describe('Dialog (primitivo dispensável)', () => {
  it('deve abrir um diálogo de leitura com título, corpo e rodapé', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<Harness />)

    // ACT
    const dialog = await abrir(usuario)

    // ASSERT: papel de leitura (dialog, não alertdialog), com o conteúdo e a ação
    expect(dialog).toHaveTextContent('Detalhes do agendamento')
    expect(dialog).toHaveTextContent('Ana S. — qui 14:00')
    expect(screen.getByRole('button', { name: 'Iniciar atendimento' })).toBeInTheDocument()
  })

  it('deve colocar o foco no botão Fechar ao abrir', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<Harness />)

    // ACT
    await abrir(usuario)

    // ASSERT
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus()
  })

  it('deve fechar com Escape e devolver o foco ao gatilho', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<Harness />)
    await abrir(usuario)

    // ACT: ler é dispensável — Esc fecha
    await usuario.keyboard('{Escape}')

    // ASSERT: fecha e o foco volta ao gatilho (2.4.3)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir detalhe' })).toHaveFocus()
  })

  it('deve fechar pelo botão Fechar', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<Harness />)
    await abrir(usuario)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Fechar' }))

    // ASSERT
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir detalhe' })).toHaveFocus()
  })

  it('deve descrever o diálogo via aria-describedby quando há descrição', () => {
    // ARRANGE + ACT
    render(
      <Dialog
        aberto
        aoMudarAberto={() => {}}
        titulo="Histórico de movimentação"
        descricao="Trilha de auditoria deste agendamento."
      >
        <p>corpo</p>
      </Dialog>,
    )

    // ASSERT
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-describedby')
    expect(screen.getByRole('dialog')).toHaveTextContent('Trilha de auditoria deste agendamento.')
  })

  it('deve somar a descrição e o aviso do corpo na descrição acessível', () => {
    // ARRANGE + ACT — o aviso que tomou o lugar do corpo é parte do que o diálogo diz (A11Y-AVI-03)
    render(
      <Dialog
        aberto
        aoMudarAberto={() => {}}
        titulo="Nova anotação"
        descricao="Registro do dia."
        idDoAviso="aviso-ficticio"
      >
        <p id="aviso-ficticio">Falta um cadastro fictício.</p>
      </Dialog>,
    )

    // ASSERT
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Registro do dia. Falta um cadastro fictício.')
  })

  it('deve descrever o diálogo só pelo aviso quando não há descrição', () => {
    // ARRANGE + ACT
    render(
      <Dialog aberto aoMudarAberto={() => {}} titulo="Nova anotação" idDoAviso="aviso-ficticio">
        <p id="aviso-ficticio">Falta um cadastro fictício.</p>
      </Dialog>,
    )

    // ASSERT
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Falta um cadastro fictício.')
  })

  it('deve renderizar a variante sheet com o mesmo conteúdo', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<Harness variante="sheet" />)

    // ACT
    const dialog = await abrir(usuario)

    // ASSERT: mesma superfície de leitura, só a apresentação muda por breakpoint
    expect(dialog).toHaveTextContent('Ana S. — qui 14:00')
  })
})
