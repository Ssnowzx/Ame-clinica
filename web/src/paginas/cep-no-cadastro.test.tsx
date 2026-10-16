import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { FormularioPublico } from '@/tipos'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaCadastroPublico } from '@/paginas/pagina-cadastro-publico'
import { PaginaPaciente } from '@/paginas/pagina-paciente'
import { useAuthStore } from '@/stores/auth-store'
import { handlersDeCadastros, pacienteFicticio, reguaFicticia } from '@/test/dados-cadastros'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

/**
 * O CEP PREENCHE O ENDEREÇO, NAS DUAS BORDAS (change `cep-preenche-o-endereco`).
 *
 * As duas bordas do cadastro estão no MESMO arquivo de teste de propósito: elas consomem a
 * mesma peça (`usarConsultaDeCep`), e é essa igualdade que o arquivo protege. Uma cópia
 * própria para a família não divergiria com erro — divergiria com a família tendo uma
 * experiência diferente da recepção, meses depois, sem ninguém ligar uma coisa à outra.
 *
 * Dados 100% FICTÍCIOS (LGPD).
 */

const ENDERECO_DO_SERVICO = {
  cep: '88501-050',
  logradouro: 'Rua Fictícia das Acácias',
  complemento: 'de 100 a 200',
  bairro: 'Centro Fictício',
  localidade: 'Lages',
  uf: 'SC',
}

/** O serviço externo, sob controle do teste. */
function prepararServicoDeCep(resposta: () => Response = () => HttpResponse.json(ENDERECO_DO_SERVICO)) {
  servidor.use(msw.get('https://viacep.com.br/ws/:cep/json/', resposta))
}

const FORMULARIO_PUBLICO: FormularioPublico = {
  clinica: { nome: 'Centro Fictício Exemplo', identidade: 'nome', fonte_do_nome: 'padrao' },
  secoes: [
    { secao: 'identificacao', rotulo: 'Identificação' },
    { secao: 'endereco', rotulo: 'Endereço' },
  ],
  campos: [
    { campo: 'nome', rotulo: 'Nome', secao: 'identificacao', lista: false, obrigatorio: true, tamanho: 255, tamanhos_dos_itens: {} },
    { campo: 'nascimento', rotulo: 'Nascimento', secao: 'identificacao', lista: false, obrigatorio: true, tamanho: null, tamanhos_dos_itens: {} },
    { campo: 'endereco_cep', rotulo: 'CEP', secao: 'endereco', lista: false, obrigatorio: false, tamanho: 9, tamanhos_dos_itens: {} },
    { campo: 'endereco_logradouro', rotulo: 'Logradouro', secao: 'endereco', lista: false, obrigatorio: false, tamanho: 500, tamanhos_dos_itens: {} },
    { campo: 'endereco_numero', rotulo: 'Número', secao: 'endereco', lista: false, obrigatorio: false, tamanho: 20, tamanhos_dos_itens: {} },
    { campo: 'endereco_complemento', rotulo: 'Complemento', secao: 'endereco', lista: false, obrigatorio: false, tamanho: 255, tamanhos_dos_itens: {} },
    { campo: 'endereco_bairro', rotulo: 'Bairro', secao: 'endereco', lista: false, obrigatorio: false, tamanho: 150, tamanhos_dos_itens: {} },
    { campo: 'endereco_cidade', rotulo: 'Cidade', secao: 'endereco', lista: false, obrigatorio: false, tamanho: 150, tamanhos_dos_itens: {} },
  ],
}

function renderizarRecepcao(regua = reguaFicticia()) {
  servidor.use(
    msw.get('/api/campos-cadastro/:formulario', () => HttpResponse.json(regua)),
    ...handlersDeCadastros(),
  )
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes: ['pacientes.ver', 'pacientes.criar', 'pacientes.editar'] },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/pacientes/novo']}>
          <Routes>
            <Route path="/pacientes/novo" element={<PaginaPaciente />} />
            <Route path="/pacientes/:id" element={<div>Ficha do paciente</div>} />
          </Routes>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

function renderizarPublico() {
  servidor.use(msw.get('/api/publico/cadastro/:slug', () => HttpResponse.json(FORMULARIO_PUBLICO)))

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/cadastro/abc123xyz9876543']}>
        <Routes>
          <Route path="/cadastro/:slug" element={<PaginaCadastroPublico />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * O cadastro de um paciente que JÁ EXISTE, com endereço gravado — inclusive o CEP.
 *
 * `semServicoDeCep: true` derruba qualquer chamada ao terceiro: se alguma sair, o MSW falha o
 * teste em vez de deixar passar em silêncio.
 */
function renderizarEdicaoComEnderecoGravado(chamadasAoTerceiro: string[]) {
  const paciente = pacienteFicticio({
    id: 7,
    endereco_json: {
      cep: '88501050',
      logradouro: 'Rua Fictícia Antiga',
      numero: '10',
      complemento: null,
      bairro: 'Bairro Fictício Antigo',
      cidade: 'Cidade Fictícia Antiga',
      uf: 'SC',
    },
  })

  servidor.use(
    // o terceiro é VIGIADO, não servido: toda chamada é registrada e devolve endereço NOVO —
    // se o preenchimento disparar, o teste vê a troca acontecer
    msw.get('https://viacep.com.br/ws/:cep/json/', ({ request }) => {
      chamadasAoTerceiro.push(request.url)
      return HttpResponse.json(ENDERECO_DO_SERVICO)
    }),
    msw.get('/api/pacientes/:id', () => HttpResponse.json(paciente)),
    msw.get('/api/campos-cadastro/:formulario', () => HttpResponse.json(reguaFicticia())),
    ...handlersDeCadastros(),
  )
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes: ['pacientes.ver', 'pacientes.criar', 'pacientes.editar'] },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/pacientes/7/editar']}>
          <Routes>
            <Route path="/pacientes/:id/editar" element={<PaginaPaciente />} />
            <Route path="/pacientes/:id" element={<div>Ficha do paciente</div>} />
          </Routes>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('Abrir ficha gravada NÃO consulta o CEP', () => {
  it('NÃO deve consultar nem alterar o endereço ao abrir o cadastro de um paciente', async () => {
    /*
     * ARRANGE — a invariante CENTRAL da capability, e a que estava sem rede.
     *
     * O teste anterior montava o hook SEM valor de CEP e afirmava que nada disparou — o que é
     * a assinatura da função, não o comportamento. O code review provou o buraco plantando
     * `useEffect(() => { cep.aoDigitarCep(dados.cep ?? '') }, [dados.cep])` na seção de
     * endereço: os 1741 testes da casa passaram.
     *
     * Este monta a ficha de um paciente GRAVADO com CEP e endereço, e vigia o terceiro. Abrir
     * a ficha de uma criança para ver um telefone não pode reescrever o endereço dela com o
     * que o serviço responde hoje.
     */
    const chamadasAoTerceiro: string[] = []

    // ACT
    renderizarEdicaoComEnderecoGravado(chamadasAoTerceiro)
    expect(await screen.findByLabelText('CEP')).toHaveValue('88501-050')
    // tempo de sobra para o debounce de 400 ms disparar, se houvesse disparo
    await new Promise((resolve) => setTimeout(resolve, 900))

    // ASSERT — nenhuma consulta saiu, e o endereço gravado está intacto
    expect(chamadasAoTerceiro).toEqual([])
    expect(screen.getByLabelText('Logradouro')).toHaveValue('Rua Fictícia Antiga')
    expect(screen.getByLabelText('Bairro')).toHaveValue('Bairro Fictício Antigo')
    expect(screen.getByLabelText('Cidade')).toHaveValue('Cidade Fictícia Antiga')
    expect(screen.getByLabelText('Número')).toHaveValue('10')
  })
})

describe('O CEP preenche o endereço — recepção', () => {
  it('deve preencher os quatro campos e levar o foco para o Número', async () => {
    // ARRANGE
    prepararServicoDeCep()
    const usuario = userEvent.setup()
    renderizarRecepcao()
    const campoCep = await screen.findByLabelText('CEP')

    // ACT
    await usuario.type(campoCep, '88501050')

    // ASSERT — o endereço aparece, e sobra digitar o número
    await waitFor(() => {
      expect(screen.getByLabelText('Logradouro')).toHaveValue('Rua Fictícia das Acácias')
    })
    expect(screen.getByLabelText('Bairro')).toHaveValue('Centro Fictício')
    expect(screen.getByLabelText('Cidade')).toHaveValue('Lages')
    expect(screen.getByLabelText('UF')).toHaveValue('SC')
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Número'))
    })
  })

  it('NÃO deve arrancar o foco de quem já saiu do CEP', async () => {
    /*
     * ARRANGE — achado BLOQUEANTE do code review.
     *
     * Entre o disparo e a resposta há o debounce mais a ida à rede. Quem digita o CEP e já
     * vai escrevendo o logradouro à mão tinha o cursor ARRANCADO do meio da digitação quando
     * a resposta chegava. É MUST NOT em duas specs ("não pode tirar o foco de quem está
     * digitando").
     */
    servidor.use(
      msw.get('https://viacep.com.br/ws/:cep/json/', async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
        return HttpResponse.json(ENDERECO_DO_SERVICO)
      }),
    )
    const usuario = userEvent.setup()
    renderizarRecepcao()
    await screen.findByLabelText('CEP')

    // ACT — digita o CEP e IMEDIATAMENTE vai para o logradouro escrever à mão
    await usuario.type(screen.getByLabelText('CEP'), '88501050')
    await usuario.click(screen.getByLabelText('Logradouro'))
    await usuario.type(screen.getByLabelText('Logradouro'), 'Rua que eu digitei')

    // a resposta chega agora, com a pessoa no meio da digitação
    await waitFor(() => {
      expect(screen.getByLabelText('Bairro')).toHaveValue('Centro Fictício')
    })

    // ASSERT — o cursor continua onde a pessoa estava
    expect(document.activeElement).toBe(screen.getByLabelText('Logradouro'))
  })

  it('NÃO deve sobrescrever o campo em que a pessoa está digitando AGORA', async () => {
    /*
     * ARRANGE — achado A11Y-CEP-10, a assimetria do meu próprio conserto.
     *
     * A guarda anterior protegia o CURSOR de quem saiu do CEP e deixava o CONTEÚDO
     * desprotegido: a pessoa escrevia a rua à mão e via, no meio da frase, o que digitou ser
     * trocado pela resposta do serviço — sem sinal nenhum para quem usa leitor de tela.
     */
    servidor.use(
      msw.get('https://viacep.com.br/ws/:cep/json/', async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
        return HttpResponse.json(ENDERECO_DO_SERVICO)
      }),
    )
    const usuario = userEvent.setup()
    renderizarRecepcao()
    await screen.findByLabelText('CEP')

    // ACT — digita o CEP e vai escrever o logradouro à mão enquanto a consulta voa
    await usuario.type(screen.getByLabelText('CEP'), '88501050')
    await usuario.click(screen.getByLabelText('Logradouro'))
    await usuario.type(screen.getByLabelText('Logradouro'), 'Rua que eu digitei')

    await waitFor(() => {
      expect(screen.getByLabelText('Bairro')).toHaveValue('Centro Fictício')
    })

    // ASSERT — o campo em que ela está permanece com o texto DELA; os outros preenchem
    expect(screen.getByLabelText('Logradouro')).toHaveValue('Rua que eu digitei')
    expect(screen.getByLabelText('Cidade')).toHaveValue('Lages')
  })

  it('deve avisar que está buscando enquanto a consulta não volta', async () => {
    // ARRANGE — a spec exige "indicar que está em andamento", e nenhum teste cobria isso:
    // removendo o `setEstado('consultando')` a suíte inteira passava (achado do code review)
    servidor.use(
      msw.get('https://viacep.com.br/ws/:cep/json/', async () => {
        await new Promise((resolve) => setTimeout(resolve, 400))
        return HttpResponse.json(ENDERECO_DO_SERVICO)
      }),
    )
    const usuario = userEvent.setup()
    renderizarRecepcao()
    await screen.findByLabelText('CEP')

    // ACT
    await usuario.type(screen.getByLabelText('CEP'), '88501050')

    // ASSERT
    expect(await screen.findByText('Buscando o endereço…')).toBeInTheDocument()
  })

  it('NÃO deve tocar em número e complemento ao trocar o CEP', async () => {
    // ARRANGE — são os campos que só quem mora ali sabe, e que a consulta não repõe se apagar
    prepararServicoDeCep()
    const usuario = userEvent.setup()
    renderizarRecepcao()
    await screen.findByLabelText('CEP')

    await usuario.type(screen.getByLabelText('Número'), '1234')
    await usuario.type(screen.getByLabelText('Complemento'), 'Fundos, portão azul')

    // ACT
    await usuario.type(screen.getByLabelText('CEP'), '88501050')

    // ASSERT
    await waitFor(() => {
      expect(screen.getByLabelText('Logradouro')).toHaveValue('Rua Fictícia das Acácias')
    })
    expect(screen.getByLabelText('Número')).toHaveValue('1234')
    expect(screen.getByLabelText('Complemento')).toHaveValue('Fundos, portão azul')
  })

  it('NÃO deve usar o complemento que o serviço devolve', async () => {
    // ARRANGE — o ViaCEP manda `complemento: "de 100 a 200"`; ele para na tradução
    prepararServicoDeCep()
    const usuario = userEvent.setup()
    renderizarRecepcao()
    await screen.findByLabelText('CEP')

    // ACT
    await usuario.type(screen.getByLabelText('CEP'), '88501050')

    // ASSERT
    await waitFor(() => {
      expect(screen.getByLabelText('Logradouro')).toHaveValue('Rua Fictícia das Acácias')
    })
    expect(screen.getByLabelText('Complemento')).toHaveValue('')
  })

  it('deve avisar e deixar preencher à mão quando o CEP não existe', async () => {
    // ARRANGE — falha é aviso, nunca bloqueio
    prepararServicoDeCep(() => HttpResponse.json({ erro: 'true' }))
    const usuario = userEvent.setup()
    renderizarRecepcao()
    await screen.findByLabelText('CEP')

    // ACT
    await usuario.type(screen.getByLabelText('CEP'), '99999999')

    // ASSERT
    expect(await screen.findByText(/CEP não encontrado/)).toBeInTheDocument()
    await usuario.type(screen.getByLabelText('Logradouro'), 'Rua Fictícia Digitada')
    expect(screen.getByLabelText('Logradouro')).toHaveValue('Rua Fictícia Digitada')
  })

  it('deve avisar e deixar preencher à mão quando o serviço está fora do ar', async () => {
    // ARRANGE — a clínica não pode parar de atender porque um terceiro caiu
    prepararServicoDeCep(() => new HttpResponse(null, { status: 503 }))
    const usuario = userEvent.setup()
    renderizarRecepcao()
    await screen.findByLabelText('CEP')

    // ACT
    await usuario.type(screen.getByLabelText('CEP'), '88501050')

    // ASSERT
    expect(await screen.findByText(/Preencha à mão/)).toBeInTheDocument()
    await usuario.type(screen.getByLabelText('Cidade'), 'Lages')
    expect(screen.getByLabelText('Cidade')).toHaveValue('Lages')
  })

  it('NÃO deve preencher campo que a clínica escondeu', async () => {
    // ARRANGE — a régua governa o que existe; a consulta não a contorna
    prepararServicoDeCep()
    const usuario = userEvent.setup()
    renderizarRecepcao(reguaFicticia({ endereco_bairro: { desabilitado: true } }))
    await screen.findByLabelText('CEP')

    // ACT
    await usuario.type(screen.getByLabelText('CEP'), '88501050')

    // ASSERT
    await waitFor(() => {
      expect(screen.getByLabelText('Cidade')).toHaveValue('Lages')
    })
    expect(screen.queryByLabelText('Bairro')).not.toBeInTheDocument()
  })

  it('deve SALVAR o cadastro com o endereço digitado à mão depois da falha', async () => {
    /*
     * ARRANGE — a promessa inteira da capability em um teste: o terceiro caiu e a ficha
     * segue. Provar que o campo continua editável não basta; o que a recepção precisa é
     * que o cadastro CHEGUE ao servidor.
     */
    prepararServicoDeCep(() => new HttpResponse(null, { status: 503 }))
    const usuario = userEvent.setup()
    renderizarRecepcao()
    // DEPOIS do render: `servidor.use` prepende, e os handlers padrão de `renderizarRecepcao`
    // venceriam este se ele fosse registrado antes
    let enviado: Record<string, unknown> | null = null
    servidor.use(
      msw.post('/api/pacientes', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 1, nome: 'Paciente Fictício Adulto' }, { status: 201 })
      }),
    )
    await screen.findByLabelText('CEP')

    // ACT — o CEP falha, e a pessoa preenche o endereço à mão
    await usuario.type(screen.getByLabelText('CEP'), '88501050')
    expect(await screen.findByText(/Preencha à mão/)).toBeInTheDocument()

    // colar em vez de digitar: o teste mede o CAMINHO, não a velocidade do teclado — e com os
    // contadores dos campos com teto cada tecla passou a custar um render a mais
    await usuario.click(screen.getByLabelText(/^Nome \(obrigatório\)/))
    await usuario.paste('Paciente Fictício Adulto')
    await usuario.type(screen.getByLabelText(/Nascimento/), '1990-01-01')
    await usuario.click(screen.getByLabelText('Logradouro'))
    await usuario.paste('Rua Fictícia Digitada')
    await usuario.click(screen.getByLabelText('Bairro'))
    await usuario.paste('Centro Fictício')
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    const endereco = (enviado as unknown as { endereco_json: Record<string, unknown> }).endereco_json
    expect(endereco['logradouro']).toBe('Rua Fictícia Digitada')
    expect(endereco['cep']).toBe('88501050')
  })

  it('NÃO deve oferecer consulta quando a clínica esconde o CEP', async () => {
    // ARRANGE
    prepararServicoDeCep()
    renderizarRecepcao(reguaFicticia({ endereco_cep: { desabilitado: true } }))
    await screen.findByLabelText('Logradouro')

    // ASSERT
    expect(screen.queryByLabelText('CEP')).not.toBeInTheDocument()
  })
})

describe('O CEP preenche o endereço — formulário público', () => {
  it('deve preencher do mesmo modo que na recepção', async () => {
    // ARRANGE — a MESMA peça: a família não pode ter experiência diferente da recepção
    prepararServicoDeCep()
    const usuario = userEvent.setup()
    renderizarPublico()

    await screen.findByRole('heading', { name: 'Centro Fictício Exemplo' })
    await usuario.type(screen.getByRole('textbox', { name: /Nome/ }), 'Criança Fictícia')
    await usuario.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15032018')
    await usuario.click(screen.getByRole('button', { name: /Continuar/ }))

    // ACT
    await usuario.type(await screen.findByLabelText(/CEP/), '88501050')

    // ASSERT
    await waitFor(() => {
      expect(screen.getByLabelText(/Logradouro/)).toHaveValue('Rua Fictícia das Acácias')
    })
    expect(screen.getByLabelText(/Cidade/)).toHaveValue('Lages')
    expect(screen.getByLabelText(/Complemento/)).toHaveValue('')
  })
})
