import { Link } from 'react-router-dom'

import { TelaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import { descreverLinhaDaCategoria, usarConfiguracaoDoDre } from '@/componentes/financeiro/dre/linha-do-dre'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { Etiqueta } from '@/componentes/ui/etiqueta'
import { chaves } from '@/lib/chaves-query'
import { categorias } from '@/servicos/financeiro'
import type { CategoriaFinanceira, PayloadCategoria, TipoLancamento } from '@/tipos'

const CAMPOS = new Set(['nome', 'tipo'])

interface Valores {
  nome: string
  tipo: TipoLancamento
}

/** Domínio FECHADO (o enum é do banco): estreitar por verificação, nunca por `as`. */
function naturezaValida(valor: string): valor is TipoLancamento {
  return valor === 'receita' || valor === 'despesa'
}

/**
 * Classifica cada receita e despesa do caixa (§9) — é o que o DRE e o contador leem.
 * As subcategorias vivem por dentro de cada categoria, na página dela.
 */
export function PaginaCategorias() {
  // a linha do DRE de cada categoria (dre-gerencial) — para quem vê o resultado da clínica; a troca
  // mora na página da categoria e em Configurar DRE
  const { consulta: dre, podeVer: podeVerODre } = usarConfiguracaoDoDre()
  const colunaDoDre = podeVerODre
    ? [
        {
          cabecalho: 'Linha do DRE',
          celula: (categoria: CategoriaFinanceira) => {
            const noDre = dre.data?.categorias.find((candidata) => candidata.id === categoria.id)
            return dre.data === undefined || noDre === undefined ? '—' : descreverLinhaDaCategoria(dre.data, noDre)
          },
        },
      ]
    : []

  return (
    <TelaDeCatalogo<CategoriaFinanceira, PayloadCategoria, Valores>
      titulo="Categorias do caixa"
      modulo="categorias"
      rotuloSingular="categoria"
      genero="f"
      chave={chaves.categorias()}
      listar={categorias.listar}
      recurso={categorias}
      campos={CAMPOS}
      colunas={[
        {
          cabecalho: 'Categoria',
          celula: (categoria) => (
            <Link
              to={`/categorias/${categoria.id}`}
              className="text-corpo font-medium text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
            >
              {categoria.nome}
            </Link>
          ),
        },
        {
          cabecalho: 'Natureza',
          celula: (categoria) => (
            <Etiqueta tom={categoria.tipo === 'receita' ? 'sucesso' : 'neutro'}>
              {categoria.tipo === 'receita' ? 'Receita' : 'Despesa'}
            </Etiqueta>
          ),
        },
        {
          cabecalho: 'Subcategorias',
          celula: (categoria) =>
            categoria.subcategorias.length === 0 ? 'Nenhuma' : categoria.subcategorias.length,
        },
        ...colunaDoDre,
      ]}
      valoresIniciais={(categoria) => ({
        nome: categoria?.nome ?? '',
        tipo: categoria?.tipo ?? 'receita',
      })}
      paraPayload={(valores) => ({ nome: valores.nome, tipo: valores.tipo })}
      nomeDoRegistro={(categoria) => categoria.nome}
      // trocar a natureza não quebra o que já foi lançado, mas trava a EDIÇÃO desses
      // lançamentos: o servidor exige categoria da mesma natureza (T-fin-11)
      consequenciasDaRegra={(valores, original) =>
        original !== undefined && original.tipo !== valores.tipo
          ? [
              `Os lançamentos que já usam "${original.nome}" continuam como estão, mas passarão a recusar edição enquanto a natureza não bater.`,
              'A categoria deixa de ser oferecida nos lançamentos da natureza anterior.',
            ]
          : []
      }
      consequenciaDaExclusao="Se a categoria tiver subcategorias ou lançamentos, o sistema recusa a exclusão."
      vazioTitulo="Nenhuma categoria cadastrada"
      vazioDescricao="Sem categoria não é possível lançar nada: cadastre pelo menos uma de receita e uma de despesa."
      formulario={({ valores, definir, erros }) => (
        <>
          <CampoTexto
            rotulo="Nome"
            obrigatorio
            value={valores.nome}
            onChange={(evento) => {
              definir({ nome: evento.target.value })
            }}
            erro={erros.campos.get('nome')}
            ajuda="Atendimentos, Aluguel, Material de consumo, Folha."
          />
          <CampoSelect
            rotulo="Natureza"
            obrigatorio
            value={valores.tipo}
            onChange={(evento) => {
              if (naturezaValida(evento.target.value)) definir({ tipo: evento.target.value })
            }}
            opcoes={[
              { valor: 'receita', rotulo: 'Receita — dinheiro que entra' },
              { valor: 'despesa', rotulo: 'Despesa — dinheiro que sai' },
            ]}
            erro={erros.campos.get('tipo')}
          />
        </>
      )}
    />
  )
}
