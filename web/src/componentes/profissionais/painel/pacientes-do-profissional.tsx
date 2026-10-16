import type { ReactNode } from 'react'

import type { VozDaFicha } from '@/lib/indicadores/frases-do-profissional'
import type { PaginaDeApi, PainelDaAgenda, PainelDosPacientes, TratamentoDaLista } from '@/tipos'

import { CartaoComErro, CartaoDoIndicador } from '@/componentes/indicadores/cartao-do-indicador'
import { QuadroVazio } from '@/componentes/indicadores/estados-da-aba'
import { BarrasComDestaque, EquivalenteEmTabela, LegendaDoDestaque, QuadroDoGrafico } from '@/componentes/indicadores/graficos-do-painel'
import { CartaoPendente, GradeDeCartoes } from '@/componentes/indicadores/moldura-dos-indicadores'
import {
  PAGINA_CHEIA,
  usePacotesNoFim,
  useTratamentosAtivos,
} from '@/componentes/profissionais/painel/consultas-de-tratamentos'
import { SecaoDoPainel } from '@/componentes/profissionais/painel/secao-do-painel'
import { TabelaDeTratamentos } from '@/componentes/profissionais/painel/tratamentos-ativos'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import {
  DEFINICAO_DO_EM_ATENDIMENTO,
  DEFINICAO_DOS_PACOTES_NO_FIM_DO_PROFISSIONAL,
} from '@/lib/indicadores/definicoes'
import { plural } from '@/lib/indicadores/frases'
import { comQuem, tituloDasSessoesPorConvenio } from '@/lib/indicadores/frases-do-profissional'
import { formatarContagem } from '@/lib/numeros'

/** A grandeza que é FOTO do momento: no lugar da comparação, a linha neutra (DQ-05). */
const DE_HOJE = 'situação de hoje'

/**
 * PACIENTES (D5): quem está em atendimento com o profissional, os pacotes perto do fim (o número e a
 * lista nominal com o saldo) e a quebra das sessões por convênio.
 *
 * Do bloco `pacientes` do painel, a ficha usa SÓ os pacotes no fim: os ativos, os novos e os que saíram
 * do `PainelDosPacientes` são da CLÍNICA INTEIRA (a régua dele, CR-IND-11), e escritos aqui seriam
 * lidos como "os pacientes de Ana". A lista nominal e o "em atendimento" vêm da lista de Tratamentos —
 * escopada pelo eixo agenda, então só para quem ALCANÇA este profissional (`alcanca`).
 */
export function PacientesDoProfissional({
  profissionalId,
  voz,
  alcanca,
  pacientes,
  agenda,
}: {
  profissionalId: number
  voz: VozDaFicha
  /** Pode ler os tratamentos deste profissional sem o recorte mentir (`tratamentos.ver` + alcance) */
  alcanca: boolean
  pacientes?: Pick<PainelDosPacientes, 'pacotes_no_fim'>
  agenda?: PainelDaAgenda
}) {
  const pacotesNoFim = pacientes?.pacotes_no_fim
  const cartoes: ReactNode[] = [
    ...(alcanca ? [<CartaoDoEmAtendimento key="em-atendimento" profissionalId={profissionalId} voz={voz} />] : []),
    ...(pacotesNoFim === undefined
      ? []
      : [
          <CartaoDoIndicador
            key="pacotes"
            rotulo="Pacotes perto do fim"
            valor={formatarContagem(pacotesNoFim)}
            legenda={pacotesNoFim === 1 ? 'pacote em andamento' : 'pacotes em andamento'}
            contexto={DE_HOJE}
            definicao={DEFINICAO_DOS_PACOTES_NO_FIM_DO_PROFISSIONAL}
          />,
        ]),
  ]
  const temConvenios = agenda !== undefined

  if (cartoes.length === 0 && !alcanca && !temConvenios) {
    return null
  }

  return (
    <SecaoDoPainel id="painel-pacientes" titulo="Pacientes" subtitulo={`As crianças em atendimento ${comQuem(voz)} e os pacotes que estão acabando.`}>
      {cartoes.length === 0 ? null : <GradeDeCartoes quantidade={cartoes.length}>{cartoes}</GradeDeCartoes>}
      {alcanca || temConvenios ? (
        <div className="grid gap-4 @min-[56rem]:grid-cols-2">
          {alcanca ? <PacotesNoFim profissionalId={profissionalId} /> : null}
          {agenda === undefined ? null : <SessoesPorConvenio agenda={agenda} />}
        </div>
      ) : null}
    </SecaoDoPainel>
  )
}

/** Em atendimento: os tratamentos em andamento — o MESMO número (e a mesma consulta) da tabela de baixo. */
function CartaoDoEmAtendimento({ profissionalId, voz }: { profissionalId: number; voz: VozDaFicha }) {
  const ativos = useTratamentosAtivos(profissionalId)

  if (ativos.isPending) {
    return <CartaoPendente rotulo="Em atendimento" linhasDaFrase={0} linhasDaComparacao={1} />
  }
  if (ativos.isError) {
    return <CartaoComErro rotulo="Em atendimento" mensagem="Não foi possível carregar os tratamentos." aoTentarNovamente={() => void ativos.refetch()} />
  }

  return (
    <CartaoDoIndicador
      rotulo="Em atendimento"
      valor={formatarContagem(ativos.data.total)}
      legenda={`${ativos.data.total === 1 ? 'tratamento em andamento' : 'tratamentos em andamento'} ${comQuem(voz)}`}
      contexto={DE_HOJE}
      definicao={DEFINICAO_DO_EM_ATENDIMENTO}
    />
  )
}

/**
 * A LISTA NOMINAL dos pacotes perto do fim, com o saldo — do mais urgente para o menos. O recorte
 * "Acabando" do servidor inclui o pacote de UMA sessão (que o aviso "Pacotes acabando" ignora: saldo 1
 * de 1 não é fim de pacote); o veredito `realce` de cada linha, do servidor, é quem separa os dois — a
 * tela não reescreve a regra.
 */
function PacotesNoFim({ profissionalId }: { profissionalId: number }) {
  const pacotes = usePacotesNoFim(profissionalId)

  return (
    <section aria-labelledby="painel-pacotes-no-fim" className="flex min-w-0 flex-col gap-3 rounded-superficie border border-linha bg-superficie p-5 shadow-e1 print:break-inside-avoid print:shadow-none">
      <h3 id="painel-pacotes-no-fim" className="text-subtitulo font-semibold text-texto">
        Quem está perto do fim do pacote
      </h3>
      {pacotes.isPending ? <Skeleton className="h-24 w-full" /> : null}
      {pacotes.isError ? (
        <EstadoErro mensagem="Não foi possível carregar os pacotes perto do fim." aoTentarNovamente={() => void pacotes.refetch()} />
      ) : null}
      {pacotes.isSuccess ? <ListaDosPacotes pagina={pacotes.data} /> : null}
    </section>
  )
}

function ListaDosPacotes({ pagina }: { pagina: PaginaDeApi<TratamentoDaLista> }) {
  const noFim = pagina.data
    .filter((tratamento) => tratamento.realce !== 'nenhum')
    .sort((a, b) => a.sessoes_saldo - b.sessoes_saldo)

  if (noFim.length === 0) {
    return <p className="text-corpo text-texto-suave">Nenhum pacote perto do fim.</p>
  }

  return (
    <>
      <TabelaDeTratamentos legenda="Pacotes perto do fim, do menor saldo para o maior" tratamentos={noFim} />
      {/* a página cheia é a amostra que o servidor mandou: passou dela, a lista se anuncia cortada */}
      {pagina.total > PAGINA_CHEIA ? (
        <p className="text-meta text-texto-suave">
          Mostrando os pacotes dos primeiros {plural(PAGINA_CHEIA, 'tratamento', 'tratamentos')}; a lista inteira está em Tratamentos.
        </p>
      ) : null}
    </>
  )
}

/** As sessões que já passaram, por convênio — com quem a agenda dele se ocupa. A linha "Outros" nunca é o destaque. */
function SessoesPorConvenio({ agenda }: { agenda: PainelDaAgenda }) {
  const linhas = agenda.por_convenio
  const maior = Math.max(0, ...linhas.filter((linha) => linha.outros === undefined).map((linha) => linha.sessoes))
  const rotulo = (linha: PainelDaAgenda['por_convenio'][number]): string =>
    linha.outros === undefined ? linha.nome : `${linha.nome} (${formatarContagem(linha.outros)})`

  return (
    <QuadroDoGrafico
      id="painel-sessoes-por-convenio"
      titulo={tituloDasSessoesPorConvenio(linhas)}
      subtitulo="Sessões que já passaram no período, por convênio"
    >
      {linhas.length === 0 ? (
        <QuadroVazio>As sessões por convênio aparecem quando as primeiras sessões do período passarem.</QuadroVazio>
      ) : (
        <>
          <BarrasComDestaque
            barras={linhas.map((linha) => ({
              chave: `${linha.nome}-${String(linha.outros ?? 0)}`,
              rotulo: rotulo(linha),
              proporcao: maior === 0 ? 0 : (linha.sessoes / maior) * 100,
              valor: formatarContagem(linha.sessoes),
              destaque: linha.outros === undefined && maior > 0 && linha.sessoes === maior,
            }))}
          />
          <LegendaDoDestaque>O convênio com mais sessões</LegendaDoDestaque>
          <EquivalenteEmTabela
            legenda="Sessões que já passaram, por convênio"
            colunas={[
              { rotulo: 'Convênio' },
              { rotulo: 'Sessões', numerica: true },
              { rotulo: 'Faltas', numerica: true },
              { rotulo: 'Desmarques', numerica: true },
            ]}
            linhas={linhas.map((linha) => ({
              chave: `${linha.nome}-${String(linha.outros ?? 0)}`,
              celulas: [rotulo(linha), formatarContagem(linha.sessoes), formatarContagem(linha.faltas), formatarContagem(linha.desmarques)],
            }))}
          />
        </>
      )}
    </QuadroDoGrafico>
  )
}
