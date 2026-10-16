import { useMutation, useQueryClient } from '@tanstack/react-query'

import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { chaves } from '@/lib/chaves-query'
import { ErroDeApi } from '@/lib/http'
import { atualizarPaciente, criarPaciente, definirSituacaoDoPaciente } from '@/servicos/pacientes'
import type { PayloadPaciente } from '@/tipos'

/** Campos do formulário — a raiz da chave do servidor (`responsaveis_json.0.nome`). */
const CAMPOS = new Set([
  'nome',
  'nome_social',
  'nascimento',
  'sexo',
  'cpf',
  // convênio vigente (change convenio-no-cadastro-do-paciente): sem estas quatro raízes,
  // a recusa do servidor cai no aviso GERAL e a recepção lê 'erro ao salvar' sem saber
  // o que corrigir — a classe de defeito que esta cadeia de changes vem fechando
  'convenio_id',
  'plano',
  'carteirinha',
  'carteirinha_validade',
  'indicacao',
  'necessidade',
  'estado_civil',
  'profissao',
  'obs',
  'ativo',
  'responsaveis_json',
  'contatos_json',
  'endereco_json',
  'consentimentos_json',
])

/**
 * Mutações do paciente — mesmo padrão do produto: `retry: 0` (POST reexecutado é
 * cadastro duplicado de uma criança), CSRF no serviço, recusa no campo (ou no
 * ITEM da lista) e toast no sucesso.
 *
 * NÃO existe exclusão (design D3): a API não a tem. `desativar` é `PATCH .../situacao` (change faxina-de-gatilhos).
 */
function useMutacaoDePaciente() {
  const queryClient = useQueryClient()
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS)

  async function aoConcluir(titulo: string): Promise<void> {
    // UMA invalidação, que agora alcança a lista E o detalhe: `['pacientes']` é prefixo de
    // `['pacientes', id]` (change `consertos-de-classe`).
    //
    // A seleção da AGENDA vive noutra raiz (`['agenda-selecao', ...]`) e precisa da segunda:
    // depois de reativar pela ficha, a caixa de paciente seguia dizendo "existe cadastro
    // inativo com esse nome" e a criança continuava fora da lista — o beco que esta change
    // existe para matar, servido pelo cache (parecer SEC-PIS-06).
    //
    // O `setQueryData(chaves.paciente(id), paciente)` que morava aqui era "a otimização mais
    // natural do mundo" — e uma armadilha: o `updateGcTime` do TanStack faz `Math.max`, então
    // ele CRIAVA a entrada do detalhe com o `gcTime` PADRÃO (5 min) e o observer com
    // `gcTime: 0` não conseguia mais baixá-la. No fluxo criar→navegar (onde o componente não
    // remonta), a entrada sobrevivia ao desmonte e o cadastro da criança voltava a hidratar do
    // CACHE — exatamente o que o `gcTime: 0` promete impedir (re-review r8).
    await queryClient.invalidateQueries({ queryKey: ['pacientes'] })
    await queryClient.invalidateQueries({ queryKey: chaves.selecaoDaAgenda() })
    notificar({ tom: 'sucesso', titulo })
  }

  const criar = useMutation({
    retry: 0,
    mutationFn: (payload: PayloadPaciente) => criarPaciente(payload),
    onMutate: limparErros,
    onError: aoFalhar,
    onSuccess: () => aoConcluir('Paciente cadastrado.'),
  })

  const atualizar = useMutation({
    retry: 0,
    mutationFn: ({ id, payload, versao }: { id: number; payload: PayloadPaciente; versao: string }) =>
      atualizarPaciente(id, payload, versao),
    onMutate: limparErros,
    onError: aoFalhar,
    onSuccess: () => aoConcluir('Cadastro atualizado.'),
  })

  const definirSituacao = useMutation({
    retry: 0,
    mutationFn: ({ id, ativo, versao }: { id: number; ativo: boolean; versao: string }) =>
      definirSituacaoDoPaciente(id, ativo, versao),
    onMutate: limparErros,
    onError: (erro) => {
      aoFalhar(erro)

      // CONFLITO tem de ter saída. O `If-Match` passou a ser a versão que hidratou a tela
      // (SEC-PIS-05) — o que fez o 409 finalmente disparar e, com ele, apareceu um beco: a
      // mensagem manda "recarregue", mas a FICHA é leitura e não oferece recarregar, não
      // recarrega sozinha (`refetchOnWindowFocus: false`) e o clique seguinte reenviava a MESMA
      // versão velha. O laço só saía com F5 (parecer SEC-PIS-11). Invalidar o cadastro aqui faz a
      // tela reconsultar sozinha: a próxima tentativa já sai com a versão fresca.
      if (erro instanceof ErroDeApi && erro.motivo === 'conflito') {
        void queryClient.invalidateQueries({ queryKey: ['pacientes'] })
      }
    },
    onSuccess: (paciente) =>
      aoConcluir(paciente.ativo ? 'Paciente reativado.' : 'Paciente desativado.'),
  })

  return {
    criar,
    atualizar,
    definirSituacao,
    erros,
    limparErros,
    gravando: criar.isPending || atualizar.isPending || definirSituacao.isPending,
  }
}

export { useMutacaoDePaciente as usarMutacaoDePaciente }
