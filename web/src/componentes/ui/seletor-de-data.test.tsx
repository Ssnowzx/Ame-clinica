import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SeletorDeData } from '@/componentes/ui/seletor-de-data'
import { isoDeTextoDigitado, mascararData } from '@/lib/data-digitada'

expect.extend(toHaveNoViolations)

/** O seletor é controlado: o exemplo guarda o valor como a página faria (na URL). */
function Exemplo({ aoMudar, inicial = '2026-02-09' }: { aoMudar?: (iso: string) => void; inicial?: string }) {
  const [valor, setValor] = useState(inicial)

  return (
    <SeletorDeData
      rotulo="Data da agenda"
      valor={valor}
      hoje="2026-02-11"
      aoMudar={(iso) => {
        setValor(iso)
        aoMudar?.(iso)
      }}
    />
  )
}

describe('mascararData / isoDeTextoDigitado — só dígitos entram, as barras são da máscara', () => {
  it('deve pôr as barras conforme os dígitos chegam', () => {
    // ARRANGE + ACT + ASSERT
    expect(mascararData('1')).toBe('1')
    expect(mascararData('14')).toBe('14')
    expect(mascararData('140')).toBe('14/0')
    expect(mascararData('1407')).toBe('14/07')
    expect(mascararData('14072026')).toBe('14/07/2026')
    expect(mascararData('14/07/2026x')).toBe('14/07/2026')
  })

  it('deve traduzir dd/mm/aaaa para AAAA-MM-DD só quando é data de calendário', () => {
    // ARRANGE + ACT + ASSERT
    expect(isoDeTextoDigitado('14/07/2026')).toBe('2026-07-14')
    expect(isoDeTextoDigitado('30/02/2026')).toBeNull()
    expect(isoDeTextoDigitado('14/07/26')).toBeNull()
  })
})

describe('SeletorDeData — digitar ou escolher, nunca o seletor nativo', () => {
  it('deve mostrar a data em dd/mm/aaaa sob o rótulo', () => {
    // ARRANGE + ACT
    render(<Exemplo />)

    // ASSERT
    expect(screen.getByLabelText('Data da agenda')).toHaveValue('09/02/2026')
    expect(screen.queryByDisplayValue('2026-02-09')).not.toBeInTheDocument()
  })

  it('deve aceitar a data digitada e avisar em AAAA-MM-DD assim que ela fecha', async () => {
    // ARRANGE
    const aoMudar = vi.fn()
    const usuario = userEvent.setup()
    render(<Exemplo aoMudar={aoMudar} />)
    const campo = screen.getByLabelText('Data da agenda')

    // ACT: só dígitos, como quem digita rápido no balcão
    await usuario.clear(campo)
    await usuario.type(campo, '15022026')

    // ASSERT
    expect(aoMudar).toHaveBeenCalledTimes(1)
    expect(aoMudar).toHaveBeenCalledWith('2026-02-15')
    expect(campo).toHaveValue('15/02/2026')
  })

  it('deve voltar ao valor de verdade ao sair do campo com texto que não é data', async () => {
    // ARRANGE
    const aoMudar = vi.fn()
    const usuario = userEvent.setup()
    render(<Exemplo aoMudar={aoMudar} />)
    const campo = screen.getByLabelText('Data da agenda')

    // ACT
    await usuario.clear(campo)
    await usuario.type(campo, '99999999')
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    await usuario.tab()

    // ASSERT: nada foi avisado, e o campo mostra a data que valia
    expect(aoMudar).not.toHaveBeenCalled()
    expect(campo).toHaveValue('09/02/2026')
    expect(campo).not.toHaveAttribute('aria-invalid')
  })

  it('deve acender a pele de erro e apontar a mensagem quando a recusa vem de fora', () => {
    // ARRANGE — o campo sozinho só sabe o que é data de calendário; "depois de hoje" quem sabe é a tela
    render(
      <>
        <SeletorDeData
          rotulo="Até"
          valor="2026-02-09"
          hoje="2026-02-11"
          aoMudar={vi.fn()}
          recusado
          idDaRecusa="recusa-do-ate"
        />
        <p id="recusa-do-ate" role="alert">
          A baixa só alcança o que já aconteceu.
        </p>
      </>,
    )

    // ACT
    const campo = screen.getByLabelText('Até')

    // ASSERT — inválido e descrito pela mensagem, com a data bem digitada
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    expect(campo).toHaveAttribute('aria-describedby', 'recusa-do-ate')
    expect(campo).toHaveValue('09/02/2026')
  })

  it('não deve marcar nada no campo que ninguém recusou', () => {
    // ARRANGE / ACT — sem as props novas, como as outras quatro telas que usam o componente
    render(<Exemplo />)

    // ASSERT
    const campo = screen.getByLabelText('Data da agenda')
    expect(campo).not.toHaveAttribute('aria-invalid')
    expect(campo).not.toHaveAttribute('aria-describedby')
  })

  it('deve escolher o dia no calendário depois de trocar ano e mês pelas listas', async () => {
    // ARRANGE
    const aoMudar = vi.fn()
    const usuario = userEvent.setup()
    render(<Exemplo aoMudar={aoMudar} />)

    // ACT: dois cliques levam a qualquer ano — o que o seletor nativo não dava
    await usuario.click(screen.getByRole('button', { name: 'Abrir o calendário' }))
    const calendario = await screen.findByRole('dialog', { name: 'Escolher a data' })
    await usuario.selectOptions(screen.getByLabelText('Ano'), '2024')
    await usuario.selectOptions(screen.getByLabelText('Mês'), '3')
    await usuario.click(screen.getByRole('button', { name: 'domingo, 3 de março de 2024' }))

    // ASSERT: avisou o dia, fechou o calendário e o campo acompanha
    expect(aoMudar).toHaveBeenCalledWith('2024-03-03')
    expect(calendario).not.toBeInTheDocument()
    expect(screen.getByLabelText('Data da agenda')).toHaveValue('03/03/2024')
  })

  it('deve andar pelos dias com as setas e escolher com Enter', async () => {
    // ARRANGE
    const aoMudar = vi.fn()
    const usuario = userEvent.setup()
    render(<Exemplo aoMudar={aoMudar} />)
    await usuario.click(screen.getByRole('button', { name: 'Abrir o calendário' }))
    const diaAtual = await screen.findByRole('button', { name: 'segunda-feira, 9 de fevereiro de 2026' })

    // a célula tabulável é o dia escolhido; as outras ficam fora do Tab
    expect(diaAtual).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'terça-feira, 10 de fevereiro de 2026' })).toHaveAttribute('tabindex', '-1')

    // ACT
    diaAtual.focus()
    await usuario.keyboard('{ArrowRight}{ArrowDown}{Enter}')

    // ASSERT: +1 dia, +7 dias
    expect(aoMudar).toHaveBeenCalledWith('2026-02-17')
  })

  it('deve fechar com Esc devolvendo o foco ao ícone do calendário', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<Exemplo />)
    const gatilho = screen.getByRole('button', { name: 'Abrir o calendário' })
    await usuario.click(gatilho)
    await screen.findByRole('dialog', { name: 'Escolher a data' })

    // ACT
    await usuario.keyboard('{Escape}')

    // ASSERT
    expect(screen.queryByRole('dialog', { name: 'Escolher a data' })).not.toBeInTheDocument()
    expect(gatilho).toHaveFocus()
  })

  it('deve marcar o dia de hoje da clínica e trocar o mês pelas setas do cabeçalho, sem violação de a11y', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<Exemplo />)
    await usuario.click(screen.getByRole('button', { name: 'Abrir o calendário' }))
    await screen.findByRole('dialog', { name: 'Escolher a data' })

    // ASSERT: hoje é o que veio por prop, nunca o relógio do navegador
    expect(screen.getByRole('button', { name: 'quarta-feira, 11 de fevereiro de 2026' })).toHaveAttribute('aria-current', 'date')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Próximo mês' }))

    // ASSERT
    expect(screen.getByText('março de 2026')).toBeInTheDocument()
    expect(await axe(document.body)).toHaveNoViolations()
  })
})

describe('SeletorDeData — o dia de hoje no tema da clínica (change tema-da-clinica)', () => {
  it('deve contornar o hoje com o destaque e manter o número no acento', async () => {
    // ARRANGE — o contorno é marcador (rosa no tema); o número é texto e segue legível
    const usuario = userEvent.setup()
    render(<Exemplo />)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir o calendário' }))
    await screen.findByRole('dialog', { name: 'Escolher a data' })

    // ASSERT
    const hoje = screen.getByRole('button', { name: 'quarta-feira, 11 de fevereiro de 2026' })
    expect(hoje.className).toContain('border-destaque')
    expect(hoje.className).toContain('text-acento')
  })

  it('não deve contornar com o destaque o hoje que também é o escolhido', async () => {
    // ARRANGE — escolhido, o preenchimento já marca: o contorno do tema em volta dele parecia defeito
    const usuario = userEvent.setup()
    render(<Exemplo inicial="2026-02-11" />)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir o calendário' }))
    await screen.findByRole('dialog', { name: 'Escolher a data' })

    // ASSERT
    const hoje = screen.getByRole('button', { name: 'quarta-feira, 11 de fevereiro de 2026' })
    expect(hoje.className).toContain('border-acento')
    expect(hoje.className).not.toContain('border-destaque')
  })
})
