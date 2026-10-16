import { useQuery } from '@tanstack/react-query'

import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { ListaDescricao, type ItemDescricao } from '@/componentes/ui/lista-descricao'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel } from '@/lib/datas'
import { buscarPaciente, buscarResumoDoPaciente } from '@/servicos/pacientes'
import type { ResumoDoPaciente } from '@/tipos'

interface SecaoPainelProps {
  pacienteId: number
}

const ROTULO_CONTRATO: Record<NonNullable<ResumoDoPaciente['contrato']>['status'], string> = {
  andamento: 'Em andamento',
  parado: 'Parado',
  finalizado: 'Finalizado',
}

function contratoLegivel(contrato: NonNullable<ResumoDoPaciente['contrato']>): string {
  const base = `${ROTULO_CONTRATO[contrato.status]} · ${contrato.sessoes_realizadas}/${contrato.sessoes_total} sessões`
  return contrato.vencido ? `${base} · vencido` : base
}

function estaVazio(resumo: ResumoDoPaciente): boolean {
  return (
    resumo.profissional_atual === null &&
    resumo.contrato === null &&
    resumo.primeira_sessao === null &&
    resumo.proxima_sessao === null &&
    resumo.sessoes_realizadas === 0
  )
}

/**
 * Seção Painel (ficha do paciente) — o resumo agregado do servidor (Decisão 3):
 * profissional atual, situação do contrato, primeira/próxima sessão e sessões
 * realizadas. Não recompõe coluna do menor — só exibe o que o resumo entrega.
 * Os quatro estados; o vazio é o paciente ainda sem contrato nem sessões.
 */
export function SecaoPainel({ pacienteId }: SecaoPainelProps) {
  /*
   * O convênio vem do CADASTRO, não do resumo.
   *
   * O `GET /pacientes/{id}/resumo` é agregado e **omite identificadores de propósito** — sem
   * nome, CPF nem nascimento (decisão SEC-FP-02, registrada para uma change futura não voltar
   * a expô-los ali). A carteirinha é identificador do menor junto à operadora, da classe do
   * CPF: pô-la no resumo reabriria exatamente o que aquela decisão fechou.
   *
   * A ficha já carrega o cadastro para o cabeçalho (nome, idade, sexo), então o dado está ao
   * lado — é a fonte única da identidade, e é dela que se lê.
   */
  const paciente = useQuery({
    queryKey: chaves.paciente(pacienteId),
    queryFn: () => buscarPaciente(pacienteId),
    // `gcTime: 0` é EXIGIDO em toda chave de detalhe (guarda `detalhe-sem-cache`), e a guarda
    // pegou esta consulta. O motivo é exatamente o meu caso: uma leitura só-visual mantém o
    // cache QUENTE, e o formulário de edição hidrata o `useState` no primeiro render — sobre o
    // dado velho. Nos tratamentos isso apagou a matrícula de um menor.
    gcTime: 0,
  })

  const resumo = useQuery({
    queryKey: chaves.pacienteResumo(pacienteId),
    queryFn: () => buscarResumoDoPaciente(pacienteId),
  })

  if (resumo.isPending) {
    return (
      <div aria-busy className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((indice) => (
          <div key={indice}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-4 w-40" />
          </div>
        ))}
      </div>
    )
  }

  if (resumo.isError) {
    return (
      <EstadoErro
        mensagem="Não foi possível carregar o resumo do paciente."
        aoTentarNovamente={() => void resumo.refetch()}
      />
    )
  }

  if (estaVazio(resumo.data)) {
    return (
      <EstadoVazio
        titulo="Sem resumo ainda"
        descricao="Este paciente ainda não tem contrato nem sessões registradas."
      />
    )
  }

  const dados = resumo.data
  const cadastro = paciente.data
  const itens: ItemDescricao[] = [
    /*
     * O convênio abre o painel: é o que a recepção precisa saber ANTES de qualquer coisa
     * quando a família liga ou chega no balcão (pedido do usuário, 2026-08-26).
     *
     * Só aparecem quando existem — criança particular não ganha duas linhas de travessão.
     */
    ...(cadastro?.convenio != null
      ? [{ rotulo: 'Convênio', valor: cadastro.convenio.nome }]
      : []),
    ...(cadastro?.carteirinha != null && cadastro.carteirinha !== ''
      ? [{ rotulo: 'Carteirinha', valor: cadastro.carteirinha }]
      : []),
    { rotulo: 'Profissional atual', valor: dados.profissional_atual?.nome ?? '—' },
    { rotulo: 'Contrato', valor: dados.contrato !== null ? contratoLegivel(dados.contrato) : '—' },
    { rotulo: 'Primeira sessão', valor: dataHoraLegivel(dados.primeira_sessao) },
    { rotulo: 'Próxima sessão', valor: dataHoraLegivel(dados.proxima_sessao) },
    { rotulo: 'Sessões realizadas', valor: String(dados.sessoes_realizadas) },
  ]

  return <ListaDescricao itens={itens} />
}
