import type { ReactNode } from 'react'

import type { PortaDoCartao } from '@/componentes/indicadores/cartao-do-indicador'
import type { VozDaFicha } from '@/lib/indicadores/frases-do-profissional'
import type { PainelDaAgenda, PainelDaEquipe } from '@/tipos'

import { CartaoDoIndicador } from '@/componentes/indicadores/cartao-do-indicador'
import { GradeDeCartoes } from '@/componentes/indicadores/moldura-dos-indicadores'
import { SecaoDoPainel } from '@/componentes/profissionais/painel/secao-do-painel'
import {
  DEFINICAO_DA_OCUPACAO_DO_PROFISSIONAL,
  DEFINICAO_DAS_EVOLUCOES_EM_DIA,
  DEFINICAO_DAS_REALIZADAS,
  definicaoDasFaltas,
  definicaoDosDesmarques,
} from '@/lib/indicadores/definicoes'
import { compararContagem, compararTaxa, formatarTaxa, fraseDaParteDasPassadas } from '@/lib/indicadores/frases'
import { atendimentosDe, daGrade, fraseDaOcupacaoDoProfissional, fraseDasEvolucoesAtrasadas } from '@/lib/indicadores/frases-do-profissional'
import { formatarContagem } from '@/lib/numeros'

/**
 * O MÊS EM NÚMEROS (D5): os cartões do painel, cada um com a comparação ao MESMO período do mês
 * anterior, a frase e o "i" com a definição — o `CartaoDoIndicador` dos Indicadores, com os números do
 * recorte de UM profissional que o servidor calculou com as mesmas regras (D7).
 *
 * Cada cartão sai do bloco que o traz: sem `agenda`, os quatro da agenda não existem; sem `equipe`, o
 * das evoluções também não — e a grade se arranja com os que sobraram, sem buraco. O recebido NÃO mora
 * aqui: ele só aparece no bloco Financeiro, ao lado da frase que diz a base (um número de dinheiro sem
 * a base escrita ao lado seria lido como "o que eu ganhei").
 */
export function MesEmNumeros({
  agenda,
  equipe,
  voz,
  portaDaProducao,
}: {
  agenda?: PainelDaAgenda
  equipe?: PainelDaEquipe
  voz: VozDaFicha
  /** A produção completa do mês — só com a permissão do DESTINO */
  portaDaProducao?: PortaDoCartao
}) {
  const cartoes: ReactNode[] = [
    ...(agenda === undefined ? [] : cartoesDaAgenda(agenda, voz, portaDaProducao)),
    ...(equipe === undefined ? [] : [<CartaoDasEvolucoes key="evolucoes" equipe={equipe} />]),
  ]
  if (cartoes.length === 0) {
    return null
  }

  return (
    <SecaoDoPainel
      id="painel-mes-em-numeros"
      titulo="O mês em números"
      subtitulo={`Os ${atendimentosDe(voz)} no período, cada número com a comparação logo abaixo dele.`}
    >
      <GradeDeCartoes quantidade={cartoes.length}>{cartoes}</GradeDeCartoes>
    </SecaoDoPainel>
  )
}

/** Os quatro cartões da agenda — realizados primeiro: é a manchete da ficha (o cartão largo da grade). */
function cartoesDaAgenda(agenda: PainelDaAgenda, voz: VozDaFicha, porta: PortaDoCartao | undefined): ReactNode[] {
  const { periodo } = agenda
  const faltas = agenda.faltas.atual
  const desmarques = agenda.desmarques.atual

  return [
    <CartaoDoIndicador
      key="realizados"
      rotulo="Atendimentos realizados"
      valor={formatarContagem(agenda.realizadas.atual)}
      legenda="sessões"
      comparacao={compararContagem(agenda.realizadas, periodo, 'subir-e-bom')}
      frase={fraseDaParteDasPassadas(agenda.realizadas.atual, agenda)}
      definicao={DEFINICAO_DAS_REALIZADAS}
      porta={porta}
    />,
    <CartaoDoIndicador
      key="ocupacao"
      rotulo="Ocupação"
      valor={agenda.ocupacao.atual === null ? null : formatarTaxa(agenda.ocupacao.atual)}
      legenda={daGrade(voz)}
      comparacao={compararTaxa(agenda.ocupacao.atual, agenda.ocupacao.anterior, periodo, 'subir-e-bom')}
      frase={fraseDaOcupacaoDoProfissional(agenda, voz)}
      definicao={DEFINICAO_DA_OCUPACAO_DO_PROFISSIONAL}
    />,
    <CartaoDoIndicador
      key="faltas"
      rotulo="Faltas"
      valor={faltas.taxa === null ? null : formatarTaxa(faltas.taxa)}
      legenda="das sessões"
      comparacao={compararTaxa(faltas.taxa, agenda.faltas.anterior?.taxa ?? null, periodo, 'subir-e-ruim')}
      frase={fraseDaParteDasPassadas(faltas.quantidade, agenda)}
      definicao={definicaoDasFaltas(agenda)}
    />,
    <CartaoDoIndicador
      key="desmarques"
      rotulo="Desmarques"
      valor={desmarques.taxa === null ? null : formatarTaxa(desmarques.taxa)}
      legenda="das sessões"
      comparacao={compararTaxa(desmarques.taxa, agenda.desmarques.anterior?.taxa ?? null, periodo, 'subir-e-ruim')}
      frase={fraseDaParteDasPassadas(desmarques.quantidade, agenda)}
      definicao={definicaoDosDesmarques(agenda)}
    />,
  ]
}

/** As evoluções em dia: a taxa, comparada, e as que passaram do prazo — a parte que pede ação. */
function CartaoDasEvolucoes({ equipe }: { equipe: PainelDaEquipe }) {
  const emDia = equipe.evolucoes.em_dia

  return (
    <CartaoDoIndicador
      rotulo="Evoluções em dia"
      valor={emDia.atual === null ? null : formatarTaxa(emDia.atual)}
      legenda="das sessões realizadas"
      comparacao={compararTaxa(emDia.atual, emDia.anterior, equipe.periodo, 'subir-e-bom')}
      frase={fraseDasEvolucoesAtrasadas(equipe)}
      definicao={DEFINICAO_DAS_EVOLUCOES_EM_DIA}
    />
  )
}
