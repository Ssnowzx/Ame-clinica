import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ehConflitoDeEdicao } from '@/lib/conflito'
import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { chaves } from '@/lib/chaves-query'

interface RecursoDeCatalogo<T, P> {
  criar: (payload: P) => Promise<T>
  atualizar: (id: number, payload: P, versao: string) => Promise<T>
  excluir: (id: number) => Promise<void>
}

interface OpcoesDeCatalogo<T, P> {
  recurso: RecursoDeCatalogo<T, P>
  /** Chave de query da LISTA — invalidada a cada escrita */
  chave: readonly unknown[]
  /**
   * A chave a INVALIDAR, quando ela não é a mesma que se lê.
   *
   * Existe por causa das subcategorias: elas são lidas sob uma chave própria
   * (`['categorias', id, 'subcategorias']`) porque o formato difere do da lista de
   * categorias — duas `queryFn` na MESMA chave não coexistem, o React Query guarda um
   * valor por chave e a última a responder vence. Mas cadastrar uma subcategoria muda
   * também a CONTAGEM na lista de categorias e o seletor de subcategoria do lançamento,
   * que leem `['categorias']`. Invalidar o PREFIXO alcança os três de uma vez.
   */
  chaveDeInvalidacao?: readonly unknown[]
  /**
   * Os campos do FORMULÁRIO — e só eles.
   *
   * A chave da ENTIDADE (`especialidade`, `sala`, `status_agendamento`…) NUNCA
   * entra aqui: é com ela que o servidor recusa a exclusão de um catálogo em uso,
   * e ela não é campo de formulário nenhum. Se entrasse, a mensagem pousaria num
   * campo que não existe na tela e **a exclusão falharia em silêncio** (SEC-CA-03).
   * Fora do conjunto, ela cai em `gerais` — que é onde o diálogo a mostra.
   */
  campos: ReadonlySet<string>
  /** Para o toast: "Especialidade salva", "Sala excluída" */
  rotuloSingular: string
  /** O português tem gênero: "especialidade salvA", "equipamento salvO" */
  genero: 'm' | 'f'
}

function comMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/**
 * Mutações dos catálogos de apoio — o padrão do produto: `retry: 0` (repetir um
 * POST recusado é cadastro duplicado), CSRF no serviço, recusa no campo certo,
 * toast no sucesso e invalidação da lista.
 */
function useMutacaoDeCatalogo<T, P>({
  recurso,
  chave,
  chaveDeInvalidacao,
  campos,
  rotuloSingular,
  genero,
}: OpcoesDeCatalogo<T, P>) {
  const queryClient = useQueryClient()
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(campos)

  const alvo = comMaiuscula(rotuloSingular)
  const vogal = genero === 'f' ? 'a' : 'o'

  async function aoConcluir(titulo: string): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: chaveDeInvalidacao ?? chave })
    // ...e a SELEÇÃO DA AGENDA, que é de onde a grade lê TODOS estes catálogos (feriados,
    // especialidades, salas, equipamentos, médicos).
    //
    // Sem esta linha, cadastrar um feriado NÃO repintava a agenda: a grade continuava mostrando
    // o dia como útil até o cache expirar (5 min), e a recepção marcava sessão num dia em que a
    // clínica não abre. É exatamente o dano que a change `portas-da-agenda` existe para evitar —
    // e ela mesma o teria causado, porque mudou a FONTE da grade e esqueceu de mudar quem a
    // invalida. (O hook do profissional já fazia isso; este não.)
    await queryClient.invalidateQueries({ queryKey: chaves.selecaoDaAgenda() })
    notificar({ tom: 'sucesso', titulo })
  }

  const criar = useMutation({
    retry: 0,
    mutationFn: (payload: P) => recurso.criar(payload),
    onMutate: limparErros,
    onSuccess: () => aoConcluir(`${alvo} cadastrad${vogal} com sucesso.`),
    onError: aoFalhar,
  })

  const atualizar = useMutation({
    retry: 0,
    mutationFn: ({ id, payload, versao }: { id: number; payload: P; versao: string }) =>
      recurso.atualizar(id, payload, versao),
    onMutate: limparErros,
    // conflito: a LINHA que hidratou a edição está velha — invalidar garante que
    // reabrir (ou o Recarregar) re-hidrate fresco; o formulário aberto não é tocado
    onError: (erro) => {
      aoFalhar(erro)
      if (ehConflitoDeEdicao(erro)) {
        void queryClient.invalidateQueries({ queryKey: chaveDeInvalidacao ?? chave })
      }
    },
    onSuccess: () => aoConcluir(`${alvo} salv${vogal}.`),
  })

  const excluir = useMutation({
    retry: 0,
    mutationFn: (id: number) => recurso.excluir(id),
    onMutate: limparErros,
    onSuccess: () => aoConcluir(`${alvo} excluíd${vogal}.`),
    // a recusa por uso (422 com a chave da entidade) chega aqui: sem campo onde
    // pousar, ela vira erro GERAL — e o toast garante que nunca falhe em silêncio
    onError: aoFalhar,
  })

  return {
    erros,
    limparErros,
    criar,
    atualizar,
    excluir,
    salvando: criar.isPending || atualizar.isPending,
    excluindo: excluir.isPending,
  }
}

export { useMutacaoDeCatalogo as usarMutacaoDeCatalogo }
