import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { FormularioPublico, ReguaDoCadastro } from '@/tipos'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaCadastroPublico } from '@/paginas/pagina-cadastro-publico'
import { PaginaPaciente } from '@/paginas/pagina-paciente'
import { useAuthStore } from '@/stores/auth-store'
import { handlersDeCadastros, reguaFicticia } from '@/test/dados-cadastros'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

/**
 * O TETO DO SERVIDOR CHEGA AO CAMPO (change `tetos-do-cadastro-na-tela`).
 *
 * O chamado que originou tudo, em 04/09/2026: a recepção preencheu a ficha inteira e o servidor
 * recusou o logradouro por tamanho — sem contador, sem trava no campo e sem dizer o tamanho. O
 * que estes testes prendem não é o número: é que ele venha do SERVIDOR. Tela que mantém o
 * próprio teto diverge do boundary sem produzir erro — produz uma recepção perdendo ficha.
 *
 * Dados 100% FICTÍCIOS (LGPD).
 */
function comTeto(campo: string, tamanho: number | null): ReguaDoCadastro {
  const regua = reguaFicticia()

  return {
    ...regua,
    campos: regua.campos.map((c) => (c.campo === campo ? { ...c, tamanho } : c)),
  }
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

describe('O teto vem do servidor — recepção', () => {
  it('deve travar o campo no teto que a RÉGUA mandou', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarRecepcao()
    const campo = await screen.findByLabelText('Logradouro')

    // ACT — colar, que além de rápido é o que a recepção de fato faz
    await usuario.click(campo)
    await usuario.paste('a'.repeat(520))

    // ASSERT — 500 é o que a régua declara para `endereco_logradouro`
    expect((campo as HTMLInputElement).value).toHaveLength(500)
  })

  it('deve SEGUIR a régua quando ela muda, sem número escrito na tela', async () => {
    /*
     * ARRANGE — é este o teste que impede a tela de manter o próprio número. Se alguém
     * escrever `limite={500}` no componente, o campo continuará em 500 e este teste cai.
     */
    const usuario = userEvent.setup()
    renderizarRecepcao(comTeto('endereco_logradouro', 30))
    const campo = await screen.findByLabelText('Logradouro')

    // ACT
    await usuario.click(campo)
    await usuario.paste('a'.repeat(60))

    // ASSERT
    expect((campo as HTMLInputElement).value).toHaveLength(30)
  })

  it('NÃO deve travar campo que o servidor não limita', async () => {
    // ARRANGE — inventar teto onde o servidor não tem é o defeito espelho
    const usuario = userEvent.setup()
    renderizarRecepcao(comTeto('endereco_logradouro', null))
    const campo = await screen.findByLabelText('Logradouro')

    // ACT
    await usuario.click(campo)
    await usuario.paste('a'.repeat(60))

    // ASSERT
    expect((campo as HTMLInputElement).value).toHaveLength(60)
    expect(campo).not.toHaveAttribute('maxlength')
  })

  it('deve avisar quando o texto se aproxima do teto', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarRecepcao(comTeto('endereco_logradouro', 20))

    // ACT
    await usuario.click(await screen.findByLabelText('Logradouro'))
    await usuario.paste('a'.repeat(15))

    // ASSERT
    expect(await screen.findByText('5 caracteres restantes')).toBeInTheDocument()
  })

  it('deve levar o teto também aos campos das LISTAS', async () => {
    // ARRANGE — sem isto, nome do responsável e valor do contato seriam os únicos campos de
    // texto do cadastro a continuar reclamando só no salvar
    const usuario = userEvent.setup()
    renderizarRecepcao()
    await screen.findByLabelText('Logradouro')

    // ACT — o "Nome" sem "(obrigatório)" é o do responsável; o do paciente leva a marca
    const doResponsavel = screen.getByLabelText('Nome')
    await usuario.click(doResponsavel)
    await usuario.paste('a'.repeat(270))

    // ASSERT — 255, que é o teto do subcampo `nome` de `responsaveis_json`
    expect((doResponsavel as HTMLInputElement).value).toHaveLength(255)
  })

  it('deve salvar a ficha inteira sem recusa por tamanho — o caso da clínica', async () => {
    /*
     * ARRANGE — a regressão do chamado de 04/09/2026, com dados fictícios: a pessoa cola no
     * logradouro um texto maior que o teto, preenche o resto e salva. Antes, o servidor
     * recusava e a ficha inteira se perdia; agora o campo trava e o cadastro passa.
     */
    const usuario = userEvent.setup()
    renderizarRecepcao()
    await screen.findByLabelText('Logradouro')

    let enviado: Record<string, unknown> | null = null
    servidor.use(
      msw.post('/api/pacientes', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 1, nome: 'Paciente Fictício Adulto' }, { status: 201 })
      }),
    )

    // ACT
    await usuario.click(screen.getByLabelText('Logradouro'))
    await usuario.paste('Rua Fictícia '.repeat(60))
    await usuario.type(screen.getByLabelText(/^Nome \(obrigatório\)/), 'Paciente Fictício Adulto')
    await usuario.type(screen.getByLabelText(/Nascimento/), '1990-01-01')
    await usuario.type(screen.getByLabelText('Bairro'), 'Centro Fictício')
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — chegou ao servidor, e dentro do teto
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    const endereco = (enviado as unknown as { endereco_json: Record<string, string> }).endereco_json
    expect(endereco['logradouro']).toHaveLength(500)
  })
})

describe('O teto vem do servidor — formulário público', () => {
  const FORMULARIO: FormularioPublico = {
    clinica: { nome: 'Centro Fictício Exemplo', identidade: 'nome', fonte_do_nome: 'padrao' },
    secoes: [{ secao: 'identificacao', rotulo: 'Identificação' }],
    campos: [
      { campo: 'nome', rotulo: 'Nome', secao: 'identificacao', lista: false, obrigatorio: true, tamanho: 255, tamanhos_dos_itens: {} },
      { campo: 'indicacao', rotulo: 'Indicação', secao: 'identificacao', lista: false, obrigatorio: false, tamanho: 25, tamanhos_dos_itens: {} },
    ],
  }

  it('deve travar também os campos das LISTAS', async () => {
    // ARRANGE — achado TETO-04 do gate: a change promete "as duas bordas", e os subcampos de
    // responsável e contato tinham ficado sem teto no formulário público. A família preenche,
    // envia e leva o 422 sem recepção por perto para traduzir
    const comLista: FormularioPublico = {
      ...FORMULARIO,
      secoes: [...FORMULARIO.secoes, { secao: 'responsaveis', rotulo: 'Responsáveis' }],
      campos: [
        ...FORMULARIO.campos,
        {
          campo: 'responsaveis_json',
          rotulo: 'Responsáveis',
          secao: 'responsaveis',
          lista: true,
          obrigatorio: false,
          tamanho: null,
          tamanhos_dos_itens: { nome: 255, parentesco: 60, telefone: 20, email: 255 },
        },
      ],
    }
    servidor.use(msw.get('/api/publico/cadastro/:slug', () => HttpResponse.json(comLista)))
    const usuario = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/cadastro/abc123xyz9876543']}>
          <Routes>
            <Route path="/cadastro/:slug" element={<PaginaCadastroPublico />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await usuario.type(await screen.findByLabelText(/^Nome/), 'Criança Fictícia')
    await usuario.type(screen.getByLabelText(/^Indicação/), 'x')
    await usuario.click(screen.getByRole('button', { name: /Continuar/ }))

    // ACT
    const parentesco = await screen.findByLabelText(/^Parentesco/)
    await usuario.click(parentesco)
    await usuario.paste('a'.repeat(90))

    // ASSERT — 60, que é o teto do subcampo `parentesco`
    expect((parentesco as HTMLInputElement).value).toHaveLength(60)
  })

  it('deve travar o campo no teto que o servidor mandou', async () => {
    // ARRANGE — a família não pode ter experiência diferente da recepção
    servidor.use(msw.get('/api/publico/cadastro/:slug', () => HttpResponse.json(FORMULARIO)))
    const usuario = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/cadastro/abc123xyz9876543']}>
          <Routes>
            <Route path="/cadastro/:slug" element={<PaginaCadastroPublico />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByRole('textbox', { name: /Nome/ })

    // ACT
    const indicacao = screen.getByRole('textbox', { name: /Indicação/ })
    await usuario.click(indicacao)
    await usuario.paste('a'.repeat(40))

    // ASSERT
    expect((indicacao as HTMLInputElement).value).toHaveLength(25)
  })
})
