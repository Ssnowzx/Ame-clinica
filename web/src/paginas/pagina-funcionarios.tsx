import type { ColunaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import type { FuncionarioDaLista } from '@/tipos'

import { FUNCIONARIOS } from '@/componentes/financeiro/modulos-de-interessado'
import { TelaDeInteressados } from '@/componentes/financeiro/tela-de-interessados'

const COLUNAS: ReadonlyArray<ColunaDeCatalogo<FuncionarioDaLista>> = [
  { cabecalho: 'Nome', celula: (funcionario) => funcionario.nome },
  { cabecalho: 'Função', celula: (funcionario) => funcionario.funcao },
  { cabecalho: 'Situação', celula: (funcionario) => (funcionario.ativo ? 'Ativo' : 'Inativo') },
]

/**
 * Funcionários (§9, change `caixa-do-dia-a-dia`): quem recebe salário da clínica. A lista mostra
 * só nome, função e situação; CPF, nascimento, contatos e endereço ficam no formulário. NÃO é o
 * cadastro de acesso ao sistema (Usuários).
 */
export function PaginaFuncionarios() {
  return (
    <TelaDeInteressados
      modulo={FUNCIONARIOS}
      colunas={COLUNAS}
      busca={{ rotulo: 'Buscar funcionário', placeholder: 'Buscar por nome…' }}
    />
  )
}
