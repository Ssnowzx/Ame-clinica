import { useMutation, useQueryClient } from '@tanstack/react-query'

import type {
  DetalheDeInteressado,
  LinhaDeInteressado,
  ModuloDeInteressado,
} from '@/componentes/financeiro/modulo-de-interessado'

import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'

function comMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/**
 * As escritas de "a quem a clínica paga" (fornecedores e funcionários) — o regime da casa:
 * `retry: 0` (repetir um POST recusado é cadastro duplicado), a recusa pousando no campo, o toast
 * no sucesso e a invalidação do que a escrita muda.
 *
 * O que ela muda vai além da lista do módulo: o NOME do interessado aparece nas listas do dinheiro
 * (o servidor o manda pela whitelist `{tipo, id, nome}`), então renomear um fornecedor precisa
 * chegar aos lançamentos e ao fluxo de caixa, ou a próxima tela mostra o nome antigo.
 *
 * `inativar` é a saída que a exclusão recusada oferece: relê o cadastro (o `updated_at` fresco e
 * os dados de agora), reenvia-o igual, só com `ativo: false`.
 */
function useMutacaoDeInteressado<L extends LinhaDeInteressado, D extends DetalheDeInteressado, P, V extends { ativo: boolean }>(
  modulo: ModuloDeInteressado<L, D, P, V>,
) {
  const queryClient = useQueryClient()
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(modulo.campos)

  const alvo = comMaiuscula(modulo.rotuloSingular)
  const vogal = modulo.genero === 'f' ? 'a' : 'o'

  async function aoConcluir(titulo: string): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: modulo.chave() })
    await queryClient.invalidateQueries({ queryKey: ['lancamentos'] })
    await queryClient.invalidateQueries({ queryKey: ['fluxo-caixa'] })
    notificar({ tom: 'sucesso', titulo })
  }

  const criar = useMutation({
    retry: 0,
    mutationFn: (payload: P) => modulo.servico.criar(payload),
    onMutate: limparErros,
    onSuccess: () => aoConcluir(`${alvo} cadastrad${vogal}.`),
    onError: aoFalhar,
  })

  const atualizar = useMutation({
    retry: 0,
    mutationFn: ({ id, payload, versao }: { id: number; payload: P; versao: string }) =>
      modulo.servico.atualizar(id, payload, versao),
    onMutate: limparErros,
    onSuccess: () => aoConcluir(`${alvo} salv${vogal}.`),
    onError: aoFalhar,
  })

  const excluir = useMutation({
    retry: 0,
    mutationFn: (id: number) => modulo.servico.excluir(id),
    onMutate: limparErros,
    onSuccess: () => aoConcluir(`${alvo} excluíd${vogal}.`),
    // a recusa por lançamento (422 na chave da ENTIDADE) não tem campo: cai em `gerais`
    onError: aoFalhar,
  })

  const inativar = useMutation({
    retry: 0,
    mutationFn: async (id: number) => {
      const atual = await modulo.servico.buscar(id)
      const payload = modulo.paraPayload({ ...modulo.valoresIniciais(atual), ativo: false }, false)
      return modulo.servico.atualizar(id, payload, atual.updated_at)
    },
    onMutate: limparErros,
    onSuccess: () => aoConcluir(`${alvo} inativad${vogal}.`),
    onError: aoFalhar,
  })

  return {
    erros,
    limparErros,
    notificar,
    criar,
    atualizar,
    excluir,
    inativar,
    salvando: criar.isPending || atualizar.isPending,
  }
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração
export { useMutacaoDeInteressado as usarMutacaoDeInteressado }
