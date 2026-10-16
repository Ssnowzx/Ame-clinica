import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { FormularioNivel } from '@/componentes/administracao/formulario-nivel'
import { CabecalhoDeCadastro } from '@/componentes/cadastro/cabecalho-de-cadastro'
import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { ProtegidoPorPermissao } from '@/componentes/protegido-por-permissao'
import { Botao } from '@/componentes/ui/botao'
import { Dialog } from '@/componentes/ui/dialog'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { Tabela } from '@/componentes/ui/tabela'
import { usarToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { ErroDeApi } from '@/lib/http'
import { possuiTodasAsPermissoes } from '@/lib/permissoes'
import { ACIMA_DO_SEU_ACESSO } from '@/lib/permissoes-rotulos'
import { excluirNivelPermissao, listarNiveisPermissao } from '@/servicos/niveis-permissao'
import { useAuthStore } from '@/stores/auth-store'
import type { NivelPermissao } from '@/tipos'

/** Extrai a recusa de domínio de um erro de API (o motivo da exclusão barrada). */
function mensagemDeExclusao(erro: unknown): string {
  if (erro instanceof ErroDeApi) {
    return Object.values(erro.camposInvalidos)[0]?.[0] ?? erro.message
  }
  return 'Não foi possível excluir o nível.'
}

/** Aba de níveis de permissão da clínica (§12), sob `niveis_permissao.ver`. */
export function PainelNiveis() {
  const queryClient = useQueryClient()
  const { notificar } = usarToast()
  const podeEditar = useAuthStore((estado) => estado.temPermissao('niveis_permissao.editar'))
  const podeExcluir = useAuthStore((estado) => estado.temPermissao('niveis_permissao.excluir'))
  const temPermissao = useAuthStore((estado) => estado.temPermissao)

  const consulta = useQuery({ queryKey: chaves.niveisPermissao(), queryFn: listarNiveisPermissao })

  // `undefined` = fechado; `null` = criando; registro = editando
  const [formulario, setFormulario] = useState<NivelPermissao | null | undefined>(undefined)
  const [aExcluir, setAExcluir] = useState<NivelPermissao | null>(null)

  const exclusao = useMutation({
    retry: 0,
    mutationFn: (id: number) => excluirNivelPermissao(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: chaves.niveisPermissao() })
      notificar({ tom: 'sucesso', titulo: 'Nível excluído.' })
    },
  })

  const niveis = consulta.data ?? []
  const aberto = formulario !== undefined
  const temAcoes = podeEditar || podeExcluir

  return (
    <section className="flex flex-col gap-6">
      <CabecalhoDeCadastro
        titulo="Níveis de permissão"
        contador={consulta.isSuccess ? `${niveis.length} nível(is)` : undefined}
        acao={
          <ProtegidoPorPermissao permissao="niveis_permissao.criar">
            <Botao
              onClick={() => {
                setFormulario(null)
              }}
            >
              <Plus aria-hidden="true" className="size-4" />
              Novo nível
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
        vazio={consulta.isSuccess && niveis.length === 0}
        vazioTitulo="Nenhum nível cadastrado"
        vazioDescricao="Crie níveis para definir o que cada usuário pode fazer."
      >
        <Tabela legenda={`${niveis.length} níveis`}>
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho scope="col">Nome</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Permissões</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Usuários</Tabela.CelulaCabecalho>
              {temAcoes ? <Tabela.CelulaCabecalho scope="col">Ações</Tabela.CelulaCabecalho> : null}
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {niveis.map((nivel) => {
              const emUso = (nivel.usuarios_count ?? 0) > 0
              return (
                <Tabela.Linha key={nivel.id}>
                  <Tabela.Celula>{nivel.nome}</Tabela.Celula>
                  <Tabela.Celula>{nivel.permissoes.length}</Tabela.Celula>
                  <Tabela.Celula>{nivel.usuarios_count ?? 0}</Tabela.Celula>
                  {temAcoes ? (
                    <Tabela.Celula>
                      <div className="flex gap-2">
                        <ProtegidoPorPermissao permissao="niveis_permissao.editar">
                          {/* nível com permissão que a pessoa não tem não se edita por ela
                              (change `trava-de-usuarios-e-niveis`) */}
                          {possuiTodasAsPermissoes(temPermissao, nivel.permissoes) ? (
                            <Botao
                              variante="secundario"
                              tamanho="sm"
                              onClick={() => {
                                setFormulario(nivel)
                              }}
                            >
                              <Pencil aria-hidden="true" className="size-3.5" />
                              Editar
                            </Botao>
                          ) : (
                            <span className="self-center text-meta text-texto-suave">{ACIMA_DO_SEU_ACESSO}</span>
                          )}
                        </ProtegidoPorPermissao>
                        <ProtegidoPorPermissao permissao="niveis_permissao.excluir">
                          <Botao
                            variante="perigo-suave"
                            tamanho="sm"
                            disabled={emUso}
                            title={emUso ? 'Nível atribuído a usuários — não pode ser excluído.' : undefined}
                            onClick={() => {
                              setAExcluir(nivel)
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
              )
            })}
          </Tabela.Corpo>
        </Tabela>
      </EstadosDaLista>

      <Dialog
        aberto={aberto}
        aoMudarAberto={(estaAberto) => {
          if (!estaAberto) setFormulario(undefined)
        }}
        titulo={formulario === null || formulario === undefined ? 'Novo nível' : `Editar ${formulario.nome}`}
        descricao="O que os usuários deste nível podem fazer."
      >
        {aberto ? (
          <FormularioNivel
            nivel={formulario ?? null}
            aoConcluir={() => {
              setFormulario(undefined)
            }}
            aoCancelar={() => {
              setFormulario(undefined)
            }}
          />
        ) : null}
      </Dialog>

      <DialogConfirmacao
        aberto={aExcluir !== null}
        aoMudarAberto={(estaAberto) => {
          if (!estaAberto) setAExcluir(null)
        }}
        titulo={aExcluir !== null ? `Excluir ${aExcluir.nome}?` : ''}
        consequencia="Os usuários deste nível ficam sem permissões até receberem outro nível."
        rotuloConfirmar="Excluir nível"
        tom="perigo"
        carregando={exclusao.isPending}
        erros={exclusao.isError ? [mensagemDeExclusao(exclusao.error)] : []}
        aoConfirmar={() =>
          new Promise<void>((resolver, rejeitar) => {
            if (aExcluir === null) {
              resolver()
              return
            }
            exclusao.mutate(aExcluir.id, {
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
