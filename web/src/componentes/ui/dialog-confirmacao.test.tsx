import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'

// Harness controlado: gatilho real para verificar abertura e retorno de foco
function Harness({ aoConfirmar }: { aoConfirmar: () => void | Promise<void> }) {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAberto(true)
        }}
      >
        Desmarcar sessão
      </button>
      <DialogConfirmacao
        aberto={aberto}
        aoMudarAberto={setAberto}
        titulo="Desmarcar a sessão de Ana S. — qui 14:00?"
        consequencia="Os 11 agendamentos futuros da série também serão desmarcados. O saldo de sessões não será descontado."
        rotuloConfirmar="Desmarcar série"
        aoConfirmar={aoConfirmar}
      />
    </>
  )
}

async function abrirDialog(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(screen.getByRole('button', { name: 'Desmarcar sessão' }))
  return screen.getByRole('alertdialog')
}

describe('DialogConfirmacao', () => {
  it('deve nomear o alvo e a consequência explícita no dialog', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<Harness aoConfirmar={vi.fn()} />)

    // ACT
    const dialog = await abrirDialog(usuario)

    // ASSERT: título nomeia o alvo; consequência descrita (aria-describedby via Radix)
    expect(dialog).toHaveTextContent('Desmarcar a sessão de Ana S. — qui 14:00?')
    expect(dialog).toHaveTextContent(/11 agendamentos futuros/)
    expect(dialog).toHaveAttribute('aria-describedby')
  })

  it('deve colocar o foco inicial no Cancelar (ação segura)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<Harness aoConfirmar={vi.fn()} />)

    // ACT
    await abrirDialog(usuario)

    // ASSERT: T-ds-06 — nunca no confirmar
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
  })

  it('deve não confirmar com Enter no mount', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoConfirmar = vi.fn()
    render(<Harness aoConfirmar={aoConfirmar} />)

    // ACT: Enter imediato após abrir (clique fantasma/Enter acidental)
    await abrirDialog(usuario)
    await usuario.keyboard('{Enter}')

    // ASSERT: aciona o Cancelar focado — a ação nunca executa
    expect(aoConfirmar).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('deve manter o foco preso dentro do dialog (focus trap)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<Harness aoConfirmar={vi.fn()} />)
    const dialog = await abrirDialog(usuario)

    // ACT: Tab circula várias vezes
    for (let volta = 0; volta < 4; volta++) {
      await usuario.tab()

      // ASSERT: o foco nunca escapa para a página por baixo (contenção T-ds-06)
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('deve cancelar com Escape sem executar e devolver o foco ao gatilho', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoConfirmar = vi.fn()
    render(<Harness aoConfirmar={aoConfirmar} />)
    await abrirDialog(usuario)

    // ACT
    await usuario.keyboard('{Escape}')

    // ASSERT: fecha sem executar; foco retorna ao disparador (2.4.3)
    expect(aoConfirmar).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desmarcar sessão' })).toHaveFocus()
  })

  it('deve executar a ação e fechar ao confirmar explicitamente', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoConfirmar = vi.fn()
    render(<Harness aoConfirmar={aoConfirmar} />)
    await abrirDialog(usuario)

    // ACT: clique consciente no botão de perigo nomeado (verbo + alvo)
    await usuario.click(screen.getByRole('button', { name: 'Desmarcar série' }))

    // ASSERT
    expect(aoConfirmar).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('deve manter o dialog aberto sem rejeição não tratada quando aoConfirmar falha', async () => {
    // ARRANGE: a ação assíncrona falha (ex.: 500 ao desmarcar a série)
    const usuario = userEvent.setup()
    const aoConfirmar = vi.fn().mockRejectedValue(new Error('falha de rede'))
    const aoRejeitar = vi.fn()
    window.addEventListener('unhandledrejection', aoRejeitar)
    render(<Harness aoConfirmar={aoConfirmar} />)
    await abrirDialog(usuario)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Desmarcar série' }))

    // ASSERT: dialog segue aberto para nova tentativa e nada escapa como
    // unhandled (o consumidor reflete o erro no toast/formulário)
    expect(aoConfirmar).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(aoRejeitar).not.toHaveBeenCalled()
    window.removeEventListener('unhandledrejection', aoRejeitar)
  })

  it('deve travar cancelamento e Escape enquanto carregando', async () => {
    // ARRANGE: dialog aberto em estado carregando
    const usuario = userEvent.setup()
    render(
      <DialogConfirmacao
        aberto
        aoMudarAberto={vi.fn()}
        titulo="Excluir o convênio Unimed?"
        consequencia="Esta ação não pode ser desfeita."
        rotuloConfirmar="Excluir convênio"
        aoConfirmar={vi.fn()}
        carregando
      />,
    )

    // ACT + ASSERT: Cancelar desabilitado; Esc não fecha
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    await usuario.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('deve usar botão primário no tom atenção (mudança de regra)', () => {
    // ARRANGE + ACT
    render(
      <DialogConfirmacao
        aberto
        aoMudarAberto={vi.fn()}
        titulo="Ativar desconto de sessão no status Consulta?"
        consequencia="Novos agendamentos com este status passarão a descontar do saldo."
        rotuloConfirmar="Ativar desconto"
        tom="atencao"
        aoConfirmar={vi.fn()}
      />,
    )

    // ASSERT: perigo é exclusivo de destrutivas (§8.3)
    expect(screen.getByRole('button', { name: 'Ativar desconto' })).toHaveClass('bg-botao-primario')
  })
})

describe('DialogConfirmacao — a confirmação DIGITADA', () => {
  it('deve manter o confirmar desabilitado até a palavra exata ser digitada', async () => {
    // ARRANGE: o erro que esta confirmação existe para pegar é, ele próprio, um CLIQUE
    // ERRADO (trocar a criança no autocomplete). Um "tem certeza?" de um clique é
    // respondido pelo mesmo reflexo que causou o engano.
    const usuario = userEvent.setup()
    const aoConfirmar = vi.fn()
    render(
      <DialogConfirmacao
        aberto
        aoMudarAberto={vi.fn()}
        titulo="Corrigir a criança deste agendamento?"
        consequencia="De Ana S. para Bruno S."
        rotuloConfirmar="Corrigir paciente"
        palavraDeConfirmacao="CORRIGIR"
        aoConfirmar={aoConfirmar}
      />,
    )
    const confirmar = screen.getByRole('button', { name: 'Corrigir paciente' })
    const campo = screen.getByRole('textbox', { name: /Digite CORRIGIR/i })

    // ASSERT: nasce travado — `aria-disabled` (focável) e não `disabled`: a ação
    // primária continua na sequência de Tab para poder DIZER o que falta (IMP-4)
    expect(confirmar).toHaveAttribute('aria-disabled', 'true')
    expect(confirmar).toHaveAccessibleDescription(/Digite CORRIGIR no campo acima/)

    // ACT: texto PARECIDO não serve — é a diferença entre ler e reconhecer a forma
    await usuario.type(campo, 'corrigi')
    expect(confirmar).toHaveAttribute('aria-disabled', 'true')

    // ACT: clicar o botão travado não confirma — a inércia é da guarda, não do `disabled`
    await usuario.click(confirmar)
    expect(aoConfirmar).not.toHaveBeenCalled()

    // ACT: a palavra exata
    await usuario.clear(campo)
    await usuario.type(campo, 'CORRIGIR')

    // ASSERT
    expect(confirmar).not.toHaveAttribute('aria-disabled')
    await usuario.click(confirmar)
    expect(aoConfirmar).toHaveBeenCalledTimes(1)
  })

  it('deve esquecer o texto ao fechar — reabrir nunca nasce pré-confirmado', async () => {
    // ARRANGE: se o texto sobrevivesse ao fechamento, a SEGUNDA troca de criança sairia
    // com um clique — e a barreira teria protegido só a primeira.
    const usuario = userEvent.setup()
    function Harness() {
      const [aberto, setAberto] = useState(true)
      return (
        <>
          <button type="button" onClick={() => { setAberto(true) }}>Abrir</button>
          <DialogConfirmacao
            aberto={aberto}
            aoMudarAberto={setAberto}
            titulo="Corrigir a criança deste agendamento?"
            consequencia="De Ana S. para Bruno S."
            rotuloConfirmar="Corrigir paciente"
            palavraDeConfirmacao="CORRIGIR"
            aoConfirmar={vi.fn()}
          />
        </>
      )
    }
    render(<Harness />)

    // ACT: digita, cancela, reabre
    await usuario.type(screen.getByRole('textbox', { name: /Digite CORRIGIR/i }), 'CORRIGIR')
    expect(screen.getByRole('button', { name: 'Corrigir paciente' })).not.toHaveAttribute('aria-disabled')
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))
    await usuario.click(screen.getByRole('button', { name: 'Abrir' }))

    // ASSERT: campo vazio, botão travado de novo
    expect(screen.getByRole('textbox', { name: /Digite CORRIGIR/i })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Corrigir paciente' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('deve continuar sem campo nenhum quando a palavra não é exigida', () => {
    // ARRANGE: fricção que aparece onde o risco NÃO está vira ruído, e o usuário
    // aprende a atravessá-la sem ler — inclusive onde ela importa.
    render(
      <DialogConfirmacao
        aberto
        aoMudarAberto={vi.fn()}
        titulo="Desmarcar a sessão de Ana S.?"
        consequencia="A sessão volta ao saldo do pacote."
        rotuloConfirmar="Desmarcar sessão"
        aoConfirmar={vi.fn()}
      />,
    )

    // ASSERT
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desmarcar sessão' })).not.toHaveAttribute('aria-disabled')
  })
})

describe('DialogConfirmacao — os campos que a própria decisão exige', () => {
  it('deve renderizar os campos do consumidor ANTES da palavra digitada', () => {
    // ARRANGE: a reabertura de ciclo exige um MOTIVO, e ele faz parte da decisão (vai
    // para a trilha). Pôr esse campo no fundo da tela, atrás do diálogo, é o mesmo
    // defeito que o `erros` já conserta: a pessoa está olhando para o diálogo.
    render(
      <DialogConfirmacao
        aberto
        aoMudarAberto={vi.fn()}
        titulo="Reabrir o período?"
        consequencia="O período volta a aceitar edição."
        rotuloConfirmar="Reabrir período"
        palavraDeConfirmacao="REABRIR"
        aoConfirmar={vi.fn()}
      >
        <label htmlFor="motivo-fake">Motivo</label>
        <input id="motivo-fake" type="text" />
      </DialogConfirmacao>,
    )

    // ACT
    const campos = screen.getAllByRole('textbox')

    // ASSERT: o motivo vem primeiro; a palavra é o ÚLTIMO gesto antes de confirmar
    expect(campos).toHaveLength(2)
    expect(campos[0]).toHaveAccessibleName('Motivo')
    expect(campos[1]).toHaveAccessibleName(/Digite REABRIR/i)
  })

  it('deve travar o confirmar enquanto o consumidor disser que ainda não pode', async () => {
    // ARRANGE: a palavra digitada prova INTENÇÃO — ela não prova que os campos foram
    // preenchidos. Sem esta trava, "REABRIR" com motivo em branco chegaria ao servidor
    // só para voltar 422, e a exigência estaria escrita na tela sem ser exigida.
    const usuario = userEvent.setup()
    const aoConfirmar = vi.fn()
    const { rerender } = render(
      <DialogConfirmacao
        aberto
        aoMudarAberto={vi.fn()}
        titulo="Reabrir o período?"
        consequencia="O período volta a aceitar edição."
        rotuloConfirmar="Reabrir período"
        palavraDeConfirmacao="REABRIR"
        podeConfirmar={false}
        aoConfirmar={aoConfirmar}
      />,
    )

    // ACT: a palavra exata, com a trava do consumidor ainda de pé
    await usuario.type(screen.getByRole('textbox', { name: /Digite REABRIR/i }), 'REABRIR')

    // ASSERT
    expect(screen.getByRole('button', { name: 'Reabrir período' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    // ACT: o consumidor libera (o motivo foi escrito)
    rerender(
      <DialogConfirmacao
        aberto
        aoMudarAberto={vi.fn()}
        titulo="Reabrir o período?"
        consequencia="O período volta a aceitar edição."
        rotuloConfirmar="Reabrir período"
        palavraDeConfirmacao="REABRIR"
        podeConfirmar
        aoConfirmar={aoConfirmar}
      />,
    )

    // ASSERT
    const confirmar = screen.getByRole('button', { name: 'Reabrir período' })
    expect(confirmar).not.toHaveAttribute('aria-disabled')
    await usuario.click(confirmar)
    expect(aoConfirmar).toHaveBeenCalledTimes(1)
  })
})

describe('DialogConfirmacao — o diálogo alto continua alcançável (1.4.4/1.4.10)', () => {
  /**
   * O defeito: `fixed` + `-translate-y-1/2` sem `max-h` não gera rolagem NENHUMA — nem de
   * página, nem de diálogo. O que passa da viewport fica inalcançável, e o que passa
   * primeiro é justamente a linha Cancelar/Confirmar. O diálogo de reabertura (o primeiro
   * com `children`) é o mais alto do app: ~601px, ~677px com erro — corta em 390×640 e
   * corta com certeza em zoom 200%. O molde correto já existia no irmão `Dialog`.
   */
  function renderizarAlto() {
    return render(
      <DialogConfirmacao
        aberto
        aoMudarAberto={vi.fn()}
        titulo="Reabrir o período de 16/05/2026 a 15/06/2026 de Convênio Fictício?"
        consequencia={'O período volta a aceitar edição. '.repeat(20)}
        rotuloConfirmar="Reabrir período"
        palavraDeConfirmacao="REABRIR"
        erros={['Este ciclo já foi reaberto.']}
        aoConfirmar={vi.fn()}
      >
        <p>Um campo alto qualquer da decisão.</p>
      </DialogConfirmacao>,
    )
  }

  it('deve limitar a ALTURA do diálogo à viewport, com o corpo rolável', () => {
    // ARRANGE + ACT
    renderizarAlto()
    const dialogo = screen.getByRole('alertdialog')

    // ASSERT: o teto e a goteira lateral vêm do molde do `Dialog` (dialog.tsx)
    expect(dialogo.className).toContain('max-h-[85vh]')
    expect(dialogo.className).toContain('w-[calc(100%-2rem)]')

    // e existe UMA região rolável dentro dele — sem ela o `max-h` só cortaria o conteúdo
    const rolavel = dialogo.querySelector('.overflow-y-auto')
    expect(rolavel).not.toBeNull()
    expect(rolavel?.className).toContain('min-h-0')
    expect(rolavel?.className).toContain('flex-1')
  })

  it('deve manter a decisão FORA da área que rola — Cancelar e Confirmar nunca somem', () => {
    // ARRANGE + ACT
    renderizarAlto()
    const dialogo = screen.getByRole('alertdialog')
    const rolavel = dialogo.querySelector('.overflow-y-auto')

    // ASSERT: os dois botões vivem no rodapé fixo, não no corpo que rola
    for (const rotulo of ['Cancelar', 'Reabrir período']) {
      const botao = screen.getByRole('button', { name: rotulo })
      expect(dialogo).toContainElement(botao)
      expect(rolavel?.contains(botao)).toBe(false)
    }

    // o texto longo e a recusa do servidor, sim, rolam
    expect(rolavel).toHaveTextContent('Este ciclo já foi reaberto.')
  })
})
