import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CampoComMascara } from '@/componentes/ui/campo-com-mascara'
import { FORMATO_DO_CEP } from '@/lib/cep'

expect.extend(toHaveNoViolations)

/** Controlado em DÍGITOS, como o formulário o usa. */
function CampoControlado({
  inicial = '',
  anuncio,
  aoMudar,
}: {
  inicial?: string
  anuncio?: string
  aoMudar?: (digitos: string) => void
}) {
  const [valor, setValor] = useState(inicial)

  return (
    <CampoComMascara
      rotulo="CEP"
      formato={FORMATO_DO_CEP}
      value={valor}
      anuncio={anuncio}
      onChangeValor={(digitos) => {
        setValor(digitos)
        aoMudar?.(digitos)
      }}
    />
  )
}

describe('CampoComMascara', () => {
  it('deve pôr o separador sozinho enquanto a pessoa digita', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<CampoControlado />)

    // ACT
    await usuario.type(screen.getByLabelText('CEP'), '88501050')

    // ASSERT
    expect(screen.getByLabelText('CEP')).toHaveValue('88501-050')
  })

  it('deve entregar ao formulário o valor SEM separador', async () => {
    // ARRANGE — guardar às vezes com hífen e às vezes sem faria o mesmo endereço parecer dois
    // na busca e no relatório
    const usuario = userEvent.setup()
    const aoMudar = vi.fn()
    render(<CampoControlado aoMudar={aoMudar} />)

    // ACT
    await usuario.type(screen.getByLabelText('CEP'), '88501050')

    // ASSERT
    expect(aoMudar).toHaveBeenLastCalledWith('88501050')
  })

  it('deve aceitar um CEP colado JÁ formatado, sem duplicar separador', async () => {
    // ARRANGE — é assim que o CEP aparece em conta de luz, em site de loja e no WhatsApp;
    // recusar o formato mais comum de todos seria máscara brigando com quem digita
    const usuario = userEvent.setup()
    const aoMudar = vi.fn()
    render(<CampoControlado aoMudar={aoMudar} />)

    // ACT
    await usuario.click(screen.getByLabelText('CEP'))
    await usuario.paste('88501-050')

    // ASSERT
    expect(screen.getByLabelText('CEP')).toHaveValue('88501-050')
    expect(aoMudar).toHaveBeenLastCalledWith('88501050')
  })

  it('deve deixar APAGAR — o separador não volta sozinho', async () => {
    // ARRANGE — se o hífen renascesse a cada apagamento, o campo ficaria preso em `88501-` e
    // seria impossível voltar atrás: cada Backspace tiraria o hífen e a máscara o devolveria
    const usuario = userEvent.setup()
    render(<CampoControlado inicial="885010" />)
    const campo = screen.getByLabelText('CEP')
    expect(campo).toHaveValue('88501-0')

    // ACT + ASSERT — o hífen SAI junto com o dígito que o justificava
    await usuario.click(campo)
    await usuario.keyboard('{End}{Backspace}')
    expect(campo).toHaveValue('88501')

    // e o apagamento continua avançando, em vez de travar no separador
    await usuario.keyboard('{Backspace}')
    expect(campo).toHaveValue('8850')
  })

  it('deve manter o cursor onde estava ao editar no MEIO', async () => {
    /*
     * ARRANGE — achado A11Y-CEP-04. Campo controlado por valor derivado: o React reescreve o
     * `value` inteiro e o navegador joga o cursor para o fim. Corrigir um dígito no meio do
     * CEP exigia re-navegar a cada tecla, e o caminho prático virava apagar tudo e redigitar.
     */
    const usuario = userEvent.setup()
    render(<CampoControlado inicial="88501050" />)
    const campo = screen.getByLabelText('CEP') as HTMLInputElement

    // ACT — cursor depois do terceiro dígito, apaga um
    await usuario.click(campo)
    campo.setSelectionRange(3, 3)
    await usuario.keyboard('{Backspace}')

    // ASSERT — o valor perdeu o dígito certo E o cursor ficou no lugar
    expect(campo).toHaveValue('88010-50')
    expect(campo.selectionStart).toBe(2)
  })

  it('deve ignorar letras', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<CampoControlado />)

    // ACT
    await usuario.type(screen.getByLabelText('CEP'), '88a50b1050')

    // ASSERT
    expect(screen.getByLabelText('CEP')).toHaveValue('88501-050')
  })

  it('deve anunciar como ESTADO o que aconteceu com os outros campos', async () => {
    // ARRANGE — quem enxerga vê quatro campos mudarem de uma vez; quem usa leitor de tela não
    // vê nada acontecer e continuaria tabulando por campos que já não precisam ser digitados
    render(<CampoControlado inicial="88501050" anuncio="Endereço preenchido pelo CEP." />)

    // ACT
    const anuncio = screen.getByRole('status')

    // ASSERT
    expect(anuncio).toHaveTextContent('Endereço preenchido pelo CEP.')
    expect(screen.getByLabelText('CEP').getAttribute('aria-describedby')).toBe(anuncio.id)
  })

  it('deve manter a região de anúncio PREEXISTENTE quando o campo anuncia', async () => {
    /*
     * ARRANGE — achado do code review, e é contraintuitivo.
     *
     * A primeira versão só criava o `<p role="status">` junto com o texto. Região viva que
     * nasce **com** o conteúdo tipicamente NÃO é anunciada por leitor de tela: ela precisa
     * preexistir e ter o texto trocado. Um teste que só confere "o texto está no documento"
     * passa nas duas versões e não protege nada.
     */
    render(<CampoControlado anuncio="" />)

    // ASSERT — a região existe, vazia, esperando o texto
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('')
    // e vazia ela NÃO descreve o campo: `aria-describedby` apontando para parágrafo em branco
    // é o defeito que o `temAjuda` do envelope nasceu para matar
    expect(screen.getByLabelText('CEP')).not.toHaveAttribute('aria-describedby')
  })

  it('NÃO deve criar região de anúncio em campo que não anuncia', async () => {
    // ARRANGE + ACT — máscara sem anúncio (um CPF, um telefone) não ganha região viva
    render(<CampoControlado />)

    // ASSERT
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByLabelText('CEP')).not.toHaveAttribute('aria-describedby')
  })

  it('deve preservar o aria-describedby do consumidor sem perder o do anúncio', async () => {
    // ARRANGE — o espalhamento de props vinha DEPOIS dos atributos do componente, e um
    // consumidor que passasse `aria-describedby` derrubava a associação do anúncio em silêncio
    render(
      <CampoComMascara
        rotulo="CEP"
        formato={FORMATO_DO_CEP}
        value="88501050"
        onChangeValor={() => {}}
        anuncio="Endereço preenchido."
        aria-describedby="qualquer-outro"
      />,
    )

    // ASSERT — o componente vence: a associação do anúncio sobrevive
    const campo = screen.getByLabelText('CEP')
    expect(campo.getAttribute('aria-describedby')).toBe(screen.getByRole('status').id)
  })

  it('deve passar no axe', async () => {
    // ARRANGE
    const { container } = render(<CampoControlado inicial="88501050" anuncio="Endereço preenchido." />)

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })
})
