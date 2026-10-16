import { useQuery } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { CabecalhoDeCadastro } from '@/componentes/cadastro/cabecalho-de-cadastro'
import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { FormularioProfissional } from '@/componentes/profissionais/formulario-profissional'
import { Botao } from '@/componentes/ui/botao'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { Tabela } from '@/componentes/ui/tabela'
import { usarMutacaoDeProfissional } from '@/hooks/usar-mutacao-de-profissional'
import { chaves } from '@/lib/chaves-query'
import { registroNoConselho } from '@/lib/conselho'
import { listarProfissionaisDoCadastro } from '@/servicos/profissionais'
import { resumoDeHorarios } from '@/lib/horarios-profissional'
import { useAuthStore } from '@/stores/auth-store'
import type { Profissional } from '@/tipos'

/** Profissionais executantes (§5) — as colunas da grade da agenda. */
export function PaginaProfissionais() {
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const [formularioAberto, setFormularioAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<Profissional | null>(null)
  const [excluindo, setExcluindo] = useState<Profissional | null>(null)

  const { excluir, gravando } = usarMutacaoDeProfissional()

  const profissionais = useQuery({
    queryKey: chaves.profissionaisDoCadastro(),
    queryFn: listarProfissionaisDoCadastro,
  })

  const podeCriar = temPermissao('profissionais.criar')
  const podeEditar = temPermissao('profissionais.editar')
  const podeExcluir = temPermissao('profissionais.excluir')

  const lista = profissionais.data ?? []

  function abrirNovo() {
    setEmEdicao(null)
    setFormularioAberto(true)
  }

  return (
    <section className="flex flex-col gap-5">
      <CabecalhoDeCadastro
        titulo="Profissionais"
        contador={
          profissionais.isSuccess
            ? `${lista.length} ${lista.length === 1 ? 'profissional' : 'profissionais'}`
            : undefined
        }
        acao={
          podeCriar ? (
            <Botao tamanho="lg" onClick={abrirNovo}>
              <UserPlus size={18} aria-hidden="true" />
              Cadastrar profissional
            </Botao>
          ) : undefined
        }
      />

      <EstadosDaLista
        carregando={profissionais.isPending}
        erro={profissionais.isError}
        aoTentarNovamente={() => {
          void profissionais.refetch()
        }}
        vazio={profissionais.isSuccess && lista.length === 0}
        vazioTitulo="Nenhum profissional cadastrado."
        vazioDescricao="A grade da agenda é montada a partir deles."
        vazioAcao={podeCriar ? <Botao onClick={abrirNovo}>Cadastrar profissional</Botao> : undefined}
      >
        <Tabela legenda={`Profissionais — ${lista.length} cadastrados`}>
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho>Profissional</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Especialidades</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Horários</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Conselho</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Situação</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Ações</Tabela.CelulaCabecalho>
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {lista.map((profissional) => (
              <Tabela.Linha key={profissional.id}>
                <Tabela.Celula>
                  {/* o nome é a PORTA da ficha (change ficha-do-profissional) */}
                  <Link
                    to={`/profissionais/${profissional.id}`}
                    className="rounded-controle font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
                  >
                    {profissional.nome}
                  </Link>
                </Tabela.Celula>
                <Tabela.Celula>
                  {profissional.especialidades.length > 0
                    ? profissional.especialidades.map((especialidade) => especialidade.nome).join(', ')
                    : '—'}
                </Tabela.Celula>
                <Tabela.Celula>{resumoDeHorarios(profissional.horarios)}</Tabela.Celula>
                <Tabela.Celula>
                  {registroNoConselho(profissional) ?? '—'}
                </Tabela.Celula>
                <Tabela.Celula>{profissional.ativo ? 'Ativo' : 'Inativo'}</Tabela.Celula>
                <Tabela.Celula>
                  <div className="flex flex-wrap gap-2">
                    {podeEditar ? (
                      <Botao
                        tamanho="sm"
                        variante="secundario"
                        onClick={() => {
                          setEmEdicao(profissional)
                          setFormularioAberto(true)
                        }}
                      >
                        Editar
                      </Botao>
                    ) : null}
                    {podeExcluir ? (
                      <Botao
                        tamanho="sm"
                        variante="perigo-suave"
                        onClick={() => {
                          setExcluindo(profissional)
                        }}
                      >
                        Excluir
                      </Botao>
                    ) : null}
                  </div>
                </Tabela.Celula>
              </Tabela.Linha>
            ))}
          </Tabela.Corpo>
        </Tabela>
      </EstadosDaLista>

      {formularioAberto ? (
        <FormularioProfissional
          aberto={formularioAberto}
          profissional={emEdicao}
          aoFechar={() => {
            setFormularioAberto(false)
            setEmEdicao(null)
          }}
        />
      ) : null}

      {/* A exclusão é PROTEGIDA no servidor: profissional referenciado → 422. A
          recusa precisa APARECER — o dialog não pode fechar como se tivesse dado
          certo (a promessa rejeita). */}
      <DialogConfirmacao
        aberto={excluindo !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) {
            setExcluindo(null)
          }
        }}
        titulo={excluindo !== null ? `Excluir ${excluindo.nome}?` : ''}
        consequencia="Se o profissional já tiver agendamentos, tratamentos ou usuários vinculados, o sistema recusa a exclusão — desative-o no cadastro."
        rotuloConfirmar="Excluir profissional"
        tom="perigo"
        carregando={gravando}
        aoConfirmar={() =>
          new Promise<void>((resolver, rejeitar) => {
            if (excluindo === null) {
              resolver()
              return
            }
            excluir.mutate(excluindo.id, {
              onSuccess: () => {
                setExcluindo(null)
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
