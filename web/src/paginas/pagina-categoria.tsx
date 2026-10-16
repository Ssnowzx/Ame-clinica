import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { TelaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import { LinhaDoDreDaCategoria } from '@/componentes/financeiro/dre/linha-do-dre-da-categoria'
import { Botao } from '@/componentes/ui/botao'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Etiqueta } from '@/componentes/ui/etiqueta'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { categorias, subcategoriasDe } from '@/servicos/financeiro'
import type { PayloadSubcategoria, SubcategoriaFinanceira } from '@/tipos'

const CAMPOS = new Set(['nome', 'codigo_contabil'])

interface Valores {
  nome: string
  codigo_contabil: string
}

/**
 * Subcategoria é AGREGADO da categoria (nasce em rota aninhada na API) — por isso
 * vive numa página da categoria, e não numa tela solta: "Aluguel" sem "Despesas da
 * clínica" acima não diz nada a quem está classificando o caixa.
 */
export function PaginaCategoria() {
  const { id } = useParams()
  const categoriaId = Number(id)
  const valido = Number.isInteger(categoriaId) && categoriaId > 0

  // A MESMA consulta da lista, com a MESMA função — a mãe sai daqui por `select`.
  // Uma `queryFn` diferente na mesma chave não coexiste: o React Query guarda UM valor
  // por chave, e a última a responder vence. Buscar a mãe com `find` numa queryFn
  // própria sobrescrevia o array que a tabela de subcategorias lê, e a tela quebrava
  // com `registros.map is not a function`.
  const categoria = useQuery({
    queryKey: chaves.categorias(),
    queryFn: categorias.listar,
    enabled: valido,
    select: (todas) => todas.find((item) => item.id === categoriaId),
  })

  if (!valido) {
    return (
      <EstadoVazio
        titulo="Categoria não encontrada"
        descricao="O endereço não corresponde a nenhuma categoria."
        acao={
          <Botao asChild variante="secundario">
            <Link to="/categorias">Voltar às categorias</Link>
          </Botao>
        }
      />
    )
  }

  const recurso = subcategoriasDe(categoriaId)

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/categorias"
        className="flex w-fit items-center gap-1.5 text-corpo text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Categorias do caixa
      </Link>

      {categoria.isPending ? <Skeleton className="h-8 w-64" /> : null}
      {categoria.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar a categoria."
          aoTentarNovamente={() => {
            void categoria.refetch()
          }}
        />
      ) : null}

      {/* a categoria some da lista enquanto a página está aberta: a consulta responde,
          mas sem a linha — é ausência, não erro de rede */}
      {categoria.isSuccess && categoria.data === undefined ? (
        <EstadoVazio
          titulo="Categoria não encontrada"
          descricao="Ela pode ter sido excluída por outra pessoa."
          acao={
            <Botao asChild variante="secundario">
              <Link to="/categorias">Voltar às categorias</Link>
            </Botao>
          }
        />
      ) : null}

      {/* O `h1` é da PÁGINA — a categoria. A seção abaixo é `h2` sob ele (A11Y-LP-01). */}
      {categoria.isSuccess && categoria.data !== undefined ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-titulo font-semibold text-texto">{categoria.data.nome}</h1>
            <Etiqueta tom={categoria.data.tipo === 'receita' ? 'sucesso' : 'neutro'}>
              {categoria.data.tipo === 'receita' ? 'Receita' : 'Despesa'}
            </Etiqueta>
          </div>

          <LinhaDoDreDaCategoria categoriaId={categoriaId} />

          <TelaDeCatalogo<SubcategoriaFinanceira, PayloadSubcategoria, Valores>
            titulo="Subcategorias"
            nivelDoTitulo="h2"
            modulo="categorias"
            rotuloSingular="subcategoria"
            genero="f"
            chave={chaves.subcategoriasDaCategoria(categoriaId)}
            chaveDeInvalidacao={chaves.categorias()}
            listar={recurso.listar}
            recurso={recurso}
            campos={CAMPOS}
            colunas={[
              { cabecalho: 'Subcategoria', celula: (sub) => sub.nome },
              { cabecalho: 'Código contábil', celula: (sub) => sub.codigo_contabil ?? '—' },
            ]}
            valoresIniciais={(sub) => ({
              nome: sub?.nome ?? '',
              codigo_contabil: sub?.codigo_contabil ?? '',
            })}
            paraPayload={(valores) => ({
              nome: valores.nome,
              codigo_contabil:
                valores.codigo_contabil.trim() === '' ? null : valores.codigo_contabil,
            })}
            nomeDoRegistro={(sub) => sub.nome}
            consequenciaDaExclusao="Se a subcategoria já tiver lançamentos, o sistema recusa a exclusão."
            vazioTitulo="Nenhuma subcategoria"
            vazioDescricao="Subcategoria é opcional: use quando a categoria precisar de detalhe no relatório do contador."
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
                />
                <CampoTexto
                  rotulo="Código contábil"
                  value={valores.codigo_contabil}
                  onChange={(evento) => {
                    definir({ codigo_contabil: evento.target.value })
                  }}
                  erro={erros.campos.get('codigo_contabil')}
                  ajuda="Opcional. O código que o contador usa para esta subcategoria."
                />
              </>
            )}
          />
        </>
      ) : null}
    </div>
  )
}
