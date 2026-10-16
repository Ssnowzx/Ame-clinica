import type { ReactNode } from 'react'

import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'

export interface EstadosDaListaProps {
  carregando: boolean
  erro: boolean
  aoTentarNovamente: () => void
  /** Lista carregada e vazia */
  vazio: boolean
  vazioTitulo: string
  vazioDescricao?: string
  /** Próximo passo do estado vazio (ex.: "Cadastrar paciente") */
  vazioAcao?: ReactNode
  /** O conteúdo, quando há dado */
  children: ReactNode
}

/**
 * Os quatro estados de uma lista de cadastro, num lugar só (design D7).
 *
 * A regra que ele existe para garantir: **falha de rede NUNCA vira "nenhum
 * registro"**. Uma lista que some quando a consulta falha diz à recepção que o
 * cadastro está vazio — e o gate da lista de espera já pegou essa mentira uma vez.
 */
export function EstadosDaLista({
  carregando,
  erro,
  aoTentarNovamente,
  vazio,
  vazioTitulo,
  vazioDescricao,
  vazioAcao,
  children,
}: EstadosDaListaProps) {
  if (erro) {
    return <EstadoErro mensagem="Não foi possível carregar." aoTentarNovamente={aoTentarNovamente} />
  }

  if (carregando) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, indice) => (
          <Skeleton key={indice} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (vazio) {
    return <EstadoVazio titulo={vazioTitulo} descricao={vazioDescricao} acao={vazioAcao} />
  }

  return <>{children}</>
}
