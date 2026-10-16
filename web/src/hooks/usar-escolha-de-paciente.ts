import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import type { SecaoDeBusca } from '@/componentes/ui/campo-busca'
import { usarDebounce } from '@/hooks/usar-debounce'
import { chaves } from '@/lib/chaves-query'
import {
  buscarPacientes,
  buscarPacientesRecentes,
  listarPacientesDaSelecao,
  PACIENTES_POR_PAGINA,
} from '@/servicos/agenda'

/** O servidor exige 2+ caracteres; abaixo disso não é busca, é a lista. */
const MINIMO_DA_BUSCA = 2

interface OpcoesDaEscolha {
  /** A caixa está em tela? Fechada, não consulta nada */
  aberto: boolean
  /** O termo digitado, cru (o debounce é daqui) */
  termo: string
  /**
   * O rótulo de quem JÁ está escolhido. Texto igual a ele não é busca — é o campo
   * exibindo a escolha (card em edição, modo retorno, ou o instante seguinte a
   * escolher da lista), e buscá-lo manda o nome de um MENOR para a query string sem
   * que ninguém tenha procurado nada (a agenda já fechava isso no gate SEC F-02; a
   * fila não — o hook fecha para as duas).
   */
  rotuloEscolhido?: string | null
  /** Desligar tudo (o cartão em leitura, o encaixe: não há o que escolher) */
  habilitado?: boolean
}

/**
 * A escolha de paciente das telas: lista ao abrir, busca ao digitar.
 *
 * Existe para que as três caixas de paciente da agenda/fila/ficha não repitam — cada
 * uma com o seu jeito — a mesma coreografia de três consultas, acúmulo de páginas e
 * troca de modo. O componente (`CampoBusca`) não sabe consultar nada: ele desenha o que
 * este hook devolve e avisa quando a rolagem chega perto do fim.
 *
 * **Dois modos, caches separados** (design D6): digitar não invalida a lista já rolada,
 * e reabrir a caixa não refaz a página que já veio.
 *
 * @param opcoes - Estado da caixa (aberta?, termo digitado, rótulo já escolhido)
 * @returns O que o `CampoBusca` consome: `opcoes`, `carregando`, `carregandoMais` e o
 *          aviso de rolagem
 */
function useEscolhaDePaciente({
  aberto,
  termo,
  rotuloEscolhido = null,
  habilitado = true,
}: OpcoesDaEscolha) {
  const termoBuscado = usarDebounce(termo)
  const ligado = aberto && habilitado
  // o MODO é decidido pelo que está digitado AGORA: o campo não fica mostrando a lista
  // enquanto o debounce não alcança, nem pisca a lista quando o usuário apaga tudo
  const buscando = termo.trim().length >= MINIMO_DA_BUSCA

  // Duas condições, cada uma fechando um caminho pelo qual o nome de um MENOR iria para a
  // query string (e daí para o access log) sem ninguém ter procurado nada:
  // (a) texto igual ao rótulo de quem já está escolhido não é busca;
  // (b) o valor DEBOUNCED tem de ter alcançado o digitado — sem isso, LIMPAR o campo dispara
  //     a busca com o rótulo anterior (o vazamento vem do atraso, não da digitação).
  const debounceAlcancouODigitado = termoBuscado.trim() === termo.trim()
  const temAlgoNovoParaBuscar = termo.trim() !== (rotuloEscolhido?.trim() ?? '')

  const busca = useQuery({
    queryKey: chaves.pacientesDaBusca(termoBuscado),
    queryFn: () => buscarPacientes(termoBuscado),
    enabled: ligado && buscando && debounceAlcancouODigitado && temAlgoNovoParaBuscar,
    // `staleTime` (o D6 promete que digitar não invalida a lista e reabrir não refaz a
    // página): sem ele o default é 0, e cada volta ao modo lista refazia TODAS as páginas
    // acumuladas, uma requisição por página (achado CR-BPL-03). O `gcTime` curto continua
    // sendo o que tira nome de menor da memória depressa.
    staleTime: 30 * 1000,
    gcTime: 30 * 1000,
  })

  const recentes = useQuery({
    queryKey: chaves.pacientesRecentes(),
    queryFn: buscarPacientesRecentes,
    enabled: ligado && !buscando,
    staleTime: 30 * 1000,
    gcTime: 30 * 1000,
  })

  // `useInfiniteQuery` e não páginas somadas à mão: o acúmulo, o "tem próxima" e o
  // "está buscando a próxima" são exatamente o que ele guarda — e um acúmulo caseiro
  // em `useState` duplicaria página no StrictMode, que monta o efeito duas vezes.
  const lista = useInfiniteQuery({
    queryKey: chaves.pacientesEmLista(),
    queryFn: ({ pageParam }) => listarPacientesDaSelecao(pageParam),
    initialPageParam: 1,
    // sem total na resposta (de propósito): página CHEIA é o sinal de que pode haver mais
    getNextPageParam: (ultima, todas) =>
      ultima.length === PACIENTES_POR_PAGINA ? todas.length + 1 : undefined,
    enabled: ligado && !buscando,
    staleTime: 30 * 1000,
    gcTime: 30 * 1000,
  })

  function comoOpcoes(pacientes: readonly { id: number; nome: string; nome_social: string | null }[]) {
    return pacientes.map((paciente) => ({ valor: paciente.id, rotulo: paciente.nome_social ?? paciente.nome }))
  }

  const doCatalogo = comoOpcoes((lista.data?.pages ?? []).flat())
  const dosRecentes = comoOpcoes(recentes.data ?? [])
  // um paciente recente não aparece DUAS vezes: a seção de baixo é o catálogo menos o atalho
  const idsRecentes = new Set(dosRecentes.map((opcao) => opcao.valor))
  const doCatalogoSemRepetir = doCatalogo.filter((opcao) => !idsRecentes.has(opcao.valor))

  // As duas consultas saem juntas, e a de recentes é agregação sobre `agendamentos` — quase
  // sempre a última a chegar. Montar as seções conforme cada uma resolve fazia "Recentes"
  // entrar DEPOIS, empurrando a lista oito linhas para baixo (mais que a altura visível) e
  // resetando o realce: o clique em voo cairia noutra criança (achado SEC-BPL-05, a mesma
  // classe do I-01 por outra porta). Ou as duas, ou nenhuma.
  const listaAssentou = !recentes.isPending && !lista.isPending

  const secoes: SecaoDeBusca[] = listaAssentou
    ? [
        ...(dosRecentes.length > 0 ? [{ nome: 'Recentes', opcoes: dosRecentes }] : []),
        // seção vazia não ganha cabeçalho: numa clínica pequena o dedupe pode esvaziar o
        // catálogo, e "TODOS" sozinho sobre o nada é ruído (achado CR-BPL-08)
        ...(doCatalogoSemRepetir.length > 0 ? [{ nome: 'Todos', opcoes: doCatalogoSemRepetir }] : []),
      ]
    : []

  return {
    opcoes: buscando ? comoOpcoes(busca.data?.pacientes ?? []) : secoes,
    // sem isto, requisição que falha vira caixa muda: nem lista, nem aviso (achado CR-BPL-04)
    falhou: buscando ? busca.isError : recentes.isError || lista.isError,
    // "existe cadastro inativo com esse nome" — quem responde é o SERVIDOR, e só para quem tem
    // `pacientes.ver`. Só no modo BUSCA: a pergunta "por que não achei?" não existe na lista.
    existeInativo: buscando && (busca.data?.existeInativo ?? false),
    // o campo mostra "buscando" enquanto o debounce não alcançou o que foi digitado
    // o debounce cria uma janela em que a busca AINDA não rodou: sem contá-la como
    // "carregando", o campo anunciaria "nenhum resultado" antes de perguntar ao servidor
    carregando: buscando
      ? busca.isFetching || !debounceAlcancouODigitado
      : ligado && (recentes.isPending || lista.isPending),
    carregandoMais: !buscando && lista.isFetchingNextPage,
    aoAproximarDoFim: () => {
      if (!buscando && lista.hasNextPage && !lista.isFetchingNextPage) {
        void lista.fetchNextPage()
      }
    },
  }
}

// Declarado `use*` e exportado em pt-BR, como `usarPreferenciaDeLayout`: a regra
// `rules-of-hooks` do lint reconhece hook pelo PREFIXO do nome declarado.
export { useEscolhaDePaciente as usarEscolhaDePaciente }
