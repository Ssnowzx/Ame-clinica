import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useState } from 'react'

import type { EsqueletoDeCartao } from '@/componentes/indicadores/moldura-dos-indicadores'
import type { AcessoDaFicha, RelogioDaFicha } from '@/componentes/profissionais/painel/acesso-da-ficha'
import type { VozDaFicha } from '@/lib/indicadores/frases-do-profissional'
import type { PainelDoProfissional, Profissional } from '@/tipos'

import { FormularioProfissional } from '@/componentes/profissionais/formulario-profissional'
import { CabecalhoDaFicha } from '@/componentes/profissionais/painel/cabecalho-da-ficha'
import { EnderecoInvalido } from '@/componentes/profissionais/painel/estados-da-ficha'
import { EvolucoesEmAberto } from '@/componentes/profissionais/painel/evolucoes-em-aberto'
import { FinanceiroDaFicha } from '@/componentes/profissionais/painel/financeiro-do-profissional'
import { HojeNaAgenda } from '@/componentes/profissionais/painel/hoje-na-agenda'
import { IdentificacaoDoProfissional } from '@/componentes/profissionais/painel/identificacao-do-profissional'
import { PacientesDoProfissional } from '@/componentes/profissionais/painel/pacientes-do-profissional'
import { PainelDoMes } from '@/componentes/profissionais/painel/painel-do-mes'
import { TratamentosAtivos } from '@/componentes/profissionais/painel/tratamentos-ativos'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { FolhaImpressa } from '@/componentes/ui/folha-impressa'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { horaAgoraNaClinica } from '@/lib/datas'
import { ErroDeApi } from '@/lib/http'
import { mesAntesDoHistorico } from '@/lib/indicadores/frases'
import { rotuloDoMes } from '@/lib/meses'

interface PropsDaFicha {
  profissionalId: number
  acesso: AcessoDaFicha
  ficha: UseQueryResult<Profissional>
  painel: UseQueryResult<PainelDoProfissional>
  relogio: RelogioDaFicha
}

/**
 * A ficha aberta (o id é válido e quem olha pode vê-la): o cabeçalho, o estado do cadastro e o corpo.
 * Profissional que não existe (ou foi apagado) mostra SÓ o "não encontramos": o painel do mesmo id
 * também responde 404, e um "Não foi possível carregar o painel" com "Tentar novamente" logo abaixo
 * prometeria uma segunda tentativa que só repete o mesmo 404 (gate r1, N2).
 */
export function FichaDoProfissional({ profissionalId, acesso, ficha, painel, relogio }: PropsDaFicha) {
  const queryClient = useQueryClient()
  const [editando, setEditando] = useState(false)
  // pelo STATUS, e não pelo motivo: `invalido` também junta 422, 428 e o 429 do limite — um 429 no
  // cadastro escondia a ficha atrás de "não encontramos" (code-reviewer r2)
  const naoEncontrado = ficha.error instanceof ErroDeApi && ficha.error.status === 404
  const dados = ficha.data
  const nome = dados?.nome ?? painel.data?.profissional.nome ?? 'Profissional'
  const { mes, mesCorrente, trocarMes } = relogio

  return (
    <FolhaImpressa titulo={`Painel do profissional — ${nome}`} periodo={rotuloDoMes(mes)}>
      <div className="@container flex flex-col gap-6">
        <CabecalhoDaFicha
          dados={dados}
          carregando={ficha.isPending}
          ehProprio={acesso.ehProprio}
          voltarParaALista={acesso.voltarParaALista}
          podeEditar={acesso.podeEditar}
          aoEditar={() => {
            setEditando(true)
          }}
          aoMudarAFoto={() => {
            // a ficha relê a versão; a seleção da agenda (lista lateral, cabeçalhos) também
            void ficha.refetch()
            void queryClient.invalidateQueries({ queryKey: chaves.selecaoDaAgenda() })
          }}
          seletor={acesso.podePainel && !naoEncontrado ? { mes, mesCorrente, trocarMes } : undefined}
        />
        {ficha.isPending ? <Skeleton className="h-40 w-full" /> : null}
        {ficha.isError && !naoEncontrado ? (
          <EstadoErro mensagem="Não foi possível carregar a ficha do profissional." aoTentarNovamente={() => void ficha.refetch()} />
        ) : null}
        {naoEncontrado ? (
          <EnderecoInvalido texto="Não encontramos este profissional." />
        ) : (
          <CorpoDaFicha profissionalId={profissionalId} acesso={acesso} dados={dados} painel={painel} relogio={relogio} voz={{ ehProprio: acesso.ehProprio, nome }} />
        )}
      </div>
      {editando && dados !== undefined ? (
        <FormularioProfissional
          aberto={editando}
          profissional={dados}
          aoFechar={() => {
            setEditando(false)
          }}
        />
      ) : null}
    </FolhaImpressa>
  )
}

/** O corpo da ficha, na ordem da pergunta do profissional (D5); cada bloco só com a permissão dele. */
function CorpoDaFicha({
  profissionalId,
  acesso,
  dados,
  painel,
  relogio,
  voz,
}: Omit<PropsDaFicha, 'ficha'> & { dados: Profissional | undefined; voz: VozDaFicha }) {
  // Pacientes e Financeiro também vêm do painel: esperam ele chegar, para o bloco não crescer depois
  const painelAssentou = !acesso.podePainel || painel.isSuccess || painel.isError
  const pronto = painel.isSuccess && !mesAntesDoHistorico(painel.data) ? painel.data : undefined

  return (
    <>
      {dados === undefined ? null : <IdentificacaoDoProfissional dados={dados} />}
      {acesso.podeAgenda ? (
        <HojeNaAgenda profissionalId={profissionalId} ehProprio={acesso.ehProprio} hoje={relogio.hoje} agora={horaAgoraNaClinica(relogio.fuso)} />
      ) : null}
      {acesso.podePainel ? (
        <PainelDoMes
          consulta={painel}
          voz={voz}
          trocarMes={relogio.trocarMes}
          esqueleto={cartoesEsperados(acesso)}
          portaDaProducao={
            acesso.podeAtendimentos
              ? { para: `/indicadores/profissionais/${profissionalId}?mes=${relogio.mes}&de=ficha`, rotulo: 'Produção completa' }
              : undefined
          }
        />
      ) : null}
      {painelAssentou ? (
        <PacientesDoProfissional profissionalId={profissionalId} voz={voz} alcanca={acesso.alcancaTratamentos} pacientes={pronto?.pacientes} agenda={pronto?.agenda} />
      ) : null}
      {acesso.podeEvolucoes || acesso.podeTratamentos ? (
        <div className="grid gap-4 @min-[56rem]:grid-cols-2">
          {acesso.podeEvolucoes ? <EvolucoesEmAberto profissionalId={profissionalId} ehProprio={acesso.ehProprio} /> : null}
          {acesso.podeTratamentos ? <TratamentosAtivos profissionalId={profissionalId} alcanca={acesso.alcancaTratamentos} /> : null}
        </div>
      ) : null}
      {pronto?.financeiro === undefined ? null : (
        <FinanceiroDaFicha financeiro={pronto.financeiro} base={pronto} serie={pronto.serie} voz={voz} />
      )}
    </>
  )
}

/** Os cartões que o painel deve trazer para quem olha — o esqueleto reserva a caixa deles (CLS). */
function cartoesEsperados({ podeAgenda, podeAtendimentos }: AcessoDaFicha): EsqueletoDeCartao[] {
  if (!podeAgenda) {
    return []
  }
  const daAgenda: EsqueletoDeCartao[] = [
    { rotulo: 'Atendimentos realizados', linhasDaFrase: [2, 2, 1], comPorta: podeAtendimentos },
    { rotulo: 'Ocupação', linhasDaFrase: [3, 3, 2] },
    { rotulo: 'Faltas', linhasDaFrase: [2, 2, 1] },
    { rotulo: 'Desmarques', linhasDaFrase: [2, 2, 1] },
  ]

  return podeAtendimentos ? [...daAgenda, { rotulo: 'Evoluções em dia', linhasDaFrase: [2, 2, 1] }] : daAgenda
}
