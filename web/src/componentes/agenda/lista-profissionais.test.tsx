import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ListaProfissionais } from '@/componentes/agenda/lista-profissionais'
import type { ProfissionalDaAgenda } from '@/tipos'

/** 29 profissionais fictícios — a carga que fez a lista medir 2554px ao vivo. */
const PROFISSIONAIS: ProfissionalDaAgenda[] = Array.from({ length: 29 }, (_, indice) => ({
  id: indice + 1,
  nome: `Profissional Fictício ${String(indice + 1)}`,
  foto_versao: null,
  obs: null,
  horarios: {},
  especialidades: [{ id: 1, nome: 'Fonoaudiologia Fictícia' }],
}))

describe('ListaProfissionais — a lista não pode enterrar a agenda', () => {
  it('deve ter teto de altura e rolagem PRÓPRIA em qualquer largura, não só no xl', () => {
    // ARRANGE — na faixa 768–1280 os painéis empilham (o `xl:flex-row` do layout só liga a
    // partir do xl) e vale a grade de desktop. A rolagem da lista só existia no `xl`: com 29
    // profissionais ela media 2554px e o topo da grade caía em y=2731 numa janela de 757 —
    // a agenda ficava 3,6 telas abaixo da dobra, isto é, não existia para quem abria a tela.
    // jsdom não calcula layout, então a guarda é sobre as classes que produzem o efeito.
    render(
      <ListaProfissionais
        profissionais={PROFISSIONAIS}
        especialidades={[]}
        selecionado={null}
        aoSelecionar={vi.fn()}
      />,
    )

    // ACT
    const lista = screen.getByRole('list')

    // ASSERT — teto e rolagem SEM prefixo de breakpoint; o `xl:` solta o teto onde a coluna
    // tem altura própria
    expect(lista.className).toContain('max-h-64')
    expect(lista.className).toContain('overflow-y-auto')
    expect(lista.className).toContain('xl:max-h-none')
  })

  it('deve manter TODOS os profissionais alcançáveis dentro do teto', () => {
    // ARRANGE — teto que esconde profissional seria trocar um defeito por outro
    render(
      <ListaProfissionais
        profissionais={PROFISSIONAIS}
        especialidades={[]}
        selecionado={null}
        aoSelecionar={vi.fn()}
      />,
    )

    // ACT
    const itens = screen.getAllByRole('listitem')

    // ASSERT
    expect(itens).toHaveLength(29)
  })

  it('deve desenhar o foco por DENTRO do item — o contêiner que rola cortava o anel', () => {
    // ARRANGE + ACT (change tema-da-clinica, gate r3)
    render(
      <ListaProfissionais
        profissionais={PROFISSIONAIS}
        especialidades={[]}
        selecionado={null}
        aoSelecionar={vi.fn()}
      />,
    )

    // ASSERT — o "Todos" e cada profissional
    for (const botao of screen.getAllByRole('button', { pressed: false }).concat(screen.getAllByRole('button', { pressed: true }))) {
      expect(botao).toHaveClass('focus-visible:-outline-offset-2')
    }
  })

  it('deve virar um SELETOR quando a página está empilhada — o cromo cede espaço à grade', () => {
    // ARRANGE — na faixa 768–1279 a lista fica EM CIMA da grade, e mesmo com teto de 256px
    // sobravam 244–284px de agenda: cerca de 5 slots (medido pelo gate em 1024×768 e
    // 1177×757). A §2 é explícita: "a tela do dia é a GRADE — o cromo cede espaço a ela".
    render(
      <ListaProfissionais
        profissionais={PROFISSIONAIS}
        especialidades={[]}
        selecionado={null}
        aoSelecionar={vi.fn()}
        compacta
      />,
    )

    // ACT / ASSERT — um controle de uma linha, com os 29 alcançáveis, e nenhuma lista
    const seletor = screen.getByRole('combobox', { name: /Profissional/ })
    expect(seletor).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(30) // 29 + "Todos os profissionais"
  })

  it('deve escolher o profissional pelo seletor compacto', async () => {
    // ARRANGE
    const aoSelecionar = vi.fn()
    render(
      <ListaProfissionais
        profissionais={PROFISSIONAIS}
        especialidades={[]}
        selecionado={null}
        aoSelecionar={aoSelecionar}
        compacta
      />,
    )

    // ACT
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Profissional/ }), '3')

    // ASSERT
    expect(aoSelecionar).toHaveBeenCalledWith(3)
  })
})

describe('ListaProfissionais — a lista diz o que faz e marca o escolhido (botoes-com-nome-na-agenda)', () => {
  const COM_TURNOS: ProfissionalDaAgenda = {
    id: 99,
    nome: 'Profissional Fictício Com Turnos',
    foto_versao: null,
    obs: null,
    horarios: {
      '1': [
        { inicio: '08:00', fim: '12:00' },
        { inicio: '14:00', fim: '18:00' },
      ],
      '2': [{ inicio: '08:00', fim: '18:00' }],
      '3': [{ inicio: '08:00', fim: '18:00' }],
      '4': [{ inicio: '08:00', fim: '18:00' }],
      '5': [{ inicio: '08:00', fim: '18:00' }],
    },
    especialidades: [{ id: 1, nome: 'Fonoaudiologia Fictícia' }],
  }

  it('deve trazer a legenda "Ver a agenda de" acima da lista', () => {
    // ARRANGE + ACT
    render(
      <ListaProfissionais
        profissionais={PROFISSIONAIS.slice(0, 3)}
        especialidades={[]}
        selecionado={null}
        aoSelecionar={vi.fn()}
      />,
    )

    // ASSERT: a legenda vive dentro da região nomeada, antes das opções
    const lista = screen.getByRole('navigation', { name: 'Profissionais' })
    expect(lista).toHaveTextContent(/^Ver a agenda de/)
  })

  it('deve marcar o escolhido com o fio de acento — e só ele', () => {
    // ARRANGE + ACT
    render(
      <ListaProfissionais
        profissionais={PROFISSIONAIS.slice(0, 3)}
        especialidades={[]}
        selecionado={2}
        aoSelecionar={vi.fn()}
      />,
    )

    // ASSERT: dois canais — o aria-pressed e o fio (before:bg-destaque), nunca só o fundo
    const escolhido = screen.getByRole('button', { name: /Profissional Fictício 2/ })
    expect(escolhido).toHaveAttribute('aria-pressed', 'true')
    expect(escolhido.className).toContain('before:bg-destaque')
    const comFio = screen
      .getAllByRole('button')
      .filter((botao) => botao.className.includes('before:bg-destaque'))
    expect(comFio).toEqual([escolhido])
  })

  it('deve desenhar "Todos os profissionais" como uma opção, com aria-pressed e o mesmo fio', () => {
    // ARRANGE + ACT
    render(
      <ListaProfissionais
        profissionais={PROFISSIONAIS.slice(0, 3)}
        especialidades={[]}
        selecionado={null}
        aoSelecionar={vi.fn()}
      />,
    )

    // ASSERT
    const todos = screen.getByRole('button', { name: 'Todos os profissionais' })
    expect(todos).toHaveAttribute('aria-pressed', 'true')
    expect(todos.className).toContain('before:bg-destaque')
  })

  it('deve mostrar o resumo de horários inteiro, com a palavra "turnos"', () => {
    // ARRANGE + ACT
    render(
      <ListaProfissionais
        profissionais={[COM_TURNOS]}
        especialidades={[]}
        selecionado={null}
        aoSelecionar={vi.fn()}
      />,
    )

    // ASSERT: o texto não é truncado por CSS (sem `truncate` na linha do resumo)
    const resumo = screen.getByText('Seg–Sex · 08:00–18:00 · turnos')
    expect(resumo.className).not.toContain('truncate')
  })
})
