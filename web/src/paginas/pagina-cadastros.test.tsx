import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { PaginaCadastros } from '@/paginas/pagina-cadastros'
import { useAuthStore } from '@/stores/auth-store'
import { usuarioFicticio } from '@/test/servidor-msw'

function renderizar(permissoes: string[]) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <MemoryRouter>
      <PaginaCadastros />
    </MemoryRouter>,
  )
}

/**
 * O hub é o único caminho de tela para os catálogos, e ele filtra CARTÃO A CARTÃO pela
 * permissão de ver de cada módulo. Até o gate isso era promessa não fiscalizada por
 * teste nenhum (achado SEC-CFT-05): nada renderizava esta página.
 *
 * O que NÃO se prova aqui: a autorização de verdade, que é do servidor. Esconder o
 * cartão é experiência — quem digitar a URL continua batendo no guard e no 403.
 */
describe('Hub de Cadastros — cada cartão pede a permissão do seu módulo', () => {
  it('deve mostrar SÓ os catálogos financeiros para quem só tem as permissões do dinheiro', () => {
    // ARRANGE + ACT — o perfil da faturista
    renderizar(['contas.ver', 'tipos_pagamento.ver', 'categorias.ver', 'cartoes.ver'])

    // ASSERT
    expect(screen.getByRole('link', { name: /Contas/ })).toHaveAttribute('href', '/contas')
    expect(screen.getByRole('link', { name: /Formas de pagamento/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Categorias do caixa/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cartões/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Especialidades/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Convênios/ })).not.toBeInTheDocument()
  })

  it('deve mostrar SÓ os catálogos clínicos para quem não tem as permissões do dinheiro', () => {
    // ARRANGE + ACT
    renderizar(['especialidades.ver', 'salas.ver'])

    // ASSERT
    expect(screen.getByRole('link', { name: /Especialidades/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Salas/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Contas/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Cartões/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Categorias do caixa/ })).not.toBeInTheDocument()
  })

  it('deve mostrar Fornecedores e esconder Funcionários de quem não tem funcionarios.ver', () => {
    // ARRANGE + ACT — a quem a clínica paga (caixa-do-dia-a-dia): cada cartão sob o seu módulo
    renderizar(['fornecedores.ver'])

    // ASSERT
    expect(screen.getByRole('link', { name: /Fornecedores/ })).toHaveAttribute('href', '/fornecedores')
    expect(screen.queryByRole('link', { name: /Funcionários/ })).not.toBeInTheDocument()
  })

  it('deve dizer no cartão de Fornecedores que é a quem a clínica paga', () => {
    // ARRANGE + ACT — o cartão é a primeira explicação que a operadora recebe (design D8)
    renderizar(['fornecedores.ver', 'funcionarios.ver'])

    // ASSERT
    expect(screen.getByRole('link', { name: /Fornecedores/ })).toHaveTextContent('A quem a clínica paga')
    expect(screen.getByRole('link', { name: /Funcionários/ })).toHaveAttribute('href', '/funcionarios')
  })

  it('deve ficar sem nenhum cartão para quem não pode ver catálogo algum', () => {
    // ARRANGE + ACT — a rota já é protegida por PERMISSOES_DE_CADASTRO; aqui é a rede
    // de baixo: nem por engano um cartão aparece
    renderizar(['agenda.ver'])

    // ASSERT
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})
