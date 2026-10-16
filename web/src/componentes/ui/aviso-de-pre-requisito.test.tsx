import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { CaminhoDoCadastro } from '@/lib/caminhos-dos-cadastros'

import { AcaoDoPreRequisito, AvisoDePreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CAMINHOS, caminhoDaFichaDoProfissional, caminhoDoPacoteDoPaciente } from '@/lib/caminhos-dos-cadastros'
import { useAuthStore } from '@/stores/auth-store'
import { usuarioFicticio } from '@/test/servidor-msw'

expect.extend(toHaveNoViolations)

function comPermissoes(permissoes: string[]): void {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })
}

describe('AvisoDePreRequisito — o caminho conforme a permissão', () => {
  it('deve oferecer o link para o cadastro a quem pode cadastrar', () => {
    // ARRANGE
    comPermissoes(['especialidades.ver', 'especialidades.criar'])

    // ACT
    render(
      <MemoryRouter>
        <AvisoDePreRequisito para={CAMINHOS.especialidade} oQueFalta="Nenhuma especialidade cadastrada." />
      </MemoryRouter>,
    )

    // ASSERT
    expect(screen.getByText(/Nenhuma especialidade cadastrada\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cadastrar em Cadastros › Especialidades' })).toHaveAttribute('href', '/especialidades')
  })

  it('deve dizer a quem pedir, sem link, a quem não pode cadastrar', () => {
    // ARRANGE
    comPermissoes(['especialidades.ver'])

    // ACT
    render(
      <MemoryRouter>
        <AvisoDePreRequisito para={CAMINHOS.especialidade} oQueFalta="Nenhuma especialidade cadastrada." />
      </MemoryRouter>,
    )

    // ASSERT
    expect(screen.getByText(/Peça a quem administra o sistema para cadastrar\./)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve exigir TODAS as permissões do caminho — criar sem ver leva a uma tela bloqueada', () => {
    // ARRANGE — pode editar o paciente e criar pacote, mas não VÊ os pacotes: o bloco nem aparece lá (CR-AVI-01)
    comPermissoes(['pacientes.ver', 'pacientes.editar', 'tratamentos.criar'])

    // ACT
    render(
      <MemoryRouter>
        <AvisoDePreRequisito para={caminhoDoPacoteDoPaciente(7)} oQueFalta="A criança não tem pacote." />
      </MemoryRouter>,
    )

    // ASSERT
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText(/Peça a quem administra o sistema para cadastrar o pacote\./)).toBeInTheDocument()
  })

  it('deve sublinhar o link — dentro do texto, só a cor não o distingue (WCAG 1.4.1)', () => {
    // ARRANGE
    comPermissoes(['contas.ver', 'contas.criar'])

    // ACT
    render(
      <MemoryRouter>
        <AvisoDePreRequisito para={CAMINHOS.conta} oQueFalta="Nenhuma conta cadastrada." />
      </MemoryRouter>,
    )

    // ASSERT
    expect(screen.getByRole('link').className).toMatch(/(^|\s)underline(\s|$)/)
  })

  it('deve dar o caminho em texto, sem link, num formulário que perderia o que foi digitado (D7)', () => {
    // ARRANGE
    comPermissoes(['especialidades.ver', 'especialidades.criar'])

    // ACT
    const { unmount } = render(
      <MemoryRouter>
        <AvisoDePreRequisito para={CAMINHOS.especialidade} oQueFalta="Nenhuma especialidade cadastrada." semLink />
      </MemoryRouter>,
    )

    // ASSERT
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Nenhuma especialidade cadastrada. Cadastre em Cadastros › Especialidades.')).toBeInTheDocument()
    unmount()
    comPermissoes([])
    render(
      <MemoryRouter>
        <AvisoDePreRequisito para={CAMINHOS.especialidade} oQueFalta="Nenhuma especialidade cadastrada." semLink />
      </MemoryRouter>,
    )
    expect(screen.getByText('Nenhuma especialidade cadastrada. Peça a quem administra o sistema para cadastrar.')).toBeInTheDocument()
  })

  it('deve chamar aoNavegar ao seguir o link, para o diálogo de origem fechar', async () => {
    // ARRANGE
    comPermissoes(['contas.ver', 'contas.criar'])
    const aoNavegar = vi.fn()
    const usuario = userEvent.setup()
    render(
      <MemoryRouter>
        <AvisoDePreRequisito para={CAMINHOS.conta} oQueFalta="Nenhuma conta cadastrada." aoNavegar={aoNavegar} />
      </MemoryRouter>,
    )

    // ACT
    await usuario.click(screen.getByRole('link', { name: 'Cadastrar em Cadastros › Contas' }))

    // ASSERT
    expect(aoNavegar).toHaveBeenCalledOnce()
  })

  it('deve entrar na descrição acessível do campo quando vai na ajuda', () => {
    // ARRANGE
    comPermissoes(['convenios.ver', 'convenios.criar'])

    // ACT
    render(
      <MemoryRouter>
        <CampoSelect
          rotulo="Convênio"
          obrigatorio
          value=""
          onChange={() => {}}
          opcoes={[]}
          ajuda={<AvisoDePreRequisito para={CAMINHOS.convenio} oQueFalta="Nenhum convênio ativo cadastrado." />}
        />
      </MemoryRouter>,
    )

    // ASSERT
    expect(screen.getByLabelText('Convênio (obrigatório)')).toHaveAccessibleDescription(
      /Nenhum convênio ativo cadastrado\. Cadastrar em Cadastros › Convênios e serviços/,
    )
  })

  it('deve passar no axe com e sem a permissão', async () => {
    for (const permissoes of [['contas.ver', 'contas.criar'], []]) {
      // ARRANGE
      comPermissoes(permissoes)

      // ACT
      const { container, unmount } = render(
        <MemoryRouter>
          <p>
            <AvisoDePreRequisito para={CAMINHOS.conta} oQueFalta="Nenhuma conta cadastrada." />
          </p>
          <AcaoDoPreRequisito para={CAMINHOS.conta} />
        </MemoryRouter>,
      )

      // ASSERT
      expect(await axe(container)).toHaveNoViolations()
      unmount()
    }
  })
})

describe('AcaoDoPreRequisito — a saída de um estado vazio', () => {
  it('deve ser o botão para o cadastro com permissão, e a frase de a quem pedir sem ela', () => {
    // ARRANGE + ACT
    comPermissoes(['profissionais.ver', 'profissionais.criar'])
    const { unmount } = render(
      <MemoryRouter>
        <AcaoDoPreRequisito para={CAMINHOS.profissional} />
      </MemoryRouter>,
    )

    // ASSERT
    expect(screen.getByRole('link', { name: 'Cadastrar profissional' })).toHaveAttribute('href', '/profissionais')
    unmount()

    comPermissoes([])
    render(
      <MemoryRouter>
        <AcaoDoPreRequisito para={CAMINHOS.profissional} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Peça a quem administra o sistema para cadastrar.')).toBeInTheDocument()
  })
})

/**
 * GUARDA DE CONTRATO — todo caminho do mapa leva a uma rota que EXISTE no roteador. Um cadastro
 * renomeado ou uma rota que muda deixaria o aviso mandando a pessoa para a página "não encontrada".
 */
describe('AvisoDePreRequisito — contrato com o roteador', () => {
  // `process.cwd()`, como as outras guardas de contrato desta casa: o `import.meta.url` do Vite
  // resolve para o caminho SERVIDO (`/src`), não para o do disco
  const ROTAS = Array.from(
    readFileSync(join(process.cwd(), 'src', 'app.tsx'), 'utf8').matchAll(/path="([^"]+)"/g),
    (achado) => achado[1],
  )

  function existe(rota: string): boolean {
    const partes = rota.split('/')
    return ROTAS.some((molde) => {
      const pedacos = molde.split('/')
      return pedacos.length === partes.length && pedacos.every((pedaco, indice) => pedaco.startsWith(':') || pedaco === partes[indice])
    })
  }

  const CASOS: Array<[string, CaminhoDoCadastro]> = [
    ...Object.entries(CAMINHOS),
    ['fichaDoProfissional', caminhoDaFichaDoProfissional(7)],
    ['pacoteDoPaciente', caminhoDoPacoteDoPaciente(7)],
  ]

  // o guarda de cada rota: `path="…"` seguido de `<ExigePermissao permissao="…">`
  const GUARDAS = new Map(
    Array.from(
      readFileSync(join(process.cwd(), 'src', 'app.tsx'), 'utf8').matchAll(/path="([^"]+)"\s+element=\{\s*<ExigePermissao permissao="([^"]+)"/g),
      (achado) => [achado[1], achado[2]] as const,
    ),
  )

  // rotas que se AUTOGUARDAM (a página decide, sem `ExigePermissao`): a permissão de leitura, declarada à
  // mão — sem esta lista, o contrato pulava a ficha do profissional em silêncio (gate CR-AVI-R2-02)
  const AUTOGUARDADAS = new Map([['/profissionais/:id', 'profissionais.ver']])

  function guardaDe(rota: string): string | undefined {
    const partes = rota.split('/')
    const casa = (candidato: string): boolean => {
      const pedacos = candidato.split('/')
      return pedacos.length === partes.length && pedacos.every((pedaco, indice) => pedaco.startsWith(':') || pedaco === partes[indice])
    }
    const molde = Array.from(GUARDAS.keys()).find(casa)
    if (molde !== undefined) {
      return GUARDAS.get(molde)
    }
    const autoguardada = Array.from(AUTOGUARDADAS.keys()).find(casa)
    return autoguardada === undefined ? undefined : AUTOGUARDADAS.get(autoguardada)
  }

  it('deve exigir também as LEITURAS da tela de destino, além do guarda (gate CR-AVI-R2-02)', () => {
    // ASSERT — a ficha monta as caixas de especialidade; o Novo tratamento lê os três catálogos
    expect(caminhoDaFichaDoProfissional(7).permissoes).toEqual(
      expect.arrayContaining(['profissionais.ver', 'profissionais.editar', 'especialidades.ver']),
    )
    expect(caminhoDoPacoteDoPaciente(7).permissoes).toEqual(
      expect.arrayContaining(['convenios.ver', 'especialidades.ver', 'profissionais.ver', 'tratamentos.ver', 'pacientes.ver']),
    )
  })

  it.each(CASOS)('deve levar "%s" a uma rota do roteador, exigindo a permissão do guarda dela', (_nome, caminho) => {
    // ASSERT — o link só aparece a quem passa no guarda: sem isso, "criar sem ver" leva a uma tela bloqueada (CR-AVI-01)
    expect(ROTAS.length).toBeGreaterThan(20)
    expect(GUARDAS.size).toBeGreaterThan(20)
    expect(existe(caminho.rota)).toBe(true)
    expect(caminho.permissoes.length).toBeGreaterThan(0)
    // toda rota do mapa tem guarda CONHECIDO — rota nova sem guarda tem de entrar em AUTOGUARDADAS
    expect(caminho.permissoes).toContain(guardaDe(caminho.rota))
  })
})
