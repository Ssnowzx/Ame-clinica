import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { usarDebounce } from '@/hooks/usar-debounce'
import { chaves } from '@/lib/chaves-query'
import { nomeDeExibicao } from '@/lib/pacientes'
import { listarPacientes } from '@/servicos/pacientes'

/** O mesmo piso das outras buscas de paciente do produto. */
const MINIMO_DA_BUSCA = 2

/**
 * Teto por página desta caixa. O `index` do cadastro pagina em 50 e devolve `nascimento`
 * e `necessidade` (dado de saúde, art. 11) — pedir menos por vez é o que mantém a
 * quantidade proporcional ao gesto de escolher um nome (achado SEC-BPL-03).
 */
const POR_PAGINA = 20

interface OpcoesDaEscolha {
  /** A caixa/diálogo está em tela? Fechado, não consulta nada */
  aberto: boolean
  /** O termo digitado, cru (o debounce é daqui) */
  termo: string
  /**
   * O rótulo de quem já está escolhido. Texto igual a ele não é busca — é o campo
   * exibindo a escolha; buscá-lo manda o nome de um MENOR para a query string sem que
   * ninguém tenha procurado nada (achado SEC-BPL-02: escolher da lista deixava o nome
   * no campo e a busca saía sozinha 300ms depois).
   */
  rotuloEscolhido?: string | null
  /** Id que não deve aparecer na lista (a ficha não se oferece a si mesma) */
  exceto?: number | null
}

/**
 * A escolha de paciente sobre o CADASTRO (`GET /api/pacientes`, sob `pacientes.ver`):
 * lista ao abrir, busca ao digitar, mais páginas ao rolar.
 *
 * Irmão de `usarEscolhaDePaciente`, que serve as telas de agenda/fila pela seleção
 * minimizada. São dois porque as fontes são duas — permissão, payload e paginação
 * diferentes —, e fundi-los esconderia justamente a fronteira que a spec da fila
 * protege (escolher paciente na agenda MUST NOT exigir `pacientes.ver`).
 *
 * @param opcoes - Estado da caixa (aberta?, termo digitado, id a excluir)
 * @returns `opcoes`, `carregando`, `carregandoMais` e o aviso de rolagem
 */
function useEscolhaDePacienteDoCadastro({
  aberto,
  termo,
  rotuloEscolhido = null,
  exceto = null,
}: OpcoesDaEscolha) {
  const termoBuscado = usarDebounce(termo)
  const buscando = termo.trim().length >= MINIMO_DA_BUSCA
  const debounceAlcancouODigitado = termoBuscado.trim() === termo.trim()
  const temAlgoNovoParaBuscar = termo.trim() !== (rotuloEscolhido?.trim() ?? '')

  const busca = useQuery({
    queryKey: chaves.pacientesDoCadastroNaBusca(termoBuscado),
    queryFn: () => listarPacientes({ busca: termoBuscado, ativo: true, pagina: 1, porPagina: POR_PAGINA }),
    enabled: aberto && buscando && debounceAlcancouODigitado && temAlgoNovoParaBuscar,
    staleTime: 30_000,
  })

  const lista = useInfiniteQuery({
    queryKey: chaves.pacientesDoCadastroEmLista(),
    queryFn: ({ pageParam }) => listarPacientes({ ativo: true, pagina: pageParam, porPagina: POR_PAGINA }),
    initialPageParam: 1,
    // este endpoint declara a paginação na própria resposta — nada de inferir por
    // "página cheia" como na seleção minimizada, que não devolve total
    getNextPageParam: (ultima) =>
      ultima.current_page < ultima.last_page ? ultima.current_page + 1 : undefined,
    enabled: aberto && !buscando,
    staleTime: 30_000,
  })

  const pacientes = buscando
    ? (busca.data?.data ?? [])
    : (lista.data?.pages ?? []).flatMap((pagina) => pagina.data)

  return {
    // requisição que falha não pode virar caixa muda (achado CR-BPL-04)
    falhou: buscando ? busca.isError : lista.isError,
    opcoes: pacientes
      .filter((paciente) => paciente.id !== exceto)
      .map((paciente) => ({ valor: paciente.id, rotulo: nomeDeExibicao(paciente) })),
    // `aberto &&` não é detalhe: a consulta da lista é `enabled: aberto && !buscando`, e query
    // DESABILITADA fica `isPending` para sempre no TanStack v5. Sem a guarda, o campo fechado
    // exibia o spinner girando eternamente — a ficha do paciente abria com a caixa "Pesquisar
    // outro paciente" parecendo travada (relato da clínica, 2026-09-14). O irmão
    // `usar-escolha-de-paciente` já tinha a guarda (`ligado &&`); este nasceu sem.
    carregando: buscando ? busca.isFetching || !debounceAlcancouODigitado : aberto && lista.isPending,
    carregandoMais: !buscando && lista.isFetchingNextPage,
    aoAproximarDoFim: () => {
      if (!buscando && lista.hasNextPage && !lista.isFetchingNextPage) {
        void lista.fetchNextPage()
      }
    },
  }
}

// Declarado `use*` e exportado em pt-BR (a regra `rules-of-hooks` lê o nome declarado).
export { useEscolhaDePacienteDoCadastro as usarEscolhaDePacienteDoCadastro }
