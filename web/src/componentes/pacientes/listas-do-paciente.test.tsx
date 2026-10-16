import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ListaDeConsentimentos, ListaDeContatos } from '@/componentes/pacientes/listas-do-paciente'
import { semErros } from '@/lib/erros'
import { chaves } from '@/lib/chaves-query'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { ContatoDoPaciente, TelefoneEmUso } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * O aviso do telefone na lista de contatos (change telefone-que-chega-no-whatsapp, D2).
 *
 * Em 02/10, seis crianças ficaram sem lembrete porque o telefone foi digitado com o DDI na frente
 * e um dígito a menos — e ninguém viu o número estranho. O campo agora diz, ao sair dele, para onde
 * a mensagem vai ou que ela não chega. Números 100% fictícios.
 */

interface ListaControladaProps {
  inicial: ContatoDoPaciente[]
  avisar?: boolean
  conferirRepetido?: boolean
  pacienteId?: number | null
}

function ListaControlada({ inicial, avisar = true, conferirRepetido = false, pacienteId = null }: ListaControladaProps) {
  const [contatos, setContatos] = useState(inicial)

  return (
    <QueryClientProvider client={queryClient}>
      <ListaDeContatos
        contatos={contatos}
        aoMudar={setContatos}
        erros={semErros()}
        avisarWhatsapp={avisar}
        conferirRepetido={conferirRepetido}
        pacienteId={pacienteId}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  queryClient.clear()
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: ['pacientes.ver'] }, carregandoSessao: false })
})

function campoDoValor(indice = 0): HTMLInputElement {
  const campo = screen.getAllByLabelText('Valor')[indice]
  if (!(campo instanceof HTMLInputElement)) {
    throw new Error('o campo "Valor" não está na tela')
  }

  return campo
}

describe('ListaDeContatos — o aviso do WhatsApp', () => {
  it('deve mostrar para onde a mensagem vai no celular já salvo', () => {
    // ARRANGE + ACT
    render(<ListaControlada inicial={[{ tipo: 'celular', valor: '(49) 99123-4567', obs: '' }]} />)

    // ASSERT — descrição do campo, não um parágrafo solto
    expect(campoDoValor()).toHaveAccessibleDescription('WhatsApp: +55 (49) 99123-4567')
  })

  it('deve avisar, ao sair do campo, o número que não recebe WhatsApp', async () => {
    // ARRANGE
    render(<ListaControlada inicial={[{ tipo: 'celular', valor: '', obs: '' }]} />)
    const campo = campoDoValor()

    // ACT — DDI na frente e um dígito a menos, como em 02/10
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '55 49912-3456' } })
    fireEvent.blur(campo)

    // ASSERT — a leitura nova entra logo depois da saída (gate r2, A11Y-TEL-04)
    await waitFor(() => {
      expect(campo).toHaveAccessibleDescription(
        'Este número não recebe WhatsApp. Confira o DDD e a quantidade de dígitos.',
      )
    })
  })

  it('não deve avisar nada enquanto a pessoa digita', () => {
    // ARRANGE
    render(<ListaControlada inicial={[{ tipo: 'celular', valor: '', obs: '' }]} />)
    const campo = campoDoValor()

    // ACT — no meio da digitação o número está sempre "errado"
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '(49) 991' } })

    // ASSERT
    expect(screen.queryByText(/não recebe WhatsApp/)).not.toBeInTheDocument()
    expect(campo).not.toHaveAccessibleDescription()
  })

  it('deve dizer que o fixo só chega se tiver WhatsApp', () => {
    // ARRANGE + ACT
    render(<ListaControlada inicial={[{ tipo: 'telefone', valor: '(49) 3222-1234', obs: '' }]} />)

    // ASSERT
    expect(campoDoValor()).toHaveAccessibleDescription(
      'Telefone fixo: o lembrete só chega se este número tiver WhatsApp.',
    )
  })

  it('não deve avisar nada no e-mail', () => {
    // ARRANGE + ACT
    render(<ListaControlada inicial={[{ tipo: 'email', valor: 'ficticio@exemplo.test', obs: '' }]} />)

    // ASSERT
    expect(campoDoValor()).not.toHaveAccessibleDescription()
  })

  it('não deve avisar nada sem a prop — fornecedor e funcionário não recebem lembrete', () => {
    // ARRANGE + ACT
    render(<ListaControlada avisar={false} inicial={[{ tipo: 'celular', valor: '55 49912-3456', obs: '' }]} />)

    // ASSERT — "WhatsApp" continua existindo como TIPO de contato; o que não pode é o aviso
    expect(campoDoValor()).not.toHaveAccessibleDescription()
    expect(screen.queryByText(/não recebe WhatsApp/)).not.toBeInTheDocument()
  })

  it('deve avisar cada contato pelo seu próprio número', () => {
    // ARRANGE + ACT
    render(
      <ListaControlada
        inicial={[
          { tipo: 'celular', valor: '(49) 99123-4567', obs: '' },
          { tipo: 'whatsapp', valor: '(49) 49912-3456', obs: '' },
        ]}
      />,
    )

    // ASSERT
    expect(campoDoValor(0)).toHaveAccessibleDescription('WhatsApp: +55 (49) 99123-4567')
    expect(campoDoValor(1)).toHaveAccessibleDescription(/não recebe WhatsApp/)
  })

  it('não deve ter violações de acessibilidade com o aviso na tela', async () => {
    // ARRANGE + ACT
    const { container } = render(
      <ListaControlada
        inicial={[
          { tipo: 'celular', valor: '(49) 99123-4567', obs: '' },
          { tipo: 'celular', valor: '55 49912-3456', obs: '' },
        ]}
      />,
    )

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('ListaDeContatos — o número que já está em outro paciente', () => {
  /** Responde a consulta e guarda cada pergunta que chegou. */
  function responderConsulta(resposta: TelefoneEmUso | { status: number }): Array<Record<string, unknown>> {
    const perguntas: Array<Record<string, unknown>> = []
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/pacientes/telefone/conferir', async ({ request }) => {
        perguntas.push((await request.json()) as Record<string, unknown>)
        return 'status' in resposta && !('forma' in resposta)
          ? new HttpResponse(null, { status: resposta.status })
          : HttpResponse.json(resposta)
      }),
    )

    return perguntas
  }

  const OUTRA_FAMILIA: TelefoneEmUso = {
    forma: '+5549991234567',
    tipo: 'celular',
    tambem_em: [{ id: 8, nome: 'Paciente Fictícia Adulta', ativo: true }],
    total: 1,
  }

  it('deve dizer quem mais tem o número, com link para a ficha em nova aba', async () => {
    // ARRANGE — outra paciente com o mesmo celular, como no cadastro feito às pressas
    const perguntas = responderConsulta(OUTRA_FAMILIA)
    render(<ListaControlada conferirRepetido pacienteId={7} inicial={[{ tipo: 'celular', valor: '(49) 99123-4567', obs: '' }]} />)

    // ACT
    const link = await screen.findByRole('link', { name: /Paciente Fictícia Adulta/ })

    // ASSERT — a pergunta leva o próprio paciente para ele não contar como "outro"
    expect(link).toHaveAttribute('href', '/pacientes/8')
    expect(link).toHaveAttribute('target', '_blank')
    expect(campoDoValor()).toHaveAccessibleDescription(
      /^WhatsApp: \+55 \(49\) 99123-4567 Este número também está no cadastro de: Paciente Fictícia Adulta/,
    )
    expect(campoDoValor()).toHaveAccessibleDescription(/Confira se é a mesma família/)
    expect(perguntas).toEqual([{ numero: '+5549991234567', ignorar_paciente_id: 7 }])
  })

  it('não deve mostrar nada quando a consulta é recusada', async () => {
    // ARRANGE — 403: o alerta é ajuda, e ajuda que falha fica calada
    const perguntas = responderConsulta({ status: 403 })
    render(<ListaControlada conferirRepetido inicial={[{ tipo: 'celular', valor: '(49) 99123-4567', obs: '' }]} />)

    // ACT
    await waitFor(() => {
      expect(perguntas).toHaveLength(1)
    })

    // ASSERT
    expect(campoDoValor()).toHaveAccessibleDescription('WhatsApp: +55 (49) 99123-4567')
  })

  it('não deve perguntar sem a permissão de ver pacientes', async () => {
    // ARRANGE — a fila faz pré-cadastro sem `pacientes.ver`
    useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: ['pacientes.criar'] }, carregandoSessao: false })
    const perguntas = responderConsulta(OUTRA_FAMILIA)

    // ACT
    render(<ListaControlada conferirRepetido inicial={[{ tipo: 'celular', valor: '(49) 99123-4567', obs: '' }]} />)
    await screen.findByText('WhatsApp: +55 (49) 99123-4567')

    // ASSERT
    expect(perguntas).toHaveLength(0)
  })

  it('não deve perguntar duas vezes pelo mesmo número escrito de outro jeito', async () => {
    // ARRANGE — a forma canônica é a chave da pergunta
    const perguntas = responderConsulta(OUTRA_FAMILIA)
    render(<ListaControlada conferirRepetido inicial={[{ tipo: 'celular', valor: '(49) 99123-4567', obs: '' }]} />)
    await screen.findByRole('link', { name: /Paciente Fictícia Adulta/ })
    const campo = campoDoValor()

    // ACT
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '49991234567' } })
    fireEvent.blur(campo)

    // ASSERT
    expect(await screen.findByRole('link', { name: /Paciente Fictícia Adulta/ })).toBeInTheDocument()
    expect(perguntas).toHaveLength(1)
  })

  it('não deve perguntar pelo número que não recebe WhatsApp', async () => {
    // ARRANGE
    const perguntas = responderConsulta(OUTRA_FAMILIA)

    // ACT
    render(<ListaControlada conferirRepetido inicial={[{ tipo: 'celular', valor: '55 49912-3456', obs: '' }]} />)
    await screen.findByText(/não recebe WhatsApp/)

    // ASSERT
    expect(perguntas).toHaveLength(0)
  })

  it('não deve ter violações de acessibilidade com o alerta na tela', async () => {
    // ARRANGE
    responderConsulta(OUTRA_FAMILIA)
    const { container } = render(
      <ListaControlada conferirRepetido inicial={[{ tipo: 'celular', valor: '(49) 99123-4567', obs: '' }]} />,
    )

    // ACT
    await screen.findByRole('link', { name: /Paciente Fictícia Adulta/ })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('ListaDeContatos — o aviso chega a quem usa leitor de tela (gate r1, A11Y-TEL-01/02)', () => {
  /** A região de status do campo do telefone — montada vazia com o campo, antes de qualquer aviso. */
  function regiaoDoAviso(): HTMLElement {
    const campo = campoDoValor()
    const envelope = campo.closest('div.flex.flex-col')?.parentElement
    if (envelope === null || envelope === undefined) {
      throw new Error('o campo não está dentro do envelope do telefone')
    }

    return within(envelope).getByRole('status', { name: '' })
  }

  it('deve manter o aviso na descrição ao voltar ao campo para corrigir', () => {
    // ARRANGE — o número salvo com dígito faltando
    render(<ListaControlada inicial={[{ tipo: 'celular', valor: '55 49912-3456', obs: '' }]} />)
    const campo = campoDoValor()

    // ACT — a pessoa volta ao campo e começa a corrigir
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '(49) 9912' } })

    // ASSERT — a leitura é a da última saída: o aviso não some nem pisca enquanto se digita
    expect(campo).toHaveAccessibleDescription(
      'Este número não recebe WhatsApp. Confira o DDD e a quantidade de dígitos.',
    )
  })

  it('deve trocar o aviso na saída do campo, mas só depois que o foco saiu', async () => {
    // ARRANGE
    render(<ListaControlada inicial={[{ tipo: 'celular', valor: '55 49912-3456', obs: '' }]} />)
    const campo = campoDoValor()
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '(49) 99123-4567' } })

    // ACT
    fireEvent.blur(campo)

    // ASSERT — no instante da saída nada muda: trocar o aviso ali derrubava o foco (gate r2,
    // A11Y-TEL-04); logo em seguida, a leitura nova
    expect(campo).toHaveAccessibleDescription(/não recebe WhatsApp/)
    await waitFor(() => {
      expect(campo).toHaveAccessibleDescription('WhatsApp: +55 (49) 99123-4567')
    })
  })

  it('deve anunciar o número inválido numa região de status que já existia antes da saída', async () => {
    // ARRANGE — a região nasce VAZIA com o campo: uma criada junto com a mensagem não é lida
    render(<ListaControlada inicial={[{ tipo: 'celular', valor: '', obs: '' }]} />)
    const regiao = regiaoDoAviso()
    expect(regiao).toBeEmptyDOMElement()
    const campo = campoDoValor()

    // ACT
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '55 49912-3456' } })
    fireEvent.blur(campo)

    // ASSERT — a mesma região, agora com o aviso
    await waitFor(() => {
      expect(regiao).toHaveTextContent('Este número não recebe WhatsApp. Confira o DDD e a quantidade de dígitos.')
    })
  })

  it('não deve anunciar o número que chega no WhatsApp — só o que pede ação', () => {
    // ARRANGE
    render(<ListaControlada inicial={[{ tipo: 'celular', valor: '', obs: '' }]} />)
    const campo = campoDoValor()

    // ACT
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '(49) 99123-4567' } })
    fireEvent.blur(campo)

    // ASSERT
    expect(regiaoDoAviso()).toBeEmptyDOMElement()
  })

  it('deve anunciar o número repetido quando a resposta chega, e pôr o link na ordem do Tab', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/pacientes/telefone/conferir', () =>
        HttpResponse.json({
          forma: '+5549991234567',
          tipo: 'celular',
          tambem_em: [{ id: 8, nome: 'Paciente Fictícia Adulta', ativo: true }],
          total: 1,
        } satisfies TelefoneEmUso),
      ),
    )
    const usuario = userEvent.setup()
    render(<ListaControlada conferirRepetido inicial={[{ tipo: 'celular', valor: '', obs: '' }]} />)
    const campo = campoDoValor()

    // ACT — digita o número da outra família e sai do campo
    await usuario.type(campo, '(49) 99123-4567')
    await usuario.tab()

    // ASSERT — a região anuncia a frase inteira quando a resposta chega
    await waitFor(() => {
      expect(regiaoDoAviso()).toHaveTextContent(
        'Este número também está no cadastro de: Paciente Fictícia Adulta. Irmãos podem dividir o telefone. Confira se é a mesma família.',
      )
    })

    // ACT — volta ao campo e avança com Tab
    await usuario.click(campo)
    await usuario.tab()

    // ASSERT — o próximo alvo é o link, que continua lá com o campo em foco
    expect(screen.getByRole('link', { name: /Paciente Fictícia Adulta/ })).toHaveFocus()
  })
})

describe('ListaDeContatos — o campo de telefone depois da rodada 2 do gate', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function regiaoDo(indice: number): HTMLElement {
    const envelope = campoDoValor(indice).closest('div.flex.flex-col')?.parentElement
    const regiao = envelope?.lastElementChild
    if (!(regiao instanceof HTMLElement) || regiao.getAttribute('role') !== 'status') {
      throw new Error('a região de voz do campo não está no fim do envelope')
    }

    return regiao
  }

  function conferirComOutraPaciente(): void {
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/pacientes/telefone/conferir', async ({ request }) => {
        const { numero } = (await request.json()) as { numero: string }
        return HttpResponse.json({
          forma: numero,
          tipo: 'celular',
          tambem_em: numero === '+5549991234567' ? [{ id: 8, nome: 'Paciente Fictícia Adulta', ativo: true }] : [],
          total: numero === '+5549991234567' ? 1 : 0,
        } satisfies TelefoneEmUso)
      }),
    )
  }

  it('deve tirar o link do repetido assim que o número é editado, e o Tab seguir para o próximo campo', async () => {
    // ARRANGE — A11Y-TEL-04: o link sumia debaixo do Tab e o foco caía no corpo da página
    conferirComOutraPaciente()
    const usuario = userEvent.setup()
    render(<ListaControlada conferirRepetido inicial={[{ tipo: 'celular', valor: '(49) 99123-4567', obs: '' }]} />)
    await screen.findByRole('link', { name: /Paciente Fictícia Adulta/ })
    const campo = campoDoValor()

    // ACT — corrige para outro número, ainda no campo
    await usuario.clear(campo)
    await usuario.type(campo, '(49) 98888-7777')

    // ASSERT — o link já saiu, com o foco no campo
    expect(screen.queryByRole('link', { name: /Paciente Fictícia Adulta/ })).not.toBeInTheDocument()

    // ACT
    await usuario.tab()

    // ASSERT — o foco vai ao campo seguinte e fica lá
    const observacao = screen.getAllByLabelText('Observação')[0]
    expect(observacao).toHaveFocus()
    await waitFor(() => {
      expect(campo).toHaveAccessibleDescription('WhatsApp: +55 (49) 98888-7777')
    })
    expect(observacao).toHaveFocus()
  })

  it('não deve anunciar sozinho o número repetido ao abrir a ficha', async () => {
    // ARRANGE — A11Y-TEL-05 / CR-TEL-12: abrir a ficha de irmãos falava a cada abertura
    conferirComOutraPaciente()

    // ACT
    render(<ListaControlada conferirRepetido inicial={[{ tipo: 'celular', valor: '(49) 99123-4567', obs: '' }]} />)
    await screen.findByRole('link', { name: /Paciente Fictícia Adulta/ })

    // ASSERT — o alerta está à vista; a voz fica calada
    expect(regiaoDo(0)).toBeEmptyDOMElement()
  })

  it('não deve repetir o anúncio de quem passa pelo campo sem mexer', () => {
    // ARRANGE — relógio falso: todos os temporizadores do campo rodam, sem espera acoplada a eles
    vi.useFakeTimers()
    render(<ListaControlada inicial={[{ tipo: 'celular', valor: '55 49912-3456', obs: '' }]} />)
    const campo = campoDoValor()

    // ACT
    fireEvent.focus(campo)
    fireEvent.blur(campo)
    act(() => {
      vi.runAllTimers()
    })

    // ASSERT
    expect(regiaoDo(0)).toBeEmptyDOMElement()
  })

  it('deve confirmar em voz a correção que resolve o aviso', async () => {
    // ARRANGE — A11Y-TEL-05: quem ouviu "não recebe WhatsApp" e corrigiu não ouvia nada
    render(<ListaControlada inicial={[{ tipo: 'celular', valor: '55 49912-3456', obs: '' }]} />)
    const campo = campoDoValor()

    // ACT
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '(49) 99123-4567' } })
    fireEvent.blur(campo)

    // ASSERT
    await waitFor(() => {
      expect(regiaoDo(0)).toHaveTextContent('WhatsApp: +55 (49) 99123-4567')
    })
  })

  it('não deve deixar a voz falando do contato que foi removido', async () => {
    // ARRANGE — CR-TEL-11: a lista identifica o contato pela posição, e o anúncio do primeiro
    // passava para o segundo quando o primeiro saía
    render(
      <ListaControlada
        inicial={[
          { tipo: 'celular', valor: '', obs: '' },
          { tipo: 'celular', valor: '(49) 99123-4567', obs: '' },
        ]}
      />,
    )
    const primeiro = campoDoValor(0)
    fireEvent.focus(primeiro)
    fireEvent.change(primeiro, { target: { value: '55 49912-3456' } })
    fireEvent.blur(primeiro)
    await waitFor(() => {
      expect(regiaoDo(0)).toHaveTextContent(/não recebe WhatsApp/)
    })

    // ACT
    fireEvent.click(screen.getByRole('button', { name: 'Remover contato 1' }))

    // ASSERT — o que sobrou fala do número dele, e a voz não diz nada
    expect(campoDoValor(0)).toHaveValue('(49) 99123-4567')
    expect(regiaoDo(0)).toBeEmptyDOMElement()
  })

  it('deve calar a voz quando o contato vira e-mail', async () => {
    // ARRANGE — CR-TEL-11, caso 2
    render(<ListaControlada inicial={[{ tipo: 'celular', valor: '', obs: '' }]} />)
    const campo = campoDoValor()
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '55 49912-3456' } })
    fireEvent.blur(campo)
    await waitFor(() => {
      expect(regiaoDo(0)).toHaveTextContent(/não recebe WhatsApp/)
    })

    // ACT
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'email' } })

    // ASSERT
    expect(regiaoDo(0)).toBeEmptyDOMElement()
  })
})

describe('ListaDeContatos — o campo de telefone depois da rodada 3 do gate', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function regiaoDoPrimeiro(): HTMLElement {
    const regiao = campoDoValor().closest('div.flex.flex-col')?.parentElement?.lastElementChild
    if (!(regiao instanceof HTMLElement) || regiao.getAttribute('role') !== 'status') {
      throw new Error('a região de voz do campo não está no fim do envelope')
    }

    return regiao
  }

  /** Os textos por que a região passa — o que o leitor de tela anunciaria. */
  function gravarRegiao(regiao: HTMLElement): string[] {
    const textos: string[] = []
    new MutationObserver(() => {
      textos.push(regiao.textContent ?? '')
    }).observe(regiao, { childList: true, characterData: true, subtree: true })

    return textos
  }

  it('não deve falar enquanto a pessoa digita no campo de um aviso já anunciado', async () => {
    // ARRANGE — A11Y-TEL-08: a região se esvaziava e voltava no meio da digitação
    render(<ListaControlada inicial={[{ tipo: 'celular', valor: '', obs: '' }]} />)
    const campo = campoDoValor()
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '55 49912-3456' } })
    fireEvent.blur(campo)
    await waitFor(() => {
      expect(regiaoDoPrimeiro()).toHaveTextContent(/não recebe WhatsApp/)
    })
    const textos = gravarRegiao(regiaoDoPrimeiro())

    // ACT — volta, apaga o último dígito e o digita de novo
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '55 49912-345' } })
    fireEvent.change(campo, { target: { value: '55 49912-3456' } })
    await new Promise((pronto) => setTimeout(pronto, 0))

    // ASSERT — nenhuma mudança na região: nada a anunciar por cima das teclas
    expect(textos).toEqual([])
  })

  it('deve anunciar de novo o mesmo aviso para OUTRO número inválido', async () => {
    // ARRANGE — a mesma frase para outro número: a região passa por vazio e o leitor a lê de novo
    render(<ListaControlada inicial={[{ tipo: 'celular', valor: '', obs: '' }]} />)
    const campo = campoDoValor()
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '55 49912-3456' } })
    fireEvent.blur(campo)
    await waitFor(() => {
      expect(regiaoDoPrimeiro()).toHaveTextContent(/não recebe WhatsApp/)
    })
    const textos = gravarRegiao(regiaoDoPrimeiro())

    // ACT
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '(49) 49912-3456' } })
    fireEvent.blur(campo)

    // ASSERT
    await waitFor(() => {
      expect(textos.slice(-2)).toEqual(['', 'Este número não recebe WhatsApp. Confira o DDD e a quantidade de dígitos.'])
    })
  })

  it('deve continuar em foco quem sai e volta ao campo no mesmo tique', () => {
    // ARRANGE — CR-TEL-16: a leitura da saída é adiada; voltar antes dela tem de cancelá-la, ou o
    // campo em foco passaria a ler cada tecla
    vi.useFakeTimers()
    render(<ListaControlada inicial={[{ tipo: 'celular', valor: '55 49912-3456', obs: '' }]} />)
    const campo = campoDoValor()
    fireEvent.focus(campo)
    fireEvent.change(campo, { target: { value: '(49) 99123-4567' } })

    // ACT — sai e volta antes de o temporizador rodar, e continua digitando
    fireEvent.blur(campo)
    fireEvent.focus(campo)
    act(() => {
      vi.runAllTimers()
    })
    fireEvent.change(campo, { target: { value: '(49) 99123-45678' } })

    // ASSERT — a descrição é a da leitura na volta, e não segue a tecla
    expect(campo).toHaveAccessibleDescription('WhatsApp: +55 (49) 99123-4567')
  })

  it('não deve mostrar o repetido guardado em cache a quem não pode ver pacientes', async () => {
    // ARRANGE — SEC-TEL-07: com a consulta desligada pela permissão, o cache não pode vazar
    useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: ['pacientes.criar'] }, carregandoSessao: false })
    queryClient.setQueryData(chaves.telefoneEmUso('+5549991234567', null), {
      forma: '+5549991234567',
      tipo: 'celular',
      tambem_em: [{ id: 8, nome: 'Paciente Fictícia Adulta', ativo: true }],
      total: 1,
    } satisfies TelefoneEmUso)

    // ACT
    render(<ListaControlada conferirRepetido inicial={[{ tipo: 'celular', valor: '(49) 99123-4567', obs: '' }]} />)
    await screen.findByText('WhatsApp: +55 (49) 99123-4567')

    // ASSERT
    expect(screen.queryByText(/Paciente Fictícia Adulta/)).not.toBeInTheDocument()
  })
})

describe('ListaDeConsentimentos — sem termo publicado, o caminho por permissão (o-sistema-avisa-o-que-falta)', () => {
  const ONDE_PUBLICAR = /Publique em Cadastros › Termo de consentimento\./
  const QUEM_PUBLICA = ['pacientes.editar', 'termos_consentimento.ver', 'termos_consentimento.criar']

  function renderizarSemTermo(permissoes: string[], termoLido = true) {
    useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })
    return render(
      <ListaDeConsentimentos
        registrados={[]}
        novos={[]}
        termoVigente={null}
        termoLido={termoLido}
        aoAdicionar={vi.fn()}
        aoRemoverNovo={vi.fn()}
        erros={semErros()}
      />,
    )
  }

  it('deve dizer onde publicar o termo a quem pode publicar', () => {
    // ARRANGE + ACT
    renderizarSemTermo(QUEM_PUBLICA)

    // ASSERT
    const consentimentos = screen.getByRole('group', { name: 'Consentimentos' })
    expect(within(consentimentos).getByText(/Nenhum termo publicado/)).toBeInTheDocument()
    expect(within(consentimentos).getByText(ONDE_PUBLICAR)).toBeInTheDocument()
    expect(within(consentimentos).queryByText(/Peça a quem administra/)).not.toBeInTheDocument()
  })

  it('deve dizer a quem pedir a quem não pode publicar termo, sem mandar publicar', () => {
    // ARRANGE + ACT — "publique em Cadastros" para quem leva 403 lá é mandar a uma porta fechada; e
    // "criar" sem "ver" não abre a tela dos termos
    renderizarSemTermo(['pacientes.editar', 'termos_consentimento.criar'])

    // ASSERT
    const consentimentos = screen.getByRole('group', { name: 'Consentimentos' })
    expect(within(consentimentos).getByText(/Nenhum termo publicado/)).toBeInTheDocument()
    expect(
      within(consentimentos).getByText(/Peça a quem administra o sistema para publicar o termo\./),
    ).toBeInTheDocument()
    expect(within(consentimentos).queryByText(ONDE_PUBLICAR)).not.toBeInTheDocument()
  })

  it('não deve afirmar que falta termo enquanto a leitura dele não chegou (carregando ou com erro)', () => {
    // ARRANGE + ACT — rede ou 403 na leitura da régua não provam "nenhum publicado" (gate CR-AVI-08)
    renderizarSemTermo(QUEM_PUBLICA, false)

    // ASSERT — nem a falta, nem o registro que o servidor recusaria
    const consentimentos = screen.getByRole('group', { name: 'Consentimentos' })
    expect(within(consentimentos).queryByText(/Nenhum termo publicado/)).not.toBeInTheDocument()
    expect(within(consentimentos).queryByRole('button', { name: /Registrar aceite/ })).not.toBeInTheDocument()
  })

  it('deve dizer que o termo não carregou e oferecer tentar de novo, quando a leitura falhou', async () => {
    // ARRANGE — o registro do aceite não pode sumir calado (gate CR-AVI-R2-01)
    useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: QUEM_PUBLICA }, carregandoSessao: false })
    const aoTentarLerOTermo = vi.fn()
    const usuario = userEvent.setup()
    render(
      <ListaDeConsentimentos
        registrados={[]}
        novos={[]}
        termoVigente={null}
        termoLido={false}
        aoTentarLerOTermo={aoTentarLerOTermo}
        aoAdicionar={vi.fn()}
        aoRemoverNovo={vi.fn()}
        erros={semErros()}
      />,
    )
    const consentimentos = screen.getByRole('group', { name: 'Consentimentos' })

    // ACT
    await usuario.click(within(consentimentos).getByRole('button', { name: 'Tentar de novo' }))

    // ASSERT
    expect(within(consentimentos).getByText(/Não foi possível carregar o termo em vigor/)).toBeInTheDocument()
    expect(within(consentimentos).queryByText(/Nenhum termo publicado/)).not.toBeInTheDocument()
    expect(aoTentarLerOTermo).toHaveBeenCalledOnce()
  })

  it('não deve pôr link no aviso — sair por ele apagaria o cadastro que está sendo digitado', () => {
    // ARRANGE + ACT
    renderizarSemTermo(QUEM_PUBLICA)

    // ASSERT
    expect(within(screen.getByRole('group', { name: 'Consentimentos' })).queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve passar no axe com o aviso, com e sem a permissão de publicar', async () => {
    for (const permissoes of [QUEM_PUBLICA, ['pacientes.editar']]) {
      // ARRANGE
      const { container, unmount } = renderizarSemTermo(permissoes)

      // ACT
      const resultado = await axe(container)

      // ASSERT
      expect(resultado).toHaveNoViolations()
      unmount()
    }
  })
})
