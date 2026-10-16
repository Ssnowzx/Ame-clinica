import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Botao } from '@/componentes/ui/botao'

describe('Botao', () => {
  it('deve renderizar com type="button" por padrão', () => {
    // ARRANGE + ACT
    render(<Botao>Salvar</Botao>)

    // ASSERT: nunca submete formulário por acidente
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('type', 'button')
  })

  it('deve aplicar as classes semânticas de cada variante', () => {
    // ARRANGE + ACT
    const { rerender } = render(<Botao variante="primario">Ação</Botao>)

    // ASSERT: só tokens semânticos (bg-botao-primario, bg-perigo…) — o primário tem papel próprio
    // desde a change tema-da-clinica (no Padrão ele É o acento)
    expect(screen.getByRole('button')).toHaveClass('bg-botao-primario')

    rerender(<Botao variante="perigo">Ação</Botao>)
    expect(screen.getByRole('button')).toHaveClass('bg-perigo')

    rerender(<Botao variante="secundario">Ação</Botao>)
    expect(screen.getByRole('button')).toHaveClass('bg-superficie')

    rerender(<Botao variante="fantasma">Ação</Botao>)
    expect(screen.getByRole('button')).toHaveClass('hover:bg-acento-suave')

    // impacto FORA do diálogo: moldura + texto de perigo, nunca o sólido
    rerender(<Botao variante="perigo-suave">Ação</Botao>)
    expect(screen.getByRole('button')).toHaveClass('text-perigo-texto', 'hover:bg-perigo-suave')
    expect(screen.getByRole('button')).not.toHaveClass('bg-perigo')
  })

  it('deve dar ao primário o losango e a elevação por PAPEL, com as travas do inerte e do filtro ligado', () => {
    // ARRANGE + ACT — change tema-xclinicas: o ornamento e a subida são papéis (no Padrão, nada)
    render(<Botao variante="primario">Salvar</Botao>)
    const botao = screen.getByRole('button', { name: 'Salvar' })

    // ASSERT — o losango só existe se o papel der conteúdo; a subida só move se o papel der medida
    expect(botao).toHaveClass('after:content-(--botao-primario-losango)', 'after:bg-losango')
    expect(botao).toHaveClass('hover:-translate-y-(--botao-primario-elevacao)', 'transition')
    // a ponte que segura o hover na subida só existe DURANTE o hover (code-reviewer r2): em repouso,
    // ela mesma dava o hover abaixo do botão e o tremor só mudava de lugar
    expect(botao).toHaveClass('before:h-0', 'hover:before:h-(--botao-primario-elevacao)')
    expect(botao).not.toHaveClass('before:h-(--botao-primario-elevacao)')
    // o inerte não sobe nem diz "pronto para ir"; o filtro ligado é "escolhido", não "vá"
    expect(botao).toHaveClass('aria-disabled:hover:translate-y-0', 'aria-disabled:after:hidden', 'disabled:after:hidden')
    expect(botao).toHaveClass('aria-pressed:after:hidden', 'aria-pressed:hover:translate-y-0')
  })

  it('não deve dar o losango nem a elevação ao secundário', () => {
    // ARRANGE + ACT
    render(<Botao variante="secundario">Cancelar</Botao>)
    const botao = screen.getByRole('button', { name: 'Cancelar' })

    // ASSERT — o "ponto de chegada" é só da ação principal
    expect(botao.className).not.toMatch(/losango|elevacao/)
    expect(botao).toHaveClass('transition-colors')
  })

  it('deve manter o rótulo visível, o FOCO e travar o clique quando carregando', async () => {
    // ARRANGE — `disabled` nativo tira o botão do ciclo de foco, e num diálogo o focus scope
    // o recolhe no contêiner: quem acionava a ação era teleportado para o topo e precisava de
    // ~20 Tabs para voltar ao botão que acabou de apertar (medido pelo gate, 2.4.3). O
    // `aria-disabled` mantém o foco e continua inerte — mas por CONTRATO, então o clique é
    // barrado à mão.
    const aoClicar = vi.fn()
    render(
      <Botao carregando onClick={aoClicar}>
        Salvando…
      </Botao>,
    )
    const botao = screen.getByRole('button')

    // ACT
    botao.focus()
    await userEvent.click(botao)

    // ASSERT — focável, anunciado como ocupado e inerte, e o clique não passa
    expect(botao).toHaveAttribute('aria-busy', 'true')
    expect(botao).toHaveAttribute('aria-disabled', 'true')
    expect(botao).not.toBeDisabled()
    expect(botao).toHaveFocus()
    expect(aoClicar).not.toHaveBeenCalled()
    expect(botao).toHaveTextContent('Salvando…')
  })

  it('deve responder a Enter e Espaço pelo teclado', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoClicar = vi.fn()
    render(<Botao onClick={aoClicar}>Confirmar</Botao>)

    // ACT: foca e aciona pelas duas teclas
    const botao = screen.getByRole('button', { name: 'Confirmar' })
    botao.focus()
    await usuario.keyboard('{Enter}')
    await usuario.keyboard(' ')

    // ASSERT
    expect(aoClicar).toHaveBeenCalledTimes(2)
  })

  it('deve não disparar clique quando desabilitado', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoClicar = vi.fn()
    render(
      <Botao disabled onClick={aoClicar}>
        Excluir
      </Botao>,
    )

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Excluir' }))

    // ASSERT
    expect(aoClicar).not.toHaveBeenCalled()
  })

  it('deve delegar a skin para o filho com asChild', () => {
    // ARRANGE + ACT: vira <a> mantendo as classes (Radix Slot)
    render(
      <Botao asChild variante="secundario">
        <a href="/agenda">Ver agenda</a>
      </Botao>,
    )

    // ASSERT
    const link = screen.getByRole('link', { name: 'Ver agenda' })
    expect(link).toHaveClass('bg-superficie')
  })
})
