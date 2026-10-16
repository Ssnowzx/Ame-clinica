import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { PaginaCadastroPublico } from '@/paginas/pagina-cadastro-publico'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { FormularioPublico } from '@/tipos'

/**
 * A página que a família abre pelo link (change `cadastro-online-do-paciente`).
 *
 * Ela é a única tela do produto que uma pessoa sem conta vê, e a única em que o leitor é leigo. Os
 * testes aqui perseguem isso: nenhuma chamada autenticada, data em português mesmo com o navegador
 * em inglês, responsável exigido só quando a data indica menor, e a conclusão que não promete o
 * que não vai acontecer.
 */
const FORMULARIO: FormularioPublico = {
  clinica: { nome: 'Centro Fictício Exemplo', identidade: 'nome', fonte_do_nome: 'padrao', tema: 'padrao' },
  secoes: [
    { secao: 'identificacao', rotulo: 'Identificação' },
    { secao: 'responsaveis', rotulo: 'Responsáveis' },
    { secao: 'contatos', rotulo: 'Contatos' },
  ],
  campos: [
    { campo: 'nome', rotulo: 'Nome', secao: 'identificacao', lista: false, obrigatorio: true, tamanho: 255, tamanhos_dos_itens: {} },
    { campo: 'nascimento', rotulo: 'Nascimento', secao: 'identificacao', lista: false, obrigatorio: true, tamanho: null, tamanhos_dos_itens: {} },
    { campo: 'sexo', rotulo: 'Sexo', secao: 'identificacao', lista: false, obrigatorio: false, tamanho: null, tamanhos_dos_itens: {} },
    { campo: 'responsaveis_json', rotulo: 'Responsáveis', secao: 'responsaveis', lista: true, obrigatorio: false, tamanho: null, tamanhos_dos_itens: { nome: 255, parentesco: 60, telefone: 20, email: 255 } },
    { campo: 'contatos_json', rotulo: 'Contatos', secao: 'contatos', lista: true, obrigatorio: false, tamanho: null, tamanhos_dos_itens: { valor: 255, obs: 255 } },
  ],
}

function prepararFormulario(resposta: () => Response = () => HttpResponse.json(FORMULARIO)) {
  servidor.use(msw.get('/api/publico/cadastro/:slug', resposta))
}

function renderizar(slug = 'abc123xyz9876543') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/cadastro/${slug}`]}>
        <Routes>
          <Route path="/cadastro/:slug" element={<PaginaCadastroPublico />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * O texto de TODAS as regiões vivas da página.
 *
 * O passo do assistente é anunciado como estado (`role="status"`), e era o único — daí o
 * `getByRole('status')` original. Com a change `tetos-do-cadastro-na-tela`, cada campo com teto
 * ganhou a própria região viva (preexistente e vazia, que é o padrão correto), e a consulta
 * singular passou a ser ambígua. O que o teste quer continua sendo o mesmo: o passo é anunciado.
 */
function textoDosStatus(): string {
  return screen
    .getAllByRole('status')
    .map((no) => no.textContent ?? '')
    .join(' | ')
}

describe('Cadastro público — a página que a família abre', () => {
  it('deve abrir com a marca da clínica e os campos da régua', async () => {
    // ARRANGE
    prepararFormulario()

    // ACT
    renderizar()

    // ASSERT — a marca no topo, e os campos que o SERVIDOR mandou
    expect(await screen.findByRole('heading', { name: 'Centro Fictício Exemplo' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Nome/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Nascimento/ })).toBeInTheDocument()
  })

  it('NÃO deve fazer nenhuma chamada autenticada', async () => {
    // ARRANGE — o shell consulta sessão, contadores e permissões; esta página não tem conta por
    // trás, e montá-lo aqui seria uma tela que falha em toda chamada
    const chamadas: string[] = []
    servidor.events.on('request:start', ({ request }) => {
      chamadas.push(new URL(request.url).pathname)
    })
    prepararFormulario()

    // ACT
    renderizar()
    await screen.findByRole('heading', { name: 'Centro Fictício Exemplo' })

    // ASSERT — só a rota pública; nada de `/api/me`, nada de notificações
    expect(chamadas.every((caminho) => caminho.startsWith('/api/publico/'))).toBe(true)
  })

  it('deve mostrar a MESMA tela para link desligado e para endereço inexistente', async () => {
    // ARRANGE — o servidor já responde igual nos dois casos; se a tela os separasse, o oráculo
    // que ele fechou voltaria pela interface
    prepararFormulario(() => HttpResponse.json({ message: 'indisponível' }, { status: 404 }))

    // ACT
    renderizar()

    // ASSERT — e ela NÃO diz se a clínica existe
    const titulo = await screen.findByRole('heading', { name: 'Este link não está disponível' })
    expect(titulo).toBeInTheDocument()
    expect(screen.queryByText(/Centro Fictício/)).not.toBeInTheDocument()
  })

  it('deve parar no passo quando falta obrigatório, com o erro NO campo', async () => {
    // ARRANGE
    prepararFormulario()
    renderizar()
    await screen.findByRole('textbox', { name: /Nome/ })

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ASSERT — continua no passo 1, e o erro está no campo (não num aviso solto no topo)
    expect(textoDosStatus()).toContain('Passo 1 de 3')
    expect(screen.getByRole('textbox', { name: /Nome/ })).toHaveAccessibleDescription(/Preencha este campo/)
  })

  it('deve tratar a data como BRASILEIRA mesmo com o navegador em inglês', async () => {
    // ARRANGE — é o defeito que a referência tem: ela usa o campo nativo, e o campo nativo segue
    // o idioma do aparelho. Numa página de famílias brasileiras, `03/04` deixa de ter significado
    const locale = navigator.language
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
    prepararFormulario()
    renderizar()
    const nascimento = await screen.findByRole('textbox', { name: /Nascimento/ })

    // ACT — a família digita só os números
    await userEvent.type(nascimento, '15032018')

    // ASSERT — dia/mês/ano, com as barras postas pela tela
    expect(nascimento).toHaveValue('15/03/2018')
    expect(nascimento).toHaveAccessibleDescription(/dia\/mês\/ano/)

    Object.defineProperty(navigator, 'language', { value: locale, configurable: true })
  })

  it('deve recusar data que não existe, em vez de corrigi-la em silêncio', async () => {
    // ARRANGE — `31/02` virando `03/03` gravaria outra coisa, e o cadastro de uma criança não é
    // lugar para o sistema adivinhar o que a família quis dizer
    prepararFormulario()
    renderizar()
    const nascimento = await screen.findByRole('textbox', { name: /Nascimento/ })

    // ACT
    await userEvent.type(screen.getByRole('textbox', { name: /Nome/ }), 'Criança Fictícia')
    await userEvent.type(nascimento, '31022018')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ASSERT
    expect(nascimento).toHaveAccessibleDescription(/Confira a data/)
    expect(textoDosStatus()).toContain('Passo 1 de 3')
  })

  it('deve exigir responsável SÓ quando a data indica menor de idade', async () => {
    // ARRANGE — é a lei (art. 14), não preferência da clínica. Quem decide é o servidor; a tela
    // avisa antes para a família não descobrir a exigência só ao enviar
    prepararFormulario()
    renderizar()
    await screen.findByRole('textbox', { name: /Nome/ })

    // ACT — maior de idade
    await userEvent.type(screen.getByRole('textbox', { name: /Nome/ }), 'Adulto Fictício')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15031980')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ASSERT — passa, e o texto não exige responsável
    expect(await screen.findByText('Se quiser, informe um responsável.')).toBeInTheDocument()
  })

  it('deve barrar o menor sem responsável, e deixar passar com ele', async () => {
    // ARRANGE
    prepararFormulario()
    renderizar()
    await screen.findByRole('textbox', { name: /Nome/ })
    await userEvent.type(screen.getByRole('textbox', { name: /Nome/ }), 'Criança Fictícia')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15032018')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await screen.findByText('Para menor de idade, informe pelo menos um responsável.')

    // ACT — tenta avançar sem responsável
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ASSERT — para no passo 2
    expect(textoDosStatus()).toContain('Passo 2 de 3')
    expect(screen.getByRole('textbox', { name: /Nome do responsável/ }))
      .toHaveAccessibleDescription(/pelo menos um responsável/)

    // ACT — com responsável, avança
    await userEvent.type(screen.getByRole('textbox', { name: /Nome do responsável/ }), 'Responsável Fictícia')
    await userEvent.type(screen.getByRole('textbox', { name: /Parentesco/ }), 'Mãe')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ASSERT
    expect(textoDosStatus()).toContain('Passo 3 de 3')
  })

  it('NÃO deve escrever nada antes da conclusão', async () => {
    // ARRANGE — o assistente inteiro é local até a família clicar em enviar
    const escritas: string[] = []
    servidor.events.on('request:start', ({ request }) => {
      if (request.method === 'POST') escritas.push(request.url)
    })
    prepararFormulario()
    renderizar()
    await screen.findByRole('textbox', { name: /Nome/ })

    // ACT — percorre os dois primeiros passos
    await userEvent.type(screen.getByRole('textbox', { name: /Nome/ }), 'Adulto Fictício')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15031980')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ASSERT
    expect(escritas).toEqual([])
  })

  it('deve confirmar o recebimento sem prometer cadastro pronto, e sem ecoar o enviado', async () => {
    // ARRANGE
    prepararFormulario()
    servidor.use(
      msw.post('/api/publico/cadastro/:slug', () =>
        HttpResponse.json({ mensagem: 'Recebemos o seu cadastro. A clínica vai conferir os dados e entrar em contato.' }, { status: 201 }),
      ),
    )
    renderizar()
    await screen.findByRole('textbox', { name: /Nome/ })
    await userEvent.type(screen.getByRole('textbox', { name: /Nome/ }), 'Adulto Fictício')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15031980')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Enviar cadastro' }))

    // ASSERT — confirma o RECEBIMENTO, diz que a clínica vai conferir, e não devolve o dado
    expect(await screen.findByRole('heading', { name: 'Cadastro enviado' })).toBeInTheDocument()
    // UMA vez. A tela dizia a mesma coisa duas vezes, com palavras diferentes, na tela mais
    // calma do produto (design-QA, achado 18) — e o teste antigo cimentava a repetição
    expect(screen.getAllByText(/vai conferir os dados/)).toHaveLength(1)
    expect(screen.getByText(/entramos em contato/)).toBeInTheDocument()
    expect(screen.queryByText('Adulto Fictício')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enviar cadastro' })).not.toBeInTheDocument()
  })

  it('deve PRESERVAR o preenchimento quando o envio falha', async () => {
    // ARRANGE — falha de rede não pode custar o formulário inteiro: quem preencheu no celular,
    // com a criança no colo, não vai preencher de novo
    prepararFormulario()
    servidor.use(msw.post('/api/publico/cadastro/:slug', () => HttpResponse.error()))
    renderizar()
    await screen.findByRole('textbox', { name: /Nome/ })
    await userEvent.type(screen.getByRole('textbox', { name: /Nome/ }), 'Adulto Fictício')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15031980')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Enviar cadastro' }))

    // ASSERT — o aviso aparece e o preenchimento continua lá
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/tente de novo/)
    })
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByRole('textbox', { name: /Nome/ })).toHaveValue('Adulto Fictício')
  })

  it('deve traduzir a recusa do servidor para o campo certo', async () => {
    // ARRANGE — quem está do outro lado é uma família, não um integrador: a recusa chega em
    // português e no campo, não como erro solto com nome de coluna
    prepararFormulario()
    servidor.use(
      msw.post('/api/publico/cadastro/:slug', () =>
        HttpResponse.json(
          { message: 'erro', errors: { nome: ['O formulário mudou desde que você o abriu. Atualize a página.'] } },
          { status: 422 },
        ),
      ),
    )
    renderizar()
    await screen.findByRole('textbox', { name: /Nome/ })
    await userEvent.type(screen.getByRole('textbox', { name: /Nome/ }), 'Adulto Fictício')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15031980')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Enviar cadastro' }))

    // ASSERT — volta para o passo do campo recusado, com a mensagem nele
    await waitFor(() => {
      expect(textoDosStatus()).toContain('Passo 1 de 3')
    })
    expect(screen.getByRole('textbox', { name: /Nome/ })).toHaveAccessibleDescription(/Atualize a página/)
  })

  it('deve levar ao campo a recusa de um item de LISTA, que vem em chave pontilhada', async () => {
    // ARRANGE — responsáveis e contatos se repetem, e por isso o servidor recusa em
    // `responsaveis_json.0.nome`, não em `responsaveis_json`. Uma tela que só procura a raiz
    // deixa a família sem mensagem NENHUMA: o campo fica limpo, o aviso do topo não aparece
    // (houve erro do servidor) e o assistente cai na revisão sem dizer o que corrigir
    prepararFormulario()
    servidor.use(
      msw.post('/api/publico/cadastro/:slug', () =>
        HttpResponse.json(
          { message: 'erro', errors: { 'responsaveis_json.0.nome': ['O nome do responsável é obrigatório.'] } },
          { status: 422 },
        ),
      ),
    )
    renderizar()
    await screen.findByRole('textbox', { name: /Nome/ })
    await userEvent.type(screen.getByRole('textbox', { name: /^Nome/ }), 'Criança Fictícia')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15032018')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.type(screen.getByRole('textbox', { name: /Nome do responsável/ }), 'Adulto Fictício')
    await userEvent.type(screen.getByRole('textbox', { name: /Parentesco/ }), 'Mãe')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Enviar cadastro' }))

    // ASSERT — volta ao passo dos responsáveis, com a mensagem NO campo do item recusado
    await waitFor(() => {
      expect(textoDosStatus()).toContain('Passo 2 de 3')
    })
    expect(screen.getByRole('textbox', { name: /Nome do responsável/ }))
      .toHaveAccessibleDescription(/nome do responsável é obrigatório/)
  })

  it('deve levar a recusa ao item CERTO quando o recusado não é o primeiro', async () => {
    // ARRANGE — mostrar o erro do segundo contato em cima do primeiro manda a família corrigir
    // um campo que está certo, e o envio falha de novo sem que ela entenda por quê
    prepararFormulario()
    servidor.use(
      msw.post('/api/publico/cadastro/:slug', () =>
        HttpResponse.json(
          { message: 'erro', errors: { 'contatos_json.1.valor': ['Confira este telefone.'] } },
          { status: 422 },
        ),
      ),
    )
    renderizar()
    await screen.findByRole('textbox', { name: /Nome/ })
    await userEvent.type(screen.getByRole('textbox', { name: /^Nome/ }), 'Adulto Fictício')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15031980')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar outro contato' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Enviar cadastro' }))

    // ASSERT — o SEGUNDO contato carrega a mensagem; o primeiro segue limpo
    await waitFor(() => {
      expect(textoDosStatus()).toContain('Passo 2 de 3')
    })
    const contatos = screen.getAllByRole('textbox', { name: /^Contato/ })
    expect(contatos[1]).toHaveAccessibleDescription(/Confira este telefone/)
    expect(contatos[0]).not.toHaveAccessibleDescription(/Confira este telefone/)
  })

  it('deve manter UM h1 e dar o título da aba à clínica', async () => {
    // ARRANGE — é a única página que alguém sem conta abre: a aba dizia o nome interno do produto
    prepararFormulario()

    // ACT
    renderizar()

    // ASSERT
    await screen.findByRole('textbox', { name: /Nome/ })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.title).toBe('Cadastro de paciente — Centro Fictício Exemplo')
  })

  it('deve manter o h1 quando a clínica se identifica por LOGO', async () => {
    // ARRANGE — trocar o h1 pela imagem deixava a página inteira sem nenhum cabeçalho
    prepararFormulario(() => HttpResponse.json({ ...FORMULARIO, clinica: { ...FORMULARIO.clinica, identidade: 'logo' } }))

    // ACT
    renderizar()

    // ASSERT — o h1 continua lá, com a logo dentro e o nome da clínica como alternativa
    await screen.findByRole('textbox', { name: /Nome/ })
    expect(screen.getByRole('heading', { level: 1, name: 'Centro Fictício Exemplo' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Centro Fictício Exemplo' })).toBeInTheDocument()
  })

  it('deve OFERECER nova tentativa quando o formulário não carrega por rede', async () => {
    // ARRANGE — a cópia mandava "tente de novo" sem oferecer como
    prepararFormulario(() => HttpResponse.error())

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByRole('heading', { name: /não está disponível/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
  })

  it('NÃO deve oferecer nova tentativa quando o link é que não vale', async () => {
    // ARRANGE — insistir num endereço que o servidor recusa não muda a resposta, e o botão
    // convidaria a família a tentar de novo para sempre
    prepararFormulario(() => new HttpResponse(null, { status: 404 }))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByRole('heading', { name: /não está disponível/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument()
  })

  it('deve CONFERIR também os responsáveis e os contatos, em português', async () => {
    // ARRANGE — a tela promete "confira os dados antes de enviar" e escondia justamente o
    // responsável do menor, que é exigência legal e o dado que mais se erra
    prepararFormulario()
    renderizar()
    await screen.findByRole('textbox', { name: /^Nome/ })
    await userEvent.type(screen.getByRole('textbox', { name: /^Nome/ }), 'Criança Fictícia')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15032018')
    // a escolha é feita de propósito: sem ela o campo fica vazio e sai da conferência, e o
    // teste passaria mesmo com o valor de máquina na tela
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Sexo/ }), 'nao_informado')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.type(screen.getByRole('textbox', { name: /Nome do responsável/ }), 'Adulto Fictício')
    await userEvent.type(screen.getByRole('textbox', { name: /Parentesco/ }), 'Mãe')
    await userEvent.type(screen.getByRole('textbox', { name: /^Contato/ }), '48999998888')

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ASSERT — as listas aparecem, e nenhum valor de máquina sobra na conferência
    expect(await screen.findByText('Responsável 1')).toBeInTheDocument()
    expect(screen.getByText(/Adulto Fictício . Mãe/)).toBeInTheDocument()
    expect(screen.getByText('48999998888')).toBeInTheDocument()
    expect(screen.getByText('Prefiro não informar')).toBeInTheDocument()
    expect(screen.queryByText('nao_informado')).not.toBeInTheDocument()
  })

  it('deve AGRUPAR cada responsável, para o leitor de tela saber de qual se trata', async () => {
    // ARRANGE — com dois na tela, "Nome do responsável" era anunciado duas vezes sem distinção;
    // o agrupamento existia só como borda, e a borda tem contraste de 1,29:1
    prepararFormulario()
    renderizar()
    await screen.findByRole('textbox', { name: /^Nome/ })
    await userEvent.type(screen.getByRole('textbox', { name: /^Nome/ }), 'Criança Fictícia')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15032018')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar outro responsável' }))

    // ASSERT
    expect(screen.getByRole('group', { name: 'Responsável 1' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Responsável 2' })).toBeInTheDocument()
  })

  it('deve levar o FOCO ao primeiro campo recusado, e não deixá-lo no botão', async () => {
    // ARRANGE — vários avisos sobem ao mesmo tempo e o foco ficava no rodapé: quem não enxerga
    // ouve as reclamações sem saber em qual campo está a primeira
    prepararFormulario()
    renderizar()
    await screen.findByRole('textbox', { name: /^Nome/ })

    // ACT — tenta avançar com os obrigatórios em branco
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /^Nome/ })).toHaveFocus()
    })
  })

  it('deve mostrar no TOPO a recusa de um campo que não está na tela', async () => {
    // ARRANGE — a clínica desliga um campo enquanto a família tem o formulário aberto: o servidor
    // recusa nomeando um campo que, por definição, não está mais sendo desenhado. Sem esta rede,
    // a mensagem que existe justamente para explicar isso não chegava a ninguém
    prepararFormulario()
    servidor.use(
      msw.post('/api/publico/cadastro/:slug', () =>
        HttpResponse.json(
          { message: 'erro', errors: { cpf: ['O formulário mudou desde que você o abriu. Atualize a página.'] } },
          { status: 422 },
        ),
      ),
    )
    renderizar()
    await screen.findByRole('textbox', { name: /Nome/ })
    await userEvent.type(screen.getByRole('textbox', { name: /^Nome/ }), 'Adulto Fictício')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15031980')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Enviar cadastro' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Atualize a página/)
    })
  })
})

describe('Cadastro pelo link — as cores da clínica (change tema-da-clinica)', () => {
  it('deve abrir o formulário no tema da clínica e tirá-lo ao sair', async () => {
    // ARRANGE — a família reconhece a clínica também pela cor
    prepararFormulario(() => HttpResponse.json({ ...FORMULARIO, clinica: { ...FORMULARIO.clinica, tema: 'menta' } }))

    // ACT
    const { unmount } = renderizar()
    await screen.findByRole('heading', { level: 1 })

    // ASSERT
    await waitFor(() => {
      expect(document.documentElement.dataset.tema).toBe('menta')
    })
    unmount()
    expect(document.documentElement.dataset.tema).toBeUndefined()
  })

  it('não deve aplicar tema quando a clínica está no Padrão', async () => {
    // ARRANGE
    prepararFormulario()

    // ACT
    renderizar()
    await screen.findByRole('heading', { level: 1 })

    // ASSERT
    expect(document.documentElement.dataset.tema).toBeUndefined()
  })
  it('deve avisar a família, ao sair do campo, o celular que não recebe WhatsApp, e deixar enviar', async () => {
    // ARRANGE — change telefone-que-chega-no-whatsapp: DDI na frente e um dígito a menos, como em
    // 02/10. O aviso NÃO bloqueia, e é só de validade: nunca diz se o número já existe
    prepararFormulario()
    let enviado: Record<string, unknown> | null = null
    let perguntouPeloRepetido = false
    servidor.use(
      msw.post('/api/publico/cadastro/:slug', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ recebido: true }, { status: 201 })
      }),
      msw.post('/api/pacientes/telefone/conferir', () => {
        perguntouPeloRepetido = true
        return HttpResponse.json({ forma: null, tipo: null, tambem_em: [], total: 0 })
      }),
    )
    renderizar()
    await screen.findByRole('textbox', { name: /Nome/ })
    await userEvent.type(screen.getByRole('textbox', { name: /^Nome/ }), 'Adulto Fictício')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15031990')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    const contato = screen.getByRole('textbox', { name: /^Contato/ })

    // ACT
    await userEvent.type(contato, '55 49912-3456')
    await userEvent.tab()

    // ASSERT
    expect(contato).toHaveAccessibleDescription(
      'Este número não recebe WhatsApp. Confira o DDD e a quantidade de dígitos.',
    )

    // ACT — o envio continua permitido
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar cadastro' }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(JSON.stringify(enviado)).toContain('55 49912-3456')
    // e nunca perguntou se o número existe — seria contar que outra criança é paciente
    expect(perguntouPeloRepetido).toBe(false)
  })

  it('deve deixar a família escolher o país e enviar o número com o código (Reino Unido)', async () => {
    // ARRANGE — change telefone-estrangeiro: o país vem antes do número, já em Brasil. Faixa de
    // ficção da Ofcom (`+44 7700 900xxx`)
    prepararFormulario()
    let enviado: Record<string, unknown> | null = null
    servidor.use(
      msw.post('/api/publico/cadastro/:slug', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ recebido: true }, { status: 201 })
      }),
    )
    renderizar()
    await screen.findByRole('textbox', { name: /Nome/ })
    await userEvent.type(screen.getByRole('textbox', { name: /^Nome/ }), 'Adulto Fictício')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15031990')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    const pais = screen.getByRole('combobox', { name: 'País do telefone' })
    const contato = screen.getByRole('textbox', { name: /^Contato/ })
    expect(pais).toHaveDisplayValue('Brasil +55')

    // ACT
    await userEvent.selectOptions(pais, 'GB')
    await userEvent.type(contato, '7700 900123')
    await userEvent.tab()

    // ASSERT
    await waitFor(() => {
      expect(contato).toHaveAccessibleDescription('WhatsApp: +447700900123')
    })

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar cadastro' }))

    // ASSERT — o que se grava é um texto só, com o código na frente
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(JSON.stringify(enviado)).toContain('+44 7700 900123')
  })

  it('NÃO deve perguntar se um celular VÁLIDO já existe na clínica', async () => {
    // ARRANGE — o número bom é justamente o que a tela interna conferiria. E a sessão TEM
    // `pacientes.ver`: alguém da equipe abrindo o link no mesmo navegador não pode transformar o
    // formulário da família num oráculo da base
    useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: ['pacientes.ver'] }, carregandoSessao: false })
    prepararFormulario()
    let perguntouPeloRepetido = false
    servidor.use(
      msw.post('/api/pacientes/telefone/conferir', () => {
        perguntouPeloRepetido = true
        return HttpResponse.json({ forma: null, tipo: null, tambem_em: [], total: 0 })
      }),
    )
    renderizar()
    await screen.findByRole('textbox', { name: /Nome/ })
    await userEvent.type(screen.getByRole('textbox', { name: /^Nome/ }), 'Adulto Fictício')
    await userEvent.type(screen.getByRole('textbox', { name: /Nascimento/ }), '15031990')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    const contato = screen.getByRole('textbox', { name: /^Contato/ })

    // ACT
    await userEvent.type(contato, '(49) 99123-4567')
    await userEvent.tab()

    // ASSERT — diz para onde vai, e só
    expect(contato).toHaveAccessibleDescription('WhatsApp: +55 (49) 99123-4567')
    expect(perguntouPeloRepetido).toBe(false)
  })
})
