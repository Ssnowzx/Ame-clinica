import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { ColunaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import type { FornecedorDaLista } from '@/tipos'

import { FORNECEDORES } from '@/componentes/financeiro/modulos-de-interessado'
import { TelaDeInteressados } from '@/componentes/financeiro/tela-de-interessados'
import { chaves } from '@/lib/chaves-query'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { listarCategorias } from '@/servicos/financeiro'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Fornecedores (§9, change `caixa-do-dia-a-dia`): a quem a clínica paga. A lista mostra só o que a
 * API lista — razão social, nome fantasia, categoria padrão e situação; documento, contatos e
 * endereço ficam no formulário.
 *
 * A coluna da categoria só existe para quem pode ver as categorias: um "—" para quem não pode
 * diria "sem categoria", o que seria mentira.
 */
export function PaginaFornecedores() {
  const podeVerCategorias = useAuthStore((estado) => estado.temPermissao('categorias.ver'))
  const categorias = useQuery({
    queryKey: chaves.categorias(),
    queryFn: listarCategorias,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: podeVerCategorias,
  })

  const colunas = useMemo<ReadonlyArray<ColunaDeCatalogo<FornecedorDaLista>>>(() => {
    const nomeDaCategoria = (fornecedor: FornecedorDaLista): string => {
      const categoria = categorias.data?.find((uma) => uma.id === fornecedor.categoria_id)
      if (categoria === undefined) return '—'
      const subcategoria = categoria.subcategorias.find((uma) => uma.id === fornecedor.subcategoria_id)
      return subcategoria === undefined ? categoria.nome : `${categoria.nome} › ${subcategoria.nome}`
    }

    return [
      { cabecalho: 'Razão social', celula: (fornecedor) => fornecedor.razao_social },
      { cabecalho: 'Nome fantasia', celula: (fornecedor) => fornecedor.nome_fantasia ?? '—' },
      ...(podeVerCategorias ? [{ cabecalho: 'Categoria padrão', celula: nomeDaCategoria }] : []),
      { cabecalho: 'Situação', celula: (fornecedor) => (fornecedor.ativo ? 'Ativo' : 'Inativo') },
    ]
  }, [categorias.data, podeVerCategorias])

  return (
    <TelaDeInteressados
      modulo={FORNECEDORES}
      colunas={colunas}
      busca={{ rotulo: 'Buscar fornecedor', placeholder: 'Buscar por razão social ou nome fantasia…' }}
    />
  )
}
