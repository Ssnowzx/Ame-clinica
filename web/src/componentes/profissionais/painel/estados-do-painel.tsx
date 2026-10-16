import { CalendarRange, ShieldAlert } from 'lucide-react'

import type { BaseDoPainel } from '@/tipos'

import { EsqueletoDaAba, type EsqueletoDeCartao } from '@/componentes/indicadores/moldura-dos-indicadores'
import { Botao } from '@/componentes/ui/botao'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { motivoDeSemDados } from '@/lib/indicadores/frases'
import { rotuloDoMes } from '@/lib/meses'

/**
 * Os ESTADOS do painel do mês (os quatro estados da casa): carregando na caixa do conteúdo, fora do
 * alcance (o 403), o mês antes do início dos indicadores — e o erro, que a página mostra com o
 * `EstadoErro` padrão.
 */

/**
 * CARREGANDO: a linha do período, os cartões que as permissões de quem olha devem trazer e dois quadros
 * — a mesma ordem do conteúdo, para nada pular quando o painel chegar (CLS).
 */
export function PainelCarregando({ cartoes }: { cartoes: readonly EsqueletoDeCartao[] }) {
  return <EsqueletoDaAba titulo="O mês do profissional" cartoes={cartoes} quadros={cartoes.length > 0 ? 2 : 0} />
}

/**
 * FORA DO ALCANCE (o 403 do servidor): quem olha não alcança bloco nenhum deste profissional — o
 * escopado na ficha de um colega. As seções viram PORTA, nunca um "0": o recorte de quem olha não diz
 * nada sobre o colega. A porta da agenda já está no bloco Hoje, logo acima.
 */
export function PainelForaDoAlcance() {
  return (
    <EstadoVazio
      nivel={2}
      icone={<ShieldAlert className="size-8" />}
      titulo="Os números do mês deste profissional não estão no seu acesso"
      descricao="O seu acesso não alcança a agenda nem os atendimentos deste profissional. O dia dele se vê pela agenda, com o recorte do seu papel."
    />
  )
}

/** O mês anterior ao início dos indicadores: nada de zeros — e a saída para o primeiro mês que existe. */
export function PainelSemHistorico({ base, trocarMes }: { base: BaseDoPainel; trocarMes: (mes: string) => void }) {
  const inicio = base.inicio_historico

  return (
    <EstadoVazio
      nivel={2}
      icone={<CalendarRange className="size-8" />}
      titulo="Sem dados para este mês"
      descricao={motivoDeSemDados(base)}
      acao={
        inicio === null ? undefined : (
          <Botao variante="primario" data-nao-imprimir onClick={() => trocarMes(inicio)}>
            Ver {rotuloDoMes(inicio)}
          </Botao>
        )
      }
    />
  )
}
