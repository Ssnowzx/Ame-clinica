import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'

import { ProtegidoPorPermissao } from '@/componentes/protegido-por-permissao'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { chaves } from '@/lib/chaves-query'
import { possuiTodasAsPermissoes } from '@/lib/permissoes'
import { FLAGS_DE_ESCOPO } from '@/lib/permissoes-rotulos'
import { listarNiveisPermissao } from '@/servicos/niveis-permissao'
import { listarProfissionaisDoCadastro } from '@/servicos/profissionais'
import { atribuirNivel, atualizarUsuario, buscarUsuario, criarUsuario } from '@/servicos/usuarios'
import { useAuthStore } from '@/stores/auth-store'
import type { PayloadUsuario } from '@/tipos'

const CAMPOS_DO_USUARIO = new Set(['nome', 'email', 'senha', 'ativo', 'profissional_id'])

interface EstadoDoFormulario {
  nome: string
  email: string
  senha: string
  ativo: boolean
  profissionalId: number | null
  nivelId: number | null
}

const VAZIO: EstadoDoFormulario = {
  nome: '',
  email: '',
  senha: '',
  ativo: true,
  profissionalId: null,
  nivelId: null,
}

interface FormularioUsuarioProps {
  /** `null` = criação; um id = edição (hidrata de leitura fresca). */
  usuarioId: number | null
  aoConcluir: () => void
  aoCancelar: () => void
}

/**
 * Criação/edição de usuário (§12). O nível NUNCA vai no payload de usuário (T-usr-02):
 * a atribuição é o passo dedicado `atribuirNivel`, executado em seguida — e se ele falha,
 * a tela REPORTA (nunca silencia) e reabre em edição do usuário já criado (SEC-ADM-04).
 *
 * Senha (SEC-ADM-07): `type=password` + `autocomplete=new-password`, vive só no estado
 * local, começa vazia na edição e só entra no payload se preenchida.
 */
export function FormularioUsuario({ usuarioId, aoConcluir, aoCancelar }: FormularioUsuarioProps) {
  const queryClient = useQueryClient()
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const usuarioAutenticadoId = useAuthStore((estado) => estado.usuario?.id)
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS_DO_USUARIO)

  const podeVerNivel = temPermissao('niveis_permissao.ver')
  const podeAtribuirNivel = podeVerNivel && temPermissao('niveis_permissao.editar')
  const podeVincular = temPermissao('profissionais.ver')
  const alcancaAClinica = possuiTodasAsPermissoes(temPermissao, FLAGS_DE_ESCOPO)

  const editando = usuarioId !== null
  const [dados, setDados] = useState<EstadoDoFormulario>(VAZIO)
  const [idEmEdicao, setIdEmEdicao] = useState<number | null>(usuarioId)
  const [erroNivel, setErroNivel] = useState<string | undefined>(undefined)

  // leitura FRESCA para a edição (CHAVE-DETALHE — gcTime: 0)
  const consultaUsuario = useQuery({
    queryKey: chaves.usuario(usuarioId ?? 0),
    queryFn: () => buscarUsuario(usuarioId as number),
    enabled: editando,
    gcTime: 0,
  })

  const consultaNiveis = useQuery({
    queryKey: chaves.niveisPermissao(),
    queryFn: listarNiveisPermissao,
    enabled: podeVerNivel,
  })

  const consultaProfissionais = useQuery({
    queryKey: chaves.profissionaisDoCadastro(),
    queryFn: listarProfissionaisDoCadastro,
    enabled: podeVincular,
  })

  // hidrata o formulário quando a leitura fresca chega (uma vez por usuário)
  const usuarioCarregado = consultaUsuario.data
  useEffect(() => {
    if (usuarioCarregado === undefined) return
    setDados({
      nome: usuarioCarregado.nome,
      email: usuarioCarregado.email,
      senha: '', // nunca hidrata a senha — começa vazia (SEC-ADM-07)
      ativo: usuarioCarregado.ativo,
      profissionalId: usuarioCarregado.profissional_id,
      nivelId: usuarioCarregado.nivel_permissao_id,
    })
  }, [usuarioCarregado])

  function definir(parciais: Partial<EstadoDoFormulario>): void {
    setDados((anterior) => ({ ...anterior, ...parciais }))
  }

  function montarPayload(): PayloadUsuario {
    // `acesso_mobile` NÃO é enviado (change esconder-acesso-mobile): o campo é dormente na
    // API — sem aplicativo móvel, nada o lê — e a tela não oferece controle sem efeito. Na
    // edição o servidor mantém o valor gravado (`sometimes`); na criação aplica o default.
    const payload: PayloadUsuario = {
      nome: dados.nome,
      email: dados.email,
    }
    // senha só quando preenchida (obrigatória na criação; redefine na edição)
    if (dados.senha !== '') {
      payload.senha = dados.senha
    }
    // não oferecemos desativar o próprio usuário — e não enviamos `ativo` da própria linha
    if (!(editando && idEmEdicao === usuarioAutenticadoId)) {
      payload.ativo = dados.ativo
    }
    // vínculo só entra no payload de quem pode escolher profissional (degrada sem quebrar)
    if (podeVincular) {
      payload.profissional_id = dados.profissionalId
    }
    return payload
  }

  const mutacao = useMutation({
    retry: 0,
    mutationFn: async (): Promise<{ nivelPendente: boolean }> => {
      const payload = montarPayload()
      let alvoId = idEmEdicao

      // passo 1 — cria ou atualiza o usuário
      if (alvoId === null) {
        const criado = await criarUsuario(payload)
        alvoId = criado.id
        setIdEmEdicao(criado.id) // se o passo 2 falhar, reabrimos em edição deste usuário
      } else {
        await atualizarUsuario(alvoId, payload, consultaUsuario.data?.updated_at ?? '')
      }

      // passo 2 — atribui o nível pelo endpoint dedicado, se mudou e se pode
      let nivelPendente = false
      if (podeAtribuirNivel && dados.nivelId !== null) {
        const nivelAtual = consultaUsuario.data?.nivel_permissao_id ?? null
        const mudouNivel = !editando || dados.nivelId !== nivelAtual
        if (mudouNivel) {
          try {
            // maker-checker (AP-13): com a dupla ligada, a atribuição vira pendência
            const resultado = await atribuirNivel(alvoId, dados.nivelId)
            nivelPendente = !resultado.aplicado
          } catch (erro) {
            // o usuário EXISTE; o nível não colou — reporta e mantém aberto (SEC-ADM-04)
            setErroNivel('Usuário salvo, mas o nível não pôde ser atribuído. Tente novamente.')
            throw erro
          }
        }
      }

      return { nivelPendente }
    },
    onMutate: () => {
      limparErros()
      setErroNivel(undefined)
    },
    onSuccess: async ({ nivelPendente }) => {
      await queryClient.invalidateQueries({ queryKey: chaves.usuarios() })
      if (nivelPendente) {
        await queryClient.invalidateQueries({ queryKey: chaves.aprovacoesDeAcesso() })
        notificar({
          tom: 'aviso',
          titulo: editando ? 'Usuário salvo; nível aguarda aprovação.' : 'Usuário criado; nível aguarda aprovação.',
          descricao: 'Outro administrador precisa aprovar a atribuição antes de ela valer.',
        })
      } else {
        notificar({ tom: 'sucesso', titulo: editando ? 'Usuário salvo.' : 'Usuário criado.' })
      }
      aoConcluir()
    },
    onError: aoFalhar,
  })

  function submeter(evento: FormEvent): void {
    evento.preventDefault()
    mutacao.mutate()
  }

  if (editando && consultaUsuario.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    )
  }

  const ehProprioUsuario = editando && idEmEdicao === usuarioAutenticadoId
  // só os níveis dentro do acesso de quem atribui (change `trava-de-usuarios-e-niveis`) — e o atual,
  // para o campo não nascer vazio
  const niveis = (consultaNiveis.data ?? []).filter(
    (nivel) => nivel.id === dados.nivelId || possuiTodasAsPermissoes(temPermissao, nivel.permissoes),
  )
  const profissionais = consultaProfissionais.data ?? []

  return (
    <form onSubmit={submeter} className="flex flex-col gap-4">
      <AvisoErro mensagens={erros.gerais} />

      <CampoTexto
        rotulo="Nome"
        obrigatorio
        value={dados.nome}
        erro={erros.campos.get('nome')}
        onChange={(evento) => {
          definir({ nome: evento.target.value })
        }}
      />

      <CampoTexto
        rotulo="E-mail"
        type="email"
        obrigatorio
        autoComplete="off"
        value={dados.email}
        erro={erros.campos.get('email')}
        onChange={(evento) => {
          definir({ email: evento.target.value })
        }}
      />

      <CampoTexto
        rotulo={editando ? 'Nova senha' : 'Senha inicial'}
        type="password"
        autoComplete="new-password"
        obrigatorio={!editando}
        ajuda={editando ? 'Deixe em branco para manter a senha atual.' : 'Mínimo de 10 caracteres, com letras e números.'}
        value={dados.senha}
        erro={erros.campos.get('senha')}
        onChange={(evento) => {
          definir({ senha: evento.target.value })
        }}
      />

      {podeVerNivel ? (
        <CampoSelect
          rotulo="Nível de permissão"
          placeholder="Sem nível"
          disabled={!podeAtribuirNivel}
          ajuda={
            podeAtribuirNivel
              ? undefined
              : 'Você não tem permissão para alterar o nível deste usuário.'
          }
          erro={erroNivel}
          value={dados.nivelId === null ? '' : String(dados.nivelId)}
          opcoes={niveis.map((nivel) => ({ valor: String(nivel.id), rotulo: nivel.nome }))}
          onChange={(evento) => {
            definir({ nivelId: evento.target.value === '' ? null : Number(evento.target.value) })
          }}
        />
      ) : null}

      <ProtegidoPorPermissao permissao="profissionais.ver">
        <CampoSelect
          rotulo="Profissional vinculado"
          placeholder="Sem vínculo"
          // o vínculo é escopo (D11): pôr ou trocar exige ver a clínica inteira — o servidor recusa com
          // 403 (change `trava-de-usuarios-e-niveis`)
          disabled={!alcancaAClinica}
          ajuda={
            alcancaAClinica
              ? 'Vincula o usuário a um profissional para ver a própria agenda.'
              : 'Vincular a um profissional exige ver a agenda e o prontuário de toda a clínica.'
          }
          value={dados.profissionalId === null ? '' : String(dados.profissionalId)}
          opcoes={profissionais.map((prof) => ({ valor: String(prof.id), rotulo: prof.nome }))}
          onChange={(evento) => {
            definir({
              profissionalId: evento.target.value === '' ? null : Number(evento.target.value),
            })
          }}
        />
      </ProtegidoPorPermissao>

      {/* não se oferece desativar o próprio usuário (o servidor também recusa) */}
      {ehProprioUsuario ? null : (
        <CampoCheckbox
          rotulo="Usuário ativo"
          ajuda="Desmarque para desativar o acesso sem apagar o histórico."
          erro={erros.campos.get('ativo')}
          marcado={dados.ativo}
          aoMudar={(marcado) => {
            definir({ ativo: marcado })
          }}
        />
      )}

      <div className="mt-2 flex justify-end gap-3">
        <Botao
          type="button"
          variante="secundario"
          tamanho="lg"
          disabled={mutacao.isPending}
          onClick={aoCancelar}
        >
          Cancelar
        </Botao>
        <Botao type="submit" tamanho="lg" carregando={mutacao.isPending}>
          {/* após uma criação cujo passo 2 falhou, o usuário já existe: o botão vira "Salvar" */}
          {idEmEdicao !== null ? 'Salvar' : 'Criar usuário'}
        </Botao>
      </div>
    </form>
  )
}
