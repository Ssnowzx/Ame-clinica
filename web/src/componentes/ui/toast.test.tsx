import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { Botao } from '@/componentes/ui/botao'
import { ProvedorToast, usarToast, type OpcoesToast } from '@/componentes/ui/toast'
import { fingirTelaAbaixoDeLg } from '@/test/setup'

function Disparador(opcoes: OpcoesToast) {
  const { notificar } = usarToast()
  return (
    <Botao
      onClick={() => {
        notificar(opcoes)
      }}
    >
      Notificar
    </Botao>
  )
}

/** Vários toasts no MESMO tique, como a agenda faz ao criar um agendamento. */
function DisparadorEmSequencia({ avisos }: { avisos: OpcoesToast[] }) {
  const { notificar } = usarToast()
  return (
    <Botao
      onClick={() => {
        avisos.forEach((aviso) => notificar(aviso))
      }}
    >
      Notificar em sequência
    </Botao>
  )
}

function SegundoDisparador() {
  const { notificar } = usarToast()
  return (
    <Botao
      onClick={() => {
        notificar({ tom: 'sucesso', titulo: 'Segundo aviso' })
      }}
    >
      Notificar de novo
    </Botao>
  )
}

function renderComProvedor(opcoes: OpcoesToast) {
  return render(
    <ProvedorToast>
      <Disparador {...opcoes} />
    </ProvedorToast>,
  )
}

/**
 * Região aria-live que o Radix cria para anunciar o toast (≠ painel visual).
 * O texto só entra no frame seguinte à abertura (useNextFrame) — por isso o waitFor.
 */
async function regiaoDeAnuncio(texto: string): Promise<HTMLElement> {
  return waitFor(() => {
    const regiao = [...document.querySelectorAll('[aria-live]')].find((elemento) =>
      elemento.textContent?.includes(texto),
    )
    if (regiao === undefined) {
      throw new Error(`nenhuma região aria-live anunciando "${texto}"`)
    }
    return regiao as HTMLElement
  })
}

describe('Toast', () => {
  it('deve mostrar a tripla da agenda UM DE CADA VEZ abaixo de lg, sem perder o aviso de sobreposição', async () => {
    // ARRANGE — a agenda emite três toasts no mesmo tique, e o do meio é o ÚNICO registro de que a
    // criança já tem outro atendimento (D4 da conflito-do-paciente). Substituir apagava justo ele
    // (CRL3-01). Prova por mutação: com substituição, só o último aparece; sem fila, os três juntos
    fingirTelaAbaixoDeLg(true)
    const usuario = userEvent.setup()
    render(
      <ProvedorToast>
        <DisparadorEmSequencia
          avisos={[
            { tom: 'sucesso', titulo: 'Agendamento criado.' },
            { tom: 'aviso', titulo: 'Atenção: esta criança já tem outro atendimento neste horário.' },
            { tom: 'sucesso', titulo: 'Aviso enviado ao WhatsApp da família.' },
          ]}
        />
      </ProvedorToast>,
    )

    // ACT + ASSERT — um por vez, na ordem; cada um entra quando o anterior fecha
    await usuario.click(screen.getByRole('button', { name: 'Notificar em sequência' }))
    expect(await screen.findByText('Agendamento criado.')).toBeInTheDocument()
    expect(screen.queryByText(/já tem outro atendimento/)).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Fechar notificação' }))
    expect(await screen.findByText('Atenção: esta criança já tem outro atendimento neste horário.')).toBeInTheDocument()
    expect(screen.queryByText('Agendamento criado.')).not.toBeInTheDocument()
    expect(screen.queryByText('Aviso enviado ao WhatsApp da família.')).not.toBeInTheDocument()
    // e o leitor de tela o anuncia quando ele ENTRA — não só o primeiro da fila
    expect(await regiaoDeAnuncio('já tem outro atendimento')).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Fechar notificação' }))
    expect(await screen.findByText('Aviso enviado ao WhatsApp da família.')).toBeInTheDocument()
  })

  it('NÃO deve perder o erro quando um sucesso chega logo depois, e deve respeitar a duração de cada um', async () => {
    // ARRANGE — o erro fica 8 s na tela e o sucesso, 5 s. Na fila, o sucesso espera o erro sair
    vi.useFakeTimers({ shouldAdvanceTime: true })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    fingirTelaAbaixoDeLg(true)
    render(
      <ProvedorToast>
        <DisparadorEmSequencia
          avisos={[
            { tom: 'erro', titulo: 'Não foi possível salvar.' },
            { tom: 'sucesso', titulo: 'Preferência salva.' },
          ]}
        />
      </ProvedorToast>,
    )

    // ACT
    fireEvent.click(screen.getByRole('button', { name: 'Notificar em sequência' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    // ASSERT — aos 5 s o erro ainda está na tela (prova por mutação: com substituição, some já)
    expect(screen.getByText('Não foi possível salvar.')).toBeInTheDocument()
    expect(screen.queryByText('Preferência salva.')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_500)
    })
    expect(screen.queryByText('Não foi possível salvar.')).not.toBeInTheDocument()
    expect(screen.getByText('Preferência salva.')).toBeInTheDocument()
  })

  it('deve empilhar os toasts em tela larga, como sempre', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(
      <ProvedorToast>
        <Disparador tom="sucesso" titulo="Primeiro aviso" />
        <SegundoDisparador />
      </ProvedorToast>,
    )

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Notificar' }))
    await usuario.click(screen.getByRole('button', { name: 'Notificar de novo' }))

    // ASSERT
    expect(await screen.findByText('Segundo aviso')).toBeInTheDocument()
    expect(screen.getByText('Primeiro aviso')).toBeInTheDocument()
  })

  it('deve caber na tela estreita e subir para o topo abaixo de lg', () => {
    // ARRANGE — `w-96` fixo dava 384 px num celular de 320 (A11Y-CL-05), e embaixo o aviso cobria
    // o campo de escrever da conversa (A11Y-CL-06). O jsdom não aplica media query nem calcula
    // largura: o que se confere é a classe; a medida (320 px) foi feita no navegador
    renderComProvedor({ tom: 'sucesso', titulo: 'Salvo' })

    // ACT
    const viewport = screen.getByRole('region', { name: /Notificações/ }).querySelector('ol')

    // ASSERT — prova por mutação: voltar a `w-96`, ou tirar o `max-lg:top-3`, derruba o teste
    expect(viewport).toHaveClass('w-[min(24rem,calc(100vw-2rem))]', 'max-lg:top-3', 'max-lg:bottom-auto')
    expect(viewport).not.toHaveClass('w-96')
  })

  it('deve exibir título e descrição ao notificar', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderComProvedor({ tom: 'sucesso', titulo: 'Agendamento salvo', descricao: 'A série foi criada.' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Notificar' }))

    // ASSERT
    expect(screen.getByText('Agendamento salvo')).toBeInTheDocument()
    expect(screen.getByText('A série foi criada.')).toBeInTheDocument()
  })

  it('deve anunciar sucesso de forma polite (nunca interrompe o leitor de tela)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderComProvedor({ tom: 'sucesso', titulo: 'Salvo' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Notificar' }))

    // ASSERT: é a região de ANÚNCIO do Radix (aria-live) que define a
    // politeness — o role do painel sozinho passaria mesmo com assertive
    expect(await regiaoDeAnuncio('Salvo')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('Salvo')).toBeInTheDocument()
  })

  it('deve anunciar aviso de forma polite', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderComProvedor({ tom: 'aviso', titulo: 'Restam 2 sessões' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Notificar' }))

    // ASSERT
    expect(await regiaoDeAnuncio('Restam 2 sessões')).toHaveAttribute('aria-live', 'polite')
  })

  it('deve anunciar erro de forma assertiva (único tom que interrompe)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderComProvedor({ tom: 'erro', titulo: 'Falha ao salvar o agendamento' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Notificar' }))

    /*
     * ASSERT: o anúncio assertivo sai da região do Radix, governada pelo `type` — e é ELE
     * que prova a interrupção. O `role="alert"` que existia no `<li>` foi REMOVIDO (achado
     * A11Y-RCD-10): ele era redundante para o anúncio e quebrava a semântica do `<ol>` do
     * viewport, com o axe acusando `serious` em toda tela que mostrasse um toast.
     *
     * O painel continua na tela e continua legível — só não finge ser uma região viva por
     * conta própria.
     */
    expect(await regiaoDeAnuncio('Falha ao salvar o agendamento')).toHaveAttribute('aria-live', 'assertive')
    expect(screen.getByText('Falha ao salvar o agendamento')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('deve fechar pelo botão com rótulo acessível', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderComProvedor({ tom: 'aviso', titulo: 'Sessões quase no fim' })
    await usuario.click(screen.getByRole('button', { name: 'Notificar' }))

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Fechar notificação' }))

    // ASSERT
    expect(screen.queryByText('Sessões quase no fim')).not.toBeInTheDocument()
  })

  it('deve renderizar título malicioso como texto literal', async () => {
    // ARRANGE: contrato de string plana (T-ds-01/T-ds-05)
    const usuario = userEvent.setup()
    const payload = '<script>alert(1)</script>'
    renderComProvedor({ tom: 'erro', titulo: payload })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Notificar' }))

    // ASSERT
    expect(screen.getByText(payload)).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
  })

  it('deve lançar erro claro quando usarToast é chamado fora do provedor', () => {
    // ARRANGE: componente sem <ProvedorToast> acima
    const Solto = () => {
      usarToast()
      return null
    }

    // ACT + ASSERT
    expect(() => render(<Solto />)).toThrow(/ProvedorToast/)
  })
})
