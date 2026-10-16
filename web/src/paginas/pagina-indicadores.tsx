import type { FrenteDoPainel } from '@/tipos'

import {
  CartaoDaAgenda,
  CartaoDaEquipe,
  CartaoDoDinheiro,
  CartaoDosPacientes,
  TendenciaDoRecebido,
} from '@/componentes/indicadores/cartoes-da-visao-geral'
import { PeriodoDaVisaoGeral } from '@/componentes/indicadores/linha-do-periodo'
import { GradeDeCartoes, ParDeQuadros } from '@/componentes/indicadores/moldura-dos-indicadores'
import { PedeAtencao } from '@/componentes/indicadores/pede-atencao'
import { useMesDosIndicadores } from '@/componentes/indicadores/periodo-dos-indicadores'
import { RegrasDosIndicadores } from '@/componentes/indicadores/regras-dos-indicadores'
import { FolhaImpressa } from '@/componentes/ui/folha-impressa'
import { PERMISSOES_DO_PAINEL } from '@/lib/indicadores/paineis'
import { rotuloDoMes } from '@/lib/meses'
import { useAuthStore } from '@/stores/auth-store'

const ORDEM: readonly FrenteDoPainel[] = ['dinheiro', 'agenda', 'pacientes', 'equipe']

/**
 * A VISÃO GERAL executiva (change indicadores-profissionais, D6/D7): a linha do período, os
 * quatro cartões — Dinheiro, Agenda, Pacientes e Equipe —, a tendência do recebido, o "Pede
 * atenção" e as regras para os números ficarem certos (change inicio-dos-indicadores). É a tela do
 * GESTOR: trinta segundos e ele sabe como o mês está.
 *
 * **Composta pelo módulo DONO de cada painel (T-not-13).** Cada cartão só MONTA — e portanto só
 * BUSCA — com a permissão do painel dele; a linha do período e as regras recebem só as frentes
 * permitidas, então quem não tem `fluxo_caixa.ver` não vê cartão, regra nem tendência de dinheiro, e o painel do dinheiro nem é
 * chamado. Esconder é experiência: o servidor continua respondendo 403 à URL digitada.
 *
 * Só agregados: nenhum nome de paciente aparece aqui (o "Pede atenção" usa só os totais do sino).
 */
export function PaginaIndicadores() {
  const mes = useMesDosIndicadores()
  // as permissões como DADO do store (e não a função `temPermissao`): o seletor de uma função
  // estável não re-renderiza quando a sessão muda
  const permissoes = useAuthStore((estado) => estado.usuario?.permissoes)
  const frentes = ORDEM.filter((frente) => PERMISSOES_DO_PAINEL[frente].every((permissao) => permissoes?.includes(permissao) === true))
  const podeDinheiro = frentes.includes('dinheiro')

  return (
    <FolhaImpressa titulo="Indicadores — visão geral" periodo={rotuloDoMes(mes)}>
      <div className="@container flex flex-col gap-5">
        {frentes.length > 0 ? <PeriodoDaVisaoGeral mes={mes} frentes={frentes} /> : null}

        {frentes.length > 0 ? (
          // quatro cartões lado a lado no monitor, 2 + 2 no tablet, um no celular — e, com três
          // frentes permitidas, três cartões largos: nunca um cartão órfão numa linha (DQ-13)
          <GradeDeCartoes quantidade={frentes.length}>
            {frentes.includes('dinheiro') ? <CartaoDoDinheiro mes={mes} /> : null}
            {frentes.includes('agenda') ? <CartaoDaAgenda mes={mes} /> : null}
            {frentes.includes('pacientes') ? <CartaoDosPacientes mes={mes} /> : null}
            {frentes.includes('equipe') ? <CartaoDaEquipe mes={mes} /> : null}
          </GradeDeCartoes>
        ) : null}

        {/* a tendência e o "Pede atenção" com a MESMA altura, lado a lado no monitor (DQ-04) */}
        {podeDinheiro ? (
          <ParDeQuadros proporcao="tendencia">
            <TendenciaDoRecebido mes={mes} />
            <PedeAtencao />
          </ParDeQuadros>
        ) : (
          <PedeAtencao />
        )}

        {/* por último, o que a clínica precisa registrar para os números acima dizerem a verdade */}
        {frentes.length > 0 ? <RegrasDosIndicadores mes={mes} frentes={frentes} /> : null}
      </div>
    </FolhaImpressa>
  )
}
