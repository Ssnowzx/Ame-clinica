import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Botao } from '@/componentes/ui/botao'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { ErroDeApi } from '@/lib/http'
import { aprovarAprovacao, cancelarAprovacao, listarAprovacoes, recusarAprovacao } from '@/servicos/aprovacoes'
import { useAuthStore } from '@/stores/auth-store'
import type { AprovacaoDeAcesso } from '@/tipos'

type Acao = 'aprovar' | 'recusar' | 'cancelar'

const SEM_O_ACESSO_EM_JOGO = 'Esta mudança envolve acesso que você não tem: outro administrador precisa aprovar.'

const ROTULO_DO_TIPO: Record<AprovacaoDeAcesso['tipo'], string> = {
  editar_nivel: 'Editar nível de permissão',
  atribuir_nivel: 'Atribuir nível a usuário',
  configurar_seguranca: 'Alterar configuração de segurança',
}

const ROTULO_DO_STATUS: Record<AprovacaoDeAcesso['status'], string> = {
  pendente: 'Pendente',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
  cancelada: 'Cancelada',
}

const EXECUTAR: Record<Acao, (id: number) => Promise<AprovacaoDeAcesso>> = {
  aprovar: aprovarAprovacao,
  recusar: recusarAprovacao,
  cancelar: cancelarAprovacao,
}

/**
 * Pendências do maker-checker (AP-13): quem pediu NÃO decide — o botão
 * desabilitado é cortesia; a recusa real é do servidor (422). Aprovar aplica a
 * mudança revalidada; recusar/cancelar só encerram a pendência.
 */
export function PainelAprovacoes() {
  const queryClient = useQueryClient()
  const { notificar } = usarToast()
  const usuarioId = useAuthStore((estado) => estado.usuario?.id)
  const podeDecidir = useAuthStore((estado) => estado.temPermissao('niveis_permissao.editar'))
  const [confirmando, setConfirmando] = useState<{ acao: Acao; aprovacao: AprovacaoDeAcesso } | null>(null)

  const consulta = useQuery({
    queryKey: chaves.aprovacoesDeAcesso(),
    queryFn: listarAprovacoes,
  })

  const mutacao = useMutation({
    retry: 0,
    mutationFn: ({ acao, aprovacao }: { acao: Acao; aprovacao: AprovacaoDeAcesso }) =>
      EXECUTAR[acao](aprovacao.id),
    onSuccess: async (_, { acao }) => {
      // aprovar APLICA a mudança — os dados vigentes de níveis/usuários/configurações
      // podem ter mudado; invalidar tudo que a aplicação alcança
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: chaves.aprovacoesDeAcesso() }),
        queryClient.invalidateQueries({ queryKey: chaves.niveisPermissao() }),
        queryClient.invalidateQueries({ queryKey: chaves.usuarios() }),
        queryClient.invalidateQueries({ queryKey: chaves.configuracoes() }),
      ])
      notificar({
        tom: 'sucesso',
        titulo: acao === 'aprovar' ? 'Pendência aprovada e aplicada.' : acao === 'recusar' ? 'Pendência recusada.' : 'Pendência cancelada.',
      })
    },
    onError: (falha: unknown) => {
      const mensagem =
        falha instanceof ErroDeApi
          ? (falha.camposInvalidos.aprovacao?.[0] ?? falha.message)
          : 'Não foi possível concluir a ação.'
      notificar({ tom: 'erro', titulo: mensagem })
      void queryClient.invalidateQueries({ queryKey: chaves.aprovacoesDeAcesso() })
    },
    onSettled: () => {
      setConfirmando(null)
    },
  })

  if (consulta.isPending) {
    return <Skeleton className="h-48 w-full" />
  }

  if (consulta.isError) {
    return (
      <EstadoErro
        mensagem="Não foi possível carregar as pendências de aprovação."
        aoTentarNovamente={() => void consulta.refetch()}
      />
    )
  }

  if (consulta.data.length === 0) {
    return (
      <EstadoVazio
        titulo="Nenhuma pendência de aprovação."
        descricao="Com a aprovação dupla ligada, mudanças de acesso aparecem aqui até outro administrador decidir."
      />
    )
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {consulta.data.map((aprovacao) => {
          const pendente = aprovacao.status === 'pendente'
          const doProprioUsuario = aprovacao.solicitante?.id === usuarioId

          return (
            <li
              key={aprovacao.id}
              className="flex flex-col gap-3 rounded-superficie border border-linha bg-superficie p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-corpo font-medium text-texto">
                  {ROTULO_DO_TIPO[aprovacao.tipo]}: <span className="font-semibold">{aprovacao.alvo.rotulo}</span>
                </p>
                {/* estado de UI (não é dado da clínica): tokens semânticos, palavra sempre visível */}
                <span
                  className={
                    pendente
                      ? 'rounded-full bg-alerta-suave px-2.5 py-0.5 text-meta font-medium text-alerta-texto'
                      : 'rounded-full bg-fundo px-2.5 py-0.5 text-meta font-medium text-texto-suave'
                  }
                >
                  {ROTULO_DO_STATUS[aprovacao.status]}
                </span>
              </div>

              <ResumoDaProposta aprovacao={aprovacao} />

              <p className="text-meta text-texto-suave">
                Pedida por {aprovacao.solicitante?.nome ?? '—'}
                {aprovacao.criado_em !== null ? ` em ${aprovacao.criado_em}` : ''}
                {aprovacao.decidido_por !== null ? ` · decidida por ${aprovacao.decidido_por.nome}` : ''}
              </p>

              {pendente ? (
                <div className="flex flex-wrap items-center gap-2">
                  {podeDecidir && !doProprioUsuario ? (
                    <>
                      {aprovacao.voce_pode_aprovar ? (
                        <Botao
                          tamanho="sm"
                          onClick={() => setConfirmando({ acao: 'aprovar', aprovacao })}
                          carregando={mutacao.isPending && confirmando?.aprovacao.id === aprovacao.id}
                        >
                          Aprovar
                        </Botao>
                      ) : (
                        // o servidor recusaria com 403 (change `trava-de-usuarios-e-niveis`); recusar não
                        // aplica nada e continua com quem decide
                        <p className="text-meta text-texto-suave">{SEM_O_ACESSO_EM_JOGO}</p>
                      )}
                      <Botao
                        variante="secundario"
                        tamanho="sm"
                        onClick={() => setConfirmando({ acao: 'recusar', aprovacao })}
                      >
                        Recusar
                      </Botao>
                    </>
                  ) : null}
                  {podeDecidir && doProprioUsuario ? (
                    // cortesia de UI — a regra (maker ≠ checker) vive no servidor
                    <p className="text-meta text-texto-suave">
                      Você pediu esta mudança — outro administrador precisa decidir.
                    </p>
                  ) : null}
                  {doProprioUsuario ? (
                    <Botao
                      variante="fantasma"
                      tamanho="sm"
                      onClick={() => setConfirmando({ acao: 'cancelar', aprovacao })}
                    >
                      Cancelar pendência
                    </Botao>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      <DialogConfirmacao
        aberto={confirmando !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) {
            setConfirmando(null)
          }
        }}
        titulo={
          confirmando?.acao === 'aprovar'
            ? `Aprovar a mudança em ${confirmando.aprovacao.alvo.rotulo}?`
            : confirmando?.acao === 'recusar'
              ? `Recusar a pendência de ${confirmando.aprovacao.alvo.rotulo}?`
              : `Cancelar a sua pendência de ${confirmando?.aprovacao.alvo.rotulo ?? '—'}?`
        }
        consequencia={
          confirmando?.acao === 'aprovar'
            ? 'A mudança será revalidada contra o estado atual e aplicada em seu nome, com registro na trilha.'
            : 'A pendência será encerrada sem aplicar nada.'
        }
        rotuloConfirmar={
          confirmando?.acao === 'aprovar'
            ? 'Aprovar mudança'
            : confirmando?.acao === 'recusar'
              ? 'Recusar pendência'
              : 'Cancelar pendência'
        }
        tom="atencao"
        carregando={mutacao.isPending}
        aoConfirmar={() => {
          if (confirmando !== null) {
            mutacao.mutate(confirmando)
          }
        }}
      />
    </>
  )
}

function ResumoDaProposta({ aprovacao }: { aprovacao: AprovacaoDeAcesso }) {
  if (aprovacao.tipo === 'editar_nivel') {
    const permissoes = Array.isArray(aprovacao.payload.permissoes) ? aprovacao.payload.permissoes.length : 0

    return (
      <p className="text-corpo text-texto-suave">
        Novo conjunto proposto: {permissoes} {permissoes === 1 ? 'permissão' : 'permissões'}
        {typeof aprovacao.payload.nome === 'string' ? ` · nome "${aprovacao.payload.nome}"` : ''}
      </p>
    )
  }

  if (aprovacao.tipo === 'atribuir_nivel') {
    return (
      <p className="text-corpo text-texto-suave">
        Nível proposto: {typeof aprovacao.payload.nivel_proposto === 'string' ? aprovacao.payload.nivel_proposto : '—'}
      </p>
    )
  }

  return (
    <p className="text-corpo text-texto-suave">
      {aprovacao.payload.valor === true ? 'Ligar' : 'Desligar'} a configuração {aprovacao.alvo.rotulo}
    </p>
  )
}
