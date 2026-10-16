import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { describe, expect, it } from 'vitest'

import { SecaoLinkDeCadastro } from '@/componentes/administracao/secao-link-de-cadastro'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { servidor } from '@/test/servidor-msw'
import type { LinkDeCadastro } from '@/tipos'

/**
 * O endereço do cadastro pelo link, na tela de Configurações
 * (change `cadastro-online-do-paciente`).
 *
 * Duas coisas são testadas aqui porque as duas custam caro se saírem erradas: **trocar o endereço
 * derruba o que já foi divulgado** (e por isso pergunta antes, nomeando a consequência), e o
 * endereço **nunca aparece na trilha de auditoria** — o que se verifica no servidor, mas cuja
 * razão vive aqui: ele não é campo do catálogo de configurações.
 */
function prepararLink(estado: LinkDeCadastro) {
  servidor.use(msw.get('/api/cadastro-online/link', () => HttpResponse.json(estado)))
}

function renderizar(podeEditar = true) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <SecaoLinkDeCadastro podeEditar={podeEditar} />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('Endereço do cadastro pelo link', () => {
  it('deve oferecer GERAR quando ainda não existe endereço', async () => {
    // ARRANGE — nasce sem endereço em toda clínica: ninguém ganha porta pública por deploy
    prepararLink({ slug: null, url: null, ativo: false })

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhum endereço gerado ainda.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gerar endereço' })).toBeInTheDocument()
  })

  it('deve gerar o PRIMEIRO endereço sem pedir confirmação — não há nada a derrubar', async () => {
    // ARRANGE — a leitura passa a devolver o endereço depois que ele é gerado, como o servidor faz
    let gerado = false
    servidor.use(
      msw.get('/api/cadastro-online/link', () =>
        HttpResponse.json(
          gerado
            ? { slug: 'abc123xyz9876543', url: 'https://exemplo/cadastro/abc123xyz9876543', ativo: false }
            : { slug: null, url: null, ativo: false },
        ),
      ),
      msw.post('/api/cadastro-online/link/rotacionar', () => {
        gerado = true
        return HttpResponse.json({
          slug: 'abc123xyz9876543',
          url: 'https://exemplo/cadastro/abc123xyz9876543',
          ativo: false,
        })
      }),
    )
    renderizar()
    await screen.findByRole('button', { name: 'Gerar endereço' })

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Gerar endereço' }))

    // ASSERT — o endereço aparece, e nenhum diálogo apareceu no caminho
    expect(await screen.findByText('https://exemplo/cadastro/abc123xyz9876543')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('deve PEDIR CONFIRMAÇÃO para trocar, dizendo o que a troca derruba', async () => {
    // ARRANGE — quem já recebeu o link antigo para de conseguir abrir o formulário. Essa é a
    // mitigação do link vazado, e é também o custo dela
    prepararLink({ slug: 'abc123xyz9876543', url: 'https://exemplo/cadastro/abc123xyz9876543', ativo: true })
    renderizar()

    // ACT
    await userEvent.click(await screen.findByRole('button', { name: 'Trocar o endereço' }))

    // ASSERT
    expect(await screen.findByText(/para de funcionar na hora/)).toBeInTheDocument()
    expect(screen.getByText(/não vai mais conseguir abrir o formulário/)).toBeInTheDocument()
  })

  it('deve avisar que o endereço existe mas o cadastro está DESLIGADO', async () => {
    // ARRANGE — é o estado em que a clínica gera, testa e ainda não abriu. Sem o aviso, ela
    // divulgaria um endereço que responde "indisponível" a todo mundo
    prepararLink({ slug: 'abc123xyz9876543', url: 'https://exemplo/cadastro/abc123xyz9876543', ativo: false })

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText(/está DESLIGADO/)).toBeInTheDocument()
  })

  it('NÃO deve oferecer os botões a quem só lê as configurações', async () => {
    // ARRANGE
    prepararLink({ slug: 'abc123xyz9876543', url: 'https://exemplo/cadastro/abc123xyz9876543', ativo: true })

    // ACT
    renderizar(false)

    // ASSERT — o endereço aparece (é leitura), os gestos não
    expect(await screen.findByText('https://exemplo/cadastro/abc123xyz9876543')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Trocar o endereço' })).not.toBeInTheDocument()
  })
})
