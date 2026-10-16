import type { UseQueryResult } from '@tanstack/react-query'

import type { PortaDoCartao } from '@/componentes/indicadores/cartao-do-indicador'
import type { EsqueletoDeCartao } from '@/componentes/indicadores/moldura-dos-indicadores'
import type { VozDaFicha } from '@/lib/indicadores/frases-do-profissional'
import type { PainelDoProfissional } from '@/tipos'

import { LinhaDoPeriodo } from '@/componentes/indicadores/linha-do-periodo'
import { ASemana } from '@/componentes/profissionais/painel/a-semana'
import { PainelCarregando, PainelForaDoAlcance, PainelSemHistorico } from '@/componentes/profissionais/painel/estados-do-painel'
import { MesEmNumeros } from '@/componentes/profissionais/painel/mes-em-numeros'
import { OndeNaoRendeu } from '@/componentes/profissionais/painel/onde-nao-rendeu'
import { SeisMeses } from '@/componentes/profissionais/painel/seis-meses'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { ErroDeApi } from '@/lib/http'
import { mesAntesDoHistorico } from '@/lib/indicadores/frases'

/**
 * O PAINEL DO MÊS — a parte da ficha que vem de `GET /profissionais/{id}/painel` (D7): a linha do
 * período, O mês em números, Seis meses, A semana e Onde a agenda não rendeu, nesta ordem (D5). Os
 * blocos de Pacientes e Financeiro, que vêm do mesmo painel, ficam mais abaixo na ficha.
 *
 * Os estados:
 * - carregando: o esqueleto na caixa dos cartões e dos quadros;
 * - 403: quem olha não alcança bloco nenhum (o escopado na ficha de um colega) — PORTA, nunca zero;
 * - erro: "Tentar novamente";
 * - mês antes do início dos indicadores: "sem dados", com a saída para o primeiro mês que existe.
 */
export function PainelDoMes({
  consulta,
  voz,
  trocarMes,
  esqueleto,
  portaDaProducao,
}: {
  consulta: UseQueryResult<PainelDoProfissional>
  voz: VozDaFicha
  trocarMes: (mes: string) => void
  /** Os cartões que as permissões de quem olha devem trazer — o esqueleto reserva a caixa deles */
  esqueleto: readonly EsqueletoDeCartao[]
  portaDaProducao?: PortaDoCartao
}) {
  if (consulta.isPending) {
    return <PainelCarregando cartoes={esqueleto} />
  }
  if (consulta.isError) {
    return consulta.error instanceof ErroDeApi && consulta.error.motivo === 'sem_acesso' ? (
      <PainelForaDoAlcance />
    ) : (
      <EstadoErro mensagem={mensagemDoErro(consulta.error)} aoTentarNovamente={() => void consulta.refetch()} />
    )
  }
  const painel = consulta.data
  if (mesAntesDoHistorico(painel)) {
    return <PainelSemHistorico base={painel} trocarMes={trocarMes} />
  }

  return (
    <>
      <LinhaDoPeriodo base={painel} />
      <MesEmNumeros agenda={painel.agenda} equipe={painel.equipe} voz={voz} portaDaProducao={portaDaProducao} />
      {/* a série também vem com o FINANCEIRO, só com o recebido (a faturista): sem a produtividade não há
          contagens, e "Seis meses" desenharia meses vazios — o recebido mora no bloco Financeiro */}
      {painel.serie === undefined || painel.produtividade === undefined ? null : (
        <SeisMeses base={painel} serie={painel.serie} agenda={painel.agenda} voz={voz} />
      )}
      <ASemana agenda={painel.agenda} produtividade={painel.produtividade} voz={voz} />
      <OndeNaoRendeu produtividade={painel.produtividade} agenda={painel.agenda} />
    </>
  )
}

/**
 * O 429 é o limite de consultas da rota (quem troca de mês muitas vezes seguidas): não é "revise os
 * dados" nem falha do servidor — é esperar um pouco. O "Tentar novamente" da casa continua ali.
 */
function mensagemDoErro(erro: Error): string {
  return erro instanceof ErroDeApi && erro.status === 429
    ? 'Muitas consultas seguidas; tente de novo em um minuto.'
    : 'Não foi possível carregar o painel do mês.'
}
