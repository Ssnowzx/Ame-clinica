import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { axe, toHaveNoViolations } from 'jest-axe'
import { describe, expect, it } from 'vitest'

import { SecaoIdentidadeDaClinica } from '@/componentes/administracao/secao-identidade-da-clinica'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import { configuracaoFicticia } from '@/test/dados-configuracoes'
import type { Configuracao } from '@/tipos'

const IDENTIDADE: Configuracao = configuracaoFicticia({
  chave: 'clinica.identidade',
  rotulo: 'Identidade na barra lateral',
  tipo: 'string',
  valor: 'nome',
  opcoes: ['nome', 'logo'],
})
expect.extend(toHaveNoViolations)

const TEMA: Configuracao = configuracaoFicticia({
  chave: 'clinica.tema',
  rotulo: 'Tema de cores',
  tipo: 'string',
  valor: 'padrao',
  opcoes: ['padrao', 'menta', 'xclinicas'],
})
const FONTE: Configuracao = configuracaoFicticia({
  chave: 'clinica.fonte_do_nome',
  rotulo: 'Fonte do nome',
  tipo: 'string',
  valor: 'padrao',
  opcoes: ['padrao', 'serifada', 'arredondada', 'manuscrita'],
})

function renderizar({
  identidade = IDENTIDADE,
  logoVersao = null,
  podeEditar = true,
  tema = TEMA,
}: { identidade?: Configuracao; logoVersao?: string | null; podeEditar?: boolean; tema?: Configuracao | null } = {}) {
  useAuthStore.setState({
    usuario: {
      ...usuarioFicticio,
      marca: { nome: 'Clínica Feliz', identidade: String(identidade.valor), fonte: 'padrao', logo_versao: logoVersao },
    },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <SecaoIdentidadeDaClinica
          identidade={identidade}
          fonte={FONTE}
          tema={tema ?? undefined}
          nomeDaClinica="Clínica Feliz"
          podeEditar={podeEditar}
        />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('SecaoIdentidadeDaClinica — identidade visual na aba Clínica', () => {
  it('deve refletir a fonte escolhida (não salva) no preview da barra lateral', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar()

    // ACT — escolhe a serifada sem salvar
    await usuario.click(screen.getByRole('radio', { name: /Serifada/ }))

    // ASSERT — o preview (nome truncado com title) já está na serifada
    const preview = screen.getByTitle('Clínica Feliz')
    expect(preview.style.fontFamily).toContain('serifada')
    // nada foi salvo: o botão de salvar segue habilitado (escolha pendente)
    expect(screen.getByRole('button', { name: 'Salvar identidade' })).toBeEnabled()
  })

  it('deve recusar arquivo de formato não aceito no próprio campo, sem rede', async () => {
    // ARRANGE — applyAccept desligado: o atributo accept filtra no navegador, mas a
    // régua que o teste prova é a do ESPELHO local (arrastar/soltar contorna o accept)
    const usuario = userEvent.setup({ applyAccept: false })
    renderizar()
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })

    // ACT
    await usuario.upload(screen.getByLabelText('Enviar logo da clínica'), svg)

    // ASSERT — recusa espelhada (mesma régua do servidor)
    expect(await screen.findByRole('alert')).toHaveTextContent('Formato não aceito. Envie PNG, JPG ou WebP.')
  })

  it('deve pedir confirmação explícita para remover a logo', async () => {
    // ARRANGE — logo existente
    const usuario = userEvent.setup()
    let removeu = false
    servidor.use(
      msw.delete('/api/clinica/logo', () => {
        removeu = true
        return new HttpResponse(null, { status: 204 })
      }),
      msw.get('/api/me', () => HttpResponse.json(usuarioFicticio)),
    )
    renderizar({ logoVersao: '20260722180000' })

    // ACT — remover exige confirmar no diálogo
    await usuario.click(screen.getByRole('button', { name: 'Remover logo' }))
    expect(removeu).toBe(false)
    const dialogo = await screen.findByRole('alertdialog')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Remover logo' }))

    // ASSERT
    expect(await screen.findByText('Logo removida.')).toBeInTheDocument()
    expect(removeu).toBe(true)
  })

  it('deve avisar quando a identidade é logo sem arquivo enviado', () => {
    // ARRANGE — valor SALVO é logo, sem logo_versao
    renderizar({ identidade: { ...IDENTIDADE, valor: 'logo' }, logoVersao: null })

    // ASSERT
    expect(screen.getByText(/a barra exibirá o nome até o envio/i)).toBeInTheDocument()
  })

  it('deve avisar que a escolha ainda não foi salva', async () => {
    // ARRANGE: a tela mostrava a escolha como se já valesse — a pessoa marcava "Logo", via a
    // pré-visualização mudar, saía da tela e a barra continuava como antes
    const usuario = userEvent.setup()
    renderizar()
    expect(screen.queryByText(/ainda não salva/i)).not.toBeInTheDocument()

    // ACT
    await usuario.click(screen.getByRole('radio', { name: /Logo/ }))

    // ASSERT
    expect(screen.getByText(/Alteração ainda não salva/i)).toBeInTheDocument()
  })

  it('deve dizer que a logo foi APLICADA quando o servidor a aplica', async () => {
    // ARRANGE: enviar a logo aplica a logo na barra (change logo-aplicada-ao-enviar) — a
    // confirmação precisa dizer isso, senão a pessoa fica sem saber se falta algum passo
    const usuario = userEvent.setup({ applyAccept: false })
    servidor.use(
      msw.post('/api/clinica/logo', () =>
        HttpResponse.json({ logo_versao: '20260828223000', identidade_aplicada: true }, { status: 201 }),
      ),
      msw.get('/api/me', () => HttpResponse.json(usuarioFicticio)),
    )
    renderizar()

    // ACT
    await usuario.upload(
      screen.getByLabelText('Enviar logo da clínica'),
      new File(['png'], 'logo.png', { type: 'image/png' }),
    )

    // ASSERT
    expect(await screen.findByText('Logo enviada e aplicada na barra.')).toBeInTheDocument()
  })

  it('deve dizer apenas "Logo enviada" quando não havia o que aplicar', async () => {
    // ARRANGE: a clínica já exibia a logo e está só trocando o arquivo
    const usuario = userEvent.setup({ applyAccept: false })
    servidor.use(
      msw.post('/api/clinica/logo', () =>
        HttpResponse.json({ logo_versao: '20260828223000', identidade_aplicada: false }, { status: 201 }),
      ),
      msw.get('/api/me', () => HttpResponse.json(usuarioFicticio)),
    )
    renderizar({ identidade: { ...IDENTIDADE, valor: 'logo' }, logoVersao: '20260722180000' })

    // ACT
    await usuario.upload(
      screen.getByLabelText('Enviar logo da clínica'),
      new File(['png'], 'logo.png', { type: 'image/png' }),
    )

    // ASSERT
    expect(await screen.findByText('Logo enviada.')).toBeInTheDocument()
  })

  it('não deve oferecer controles de escrita em somente leitura', () => {
    // ARRANGE
    renderizar({ podeEditar: false })

    // ASSERT — sem salvar, sem upload; as escolhas aparecem desabilitadas
    expect(screen.queryByRole('button', { name: 'Salvar identidade' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Enviar logo da clínica')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Nome da clínica/ })).toBeDisabled()
  })
})

describe('SecaoIdentidadeDaClinica — cores do sistema (change tema-da-clinica)', () => {
  it('deve oferecer cada tema com o nome, a descrição e a miniatura desenhada no próprio tema', () => {
    // ARRANGE + ACT
    renderizar()

    // ASSERT — o nome diz qual é; a miniatura (decorativa) diz como fica
    const menta = screen.getByRole('radio', { name: /Menta/ })
    expect(menta).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Padrão.*As cores do sistema/ })).toBeChecked()
    const amostra = menta.closest('label')?.querySelector('[data-tema="menta"]')
    expect(amostra).not.toBeNull()
    expect(amostra).toHaveAttribute('aria-hidden', 'true')
  })

  it('deve oferecer o tema Xclinicas com o nome da marca, a descrição e a miniatura no próprio tema', () => {
    // ARRANGE + ACT — change tema-xclinicas: a marca do produto é opção de toda clínica
    renderizar()

    // ASSERT — o nome é o da marca, a descrição diz o que vem, e a miniatura é pintada pelo tema
    const xclinicas = screen.getByRole('radio', { name: /Xclinicas.*Ameixa e rosé da marca, com títulos em serifa/ })
    expect(xclinicas).not.toBeChecked()
    const amostra = xclinicas.closest('label')?.querySelector('[data-tema="xclinicas"]')
    expect(amostra).not.toBeNull()
    expect(amostra).toHaveAttribute('aria-hidden', 'true')
  })

  it('deve sinalizar a troca de tema como alteração ainda não salva', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(screen.getByRole('radio', { name: /Menta/ }))

    // ASSERT — a tela só muda depois de salvar, e isso precisa estar dito
    expect(screen.getByText(/Alteração ainda não salva — a tela só muda depois de salvar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar identidade' })).toBeEnabled()
  })

  it('deve gravar o tema e recarregar a sessão para a cor trocar sem recarregar a página', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const gravados: Array<{ chave: string; valor: unknown }> = []
    let sessoesPedidas = 0
    servidor.use(
      msw.put('/api/configuracoes', async ({ request }) => {
        const corpo = (await request.json()) as { chave: string; valor: unknown }
        gravados.push(corpo)
        return HttpResponse.json(corpo)
      }),
      msw.get('/api/me', () => {
        sessoesPedidas += 1
        return HttpResponse.json({ ...usuarioFicticio, marca: { ...usuarioFicticio.marca, tema: 'menta' } })
      }),
    )
    renderizar()
    await usuario.click(screen.getByRole('radio', { name: /Menta/ }))

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Salvar identidade' }))

    // ASSERT — só a chave que mudou vai, e o /me é pedido de novo (é dele que o shell lê o tema)
    expect(await screen.findByText('Identidade da clínica atualizada.')).toBeInTheDocument()
    expect(gravados).toEqual([{ chave: 'clinica.tema', valor: 'menta' }])
    expect(sessoesPedidas).toBeGreaterThan(0)
  })

  it('deve seguir sem a escolha de cores quando a API ainda não tem o tema', () => {
    // ARRANGE + ACT — deploy fora de ordem: tela nova, API velha
    renderizar({ tema: null })

    // ASSERT
    expect(screen.queryByText('Cores do sistema')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Serifada/ })).toBeInTheDocument()
  })

  it('não deve ter violações de acessibilidade na seção com as cores', async () => {
    // ARRANGE
    const { container } = renderizar()

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })
})

describe('SecaoIdentidadeDaClinica — acabamento do tema (change tema-da-clinica)', () => {
  it('deve desenhar o Remover logo com moldura de perigo, sem o bloco vermelho', () => {
    // ARRANGE + ACT
    renderizar({ logoVersao: '20260722180000' })

    // ASSERT — o sólido fica para o botão que CONFIRMA, dentro do diálogo
    const remover = screen.getByRole('button', { name: 'Remover logo' })
    expect(remover).toHaveClass('border-perigo')
    expect(remover).not.toHaveClass('bg-perigo')
  })

  it('deve resolver fonte, peso e fio na própria miniatura, e não herdar da tela', () => {
    // ARRANGE + ACT — a amostra do Padrão numa tela no tema sairia na fonte e no peso do tema
    renderizar()

    // ASSERT
    const amostra = document.querySelector('[data-tema="padrao"]')
    expect(amostra).toHaveClass('font-texto', '[font-weight:var(--peso-texto)]')
    expect(amostra?.querySelector('.before\\:left-recuo-fio')).not.toBeNull()
  })
})
