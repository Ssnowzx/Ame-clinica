import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { CampoBusca, type OpcaoDeBusca } from '@/componentes/ui/campo-busca'
import { usarDebounce } from '@/hooks/usar-debounce'
import { chaves } from '@/lib/chaves-query'
import { buscarPacientePorId, buscarPacientes } from '@/servicos/agenda'
import { useAuthStore } from '@/stores/auth-store'

const MINIMO_DE_LETRAS = 2

export interface CampoPacienteProps {
  /** O id que está no rascunho (a URL leva SÓ o id — nome de menor não vai para histórico). */
  pacienteId: string | undefined
  aoEscolher: (pacienteId: string | undefined) => void
}

/**
 * A escolha da criança para os relatórios de UMA criança (extrato). Busca pelo endpoint
 * de seleção da agenda (nome e id, nada mais); o id que veio pela URL é NOMEADO por uma
 * leitura própria, para o campo mostrar quem está escolhido sem inventar nome.
 */
export function CampoPaciente({ pacienteId, aoEscolher }: CampoPacienteProps) {
  const [termo, setTermo] = useState('')
  const termoAtrasado = usarDebounce(termo)
  const podeBuscar = useAuthStore((estado) => estado.temPermissao('agenda.ver'))
  const idNumerico = pacienteId === undefined ? null : Number(pacienteId)

  const nomeado = useQuery({
    queryKey: chaves.pacienteDaSelecao(idNumerico ?? 0),
    queryFn: () => buscarPacientePorId(idNumerico ?? 0),
    enabled: idNumerico !== null && podeBuscar,
  })

  const busca = useQuery({
    queryKey: chaves.pacientesDaBusca(termoAtrasado),
    queryFn: () => buscarPacientes(termoAtrasado),
    enabled: podeBuscar && termoAtrasado.trim().length >= MINIMO_DE_LETRAS,
  })

  const selecionado: OpcaoDeBusca | null =
    idNumerico === null
      ? null
      : {
          valor: idNumerico,
          rotulo: nomeado.data?.nome ?? (nomeado.isPending ? 'Carregando…' : 'Paciente não encontrado'),
        }

  return (
    <CampoBusca
      rotulo="Paciente"
      obrigatorio
      placeholder="Digite o nome para buscar"
      selecionado={selecionado}
      aoSelecionar={(opcao) => {
        aoEscolher(opcao === null ? undefined : String(opcao.valor))
      }}
      termo={termo}
      aoDigitar={setTermo}
      opcoes={(busca.data?.pacientes ?? []).map((paciente) => ({ valor: paciente.id, rotulo: paciente.nome }))}
      carregando={busca.isFetching}
      falhou={busca.isError}
      // a TERCEIRA caixa servida por esta rota: o vazio explica o inativo aqui também, senão o
      // beco que a change fechou na agenda e na fila continuaria aberto no filtro do relatório
      // (achado CR-IMP-2 / SEC-PIS-12)
      existeInativo={busca.data?.existeInativo ?? false}
      desabilitado={!podeBuscar}
      ajuda={podeBuscar ? undefined : 'A busca de pacientes precisa da permissão de ver a agenda.'}
    />
  )
}
