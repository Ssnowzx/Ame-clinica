import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SecaoReservada } from '@/componentes/pacientes/ficha/secao-reservada'

/**
 * O MECANISMO do slot reservado (spec ficha-paciente). Desde a change
 * anexos-do-paciente nenhuma seção do REGISTRO está reservada — mas o
 * requirement segue vivo para as futuras (Crédito, Contrato/Termo, Diário das
 * Emoções): seção sem domínio mostra indisponibilidade COM motivo, nunca UI que
 * finge funcionar.
 */
describe('SecaoReservada', () => {
  it('deve mostrar a indisponibilidade com o motivo, sem controles falsos', () => {
    // ARRANGE + ACT
    render(<SecaoReservada rotulo="Crédito" motivo="Disponível numa change própria." />)

    // ASSERT
    expect(screen.getByText('Crédito — indisponível')).toBeInTheDocument()
    expect(screen.getByText('Disponível numa change própria.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
