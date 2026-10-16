import { useQuery } from '@tanstack/react-query'

import { PERMISSOES_DA_SELECAO_DA_AGENDA } from '@/lib/catalogos'
import { chaves } from '@/lib/chaves-query'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import type { NomesDoTratamento } from '@/lib/rotulo-de-tratamento'
import { buscarSelecaoDaAgenda } from '@/servicos/agenda'
import { convenios as servicoDeConvenios } from '@/servicos/catalogos-de-apoio'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Os nomes que o rótulo do pacote usa, cada catálogo sob a SUA permissão. Sem uma delas a parte
 * correspondente sai do rótulo — o convênio de uma criança não aparece para quem não pode ler
 * convênios. Serve ao campo Tratamento do lançamento e ao lote de vínculos: o MESMO rótulo, e o
 * "Vai para" sai do mesmo catálogo de profissionais.
 * @param ativo - Liga as consultas (o campo sem criança ou sem `tratamentos.ver` não pede nada)
 */
function useNomesDoTratamento(ativo: boolean): NomesDoTratamento {
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const selecao = useQuery({
    queryKey: chaves.selecaoDaAgenda(),
    queryFn: buscarSelecaoDaAgenda,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: ativo && PERMISSOES_DA_SELECAO_DA_AGENDA.some((permissao) => temPermissao(permissao)),
  })
  const convenios = useQuery({
    queryKey: chaves.convenios(),
    queryFn: servicoDeConvenios.listar,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: ativo && temPermissao('convenios.ver'),
  })

  return {
    especialidades: selecao.data?.especialidades ?? [],
    profissionais: selecao.data?.profissionais ?? [],
    convenios: convenios.data ?? [],
  }
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração
export { useNomesDoTratamento as usarNomesDoTratamento }
