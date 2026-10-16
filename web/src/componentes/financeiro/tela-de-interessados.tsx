import { useQuery } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'

import type { ColunaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import type {
  DetalheDeInteressado,
  LinhaDeInteressado,
  ModuloDeInteressado,
} from '@/componentes/financeiro/modulo-de-interessado'

import { CabecalhoDeCadastro } from '@/componentes/cadastro/cabecalho-de-cadastro'
import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { DialogoDeInteressado } from '@/componentes/financeiro/dialogo-de-interessado'
import { Botao } from '@/componentes/ui/botao'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { Paginacao } from '@/componentes/ui/paginacao'
import { Tabela } from '@/componentes/ui/tabela'
import { usarDebounce } from '@/hooks/usar-debounce'
import { usarMutacaoDeInteressado } from '@/hooks/usar-mutacao-de-interessado'
import { ErroDeApi } from '@/lib/http'
import { useAuthStore } from '@/stores/auth-store'

export interface TelaDeInteressadosProps<
  L extends LinhaDeInteressado,
  D extends DetalheDeInteressado,
  P,
  V extends { ativo: boolean },
> {
  modulo: ModuloDeInteressado<L, D, P, V>
  /** As colunas da LISTA — só o que a API lista (a lista é minimizada no servidor, T-fin-05). */
  colunas: ReadonlyArray<ColunaDeCatalogo<L>>
  busca: { rotulo: string; placeholder: string }
}

/**
 * A tela de um cadastro de "a quem a clínica paga" — Fornecedores ou Funcionários (design D4), no
 * molde do `TelaDeCatalogo`, com o que estes dois cadastros têm e os catálogos não:
 *
 * - **busca e página no SERVIDOR**: a lista cresce (dezesseis funcionários só na virada);
 * - **edição pelo DETALHE lido na hora**: a linha é minimizada e não traz documento, contatos,
 *   endereço nem o `updated_at`. Nada vem do cache — não existe o detalhe velho de onde um
 *   formulário hidrataria e desfaria a edição anterior (gatilho CHAVE-DETALHE);
 * - **exclusão com saída**: quem já tem lançamento não se exclui (retenção fiscal); o servidor
 *   recusa, a tela mostra a razão e oferece inativar ali mesmo.
 */
export function TelaDeInteressados<
  L extends LinhaDeInteressado,
  D extends DetalheDeInteressado,
  P,
  V extends { ativo: boolean },
>({ modulo, colunas, busca }: TelaDeInteressadosProps<L, D, P, V>) {
  const [termo, setTermo] = useState('')
  const termoAtrasado = usarDebounce(termo, 300)
  const [pagina, setPagina] = useState(1)
  const filtro = { busca: termoAtrasado.trim(), pagina }
  const consulta = useQuery({
    queryKey: modulo.chave(filtro),
    queryFn: () => modulo.servico.listar(filtro),
    // a lista anterior fica enquanto a próxima busca responde: sem isto a tabela pisca vazia a cada tecla
    placeholderData: (anterior) => anterior,
  })

  const podeCriar = useAuthStore((estado) => estado.temPermissao(`${modulo.modulo}.criar`))
  const podeEditar = useAuthStore((estado) => estado.temPermissao(`${modulo.modulo}.editar`))
  const podeExcluir = useAuthStore((estado) => estado.temPermissao(`${modulo.modulo}.excluir`))
  const { erros, limparErros, notificar, excluir, inativar } = usarMutacaoDeInteressado(modulo)

  const refDisparador = useRef<HTMLElement | null>(null)
  const refDisparadorDaExclusao = useRef<HTMLElement | null>(null)
  // a âncora que sobrevive a qualquer repintura da lista: o gatilho some quando a linha sai (excluir)
  // ou quando o estado vazio vira tabela (o primeiro cadastro) — e o foco não pode cair no `body`
  const refDoTitulo = useRef<HTMLHeadingElement>(null)
  const [formulario, setFormulario] = useState<{ registro: D | null } | null>(null)
  const [abrindoId, setAbrindoId] = useState<number | null>(null)
  const [aExcluir, setAExcluir] = useState<L | null>(null)
  const [ofereceInativar, setOfereceInativar] = useState(false)

  const registros = consulta.data?.data ?? []
  const total = consulta.data?.total ?? 0
  const singular = modulo.rotuloSingular
  const vogal = modulo.genero === 'f' ? 'a' : 'o'
  const nenhum = modulo.genero === 'f' ? 'Nenhuma' : 'Nenhum'
  const contagem = `${total} ${total === 1 ? singular : modulo.titulo.toLowerCase()}`
  const buscando = filtro.busca !== ''
  const temAcoes = podeEditar || podeExcluir

  /** O gatilho, se ele ainda está na tela; senão, o título da seção (2.4.3). */
  function focoDepoisDe(disparador: HTMLElement | null): HTMLElement | null {
    return disparador !== null && disparador.isConnected ? disparador : refDoTitulo.current
  }

  function abrirNovo(disparador: HTMLElement): void {
    refDisparador.current = disparador
    setFormulario({ registro: null })
  }

  /** A edição relê o cadastro INTEIRO agora — a linha da lista não tem o que o formulário precisa. */
  async function abrirEdicao(linha: L, disparador: HTMLElement): Promise<void> {
    refDisparador.current = disparador
    setAbrindoId(linha.id)
    try {
      setFormulario({ registro: await modulo.servico.buscar(linha.id) })
    } catch {
      notificar({
        tom: 'erro',
        titulo: `Não foi possível abrir o cadastro de ${modulo.nomeDaLinha(linha)}. Tente de novo em instantes.`,
      })
      void consulta.refetch()
    } finally {
      setAbrindoId(null)
    }
  }

  function trocarBusca(valor: string): void {
    setTermo(valor)
    setPagina(1)
  }

  const botaoCadastrar = podeCriar ? (
    <Botao
      onClick={(evento) => {
        abrirNovo(evento.currentTarget)
      }}
    >
      <Plus aria-hidden="true" className="size-4" />
      Cadastrar {singular}
    </Botao>
  ) : undefined

  return (
    <section className="flex flex-col gap-6">
      <CabecalhoDeCadastro
        titulo={modulo.titulo}
        refDoTitulo={refDoTitulo}
        voltar={{ rota: '/cadastros', rotulo: 'Cadastros' }}
        contador={consulta.isSuccess ? contagem : undefined}
        acao={botaoCadastrar}
        busca={{ rotulo: busca.rotulo, placeholder: busca.placeholder, valor: termo, aoMudar: trocarBusca }}
      />

      {/* a frase de "o que é" (design D8): o motivo de a clínica não usar isto no sistema antigo */}
      <p className="-mt-2 max-w-2xl text-corpo text-texto-suave">{modulo.explicacao}</p>

      <EstadosDaLista
        carregando={consulta.isPending}
        erro={consulta.isError}
        aoTentarNovamente={() => {
          void consulta.refetch()
        }}
        vazio={consulta.isSuccess && registros.length === 0}
        vazioTitulo={buscando ? `${nenhum} ${singular} encontrad${vogal}` : `${nenhum} ${singular} cadastrad${vogal}`}
        vazioDescricao={
          buscando
            ? 'Confira a grafia, ou cadastre um novo.'
            : 'Cadastre para escolher como interessado de uma despesa.'
        }
        vazioAcao={botaoCadastrar}
      >
        <Tabela legenda={contagem}>
          <Tabela.Cabecalho>
            <Tabela.Linha>
              {colunas.map(({ cabecalho }) => (
                <Tabela.CelulaCabecalho key={cabecalho} scope="col">
                  {cabecalho}
                </Tabela.CelulaCabecalho>
              ))}
              {temAcoes ? <Tabela.CelulaCabecalho scope="col">Ações</Tabela.CelulaCabecalho> : null}
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {registros.map((registro) => (
              <Tabela.Linha key={registro.id}>
                {colunas.map(({ cabecalho, celula }) => (
                  <Tabela.Celula key={cabecalho}>{celula(registro)}</Tabela.Celula>
                ))}
                {temAcoes ? (
                  <Tabela.Celula>
                    <div className="flex gap-2">
                      {podeEditar ? (
                        <Botao
                          variante="secundario"
                          tamanho="sm"
                          carregando={abrindoId === registro.id}
                          onClick={(evento) => {
                            void abrirEdicao(registro, evento.currentTarget)
                          }}
                        >
                          <Pencil aria-hidden="true" className="size-3.5" />
                          Editar
                        </Botao>
                      ) : null}
                      {podeExcluir ? (
                        <Botao
                          variante="perigo-suave"
                          tamanho="sm"
                          onClick={(evento) => {
                            refDisparadorDaExclusao.current = evento.currentTarget
                            limparErros()
                            setOfereceInativar(false)
                            setAExcluir(registro)
                          }}
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                          Excluir
                        </Botao>
                      ) : null}
                    </div>
                  </Tabela.Celula>
                ) : null}
              </Tabela.Linha>
            ))}
          </Tabela.Corpo>
        </Tabela>

        {consulta.data !== undefined && consulta.data.last_page > 1 ? (
          <Paginacao
            pagina={consulta.data.current_page}
            totalPaginas={consulta.data.last_page}
            totalItens={total}
            aoMudar={setPagina}
          />
        ) : null}
      </EstadosDaLista>

      {formulario !== null ? (
        <DialogoDeInteressado
          modulo={modulo}
          registro={formulario.registro}
          aoFechar={() => {
            setFormulario(null)
          }}
          focoAoFechar={() => focoDepoisDe(refDisparador.current)}
        />
      ) : null}

      {/* Excluir → (recusa por lançamento) → inativar, no MESMO diálogo: a razão do servidor fica à
          vista, e a saída que ela aponta está a um clique, sem procurar o Editar da linha */}
      <DialogConfirmacao
        aberto={aExcluir !== null}
        aoMudarAberto={(aberto) => {
          if (aberto) return
          setAExcluir(null)
          setOfereceInativar(false)
          limparErros()
        }}
        titulo={
          aExcluir === null
            ? ''
            : ofereceInativar
              ? `Inativar ${modulo.nomeDaLinha(aExcluir)}?`
              : `Excluir ${modulo.nomeDaLinha(aExcluir)}?`
        }
        consequencia={
          ofereceInativar
            ? `Inativ${vogal}, o cadastro fica guardado com o histórico dos lançamentos que já tem.`
            : 'Só sai do sistema quem ainda não tem lançamento. Com lançamento, o sistema recusa e oferece inativar.'
        }
        rotuloConfirmar={ofereceInativar ? `Inativar ${singular}` : `Excluir ${singular}`}
        tom={ofereceInativar ? 'atencao' : 'perigo'}
        focoAoFechar={() => {
          const disparador = refDisparadorDaExclusao.current
          // o gatilho ainda na tela: o padrão do diálogo (volta a ele) já está certo
          return disparador !== null && disparador.isConnected ? null : refDoTitulo.current
        }}
        carregando={excluir.isPending || inativar.isPending}
        erros={erros.gerais}
        aoConfirmar={() =>
          new Promise<void>((resolver, rejeitar) => {
            if (aExcluir === null) {
              resolver()
              return
            }
            const alvo = aExcluir
            const acabar = {
              onSuccess: () => {
                setAExcluir(null)
                setOfereceInativar(false)
                resolver()
              },
            }

            if (ofereceInativar) {
              inativar.mutate(alvo.id, {
                ...acabar,
                onError: () => {
                  rejeitar(new Error('recusado'))
                },
              })
              return
            }
            excluir.mutate(alvo.id, {
              ...acabar,
              onError: (erro) => {
                // 422 = tem lançamento. A saída é inativar — se ainda está ativo e quem tenta pode editar
                const recusaDeNegocio = erro instanceof ErroDeApi && erro.motivo === 'invalido'
                setOfereceInativar(recusaDeNegocio && alvo.ativo && podeEditar)
                rejeitar(new Error('recusado'))
              },
            })
          })
        }
      />
    </section>
  )
}
