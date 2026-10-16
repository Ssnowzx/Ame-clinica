import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { CampoDoTelefone } from '@/componentes/pacientes/campo-do-telefone'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { TelefoneEmUso } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * O país antes do número (change telefone-estrangeiro, tarefa 1.3b). Números 100% fictícios: os do
 * Reino Unido são da faixa `+44 7700 900xxx`, reservada pela Ofcom para ficção.
 */

interface CampoControladoProps {
  inicial?: string
  tipo?: string
  limite?: number
  conferirRepetido?: boolean
  disabled?: boolean
  /** Cada valor que o campo mandou gravar, em ordem */
  gravados?: string[]
}

function CampoControlado({ inicial = '', tipo, limite, conferirRepetido = false, disabled, gravados }: CampoControladoProps) {
  const [valor, setValor] = useState(inicial)

  return (
    <QueryClientProvider client={queryClient}>
      <CampoDoTelefone
        rotulo="Telefone"
        value={valor}
        tipo={tipo}
        limite={limite}
        conferirRepetido={conferirRepetido}
        disabled={disabled}
        aoMudar={(novo) => {
          gravados?.push(novo)
          setValor(novo)
        }}
      />
      <button type="button">Depois do campo</button>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  queryClient.clear()
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: ['pacientes.ver'] }, carregandoSessao: false })
})

function seletorDoPais(): HTMLSelectElement {
  const seletor = screen.getByRole('combobox', { name: 'País do telefone' })
  if (!(seletor instanceof HTMLSelectElement)) {
    throw new Error('o país do telefone não é um <select>')
  }

  return seletor
}

function campoDoNumero(): HTMLInputElement {
  const campo = screen.getByRole('textbox', { name: /Telefone/ })
  if (!(campo instanceof HTMLInputElement)) {
    throw new Error('o campo do número não está na tela')
  }

  return campo
}

/** A região de status do campo — montada vazia com ele. */
function regiaoDoAviso(): HTMLElement {
  const envelope = campoDoNumero().closest('div.flex.flex-col')?.parentElement
  const regiao = envelope?.lastElementChild
  if (!(regiao instanceof HTMLElement) || regiao.getAttribute('role') !== 'status') {
    throw new Error('a região de status do telefone não está onde deveria')
  }

  return regiao
}

describe('CampoDoTelefone — o país antes do número', () => {
  it('deve abrir no Brasil e gravar o número brasileiro exatamente como foi digitado', async () => {
    // ARRANGE
    const gravados: string[] = []
    render(<CampoControlado gravados={gravados} />)

    // ACT
    await userEvent.type(campoDoNumero(), '(11) 98765-4321')

    // ASSERT — o caso comum não muda: nada de prefixo no que se grava
    expect(seletorDoPais()).toHaveDisplayValue('Brasil +55')
    expect(gravados.at(-1)).toBe('(11) 98765-4321')
  })

  it('deve gravar o +44 na frente ao escolher o Reino Unido, e mostrar no campo só o número', async () => {
    // ARRANGE
    const gravados: string[] = []
    render(<CampoControlado gravados={gravados} />)

    // ACT
    await userEvent.selectOptions(seletorDoPais(), 'GB')
    await userEvent.type(campoDoNumero(), '7700 900123')
    await userEvent.tab()

    // ASSERT
    expect(gravados.at(-1)).toBe('+44 7700 900123')
    expect(campoDoNumero()).toHaveValue('7700 900123')
    await waitFor(() => {
      expect(campoDoNumero()).toHaveAccessibleDescription('WhatsApp: +447700900123')
    })
  })

  it('deve levar para o país escolhido o número que já estava digitado', async () => {
    // ARRANGE
    const gravados: string[] = []
    render(<CampoControlado inicial="7700 900123" gravados={gravados} />)

    // ACT
    await userEvent.selectOptions(seletorDoPais(), 'GB')

    // ASSERT
    expect(gravados).toEqual(['+44 7700 900123'])
    expect(campoDoNumero()).toHaveValue('7700 900123')
  })

  it('deve abrir o número gravado com +44 no Reino Unido', () => {
    // ARRANGE + ACT
    render(<CampoControlado inicial="+44 7700 900123" />)

    // ASSERT — o cenário "abrir um +44… com o país certo" da tarefa 1.3b
    expect(seletorDoPais()).toHaveValue('GB')
    expect(seletorDoPais()).toHaveDisplayValue('Reino Unido +44')
    expect(campoDoNumero()).toHaveValue('7700 900123')
    expect(campoDoNumero()).toHaveAccessibleDescription('WhatsApp: +447700900123')
  })

  it('deve abrir o +1 nos Estados Unidos, o primeiro dos dois países do código', () => {
    // ARRANGE + ACT
    render(<CampoControlado inicial="+1 202 555 0143" />)

    // ASSERT
    expect(seletorDoPais()).toHaveValue('US')
  })

  it('deve seguir o país quando o valor muda por fora do campo', () => {
    // ARRANGE — as listas identificam o contato pela posição: remover o de cima traz outro valor
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <CampoDoTelefone rotulo="Telefone" value="+44 7700 900123" aoMudar={() => undefined} />
      </QueryClientProvider>,
    )

    // ACT
    rerender(
      <QueryClientProvider client={queryClient}>
        <CampoDoTelefone rotulo="Telefone" value="(49) 99123-4567" aoMudar={() => undefined} />
      </QueryClientProvider>,
    )

    // ASSERT
    expect(seletorDoPais()).toHaveValue('BR')
    expect(campoDoNumero()).toHaveValue('(49) 99123-4567')
  })

  it('deve avisar, ao sair do campo, os dígitos que faltam para o país escolhido', async () => {
    // ARRANGE
    render(<CampoControlado />)
    const regiao = regiaoDoAviso()

    // ACT
    await userEvent.selectOptions(seletorDoPais(), 'GB')
    await userEvent.type(campoDoNumero(), '7700 9001')
    await userEvent.tab()

    // ASSERT — na descrição do campo e na região de voz, antes de salvar
    const esperado = 'Faltam 2 dígitos: um número do Reino Unido tem 10 depois do +44.'
    await waitFor(() => {
      expect(campoDoNumero()).toHaveAccessibleDescription(esperado)
    })
    await waitFor(() => {
      expect(regiao).toHaveTextContent(esperado)
    })
  })

  it('deve ler o +código digitado no Brasil e trocar a bandeira só depois de sair do campo', async () => {
    // ARRANGE
    const gravados: string[] = []
    render(<CampoControlado gravados={gravados} />)

    // ACT
    await userEvent.type(campoDoNumero(), '+351 912 345 678')

    // ASSERT — no meio da digitação nada pula: o campo mostra o que foi digitado
    expect(campoDoNumero()).toHaveValue('+351 912 345 678')
    expect(seletorDoPais()).toHaveValue('BR')

    // ACT
    await userEvent.tab()

    // ASSERT — o valor gravado é o mesmo; a bandeira passa a de Portugal
    await waitFor(() => {
      expect(seletorDoPais()).toHaveValue('PT')
    })
    expect(campoDoNumero()).toHaveValue('912 345 678')
    expect(gravados.at(-1)).toBe('+351 912 345 678')
  })

  it('deve gravar o código digitado à mão com um país escolhido sem repeti-lo', async () => {
    // ARRANGE — quem já escolheu o Reino Unido e digita "+44" por hábito
    const gravados: string[] = []
    render(<CampoControlado gravados={gravados} />)
    await userEvent.selectOptions(seletorDoPais(), 'GB')

    // ACT
    await userEvent.type(campoDoNumero(), '+44 7700 900123')

    // ASSERT — nem `+44 +44 …`, nem o "+44" sumindo debaixo dos dedos
    expect(gravados.at(-1)).toBe('+44 7700 900123')
    expect(campoDoNumero()).toHaveValue('+44 7700 900123')

    // ACT
    await userEvent.tab()

    // ASSERT
    await waitFor(() => {
      expect(seletorDoPais()).toHaveValue('GB')
    })
    expect(campoDoNumero()).toHaveValue('7700 900123')
  })

  it('deve pôr o + sozinho em "Outro país"', async () => {
    // ARRANGE
    const gravados: string[] = []
    render(<CampoControlado gravados={gravados} />)

    // ACT
    await userEvent.selectOptions(seletorDoPais(), 'outro')
    await userEvent.type(campoDoNumero(), '999 1234 5678')

    // ASSERT — sem o `+`, o servidor leria o número como brasileiro
    expect(gravados.at(-1)).toBe('+999 1234 5678')
    expect(campoDoNumero()).toHaveValue('+999 1234 5678')
  })

  it('deve descontar do teto do campo o código que a escolha mostra', async () => {
    // ARRANGE — o teto do servidor conta o valor inteiro, com o "+44 "
    render(<CampoControlado inicial="+44 7700 900123" limite={20} />)

    // ACT + ASSERT
    expect(campoDoNumero()).toHaveAttribute('maxLength', '16')
  })

  it('não deve mostrar o país no contato de e-mail', () => {
    // ARRANGE + ACT
    render(<CampoControlado tipo="email" inicial="ficticio@exemplo.test" />)

    // ASSERT
    expect(screen.queryByRole('combobox', { name: 'País do telefone' })).not.toBeInTheDocument()
  })

  it('deve manter o país escolhido ao passar pelo número sem digitar nada', async () => {
    // ARRANGE — gate r1: o número vazio não diz país nenhum
    render(<CampoControlado />)
    await userEvent.selectOptions(seletorDoPais(), 'GB')

    // ACT — entra no número e sai sem digitar
    await userEvent.tab()
    expect(campoDoNumero()).toHaveFocus()
    await userEvent.tab()
    await act(async () => {
      await new Promise((resolver) => {
        window.setTimeout(resolver, 20)
      })
    })

    // ASSERT
    expect(seletorDoPais()).toHaveValue('GB')
  })

  it('deve manter o Canadá escolhido ao sair do campo, mesmo com o +1 dos Estados Unidos', async () => {
    // ARRANGE — gate r1: os dois países têm o mesmo código. Faixa de ficção do 555-01xx
    const gravados: string[] = []
    render(<CampoControlado gravados={gravados} />)
    await userEvent.selectOptions(seletorDoPais(), 'CA')

    // ACT
    await userEvent.type(campoDoNumero(), '204 555 0143')
    await userEvent.tab()

    // ASSERT
    await waitFor(() => {
      expect(campoDoNumero()).toHaveAccessibleDescription('WhatsApp: +12045550143')
    })
    expect(seletorDoPais()).toHaveValue('CA')
    expect(gravados.at(-1)).toBe('+1 204 555 0143')
  })

  it('deve tirar só o + ao escolher o Brasil num número que também é brasileiro', async () => {
    // ARRANGE — gate r1: `+11 98765-4321` era um celular de São Paulo digitado com o + por engano
    const gravados: string[] = []
    render(<CampoControlado inicial="+11 98765-4321" gravados={gravados} />)
    expect(campoDoNumero()).toHaveAccessibleDescription(
      'Este número também é um telefone do Brasil (DDD 11). Se for do Brasil, escolha Brasil no país do telefone.',
    )

    // ACT — o que o aviso pede
    await userEvent.selectOptions(seletorDoPais(), 'BR')

    // ASSERT — tirar o "+1" comeria o DDD
    expect(gravados).toEqual(['11 98765-4321'])
    expect(campoDoNumero()).toHaveAccessibleDescription('WhatsApp: +55 (11) 98765-4321')
  })

  it('deve travar o país junto com o número no campo desabilitado', () => {
    // ARRANGE + ACT
    render(<CampoControlado disabled inicial="+44 7700 900123" />)

    // ASSERT
    expect(seletorDoPais()).toBeDisabled()
  })
})

describe('CampoDoTelefone — o país por teclado e por leitor de tela', () => {
  it('deve vir antes do número na ordem do Tab, com nome e código na opção', async () => {
    // ARRANGE
    render(<CampoControlado />)

    // ACT
    await userEvent.tab()

    // ASSERT — a ordem do Tab é a ordem da tela
    expect(seletorDoPais()).toHaveFocus()

    // ACT
    await userEvent.tab()

    // ASSERT
    expect(campoDoNumero()).toHaveFocus()
    // a opção começa pelo NOME: é por ele que a busca do teclado acha o país na lista nativa
    expect(within(seletorDoPais()).getByRole('option', { name: 'Reino Unido +44' })).toBeInTheDocument()
    expect(within(seletorDoPais()).getByRole('option', { name: /^Outro país/ })).toBeInTheDocument()
  })

  it('deve anunciar o aviso novo quando a pessoa para de trocar de país', async () => {
    // ARRANGE — o número sem país não chega, e isso foi anunciado ao sair do campo
    render(<CampoControlado />)
    const regiao = regiaoDoAviso()
    await userEvent.type(campoDoNumero(), '447700900123')
    await userEvent.tab()
    await waitFor(() => {
      expect(regiao).toHaveTextContent(/não recebe WhatsApp/)
    })

    // ACT — volta ao país e passa por dois deles, como com as setas no Windows, parando um instante
    // em Portugal (onde o número teria dígitos a mais)
    fireEvent.change(seletorDoPais(), { target: { value: 'PT' } })
    await act(async () => {
      await new Promise((resolver) => {
        window.setTimeout(resolver, 150)
      })
    })

    // ASSERT — o aviso do país atravessado não chega à região
    expect(regiao).toBeEmptyDOMElement()

    // ACT
    fireEvent.change(seletorDoPais(), { target: { value: 'GB' } })

    // ASSERT — a correção é confirmada quando a pessoa para
    await waitFor(() => {
      expect(regiao).toHaveTextContent('WhatsApp: +447700900123')
    })
  })

  it('deve tratar três trocas seguidas de país como uma só, comparando com o número de antes da primeira', async () => {
    // ARRANGE — gate r1: o número sem país não chegava, e isso foi anunciado ao sair do campo
    render(<CampoControlado />)
    const regiao = regiaoDoAviso()
    await userEvent.type(campoDoNumero(), '7700 900123')
    await userEvent.tab()
    await waitFor(() => {
      expect(regiao).toHaveTextContent(/não recebe WhatsApp/)
    })

    // ACT — Portugal, Estados Unidos e Reino Unido, sem parar. Nos EUA o número já chegaria
    // ("WhatsApp: +1…"): comparar com a troca de antes da última calaria a confirmação
    await userEvent.selectOptions(seletorDoPais(), 'PT')
    await userEvent.selectOptions(seletorDoPais(), 'US')
    await userEvent.selectOptions(seletorDoPais(), 'GB')

    // ASSERT — a correção do aviso de ANTES da série é confirmada
    await waitFor(() => {
      expect(regiao).toHaveTextContent('WhatsApp: +447700900123')
    })
  })

  it('deve conferir o número repetido também na forma estrangeira', async () => {
    // ARRANGE
    const perguntas: Array<Record<string, unknown>> = []
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/pacientes/telefone/conferir', async ({ request }) => {
        perguntas.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json({
          forma: '+447700900123',
          tipo: 'celular',
          tambem_em: [{ id: 8, nome: 'Paciente Fictícia Adulta', ativo: true }],
          total: 1,
        } satisfies TelefoneEmUso)
      }),
    )

    // ACT
    render(<CampoControlado conferirRepetido inicial="+44 7700 900123" />)

    // ASSERT — a pergunta vai pela forma canônica, e o alerta aparece como no número brasileiro
    await screen.findByRole('link', { name: /Paciente Fictícia Adulta/ })
    expect(perguntas[0]).toMatchObject({ numero: '+447700900123' })
  })

  it('deve continuar conferindo o número repetido quando o aviso é o do número que também é do Brasil', async () => {
    // ARRANGE — gate r2: o ambíguo é alerta, mas o número é inteiro (o celular do Peru sempre cai aqui)
    const perguntas: Array<Record<string, unknown>> = []
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/pacientes/telefone/conferir', async ({ request }) => {
        perguntas.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json({
          forma: '+51912345678',
          tipo: 'celular',
          tambem_em: [{ id: 8, nome: 'Paciente Fictícia Adulta', ativo: true }],
          total: 1,
        } satisfies TelefoneEmUso)
      }),
    )

    // ACT
    render(<CampoControlado conferirRepetido inicial="+51 912 345 678" />)

    // ASSERT — o aviso do ambíguo e o do repetido, juntos
    await screen.findByRole('link', { name: /Paciente Fictícia Adulta/ })
    expect(perguntas[0]).toMatchObject({ numero: '+51912345678' })
    expect(campoDoNumero()).toHaveAccessibleDescription(/também é um telefone do Brasil \(DDD 51\)/)
  })

  it('não deve perguntar pelo repetido quando o número tem dígitos a menos para o país', async () => {
    // ARRANGE
    let perguntou = false
    servidor.use(
      msw.post('/api/pacientes/telefone/conferir', () => {
        perguntou = true
        return HttpResponse.json({ forma: null, tipo: null, tambem_em: [], total: 0 })
      }),
    )

    // ACT
    render(<CampoControlado conferirRepetido inicial="+44 7700 9001" />)
    await act(async () => {
      await new Promise((resolver) => {
        window.setTimeout(resolver, 50)
      })
    })

    // ASSERT
    expect(campoDoNumero()).toHaveAccessibleDescription(/Faltam 2 dígitos/)
    expect(perguntou).toBe(false)
  })

  it('não deve ter violações de acessibilidade com o país escolhido e o aviso na tela', async () => {
    // ARRANGE + ACT
    const { container } = render(<CampoControlado inicial="+44 7700 9001" />)
    await act(async () => {
      await Promise.resolve()
    })

    // ASSERT
    expect(campoDoNumero()).toHaveAccessibleDescription(/Faltam 2 dígitos/)
    expect(await axe(container)).toHaveNoViolations()
  })
})
