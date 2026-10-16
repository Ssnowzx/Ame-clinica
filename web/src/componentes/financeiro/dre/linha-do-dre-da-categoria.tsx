import { useId } from 'react'
import { Link } from 'react-router-dom'

import {
  descreverLinhaDaCategoria,
  descreverLinhaDaSubcategoria,
  usarConfiguracaoDoDre,
} from '@/componentes/financeiro/dre/linha-do-dre'
import { SeletorDaLinhaDoDre } from '@/componentes/financeiro/dre/seletor-da-linha-do-dre'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'

const CLASSES_DO_LINK =
  'w-fit text-corpo font-medium text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco'

/**
 * A linha do DRE no cadastro da categoria (change `dre-gerencial`, spec `financeiro-cadastros`): a
 * linha EM VIGOR — escolhida ou o padrão — da categoria e de cada subcategoria, com a troca para quem
 * edita categorias E vê o caixa. Quem não vê o resultado da clínica não vê a seção.
 */
export function LinhaDoDreDaCategoria({ categoriaId }: { categoriaId: number }) {
  const idDoTitulo = useId()
  const { consulta, podeVer, podeTrocar } = usarConfiguracaoDoDre()
  if (!podeVer) {
    return null
  }

  function conteudo() {
    if (consulta.isError) {
      return <EstadoErro mensagem="Não foi possível carregar a linha do DRE." aoTentarNovamente={() => void consulta.refetch()} />
    }
    if (consulta.isPending) {
      return <Skeleton className="h-16 w-full max-w-md" />
    }
    const configuracao = consulta.data
    const categoria = configuracao.categorias.find((candidata) => candidata.id === categoriaId)
    if (categoria === undefined) {
      return <p className="text-corpo text-texto-suave">Esta categoria não aparece no DRE — ela pode ter sido excluída.</p>
    }

    return (
      <div className="flex max-w-xl flex-col gap-4">
        {podeTrocar ? (
          <SeletorDaLinhaDoDre
            configuracao={configuracao}
            alvo={{ tipo: 'categoria', categoria }}
            rotulo={categoria.nome}
            ajuda={`Em vigor: ${descreverLinhaDaCategoria(configuracao, categoria)}.`}
          />
        ) : (
          <p className="text-corpo text-texto">
            <span className="font-medium">{categoria.nome}:</span> {descreverLinhaDaCategoria(configuracao, categoria)}
          </p>
        )}
        {categoria.subcategorias.map((subcategoria) =>
          podeTrocar ? (
            <SeletorDaLinhaDoDre
              key={subcategoria.id}
              configuracao={configuracao}
              alvo={{ tipo: 'subcategoria', categoria, subcategoria }}
              rotulo={`${categoria.nome} › ${subcategoria.nome}`}
              ajuda={`Em vigor: ${descreverLinhaDaSubcategoria(configuracao, subcategoria)}.`}
            />
          ) : (
            <p key={subcategoria.id} className="text-corpo text-texto">
              <span className="font-medium">
                {categoria.nome} › {subcategoria.nome}:
              </span>{' '}
              {descreverLinhaDaSubcategoria(configuracao, subcategoria)}
            </p>
          ),
        )}
      </div>
    )
  }

  return (
    <section aria-labelledby={idDoTitulo} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={idDoTitulo} className="text-subtitulo font-semibold text-texto">
          Linha do DRE
        </h2>
        <p className="max-w-2xl text-corpo text-texto-suave">
          Onde os lançamentos desta categoria entram no DRE. Uma subcategoria pode ter a sua própria; sem escolha, segue a
          da categoria.
        </p>
      </div>
      {conteudo()}
      <Link to="/financeiro/dre/configurar" className={CLASSES_DO_LINK}>
        Ver a escada inteira em Configurar DRE
      </Link>
    </section>
  )
}
