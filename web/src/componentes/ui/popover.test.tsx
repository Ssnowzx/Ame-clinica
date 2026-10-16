import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { Popover } from '@/componentes/ui/popover'

function PopoverDeTeste({ rodape, descreverPeloCorpo = false }: { rodape?: ReactNode; descreverPeloCorpo?: boolean }) {
  const [aberto, setAberto] = useState(false)

  return (
    <Popover
      aberto={aberto}
      aoMudarAberto={setAberto}
      titulo="Aniversariantes"
      gatilho={<button type="button">Abrir painel</button>}
      rodape={rodape}
      descreverPeloCorpo={descreverPeloCorpo}
    >
      <p>Conteúdo do painel</p>
    </Popover>
  )
}

describe('Popover', () => {
  it('deve abrir pelo gatilho e nomear o painel pelo título', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<PopoverDeTeste />)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir painel' }))

    // ASSERT: o título é o nome acessível do painel (aria-labelledby)
    const painel = await screen.findByRole('dialog', { name: 'Aniversariantes' })
    expect(painel).toHaveTextContent('Conteúdo do painel')
    // modal: o foco ENTRA no painel ao abrir (regride sem barulho se alguém
    // adicionar um onOpenAutoFocus no futuro)
    expect(painel.contains(document.activeElement)).toBe(true)
  })

  it('deve expor o estado aberto/fechado no gatilho', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<PopoverDeTeste />)
    const gatilho = screen.getByRole('button', { name: 'Abrir painel' })
    expect(gatilho).toHaveAttribute('aria-expanded', 'false')

    // ACT
    await usuario.click(gatilho)

    // ASSERT
    expect(gatilho).toHaveAttribute('aria-expanded', 'true')
  })

  it('deve fechar com Esc devolvendo o foco ao gatilho', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<PopoverDeTeste />)
    const gatilho = screen.getByRole('button', { name: 'Abrir painel' })
    await usuario.click(gatilho)
    await screen.findByRole('dialog', { name: 'Aniversariantes' })

    // ACT
    await usuario.keyboard('{Escape}')

    // ASSERT: dispensável — Esc fecha e quem abriu continua onde estava
    expect(screen.queryByRole('dialog', { name: 'Aniversariantes' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(gatilho)
  })

  it('deve mostrar o rodapé apenas quando existir', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<PopoverDeTeste rodape={<a href="/destino">Ver todos</a>} />)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir painel' }))

    // ASSERT
    const painel = await screen.findByRole('dialog', { name: 'Aniversariantes' })
    expect(painel).toHaveTextContent('Ver todos')
  })

  it('deve fazer do corpo uma parada de teclado que recebe o foco quando o painel só explica', async () => {
    // ARRANGE — a definição de um indicador: nenhum controle dentro, e o texto pode passar da tela
    const usuario = userEvent.setup()
    render(<PopoverDeTeste descreverPeloCorpo />)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir painel' }))

    // ASSERT — o foco vai para o TEXTO, que rola pelo teclado (A11Y-IND-01)
    const painel = await screen.findByRole('dialog', { name: 'Aniversariantes' })
    const corpo = screen.getByText('Conteúdo do painel').parentElement
    expect(corpo).toHaveAttribute('tabindex', '0')
    expect(document.activeElement).toBe(corpo)
    expect(painel).toHaveAccessibleDescription('Conteúdo do painel')
  })

  it('não deve pôr o corpo na ordem do teclado quando o painel tem os próprios controles', async () => {
    // ARRANGE + ACT — o painel de ações (ex.: o avatar) tem botões: o corpo não é parada
    const usuario = userEvent.setup()
    render(<PopoverDeTeste />)
    await usuario.click(screen.getByRole('button', { name: 'Abrir painel' }))
    await screen.findByRole('dialog', { name: 'Aniversariantes' })

    // ASSERT
    expect(screen.getByText('Conteúdo do painel').parentElement).not.toHaveAttribute('tabindex')
  })

  it('deve caber na tela que sobra e não abrir banner nem rodapé de página dentro do painel', async () => {
    // ARRANGE + ACT
    const usuario = userEvent.setup()
    render(<PopoverDeTeste rodape={<a href="/destino">Ver todos</a>} />)
    await usuario.click(screen.getByRole('button', { name: 'Abrir painel' }))
    const painel = await screen.findByRole('dialog', { name: 'Aniversariantes' })

    // ASSERT — a altura pela que o Radix mede livre, nunca só 70% da janela (zoom de 400%); e
    // `header`/`footer` soltos no `body` virariam marcos de PÁGINA (banner, contentinfo)
    expect(painel.className).toContain('--radix-popover-content-available-height')
    expect(painel.querySelector('header, footer')).toBeNull()
  })
})
