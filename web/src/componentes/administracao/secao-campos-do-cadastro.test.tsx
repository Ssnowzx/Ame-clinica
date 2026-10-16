import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'

import { SecaoCamposDoCadastro } from '@/componentes/administracao/secao-campos-do-cadastro'
import { ProvedorToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { queryClient } from '@/lib/query-client'
import { reguaFicticia } from '@/test/dados-cadastros'
import { servidor } from '@/test/servidor-msw'

/**
 * A TELA DA RÉGUA (capability `campos-do-cadastro-tela`).
 *
 * O que estes testes protegem: a forma que a referência NÃO tem. No ClinicaÁgil são quatro
 * caixas independentes por campo, e marcar "obrigatório" + "desabilitado" juntos é possível
 * — um cadastro impossível de salvar, descoberto só na recusa. Aqui a combinação impossível
 * não é representável, e campo travado não oferece a escolha para recusá-la depois.
 */

expect.extend(toHaveNoViolations)

function renderizar(props: { podeEditar?: boolean } = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <SecaoCamposDoCadastro podeEditar={props.podeEditar ?? true} />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

function linhaDoCampo(rotulo: string): HTMLElement {
  return screen.getByRole('radiogroup', { name: rotulo })
}

beforeEach(() => {
  queryClient.clear()
  servidor.use(
    msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
    msw.get('/api/campos-cadastro/:formulario', () => HttpResponse.json(reguaFicticia())),
    msw.post('/api/campos-cadastro/:formulario/previa', () =>
      HttpResponse.json({ total: 120, incompletos: 7 }),
    ),
  )
})

describe('Régua do cadastro — a tela', () => {
  it('deve mostrar o estado atual de cada campo, agrupado por seção', async () => {
    // ARRANGE + ACT
    renderizar()

    // ASSERT
    expect(await screen.findByRole('heading', { name: 'Identificação' })).toBeInTheDocument()
    expect(
      within(linhaDoCampo('Nascimento')).getByRole('radio', {
        name: 'Obrigatório',
      }),
    ).toBeChecked()
    expect(
      within(linhaDoCampo('Profissão')).getByRole('radio', {
        name: 'Opcional',
      }),
    ).toBeChecked()
  })

  it('NÃO deve permitir representar a combinação impossível', async () => {
    // ARRANGE — a escolha é ÚNICA: marcar "não aparece" desmarca "obrigatório" por
    // construção, e não há como mandar os dois ao servidor
    const usuario = userEvent.setup()
    renderizar()
    const necessidade = await screen.findByRole('radiogroup', {
      name: 'Necessidade',
    })

    // ACT
    await usuario.click(within(necessidade).getByRole('radio', { name: 'Não aparece' }))

    // ASSERT
    // rádios NATIVOS com `name` compartilhado: a exclusão é do navegador, não do nosso
    // código — e as setas do teclado percorrem os três estados de graça
    const marcados = within(necessidade)
      .getAllByRole('radio')
      .filter((opcao) => (opcao as HTMLInputElement).checked)
    expect(marcados).toHaveLength(1)
    expect(marcados[0]).toHaveAccessibleName('Não aparece')
  })

  it('deve desabilitar as opções impossíveis do campo travado e dizer por quê', async () => {
    // ARRANGE + ACT
    renderizar()
    const nome = await screen.findByRole('radiogroup', { name: 'Nome' })

    // ASSERT — oferecer a escolha para recusá-la depois ensina a desconfiar da tela.
    // `nome` trava as DUAS chaves: só o estado que já vale continua alcançável (clicá-lo é
    // no-op), e as duas saídas impossíveis ficam desabilitadas.
    expect(within(nome).getByRole('radio', { name: 'Obrigatório' })).toBeChecked()
    expect(within(nome).getByRole('radio', { name: 'Opcional' })).toBeDisabled()
    expect(within(nome).getByRole('radio', { name: 'Não aparece' })).toBeDisabled()
    expect(
      within(nome.closest('li') as HTMLElement).getByText('Motivo fictício da trava.'),
    ).toBeInTheDocument()
  })

  it('deve travar POR CHAVE, não por campo — o CPF pode virar obrigatório', async () => {
    // ARRANGE — o CPF é travado só em "não aparece" (sumir da tela deixaria a recusa por
    // CPF repetido sem onde aparecer), mas tornar obrigatório é escolha legítima da
    // clínica, e o servidor a aceita. A primeira versão desta tela desabilitava o grupo
    // INTEIRO quando havia qualquer trava, e dizia não a uma escolha que a API permite.
    const usuario = userEvent.setup()
    renderizar()
    const cpf = await screen.findByRole('radiogroup', { name: 'CPF' })

    // ASSERT — só "Não aparece" fica fora
    expect(within(cpf).getByRole('radio', { name: 'Obrigatório' })).toBeEnabled()
    expect(within(cpf).getByRole('radio', { name: 'Opcional' })).toBeEnabled()
    expect(within(cpf).getByRole('radio', { name: 'Não aparece' })).toBeDisabled()

    // ACT / ASSERT — e a escolha de fato entra
    await usuario.click(within(cpf).getByRole('radio', { name: 'Obrigatório' }))
    expect(within(cpf).getByRole('radio', { name: 'Obrigatório' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('NÃO deve deixar campo de duas travas mudar de estado', async () => {
    // ARRANGE — `nome` trava `obrigatorio` E `desabilitado`: nenhuma MUDANÇA é alcançável,
    // então o botão de salvar não pode armar a partir dele
    const usuario = userEvent.setup()
    renderizar()
    const nome = await screen.findByRole('radiogroup', { name: 'Nome' })

    // ACT — o único clicável é o que já vale
    await usuario.click(within(nome).getByRole('radio', { name: 'Obrigatório' }))

    // ASSERT
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('deve avisar quantas fichas ficariam incompletas ANTES de salvar', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar()
    const cidade = await screen.findByRole('radiogroup', { name: 'Cidade' })

    // ACT
    await usuario.click(within(cidade).getByRole('radio', { name: 'Obrigatório' }))

    // ASSERT — número concreto, e a promessa de que nada é alterado
    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent('7 de 120 fichas')
    expect(aviso).toHaveTextContent(/Nenhuma delas é alterada/)
    // a palavra "fichas" aparece UMA vez: "7 fichas de 120 fichas" foi o que a primeira
    // versão produzia, e é o tipo de texto que faz a clínica desconfiar da tela
    expect((aviso.textContent ?? '').match(/fichas/g)).toHaveLength(1)
  })

  it('deve dizer "todas as N fichas" quando a régua alcança o cadastro inteiro', async () => {
    // ARRANGE — o caso mais alarmante é justamente o que a composição ingênua dizia pior
    // ("19 fichas de 19 fichas")
    const usuario = userEvent.setup()
    servidor.use(
      msw.post('/api/campos-cadastro/:formulario/previa', () =>
        HttpResponse.json({ total: 19, incompletos: 19 }),
      ),
    )
    renderizar()

    // ACT
    const cidade = await screen.findByRole('radiogroup', { name: 'Cidade' })
    await usuario.click(within(cidade).getByRole('radio', { name: 'Obrigatório' }))

    // ASSERT
    expect(await screen.findByRole('status')).toHaveTextContent('todas as 19 fichas')
  })

  it('deve manter a escolha do usuário quando o salvamento falha', async () => {
    // ARRANGE — quem digitou não perde o trabalho por uma queda de rede
    const usuario = userEvent.setup()
    renderizar()
    servidor.use(msw.put('/api/campos-cadastro/:formulario', () => new HttpResponse(null, { status: 500 })))

    const sexo = await screen.findByRole('radiogroup', { name: 'Sexo' })
    await usuario.click(within(sexo).getByRole('radio', { name: 'Opcional' }))

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    expect(await screen.findByText('Não foi possível salvar a configuração do cadastro.')).toBeInTheDocument()
    expect(within(sexo).getByRole('radio', { name: 'Opcional' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('deve gravar só o que mudou e limpar o pendente ao salvar', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    renderizar()
    servidor.use(
      msw.put('/api/campos-cadastro/:formulario', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(reguaFicticia({ sexo: { obrigatorio: false } }))
      }),
    )

    const sexo = await screen.findByRole('radiogroup', { name: 'Sexo' })
    await usuario.click(within(sexo).getByRole('radio', { name: 'Opcional' }))

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — um campo no payload, não os dezenove
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    const payload = enviado as unknown as { campos: Record<string, unknown> }
    expect(Object.keys(payload.campos)).toEqual(['sexo'])
    expect(payload.campos.sexo).toEqual({
      obrigatorio: false,
      desabilitado: false,
    })
    expect(await screen.findByText('Configuração do cadastro salva.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('deve pôr a régua nova no cache que o FORMULÁRIO de paciente lê', async () => {
    // ARRANGE — as duas telas leem a MESMA chave. Sem isso, a clínica salvaria a régua e o
    // cadastro continuaria exigindo o que ela acabou de afrouxar até alguém recarregar a
    // aplicação inteira.
    const usuario = userEvent.setup()
    renderizar()
    servidor.use(
      msw.put('/api/campos-cadastro/:formulario', () =>
        HttpResponse.json(reguaFicticia({ sexo: { obrigatorio: false } })),
      ),
    )

    const sexo = await screen.findByRole('radiogroup', { name: 'Sexo' })
    await usuario.click(within(sexo).getByRole('radio', { name: 'Opcional' }))

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))
    await screen.findByText('Configuração do cadastro salva.')

    // ASSERT
    const emCache = queryClient.getQueryData(chaves.reguaDoCadastro('paciente')) as
      { campos: Array<{ campo: string; obrigatorio: boolean }> } | undefined
    expect(emCache?.campos.find((campo) => campo.campo === 'sexo')?.obrigatorio).toBe(false)
  })

  it('deve deixar de contar como mudança quando o usuário volta ao estado original', async () => {
    // ARRANGE — voltar atrás não pode deixar o botão de salvar armado com um no-op
    const usuario = userEvent.setup()
    renderizar()
    const sexo = await screen.findByRole('radiogroup', { name: 'Sexo' })

    // ACT
    await usuario.click(within(sexo).getByRole('radio', { name: 'Opcional' }))
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('aria-disabled', 'false')
    await usuario.click(within(sexo).getByRole('radio', { name: 'Obrigatório' }))

    // ASSERT
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('deve permitir escolher o estado só com o teclado', async () => {
    // ARRANGE — WCAG 2.2 AA no fluxo core: os três estados precisam ser alcançáveis sem
    // mouse. Com `<button role="radio">` seria preciso escrever roving tabIndex e setas à
    // mão; com rádio NATIVO o navegador entrega isso, e este teste é a prova.
    const usuario = userEvent.setup()
    renderizar()
    const sexo = await screen.findByRole('radiogroup', { name: 'Sexo' })
    const obrigatorio = within(sexo).getByRole('radio', { name: 'Obrigatório' })

    // ACT — foca o marcado e anda com a seta
    obrigatorio.focus()
    expect(obrigatorio).toHaveFocus()
    await usuario.keyboard('{ArrowRight}')

    // ASSERT
    const opcional = within(sexo).getByRole('radio', { name: 'Opcional' })
    expect(opcional).toHaveFocus()
    expect(opcional).toBeChecked()
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('deve virar TEXTO para quem só pode ver, em vez de controles inertes', async () => {
    // ARRANGE + ACT — 57 rádios desabilitados deixavam a única informação da tela a 2,8:1
    // e zero paradas de Tab na seção inteira; a exceção de contraste da 1.4.3 vale para
    // controle inativo, não para conteúdo que precisa ser lido
    renderizar({ podeEditar: false })

    // ASSERT — a régua se lê como texto, e não há o que alterar
    await screen.findByRole('heading', { name: 'Identificação' })
    expect(screen.queryByRole('radiogroup', { name: 'Sexo' })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)

    const sexo = screen.getByText('Sexo').closest('li') as HTMLElement
    expect(sexo).toHaveTextContent('Obrigatório')
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument()
  })

  it('deve dizer o que aconteceu quando a régua não carrega', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/campos-cadastro/:formulario', () => new HttpResponse(null, { status: 500 })))

    // ACT
    renderizar()

    // ASSERT — os quatro estados do Design System: o erro tem mensagem e retry
    // 500 é falha de servidor: o cliente ainda repete uma vez antes de desistir
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      /não foi possível carregar a configuração/i,
    )
    expect(screen.getByRole('button', { name: /tentar/i })).toBeInTheDocument()
  })
})

describe('Régua do cadastro — os estados que faltavam', () => {
  it('deve levar a recusa do servidor à LINHA que a causou, não a um toast genérico', async () => {
    // ARRANGE — o 422 traz a mensagem por campo, escrita em pt-BR pela FormRequest.
    // Descartá-la fazia "tentar de novo" reproduzir a mesma recusa para sempre.
    const usuario = userEvent.setup()
    renderizar()
    servidor.use(
      msw.put('/api/campos-cadastro/:formulario', () =>
        HttpResponse.json(
          {
            message: 'O CPF não pode sumir da tela.',
            errors: { 'campos.cpf': ['O CPF não pode sumir da tela.'] },
          },
          { status: 422 },
        ),
      ),
    )

    const cpf = await screen.findByRole('radiogroup', { name: 'CPF' })
    await usuario.click(within(cpf).getByRole('radio', { name: 'Obrigatório' }))

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — a mensagem cai na linha do CPF, e a escolha recusada não fica pendurada
    const linha = cpf.closest('li') as HTMLElement
    expect(await within(linha).findByRole('alert')).toHaveTextContent('O CPF não pode sumir da tela.')
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('deve manter a região de status montada mesmo sem prévia', async () => {
    // ARRANGE — região viva inserida já com conteúdo pode nunca ser anunciada
    renderizar()

    // ACT / ASSERT
    await screen.findByRole('heading', { name: 'Identificação' })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('deve anunciar carga com aria-busy, em vez de região acessivelmente vazia', async () => {
    // ARRANGE — o Skeleton é aria-hidden; sem `aria-busy` no container ninguém é avisado
    servidor.use(
      msw.get('/api/campos-cadastro/:formulario', async () => {
        await new Promise((resolve) => setTimeout(resolve, 80))
        return HttpResponse.json(reguaFicticia())
      }),
    )

    // ACT
    const { container } = renderizar()

    // ASSERT
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    await screen.findByRole('heading', { name: 'Identificação' })
  })

  it('deve mostrar estado VAZIO quando o formulário não tem campo configurável', async () => {
    // ARRANGE — o quarto estado que faltava (SHALL do Design System)
    servidor.use(
      msw.get('/api/campos-cadastro/:formulario', () =>
        HttpResponse.json({ formulario: 'paciente', secoes: [], campos: [] }),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhum campo configurável neste formulário.')).toBeInTheDocument()
  })

  it('NÃO deve deixar a prévia atrasada sobrescrever a escolha atual', async () => {
    // ARRANGE — a primeira resposta demora mais que a segunda; sem sequência, ela chega
    // depois e o aviso passa a prometer um número que não é o da escolha na tela
    const usuario = userEvent.setup()
    let chamada = 0
    servidor.use(
      msw.post('/api/campos-cadastro/:formulario/previa', async () => {
        chamada += 1
        if (chamada === 1) {
          await new Promise((resolve) => setTimeout(resolve, 120))
          return HttpResponse.json({ total: 100, incompletos: 99 })
        }
        return HttpResponse.json({ total: 100, incompletos: 3 })
      }),
    )
    renderizar()

    // ACT — duas escolhas em sequência
    const cidade = await screen.findByRole('radiogroup', { name: 'Cidade' })
    await usuario.click(within(cidade).getByRole('radio', { name: 'Obrigatório' }))
    const bairro = screen.getByRole('radiogroup', { name: 'Bairro' })
    await usuario.click(within(bairro).getByRole('radio', { name: 'Obrigatório' }))

    // ASSERT — o número da SEGUNDA escolha, e a resposta atrasada da primeira não o troca
    expect(await screen.findByText(/3 de 100 fichas/)).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(screen.queryByText(/99 de 100/)).not.toBeInTheDocument()
  })
})

/**
 * O GATE AUTOMATIZADO da tela (condição C1 do parecer de a11y da rodada 3).
 *
 * Estava faltando: 27 arquivos desta base rodam `axe`, e nenhum era desta tela. O passe
 * manual de 25/08 mediu contraste, foco e teclado com número — mas ele acontece uma vez, e
 * isto acontece a cada `push`. Os quatro estados que a tela pode assumir entram aqui, não
 * só o feliz: a linha travada e a prévia visível são justamente onde a change acrescentou
 * marcação nova (`aria-describedby` no grupo, `role="status"` criada vazia).
 */
describe('Régua do cadastro — gate automatizado de acessibilidade', () => {
  it('deve passar no axe com a régua carregada', async () => {
    // ARRANGE / ACT
    const { container } = renderizar()
    await screen.findByRole('radiogroup', { name: 'Nome' })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve passar no axe na linha TRAVADA, que é onde mora o aria-describedby', async () => {
    // ARRANGE / ACT — CPF é travado em `desabilitado` e carrega o motivo
    const { container } = renderizar()
    const cpf = await screen.findByRole('radiogroup', { name: 'CPF' })

    // ASSERT
    expect(cpf).toHaveAttribute('aria-describedby')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve passar no axe com a PRÉVIA na tela', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/campos-cadastro/paciente/previa', () =>
        HttpResponse.json({ fichas_afetadas: 15, total_fichas: 15 }),
      ),
    )
    const { container } = renderizar()
    await screen.findByRole('radiogroup', { name: 'Nome social' })

    // ACT
    await usuario.click(
      within(linhaDoCampo('Nome social')).getByRole('radio', { name: 'Obrigatório' }),
    )

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve passar no axe no modo SOMENTE LEITURA', async () => {
    // ARRANGE / ACT — sem permissão a linha vira texto, sem controle nenhum
    const { container } = renderizar({ podeEditar: false })
    await screen.findByText('Identificação')

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})

/**
 * A GARANTIA QUE SEGURA A ORDEM DE TABULAÇÃO (achado A11Y-RCD3-05 da rodada 3).
 *
 * Uma linha só é alcançável por Tab porque o rádio MARCADO nunca está `disabled`: num grupo
 * de rádios nativos, o browser põe na ordem de tabulação o marcado — e se ele estiver
 * desabilitado, o grupo inteiro some da sequência, sem erro nenhum e sem aviso nenhum.
 *
 * Hoje isso vale por construção: `permitido()` compara o proposto com o estado EFETIVO, e
 * para chave travada o efetivo é o padrão do catálogo. Um campo da change 2 cuja trava
 * contradiga o próprio padrão quebraria a garantia em silêncio. Este teste é a rede.
 */
describe('Régua do cadastro — toda linha continua alcançável por teclado', () => {
  it('deve ter em cada linha exatamente um rádio marcado, e ele nunca desabilitado', async () => {
    // ARRANGE / ACT
    renderizar()
    await screen.findByRole('radiogroup', { name: 'Nome' })
    const grupos = screen.getAllByRole('radiogroup')

    // ASSERT — os 23 campos do catálogo. Eram 19 até a fábrica de teste ser sincronizada com o
    // servidor (change `cadastro-online-do-paciente`): ela não listava a seção `convenio`, e os
    // quatro campos dela sumiam da tela sem ninguém notar. Fixture que mente esconde linha.
    expect(grupos).toHaveLength(23)

    for (const grupo of grupos) {
      const rotulo = grupo.getAttribute('aria-labelledby') ?? '(sem rótulo)'
      const radios = [...grupo.querySelectorAll('input[type=radio]')] as HTMLInputElement[]
      const marcados = radios.filter((r) => r.checked)

      expect(marcados, `linha ${rotulo} sem exatamente um marcado`).toHaveLength(1)
      expect(marcados[0].disabled, `linha ${rotulo} tem o marcado DESABILITADO`).toBe(false)
    }
  })
})
