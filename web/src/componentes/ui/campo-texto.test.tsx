import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { CampoTexto } from '@/componentes/ui/campo-texto'

/** Controlado, como o formulário o usa. */
function CampoComTeto({ limite, inicial = '' }: { limite?: number; inicial?: string }) {
  const [valor, setValor] = useState(inicial)

  return (
    <CampoTexto
      rotulo="Logradouro"
      value={valor}
      limite={limite}
      onChange={(evento) => {
        setValor(evento.target.value)
      }}
    />
  )
}

describe('CampoTexto — o teto do servidor na tela', () => {
  it('deve impedir o excesso em vez de deixar a ficha ser perdida no salvar', async () => {
    // ARRANGE — o defeito que originou a change (04/09/2026): a recepção preencheu tudo e o
    // servidor recusou por tamanho, depois de a ficha inteira estar digitada
    const usuario = userEvent.setup()
    render(<CampoComTeto limite={10} />)

    // ACT
    await usuario.type(screen.getByLabelText('Logradouro'), 'abcdefghijKLMNO')

    // ASSERT
    expect(screen.getByLabelText('Logradouro')).toHaveValue('abcdefghij')
  })

  it('NÃO deve mostrar contador enquanto o texto está longe do teto', async () => {
    // ARRANGE — quinze contadores numa ficha viram ruído, e ruído que ninguém lê não avisa
    render(<CampoComTeto limite={500} inicial="Rua Fictícia" />)

    // ASSERT — a região existe (para poder anunciar), mas está vazia
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('deve avisar quando o texto se aproxima do teto', async () => {
    // ARRANGE — limiar: 10% do teto, com piso de 10 caracteres
    render(<CampoComTeto limite={100} inicial={'a'.repeat(95)} />)

    // ASSERT — o número exato é o VISÍVEL; a região viva fala por marco
    expect(screen.getByText('5 caracteres restantes')).toBeInTheDocument()
  })

  it('deve concordar o contador no singular', async () => {
    // ARRANGE
    render(<CampoComTeto limite={100} inicial={'a'.repeat(99)} />)

    // ASSERT
    expect(screen.getByText('1 caractere restante')).toBeInTheDocument()
  })

  it('deve manter a região de anúncio PREEXISTENTE', async () => {
    /*
     * ARRANGE — lição que custou um bloqueante na change do CEP (A11Y-CEP-02): região viva
     * criada JUNTO com a mensagem tipicamente não é anunciada por leitor de tela. Ela precisa
     * existir desde a montagem e ter o conteúdo trocado.
     */
    render(<CampoComTeto limite={500} />)

    // ASSERT — existe, vazia, e vazia não descreve o campo
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByLabelText('Logradouro')).not.toHaveAttribute('aria-describedby')
  })

  it('deve anunciar por MARCO, não a cada tecla', async () => {
    /*
     * ARRANGE — achado TETO-01. Medido pelo gate: a região mudava a cada ~52–100 ms, e falar
     * "dez caracteres restantes" leva ~1,5 s. `role="status"` é `aria-atomic`: cada mudança
     * relê a frase inteira, e a fila enchia mais rápido do que drenava, atropelando o eco de
     * tecla justamente quando a pessoa mais precisa dele.
     */
    /*
     * Limite 200: o contador acende com 20 restantes e os marcos são 10/5/0 — sobra uma faixa
     * em que o número muda a cada tecla e o anúncio fica quieto. Oito teclas no total, de
     * propósito: a primeira versão deste teste digitava 38 caracteres e ficava instável sob
     * carga paralela (achado IMPORTANTE 3 do gate) — o que ele mede é o COMPORTAMENTO, não a
     * velocidade do teclado.
     */
    const usuario = userEvent.setup()
    render(<CampoComTeto limite={200} inicial={'a'.repeat(185)} />)
    const regiao = screen.getByRole('status')
    const campo = screen.getByLabelText('Logradouro')

    // ACT + ASSERT — de 15 para 14 restantes: o VISÍVEL muda, o anunciado NÃO
    expect(screen.getByText('15 caracteres restantes')).toBeInTheDocument()
    expect(regiao).toHaveTextContent('Faltam 20 caracteres ou menos')
    await usuario.type(campo, 'a')
    expect(screen.getByText('14 caracteres restantes')).toBeInTheDocument()
    expect(regiao).toHaveTextContent('Faltam 20 caracteres ou menos')

    // cruzar o marco de 10 muda o anúncio
    await usuario.type(campo, 'aaaa')
    expect(screen.getByText('10 caracteres restantes')).toBeInTheDocument()
    expect(regiao).toHaveTextContent('Faltam 10 caracteres ou menos')

    // e as teclas seguintes, dentro do mesmo marco, não mexem nele
    await usuario.type(campo, 'aaa')
    expect(screen.getByText('7 caracteres restantes')).toBeInTheDocument()
    expect(regiao).toHaveTextContent('Faltam 10 caracteres ou menos')
  })

  it('deve AVISAR que cortou quando o texto colado não cabe', async () => {
    /*
     * ARRANGE — achado TETO-02. Colar 600 num campo de 500 sumia com 100 caracteres sem nada
     * dizer: num campo de uma linha a perda é invisível, e "0 caracteres restantes" soa como
     * "coube exatamente". Colar é como a recepção transfere endereço vindo do WhatsApp.
     */
    const usuario = userEvent.setup()
    render(<CampoComTeto limite={20} />)
    const campo = screen.getByLabelText('Logradouro')

    // ACT
    await usuario.click(campo)
    await usuario.paste('a'.repeat(30))

    // ASSERT — na tela e na região viva
    expect(screen.getAllByText('Texto cortado no limite de 20 caracteres.').length).toBeGreaterThan(0)
    expect(screen.getByRole('status')).toHaveTextContent('Texto cortado no limite de 20 caracteres.')
    expect(campo).toHaveValue('a'.repeat(20))
  })

  it('NÃO deve manter o aviso de corte depois que a pessoa continua editando', async () => {
    // ARRANGE — o aviso fala do COLAR, não do estado do campo
    const usuario = userEvent.setup()
    render(<CampoComTeto limite={20} />)
    const campo = screen.getByLabelText('Logradouro')

    await usuario.click(campo)
    await usuario.paste('a'.repeat(30))
    expect(screen.getByRole('status')).toHaveTextContent('Texto cortado')

    // ACT
    await usuario.keyboard('{Backspace}')

    // ASSERT
    expect(screen.getByRole('status')).not.toHaveTextContent('Texto cortado')
  })

  it('NÃO deve avisar corte quando o texto colado CABE', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<CampoComTeto limite={100} />)

    // ACT
    await usuario.click(screen.getByLabelText('Logradouro'))
    await usuario.paste('Rua Fictícia das Acácias')

    // ASSERT
    expect(screen.queryByText(/Texto cortado/)).not.toBeInTheDocument()
  })

  it('NÃO deve apontar o campo para uma região de anúncio VAZIA', async () => {
    /*
     * ARRANGE — achado TETO-06, e é o defeito que o `temAjuda` do envelope nasceu para matar.
     *
     * O `aria-describedby` seguia o limiar do VISÍVEL e o conteúdo seguia o marco. Num campo
     * de 500 o visível acende com 50 restantes e o marco só com 50 também — mas antes desta
     * correção o marco começava em 10, e nos 40 caracteres de janela o campo apontava para
     * um parágrafo em branco.
     */
    const { unmount } = render(<CampoComTeto limite={500} inicial={'a'.repeat(400)} />)

    // ACT + ASSERT — longe do teto: nem contador, nem referência
    expect(screen.getByLabelText('Logradouro')).not.toHaveAttribute('aria-describedby')
    expect(screen.getByRole('status')).toHaveTextContent('')
    unmount()

    // dentro da faixa de aviso: há texto, e a referência aponta para ele
    render(<CampoComTeto limite={500} inicial={'a'.repeat(460)} />)
    const regiao = screen.getByRole('status')
    expect(regiao.textContent).not.toBe('')
    expect(screen.getByLabelText('Logradouro').getAttribute('aria-describedby')).toBe(regiao.id)
  })

  it('deve dar a MESMA antecedência a quem vê e a quem ouve', async () => {
    // ARRANGE — achado TETO-07: num campo de 500, o aviso visual acendia com 50 restantes e o
    // auditivo só com 10 — um quinto da antecedência para quem depende de leitor de tela
    render(<CampoComTeto limite={500} inicial={'a'.repeat(455)} />)

    // ASSERT — os dois canais falam, no mesmo instante
    expect(screen.getByText('45 caracteres restantes')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Faltam 50 caracteres ou menos')
  })

  it('deve DIZER o excesso quando o valor gravado passa do teto', async () => {
    /*
     * ARRANGE — achados MENOR 4 e MENOR 5, nesta ordem. `maxLength` impede DIGITAR além, não
     * trunca o que já veio do banco; a primeira versão renderizava "-12 caracteres restantes",
     * e o piso em 0 que a substituiu trocou o número feio por uma frase que MENTE: "0
     * restantes" diz "coube exatamente" enquanto o salvar responde "tem 22; o limite é 10".
     */
    render(<CampoComTeto limite={10} inicial={'a'.repeat(22)} />)

    // ASSERT — na tela e no anúncio, o excesso real
    expect(screen.getByText('12 caracteres a mais do que o limite.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('12 caracteres a mais do que o limite de 10.')
    expect(screen.queryByText(/-\d+ caracteres/)).not.toBeInTheDocument()
    expect(screen.queryByText(/0 caracteres restantes/)).not.toBeInTheDocument()
  })

  it('NÃO deve apagar o maxLength que o CONSUMIDOR passou', async () => {
    /*
     * ARRANGE — regressão achada pelo gate (TETO-03). O espalhamento de props passou a vir
     * antes, e `maxLength={limite}` com `limite` indefinido sobrescrevia o teto do consumidor
     * com `undefined`. Dois campos fora do cadastro — documento do lançamento (60) e motivo
     * da evolução (500) — perderam a trava que já tinham.
     */
    const usuario = userEvent.setup()
    render(<CampoTexto rotulo="Documento" maxLength={5} defaultValue="" />)
    const campo = screen.getByLabelText('Documento')

    // ACT
    await usuario.click(campo)
    await usuario.paste('abcdefghij')

    // ASSERT
    expect(campo).toHaveAttribute('maxlength', '5')
    expect(campo).toHaveValue('abcde')
  })

  it('NÃO deve mudar nada em campo SEM teto', async () => {
    // ARRANGE — nenhuma das telas existentes muda de comportamento
    const usuario = userEvent.setup()
    render(<CampoComTeto />)

    // ACT
    await usuario.type(screen.getByLabelText('Logradouro'), 'a'.repeat(50))

    // ASSERT
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Logradouro')).not.toHaveAttribute('maxlength')
    expect(screen.getByLabelText('Logradouro')).toHaveValue('a'.repeat(50))
  })
})

describe('CampoTexto', () => {
  it('deve ligar o rótulo ao controle via label htmlFor', () => {
    // ARRANGE + ACT
    render(<CampoTexto rotulo="Nome do responsável" />)

    // ASSERT: acessível pelo nome do rótulo (3.3.2 — placeholder nunca substitui)
    expect(screen.getByLabelText('Nome do responsável')).toBeInTheDocument()
  })

  it('deve anexar ajuda e erro via aria-describedby e marcar aria-invalid', () => {
    // ARRANGE + ACT
    render(<CampoTexto rotulo="CPF" ajuda="Somente números" erro="CPF inválido" />)
    const campo = screen.getByLabelText('CPF')

    // ASSERT: erro com role=alert + descrição composta (ajuda + erro)
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    const descricao = campo.getAttribute('aria-describedby') ?? ''
    expect(descricao.split(' ')).toHaveLength(2)
    expect(screen.getByRole('alert')).toHaveTextContent('CPF inválido')
    expect(screen.getByText('Somente números')).toBeInTheDocument()
  })

  it('deve sinalizar obrigatório em texto e no atributo required', () => {
    // ARRANGE + ACT
    render(<CampoTexto rotulo="Nome" obrigatorio />)

    // ASSERT: sufixo textual, não só asterisco (contrato §5.3)
    expect(screen.getByText('(obrigatório)')).toBeInTheDocument()
    expect(screen.getByLabelText(/Nome/)).toBeRequired()
  })

  it('deve renderizar conteúdo malicioso como texto literal', () => {
    // ARRANGE: payload de stored XSS vindo de dado (T-ds-01)
    const payload = '<script>alert(1)</script>'

    // ACT: o erro (texto de dado) renderiza escapado
    render(<CampoTexto rotulo="Observação" erro={payload} />)

    // ASSERT: literal na tela, nunca interpretado
    expect(screen.getByRole('alert')).toHaveTextContent(payload)
    expect(document.querySelector('script')).toBeNull()
  })

  it('deve aceitar type password com autocomplete para campos de senha', () => {
    // ARRANGE + ACT: contrato T-ds-04 (parecer §5.6)
    render(<CampoTexto rotulo="Senha" type="password" autoComplete="current-password" />)
    const campo = screen.getByLabelText('Senha')

    // ASSERT
    expect(campo).toHaveAttribute('type', 'password')
    expect(campo).toHaveAttribute('autocomplete', 'current-password')
  })

  it('deve aplicar a altura do tamanho lg', () => {
    // ARRANGE + ACT
    render(<CampoTexto rotulo="Nome" tamanho="lg" />)

    // ASSERT: alvo primário ≥ 44px (h-11)
    expect(screen.getByLabelText('Nome')).toHaveClass('h-11')
  })
})

describe('CampoTexto — ação na linha do controle', () => {
  it('deve pôr a ação ao lado do campo, com o rótulo acima e a ajuda e o erro abaixo da linha', () => {
    // ARRANGE + ACT — o "Salvar" das configurações: o rótulo de duas linhas no celular e a ajuda não
    // podem descer nem subir o botão (gate r3 de inicio-dos-indicadores)
    render(
      <CampoTexto
        rotulo="Apagar cadastro não conferido depois de (dias)"
        ajuda="Uma frase de ajuda."
        erro="Um erro."
        acaoAoLado={<button type="button">Salvar</button>}
      />,
    )

    // ASSERT — a linha é só campo + ação
    const linha = screen.getByRole('button', { name: 'Salvar' }).parentElement
    expect(linha).toContainElement(screen.getByLabelText('Apagar cadastro não conferido depois de (dias)'))
    expect(linha).not.toContainElement(screen.getByText('Apagar cadastro não conferido depois de (dias)'))
    expect(linha).not.toContainElement(screen.getByText('Uma frase de ajuda.'))
    expect(linha).not.toContainElement(screen.getByText('Um erro.'))
  })
})

