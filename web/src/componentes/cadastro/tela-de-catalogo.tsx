import { useQuery } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { AlertDialog } from 'radix-ui'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'

import { CabecalhoDeCadastro } from '@/componentes/cadastro/cabecalho-de-cadastro'
import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { ProtegidoPorPermissao } from '@/componentes/protegido-por-permissao'
import { AvisoConflito } from '@/componentes/aviso-conflito'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { Tabela } from '@/componentes/ui/tabela'
import { usarMutacaoDeCatalogo } from '@/hooks/usar-mutacao-de-catalogo'
import type { ErrosDoServidor } from '@/lib/erros'
import { useAuthStore } from '@/stores/auth-store'

interface Registro {
  id: number
  /** token da concorrência otimista (If-Match) — vem da linha que hidrata a edição */
  updated_at: string
}

export interface ColunaDeCatalogo<T> {
  cabecalho: string
  celula: (registro: T) => ReactNode
}

export interface TelaDeCatalogoProps<T extends Registro, P, V> {
  titulo: string
  /**
   * Nível do heading da seção — default `h1` (uma tela de catálogo por rota).
   *
   * A página do convênio monta DUAS numa rota só: lá vão como `h2`, sob o `h1` da
   * página (achado A11Y-LP-01 — dois `h1` destroem a hierarquia do leitor de tela).
   */
  nivelDoTitulo?: 'h1' | 'h2'
  /**
   * Link de VOLTAR do cabeçalho. Uma tela de catálogo por rota (h1) é sempre um cadastro
   * de apoio: por padrão volta para `/cadastros` ("← Cadastros"). As seções `h2` (as duas
   * do convênio) NÃO recebem — a página que as monta já tem o próprio voltar.
   */
  voltar?: { rota: string; rotulo: string }
  /** Módulo de permissão: `especialidades`, `salas`… */
  modulo: string
  /** Singular, para o botão e o diálogo ("especialidade") */
  rotuloSingular: string
  /** O português tem gênero: "especialidade excluídA", "feriado excluídO" */
  genero: 'm' | 'f'
  chave: readonly unknown[]
  /**
   * A chave a INVALIDAR após escrever, quando difere da que se lê (default: `chave`).
   *
   * Só as subcategorias precisam: elas leem sob chave própria (o formato difere do da
   * lista de categorias, e duas `queryFn` na mesma chave não coexistem), mas escrever
   * uma muda também a contagem da lista de categorias e o seletor do lançamento.
   */
  chaveDeInvalidacao?: readonly unknown[]
  listar: () => Promise<T[]>
  recurso: {
    criar: (payload: P) => Promise<T>
    atualizar: (id: number, payload: P, versao: string) => Promise<T>
    excluir: (id: number) => Promise<void>
  }
  /** Os campos do FORMULÁRIO — a chave da ENTIDADE nunca entra (parecer SEC-CA-03) */
  campos: ReadonlySet<string>
  colunas: ReadonlyArray<ColunaDeCatalogo<T>>
  /** Estado inicial do formulário: cadastro novo (undefined) ou edição */
  valoresIniciais: (registro?: T) => V
  formulario: (contexto: {
    valores: V
    definir: (parciais: Partial<V>) => void
    erros: ErrosDoServidor
  }) => ReactNode
  paraPayload: (valores: V) => P
  /** O NOME do alvo no diálogo — nunca "este registro" (§2) */
  nomeDoRegistro: (registro: T) => string
  /**
   * Permissões das afordâncias de escrita — default `${modulo}.criar/editar/excluir`.
   *
   * Existe porque nem toda filha replica o trio do módulo: as REGRAS DE LIMITE do
   * convênio são geridas INTEIRAS sob `convenios.editar` (delta spec de
   * limites-e-pedidos-por-convenio) — criar/editar/excluir com a MESMA permissão.
   * Guard de experiência apenas: o servidor continua decidindo (403).
   */
  permissoes?: { criar: string; editar: string; excluir: string }
  /** A consequência REAL da exclusão (§2) */
  consequenciaDaExclusao: string
  /**
   * As consequências de mudar REGRA neste cadastro (§2/§13) — lista vazia quando
   * nada de regra mudou.
   *
   * Nem todo campo é preferência: `particular` num convênio decide se o
   * tratamento cai no caixa; as flags de um status decidem consumo de sessão e
   * bloqueio de horário. Esses NÃO mudam sem a clínica ler o que vai acontecer.
   */
  consequenciasDaRegra?: (valores: V, original?: T) => readonly string[]
  vazioTitulo: string
  vazioDescricao?: string
  /**
   * `false` torna a ação de salvar indisponível — para quando o formulário depende de um
   * catálogo que veio VAZIO e não há o que escolher (o cartão exige uma conta de destino).
   * É o mesmo regime dos formulários de lançamento (design D5): a ação não promete o que
   * o servidor recusaria, e o campo diz onde cadastrar.
   */
  podeSalvar?: boolean
}

/**
 * O esqueleto das telas de catálogo: lista + formulário + confirmação.
 *
 * Treze catálogos têm exatamente esta forma, e treze cópias divergiriam treze
 * vezes — divergindo primeiro justamente no que não pode: a recusa do servidor
 * pousando no lugar certo e a confirmação nomeando o alvo.
 *
 * A recusa de EXCLUSÃO (catálogo em uso) chega com a chave da ENTIDADE, que não é
 * campo de formulário nenhum: ela cai em `gerais`, o toast a mostra, a promessa
 * rejeita e **o diálogo continua aberto** — o registro permanece íntegro na lista.
 */
export function TelaDeCatalogo<T extends Registro, P, V>({
  titulo,
  nivelDoTitulo,
  voltar,
  modulo,
  rotuloSingular,
  genero,
  chave,
  chaveDeInvalidacao,
  listar,
  recurso,
  campos,
  colunas,
  valoresIniciais,
  formulario,
  paraPayload,
  nomeDoRegistro,
  consequenciaDaExclusao,
  consequenciasDaRegra,
  vazioTitulo,
  vazioDescricao,
  podeSalvar = true,
  permissoes,
}: TelaDeCatalogoProps<T, P, V>) {
  const consulta = useQuery({ queryKey: chave, queryFn: listar })
  const permissaoCriar = permissoes?.criar ?? `${modulo}.criar`
  const permissaoEditar = permissoes?.editar ?? `${modulo}.editar`
  const permissaoExcluir = permissoes?.excluir ?? `${modulo}.excluir`
  const podeEditar = useAuthStore((estado) => estado.temPermissao(permissaoEditar))
  const podeExcluir = useAuthStore((estado) => estado.temPermissao(permissaoExcluir))

  const { erros, limparErros, criar, atualizar, excluir, salvando, excluindo } =
    usarMutacaoDeCatalogo<T, P>({
      recurso,
      chave,
      chaveDeInvalidacao,
      campos,
      rotuloSingular,
      genero,
    })

  // De onde o formulário foi aberto, para devolver o foco ao fechar. O Radix sozinho
  // não resolve: o `AlertDialogContent` CANCELA o autofoco padrão e foca o seu
  // `AlertDialog.Cancel` — e esta tela não tinha um, então ninguém era focado. O foco
  // ficava no botão de FUNDO e o Tab passeava por controles sob `aria-hidden="true"`
  // (achado A11Y-CF-01/02 do gate: quem usa leitor de tela abria a janela e não ouvia
  // nada). O `DialogConfirmacao` do design system já fazia certo; aqui é a mesma receita.
  const refDoFormulario = useRef<HTMLFormElement>(null)
  const refDisparadorDoFormulario = useRef<HTMLElement | null>(null)

  const [emEdicao, setEmEdicao] = useState<T | null>(null)
  const [formularioAberto, setFormularioAberto] = useState(false)
  const [valores, setValores] = useState<V>(() => valoresIniciais())
  const [aExcluir, setAExcluir] = useState<T | null>(null)
  const [aConfirmar, setAConfirmar] = useState<readonly string[] | null>(null)

  const registros = consulta.data ?? []

  // "1 cartões" é português errado na tela de uma clínica. A contagem sai daqui UMA vez
  // porque aparece em DOIS lugares — o cabeçalho e a `<caption>` sr-only da tabela —, e
  // no primeiro conserto só o visível aprendeu o singular: quem usa leitor de tela
  // continuava ouvindo "1 cartões" (achado I1 do gate, no único lugar que o revisor
  // vidente não vê).
  const contagem = `${registros.length} ${registros.length === 1 ? rotuloSingular : titulo.toLowerCase()}`
  const temAcoes = podeEditar || podeExcluir
  // h1 = uma tela de catálogo por rota = um cadastro de apoio → volta aos Cadastros;
  // as seções h2 (convênio) não recebem (a página delas já tem o próprio voltar)
  const voltarDoCabecalho =
    voltar ?? (nivelDoTitulo === 'h2' ? undefined : { rota: '/cadastros', rotulo: 'Cadastros' })

  /**
   * `disparador` vem do CLIQUE (`evento.currentTarget`), não de `document.activeElement`.
   *
   * Adivinhar quem abriu funcionava no jsdom, onde `userEvent.click` sempre foca — mas em
   * navegador que não foca `<button>` no clique (Safari/Firefox no macOS), o
   * `preventDefault()` do `onCloseAutoFocus` mandaria o foco para o `<body>` e o teste
   * não veria. O clique já entrega essa informação de graça (achado do gate: "prova na
   * condição errada", lição que esta casa já pagou).
   */
  function abrirFormulario(disparador: HTMLElement, registro?: T): void {
    limparErros()
    refDisparadorDoFormulario.current = disparador
    setEmEdicao(registro ?? null)
    setValores(valoresIniciais(registro))
    setFormularioAberto(true)
  }

  function definir(parciais: Partial<V>): void {
    setValores((anteriores) => ({ ...anteriores, ...parciais }))
  }

  function nomeDoAlvo(): string {
    return emEdicao === null ? rotuloSingular : nomeDoRegistro(emEdicao)
  }

  function salvar(): void {
    const payload = paraPayload(valores)
    const fechar = {
      onSuccess: () => {
        setFormularioAberto(false)
        setAConfirmar(null)
      },
    }

    if (emEdicao === null) {
      criar.mutate(payload, fechar)
      return
    }
    atualizar.mutate({ id: emEdicao.id, payload, versao: emEdicao.updated_at }, fechar)
  }

  /**
   * A saída do CONFLITO (concorrência otimista): refaz a leitura e re-hidrata o
   * formulário com a versão atual — quem decide recarregar é a pessoa (o refetch
   * automático descartaria o que ela digitou, em silêncio).
   */
  async function recarregarEmEdicao(): Promise<void> {
    const { data } = await consulta.refetch()
    const fresco = (data ?? []).find((registro) => registro.id === emEdicao?.id)
    limparErros()
    if (fresco === undefined) {
      // o registro sumiu (excluído por outra pessoa): não há o que editar
      setFormularioAberto(false)
      return
    }
    setEmEdicao(fresco)
    setValores(valoresIniciais(fresco))
  }

  function submeter(evento: FormEvent): void {
    evento.preventDefault()

    // mudou REGRA? a clínica confirma sabendo o que vai acontecer (§2)
    const consequencias = consequenciasDaRegra?.(valores, emEdicao ?? undefined) ?? []
    if (consequencias.length > 0) {
      setAConfirmar(consequencias)
      return
    }
    salvar()
  }

  return (
    <section className="flex flex-col gap-6">
      <CabecalhoDeCadastro
        titulo={titulo}
        nivel={nivelDoTitulo}
        voltar={voltarDoCabecalho}
        contador={consulta.isSuccess ? contagem : undefined}
        acao={
          <ProtegidoPorPermissao permissao={permissaoCriar}>
            <Botao
              onClick={(evento) => {
                abrirFormulario(evento.currentTarget)
              }}
            >
              <Plus aria-hidden="true" className="size-4" />
              Cadastrar {rotuloSingular}
            </Botao>
          </ProtegidoPorPermissao>
        }
      />

      <EstadosDaLista
        carregando={consulta.isPending}
        erro={consulta.isError}
        aoTentarNovamente={() => {
          void consulta.refetch()
        }}
        vazio={consulta.isSuccess && registros.length === 0}
        vazioTitulo={vazioTitulo}
        vazioDescricao={vazioDescricao}
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
                      <ProtegidoPorPermissao permissao={permissaoEditar}>
                        <Botao
                          variante="secundario"
                          tamanho="sm"
                          onClick={(evento) => {
                            abrirFormulario(evento.currentTarget, registro)
                          }}
                        >
                          <Pencil aria-hidden="true" className="size-3.5" />
                          Editar
                        </Botao>
                      </ProtegidoPorPermissao>
                      <ProtegidoPorPermissao permissao={permissaoExcluir}>
                        <Botao
                          variante="perigo-suave"
                          tamanho="sm"
                          onClick={() => {
                            limparErros()
                            setAExcluir(registro)
                          }}
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                          Excluir
                        </Botao>
                      </ProtegidoPorPermissao>
                    </div>
                  </Tabela.Celula>
                ) : null}
              </Tabela.Linha>
            ))}
          </Tabela.Corpo>
        </Tabela>
      </EstadosDaLista>

      {formularioAberto ? (
        <AlertDialog.Root
          open
          onOpenChange={(aberto) => {
            if (!aberto && !salvando) setFormularioAberto(false)
          }}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-(--z-scrim) bg-texto/40" />
            <AlertDialog.Content
              className="fixed left-1/2 top-1/2 z-(--z-dialogo) max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-janela bg-superficie-elevada p-6 shadow-e3"
              onOpenAutoFocus={(evento) => {
                evento.preventDefault()
                // o PRIMEIRO campo, não o Cancelar: aqui a pessoa veio para digitar, e o
                // primeiro campo é sempre o nome (a confirmação de exclusão é que foca a
                // ação segura, porque lá o gesto é destrutivo)
                const primeiro = refDoFormulario.current?.querySelector<HTMLElement>(
                  'input:not([type="hidden"]), select, textarea',
                )
                primeiro?.focus()
              }}
              onCloseAutoFocus={(evento) => {
                evento.preventDefault()
                refDisparadorDoFormulario.current?.focus()
              }}
              // Esc fecha SEMPRE ao primeiro toque. O caminho do Radix (camada dispensável
              // mais alta) deixava de fechar depois de uma recusa do servidor — medido:
              // a tecla chegava ao documento, `salvando` era falso, o Cancelar estava
              // habilitado, e mesmo assim eram precisos DOIS Esc (achado A11Y-CF-02). Este
              // ouvinte no conteúdo não depende da ordem das camadas: o foco está dentro
              // do diálogo, o evento passa por aqui.
              onKeyDown={(evento) => {
                if (evento.key !== 'Escape' || salvando) return
                evento.stopPropagation()
                setFormularioAberto(false)
              }}
            >
              <AlertDialog.Title className="text-titulo font-semibold text-texto">
                {emEdicao === null
                  ? `Cadastrar ${rotuloSingular}`
                  : `Editar ${nomeDoRegistro(emEdicao)}`}
              </AlertDialog.Title>
              <AlertDialog.Description className="sr-only">
                Preencha os dados do cadastro.
              </AlertDialog.Description>

              <form ref={refDoFormulario} onSubmit={submeter} className="mt-5 flex flex-col gap-4">
                {/* com o diálogo de regra aberto, a recusa aparece LÁ — dois
                    role="alert" com o mesmo texto fazem o leitor de tela repetir */}
                <AvisoErro
                  mensagens={aConfirmar === null && erros.motivo !== 'conflito' ? erros.gerais : []}
                />
                <AvisoConflito
                  visivel={aConfirmar === null && erros.motivo === 'conflito' && emEdicao !== null}
                  aoRecarregar={() => {
                    void recarregarEmEdicao()
                  }}
                  recarregando={consulta.isRefetching}
                />

                {formulario({ valores, definir, erros })}

                <div className="mt-2 flex justify-end gap-3">
                  <Botao
                    type="button"
                    variante="secundario"
                    tamanho="lg"
                    disabled={salvando}
                    onClick={() => {
                      setFormularioAberto(false)
                    }}
                  >
                    Cancelar
                  </Botao>
                  <Botao type="submit" tamanho="lg" carregando={salvando} disabled={!podeSalvar}>
                    {emEdicao === null ? 'Cadastrar' : 'Salvar'}
                  </Botao>
                </div>
              </form>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}

      {/* mudança de REGRA: tom `atencao`, e a consequência em português de balcão */}
      <DialogConfirmacao
        aberto={aConfirmar !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setAConfirmar(null)
        }}
        titulo={`Mudar a regra de ${nomeDoAlvo()}?`}
        consequencia={(aConfirmar ?? []).join(' ')}
        rotuloConfirmar="Mudar a regra"
        tom="atencao"
        carregando={salvando}
        erros={erros.gerais}
        aoConfirmar={() =>
          new Promise<void>((resolver, rejeitar) => {
            const payload = paraPayload(valores)
            const acabar = {
              onSuccess: () => {
                setFormularioAberto(false)
                setAConfirmar(null)
                resolver()
              },
              onError: () => {
                rejeitar(new Error('recusado'))
              },
            }
            if (emEdicao === null) {
              criar.mutate(payload, acabar)
              return
            }
            atualizar.mutate({ id: emEdicao.id, payload, versao: emEdicao.updated_at }, acabar)
          })
        }
      />

      {/* A exclusão é PROTEGIDA no servidor (catálogo em uso → 422). A recusa
          precisa APARECER: a promessa rejeita, o diálogo fica aberto e o toast
          carrega a mensagem — nada de fechar como se tivesse dado certo. */}
      <DialogConfirmacao
        aberto={aExcluir !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setAExcluir(null)
        }}
        titulo={aExcluir !== null ? `Excluir ${nomeDoRegistro(aExcluir)}?` : ''}
        consequencia={consequenciaDaExclusao}
        rotuloConfirmar={`Excluir ${rotuloSingular}`}
        tom="perigo"
        carregando={excluindo}
        erros={erros.gerais}
        aoConfirmar={() =>
          new Promise<void>((resolver, rejeitar) => {
            if (aExcluir === null) {
              resolver()
              return
            }
            excluir.mutate(aExcluir.id, {
              onSuccess: () => {
                setAExcluir(null)
                resolver()
              },
              onError: () => {
                rejeitar(new Error('recusado'))
              },
            })
          })
        }
      />
    </section>
  )
}
