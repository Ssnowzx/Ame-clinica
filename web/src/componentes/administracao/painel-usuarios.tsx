import { useQuery } from '@tanstack/react-query'
import { Check, Minus, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'

import { FormularioUsuario } from '@/componentes/administracao/formulario-usuario'
import { CabecalhoDeCadastro } from '@/componentes/cadastro/cabecalho-de-cadastro'
import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { ProtegidoPorPermissao } from '@/componentes/protegido-por-permissao'
import { Botao } from '@/componentes/ui/botao'
import { Dialog } from '@/componentes/ui/dialog'
import { Tabela } from '@/componentes/ui/tabela'
import { chaves } from '@/lib/chaves-query'
import { alcancaOUsuario } from '@/lib/permissoes'
import { ACIMA_DO_SEU_ACESSO } from '@/lib/permissoes-rotulos'
import { listarUsuarios } from '@/servicos/usuarios'
import { useAuthStore } from '@/stores/auth-store'

/** Célula booleana com ícone (sim/não) — acessível por texto oculto. */
function CelulaBooleana({ verdadeiro, rotulo }: { verdadeiro: boolean; rotulo: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-corpo">
      {verdadeiro ? (
        <Check aria-hidden="true" className="size-4 text-sucesso-texto" />
      ) : (
        <Minus aria-hidden="true" className="size-4 text-texto-suave" />
      )}
      <span className="sr-only">{`${rotulo}: ${verdadeiro ? 'sim' : 'não'}`}</span>
    </span>
  )
}

/** Aba de gestão de usuários da clínica (§12), sob `usuarios.ver`. */
export function PainelUsuarios() {
  const podeEditar = useAuthStore((estado) => estado.temPermissao('usuarios.editar'))
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const eu = useAuthStore((estado) => estado.usuario)
  const consulta = useQuery({ queryKey: chaves.usuarios(), queryFn: listarUsuarios })

  // `undefined` = fechado; `null` = criando; number = editando aquele id
  const [formulario, setFormulario] = useState<number | null | undefined>(undefined)

  const usuarios = consulta.data ?? []
  const aberto = formulario !== undefined

  return (
    <section className="flex flex-col gap-6">
      <CabecalhoDeCadastro
        titulo="Usuários"
        contador={consulta.isSuccess ? `${usuarios.length} usuário(s)` : undefined}
        acao={
          <ProtegidoPorPermissao permissao="usuarios.criar">
            <Botao
              onClick={() => {
                setFormulario(null)
              }}
            >
              <Plus aria-hidden="true" className="size-4" />
              Novo usuário
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
        vazio={consulta.isSuccess && usuarios.length === 0}
        vazioTitulo="Nenhum usuário cadastrado"
        vazioDescricao="Crie o primeiro usuário para dar acesso ao sistema."
      >
        <Tabela legenda={`${usuarios.length} usuários`}>
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho scope="col">Nome</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">E-mail</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Nível</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Ativo</Tabela.CelulaCabecalho>
              {podeEditar ? <Tabela.CelulaCabecalho scope="col">Ações</Tabela.CelulaCabecalho> : null}
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {usuarios.map((usuario) => (
              <Tabela.Linha key={usuario.id}>
                <Tabela.Celula>{usuario.nome}</Tabela.Celula>
                <Tabela.Celula>{usuario.email}</Tabela.Celula>
                <Tabela.Celula>{usuario.nivel_permissao ?? '—'}</Tabela.Celula>
                <Tabela.Celula>
                  <CelulaBooleana verdadeiro={usuario.ativo} rotulo="Ativo" />
                </Tabela.Celula>
                {podeEditar ? (
                  <Tabela.Celula>
                    {/* só edita quem alcança o usuário, nas permissões e no escopo
                        (change `trava-de-usuarios-e-niveis`) */}
                    {eu !== null && alcancaOUsuario(temPermissao, eu, usuario) ? (
                      <Botao
                        variante="secundario"
                        tamanho="sm"
                        onClick={() => {
                          setFormulario(usuario.id)
                        }}
                      >
                        <Pencil aria-hidden="true" className="size-3.5" />
                        Editar
                      </Botao>
                    ) : (
                      <span className="text-meta text-texto-suave">{ACIMA_DO_SEU_ACESSO}</span>
                    )}
                  </Tabela.Celula>
                ) : null}
              </Tabela.Linha>
            ))}
          </Tabela.Corpo>
        </Tabela>
      </EstadosDaLista>

      <Dialog
        aberto={aberto}
        aoMudarAberto={(estaAberto) => {
          if (!estaAberto) setFormulario(undefined)
        }}
        titulo={formulario === null ? 'Novo usuário' : 'Editar usuário'}
        descricao="Dados de acesso ao sistema."
      >
        {aberto ? (
          <FormularioUsuario
            usuarioId={formulario ?? null}
            aoConcluir={() => {
              setFormulario(undefined)
            }}
            aoCancelar={() => {
              setFormulario(undefined)
            }}
          />
        ) : null}
      </Dialog>
    </section>
  )
}
