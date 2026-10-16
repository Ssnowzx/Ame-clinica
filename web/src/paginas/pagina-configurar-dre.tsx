import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'

import type { CategoriaNoDre, ConfiguracaoDoDre, DegrauDoDre, LinhaDoDre, SubcategoriaNoDre } from '@/tipos'

import {
  descreverLinhaDaSubcategoria,
  rotuloDaLinha,
  usarConfiguracaoDoDre,
} from '@/componentes/financeiro/dre/linha-do-dre'
import { ContextoDosRascunhos, usarRascunhosDaLinha } from '@/componentes/financeiro/dre/rascunhos-da-linha-do-dre'
import { SeletorDaLinhaDoDre } from '@/componentes/financeiro/dre/seletor-da-linha-do-dre'
import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Etiqueta } from '@/componentes/ui/etiqueta'
import { Skeleton } from '@/componentes/ui/skeleton'
import { possuiTodasAsPermissoes } from '@/lib/permissoes'
import { useAuthStore } from '@/stores/auth-store'

/** O que é o DRE e por que configurar é conferir, numa frase (spec `dre-gerencial`). */
export const O_QUE_E_O_DRE =
  'O DRE mostra se a clínica deu lucro ou prejuízo: tudo o que entrou, menos impostos, custos e despesas, em escada. Toda categoria já cai em alguma linha — configurar é só conferir se cada uma está no lugar certo.'

/** Ver o DRE pede as permissões do relatório — o atalho só aparece para quem o abre. */
const PERMISSOES_DO_RELATORIO = ['lancamentos.ver', 'fluxo_caixa.ver'] as const

/** Uma subcategoria com linha PRÓPRIA aparece onde o dinheiro dela cai, com a categoria-mãe no nome. */
interface SubcategoriaQueSeSepara {
  categoria: CategoriaNoDre
  subcategoria: SubcategoriaNoDre
}

function subcategoriasQueSeSeparam(configuracao: ConfiguracaoDoDre, codigo: string): SubcategoriaQueSeSepara[] {
  return configuracao.categorias.flatMap((categoria) =>
    categoria.subcategorias
      .filter((subcategoria) => subcategoria.linha_dre !== null && subcategoria.linha_efetiva === codigo)
      .map((subcategoria) => ({ categoria, subcategoria })),
  )
}

interface PropsDoItem {
  configuracao: ConfiguracaoDoDre
  podeTrocar: boolean
  aoTrocar: (idDoCampo: string) => void
}

/** Uma categoria na linha dela: o seletor (ou o nome), o selo do padrão, e as subcategorias que a seguem. */
function ItemDaCategoria({ configuracao, categoria, podeTrocar, aoTrocar }: PropsDoItem & { categoria: CategoriaNoDre }) {
  const seguidoras = categoria.subcategorias.filter((subcategoria) => subcategoria.linha_dre === null)

  return (
    <li className="flex flex-col gap-2 border-t border-linha pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-end gap-3">
        {podeTrocar ? (
          <SeletorDaLinhaDoDre
            configuracao={configuracao}
            alvo={{ tipo: 'categoria', categoria }}
            rotulo={categoria.nome}
            aoTrocar={aoTrocar}
          />
        ) : (
          <p className="text-corpo font-medium text-texto">{categoria.nome}</p>
        )}
        {categoria.linha_dre === null ? (
          <Etiqueta tom="alerta" className="mb-2.5">
            No padrão
          </Etiqueta>
        ) : null}
      </div>
      {seguidoras.length === 0 ? null : (
        <ul aria-label={`Subcategorias de ${categoria.nome}`} className="ml-4 flex flex-col gap-2 border-l-2 border-linha pl-4">
          {seguidoras.map((subcategoria) => (
            <li key={subcategoria.id}>
              {podeTrocar ? (
                <SeletorDaLinhaDoDre
                  configuracao={configuracao}
                  alvo={{ tipo: 'subcategoria', categoria, subcategoria }}
                  rotulo={`${categoria.nome} › ${subcategoria.nome}`}
                  aoTrocar={aoTrocar}
                />
              ) : (
                <p className="text-corpo text-texto">
                  {subcategoria.nome}
                  <span className="text-texto-suave"> — {descreverLinhaDaSubcategoria(configuracao, subcategoria)}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** Uma linha de VALOR: o que entra nela e quem cai nela hoje. */
function CartaoDaLinha({ configuracao, linha, podeTrocar, aoTrocar }: PropsDoItem & { linha: LinhaDoDre }) {
  const idDoTitulo = useId()
  const categorias = configuracao.categorias.filter((categoria) => categoria.linha_efetiva === linha.codigo)
  const separadas = subcategoriasQueSeSeparam(configuracao, linha.codigo)
  const vazia = categorias.length === 0 && separadas.length === 0

  return (
    <li>
      <section aria-labelledby={idDoTitulo} className="flex flex-col gap-3 rounded-janela border border-linha bg-superficie p-4">
        <div className="flex flex-col gap-0.5">
          <h3 id={idDoTitulo} className="text-corpo-lg font-semibold text-texto">
            {linha.rotulo}
          </h3>
          <p className="text-meta text-texto-suave">{linha.explicacao}</p>
        </div>
        {vazia ? (
          <p className="text-meta text-texto-suave">Nenhuma categoria cai aqui.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {categorias.map((categoria) => (
              <ItemDaCategoria
                key={categoria.id}
                configuracao={configuracao}
                categoria={categoria}
                podeTrocar={podeTrocar}
                aoTrocar={aoTrocar}
              />
            ))}
            {separadas.map(({ categoria, subcategoria }) => (
              <li key={`sub-${subcategoria.id}`} className="border-t border-linha pt-3 first:border-t-0 first:pt-0">
                {podeTrocar ? (
                  <SeletorDaLinhaDoDre
                    configuracao={configuracao}
                    alvo={{ tipo: 'subcategoria', categoria, subcategoria }}
                    rotulo={`${categoria.nome} › ${subcategoria.nome}`}
                    aoTrocar={aoTrocar}
                  />
                ) : (
                  <p className="text-corpo text-texto">
                    {categoria.nome} › {subcategoria.nome}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </li>
  )
}

/** Um degrau: o grupo com as suas linhas de valor, ou o subtotal que a escada calcula. */
function Degrau({ configuracao, degrau, podeTrocar, aoTrocar }: PropsDoItem & { degrau: DegrauDoDre }) {
  const idDoTitulo = useId()
  if (degrau.tipo === 'subtotal') {
    return (
      <li className="rounded-superficie bg-acento-suave px-4 py-3">
        <p className="flex items-baseline gap-2 text-corpo font-semibold text-texto">
          {/* o "=" da escada é só desenho: o rótulo do servidor não o traz (na planilha, uma
              célula que começa com "=" viraria fórmula e sairia neutralizada com apóstrofo) */}
          <span aria-hidden="true" className="text-acento">
            =
          </span>
          <span>{degrau.rotulo}</span>
        </p>
        <p className="text-meta text-texto-suave">{degrau.explicacao}</p>
      </li>
    )
  }
  const linhas = (degrau.linhas ?? [])
    .map((codigo) => configuracao.linhas.find((linha) => linha.codigo === codigo))
    .filter((linha): linha is LinhaDoDre => linha !== undefined)

  return (
    <li>
      <section aria-labelledby={idDoTitulo} className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id={idDoTitulo} className="text-subtitulo font-semibold text-texto">
            {degrau.rotulo}
          </h2>
          <p className="text-corpo text-texto-suave">{degrau.explicacao}</p>
        </div>
        <ul className="grid gap-3 lg:grid-cols-2">
          {linhas.map((linha) => (
            <CartaoDaLinha key={linha.codigo} configuracao={configuracao} linha={linha} podeTrocar={podeTrocar} aoTrocar={aoTrocar} />
          ))}
        </ul>
      </section>
    </li>
  )
}

/** Quantas estão no padrão — e que isso não é defeito, é o que falta conferir. */
function AvisoDoPadrao({ configuracao }: { configuracao: ConfiguracaoDoDre }) {
  if (configuracao.no_padrao === 0) {
    return (
      <p role="status" className="rounded-superficie bg-sucesso-suave px-4 py-3 text-corpo text-sucesso-texto">
        Todas as categorias têm a linha escolhida.
      </p>
    )
  }
  const quantas = configuracao.no_padrao === 1 ? '1 categoria está' : `${configuracao.no_padrao} categorias estão`

  return (
    <p role="status" className="flex items-start gap-2 rounded-superficie bg-alerta-suave px-4 py-3 text-corpo text-alerta-texto">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        {`${quantas} na linha padrão da natureza, marcadas com "No padrão": receita em ${rotuloDaLinha(configuracao, configuracao.padrao.receita)}, despesa em ${rotuloDaLinha(configuracao, configuracao.padrao.despesa)}. Confira se é o lugar delas.`}
      </span>
    </p>
  )
}

/**
 * Configurar DRE (change `dre-gerencial`): a escada inteira, cada linha com o que entra nela e as
 * categorias que caem nela HOJE. O DRE do ClinicaÁgil falhou nesta clínica por configuração
 * invisível; aqui nada fica fora (o padrão cobre), a tela diz quantas estão no padrão, e trocar é
 * um seletor na própria linha — sem as permissões, a escada aparece só para ler.
 *
 * Quando a categoria troca de linha, ela MUDA DE LUGAR na tela: o foco vai junto, para o seletor
 * dela no lugar novo (sem isso, cairia no `body`). E os rascunhos são da PÁGINA: a subcategoria que
 * segue a mãe muda de cartão com ela e remonta — com o rascunho no seletor, ele sumiria calado.
 */
export function PaginaConfigurarDre() {
  const { consulta, podeTrocar } = usarConfiguracaoDoDre()
  const podeVerORelatorio = useAuthStore((estado) => possuiTodasAsPermissoes(estado.temPermissao, PERMISSOES_DO_RELATORIO))
  const podeCadastrarCategoria = useAuthStore((estado) => estado.temPermissao('categorias.criar'))
  const [focoPendente, setFocoPendente] = useState<string | null>(null)
  const rascunhos = usarRascunhosDaLinha(consulta.data)

  // o item que trocou de linha foi desenhado de novo noutro lugar: o foco o reencontra pelo id
  useEffect(() => {
    if (focoPendente === null || consulta.isFetching) return
    document.getElementById(focoPendente)?.focus()
    setFocoPendente(null)
  }, [focoPendente, consulta.isFetching, consulta.data])

  function conteudo() {
    if (consulta.isError) {
      return <EstadoErro mensagem="Não foi possível carregar a configuração do DRE." aoTentarNovamente={() => void consulta.refetch()} />
    }
    if (consulta.isPending) {
      return (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )
    }
    const configuracao = consulta.data
    if (configuracao.categorias.length === 0) {
      return (
        <EstadoVazio
          titulo="Nenhuma categoria cadastrada."
          descricao="O DRE soma os lançamentos pelas categorias do caixa: cadastre as de receita e as de despesa."
          acao={
            podeCadastrarCategoria ? (
              <Botao asChild>
                <Link to="/categorias">Cadastrar categoria</Link>
              </Botao>
            ) : undefined
          }
        />
      )
    }

    return (
      <div className="flex flex-col gap-6">
        <AvisoDoPadrao configuracao={configuracao} />
        <ol aria-label="A escada do DRE" className="flex flex-col gap-6">
          {configuracao.escada.map((degrau) => (
            <Degrau
              key={degrau.codigo}
              configuracao={configuracao}
              degrau={degrau}
              podeTrocar={podeTrocar}
              aoTrocar={setFocoPendente}
            />
          ))}
        </ol>
      </div>
    )
  }

  return (
    <ContextoDosRascunhos.Provider value={rascunhos}>
      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Link
            to="/financeiro"
            className="inline-flex w-fit items-center gap-1 rounded-controle text-corpo font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Financeiro
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex max-w-3xl flex-col gap-1">
              <h1 className="text-titulo font-semibold text-texto">Configurar DRE</h1>
              <p className="text-corpo text-texto-suave">{O_QUE_E_O_DRE}</p>
            </div>
            {podeVerORelatorio ? (
              <Botao asChild variante="secundario">
                <Link to="/relatorios/dre-gerencial">Ver o DRE</Link>
              </Botao>
            ) : null}
          </div>
          {podeTrocar ? null : (
            <p className="text-meta text-texto-suave">
              Você vê onde cada categoria cai. Trocar a linha é de quem edita as categorias e vê o fluxo de caixa.
            </p>
          )}
        </div>

        {conteudo()}
      </section>
    </ContextoDosRascunhos.Provider>
  )
}
