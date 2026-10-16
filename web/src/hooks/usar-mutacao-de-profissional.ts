import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ehConflitoDeEdicao } from '@/lib/conflito'
import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { chaves } from '@/lib/chaves-query'
import {
  atualizarProfissional,
  criarProfissional,
  excluirProfissional,
} from '@/servicos/profissionais'
import type { PayloadProfissional } from '@/tipos'

const CAMPOS = new Set([
  'nome',
  'conselho',
  'uf_conselho',
  'num_conselho',
  'cbos_id',
  // erros indexados `horarios.<dia>.<i>.inicio` casam pela raiz `horarios`
  'horarios',
  'obs',
  // change atendimento-em-grupo: sem a chave AQUI, a recusa da faixa cai em `gerais` e o
  // campo não fica marcado — a mensagem existe, mas não ao lado do que precisa mudar
  'atendimentos_simultaneos',
  'mensagens_automaticas',
  'ativo',
  'especialidades',
  // a recusa da exclusão protegida chega assim
  'profissional',
])

/**
 * Mutações do profissional. A exclusão é **protegida** no servidor (referenciado
 * → 422 com o motivo): a recusa vira toast + aviso, e o dialog fica aberto.
 */
function useMutacaoDeProfissional() {
  const queryClient = useQueryClient()
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS)

  async function aoConcluir(titulo: string): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: chaves.profissionaisDoCadastro() })
    // a grade da agenda é montada com estes dados (janela, especialidades)
    await queryClient.invalidateQueries({ queryKey: chaves.profissionais() })
    await queryClient.invalidateQueries({ queryKey: chaves.selecaoDaAgenda() })
    notificar({ tom: 'sucesso', titulo })
  }

  const criar = useMutation({
    retry: 0,
    mutationFn: (payload: PayloadProfissional) => criarProfissional(payload),
    onMutate: limparErros,
    onError: aoFalhar,
    onSuccess: () => aoConcluir('Profissional cadastrado.'),
  })

  const atualizar = useMutation({
    retry: 0,
    mutationFn: ({ id, payload, versao }: { id: number; payload: PayloadProfissional; versao: string }) =>
      atualizarProfissional(id, payload, versao),
    onMutate: limparErros,
    onError: (erro) => {
      aoFalhar(erro)
      // conflito (EX-05/B1): invalida pela RAIZ — o form hidrata da LISTA no cadastro
      // e da FICHA (`['profissionais','ficha',id]`) na página do profissional; invalidar
      // só o cadastro deixava o If-Match da ficha velho → 409 em laço (CR-FPR-01)
      if (ehConflitoDeEdicao(erro)) {
        void queryClient.invalidateQueries({ queryKey: chaves.profissionais() })
      }
    },
    onSuccess: () => aoConcluir('Profissional atualizado.'),
  })

  const excluir = useMutation({
    retry: 0,
    mutationFn: (id: number) => excluirProfissional(id),
    onMutate: limparErros,
    onError: aoFalhar,
    onSuccess: () => aoConcluir('Profissional excluído.'),
  })

  return {
    criar,
    atualizar,
    excluir,
    erros,
    limparErros,
    gravando: criar.isPending || atualizar.isPending || excluir.isPending,
  }
}

export { useMutacaoDeProfissional as usarMutacaoDeProfissional }
