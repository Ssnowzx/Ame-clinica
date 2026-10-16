import { CalendarPlus } from 'lucide-react'
import { Link, Navigate, useLocation } from 'react-router-dom'

import type { LinhaDaEquipe, PainelDaEquipe } from '@/tipos'

import { BlocoAtendimentos } from '@/componentes/indicadores/bloco-atendimentos'
import { BlocoProfissionais } from '@/componentes/indicadores/bloco-profissionais'
import { CartaoDoIndicador, DefinicaoDoIndicador } from '@/componentes/indicadores/cartao-do-indicador'
import { QuadroVazio, SemHistoricoNaAba } from '@/componentes/indicadores/estados-da-aba'
import { QuadroDoGrafico } from '@/componentes/indicadores/graficos-do-painel'
import { BarraDePercentual } from '@/componentes/indicadores/graficos'
import {
  EsqueletoDaAba,
  GradeDeCartoes,
  QuadroPendente,
  type EsqueletoDeCartao,
} from '@/componentes/indicadores/moldura-dos-indicadores'
import { useMesDosIndicadores } from '@/componentes/indicadores/periodo-dos-indicadores'
import { LinhaDoPeriodo } from '@/componentes/indicadores/linha-do-periodo'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { FolhaImpressa } from '@/componentes/ui/folha-impressa'
import { RoladorHorizontal } from '@/componentes/ui/rolador-horizontal'
import { Tabela } from '@/componentes/ui/tabela'
import {
  DEFINICAO_DA_CAPACIDADE,
  DEFINICAO_DA_PRODUTIVIDADE,
  DEFINICAO_DAS_EVOLUCOES_EM_DIA,
  definicaoDasEvolucoesAtrasadas,
} from '@/lib/indicadores/definicoes'
import {
  compararTaxa,
  formatarTaxa,
  fraseDoCartaoDeAtrasadas,
  intervaloEmPalavras,
  mesAntesDoHistorico,
  plural,
  taxaOuSemDados,
} from '@/lib/indicadores/frases'
import { usePainelDaEquipe } from '@/lib/indicadores/paineis'
import { rotuloDoMes } from '@/lib/meses'
import { formatarContagem } from '@/lib/numeros'
import { useAuthStore } from '@/stores/auth-store'

/** Os três cartões; a porta das atrasadas só aparece a quem abre as evoluções. */
function cartoesDaEquipe(permissoes: readonly string[] | undefined): readonly EsqueletoDeCartao[] {
  return [
    { rotulo: 'Evoluções em dia', linhasDaFrase: [4, 3, 2] },
    { rotulo: 'Evoluções atrasadas', linhasDaFrase: [4, 3, 2], comPorta: permissoes?.includes('evolucoes.ver') === true },
    { rotulo: 'Sem grade', linhasDaFrase: [4, 3, 2] },
  ]
}

/** A grandeza que é uma FOTO do momento: no lugar da comparação, esta linha neutra (DQ-05). */
const DE_HOJE = 'situação de hoje'

/**
 * O link antigo da aba Produtividade (`/indicadores/produtividade?mes=…`) leva à Equipe do MESMO
 * mês: link copiado em mensagem não pode virar tela errada. O detalhe de um profissional
 * (`/indicadores/produtividade/:id`) continua onde está — ele é porta, não aba.
 */
export function RedirecionarParaEquipe() {
  const { search } = useLocation()

  return <Navigate to={`/indicadores/equipe${search}`} replace />
}

/**
 * A aba EQUIPE (change indicadores-profissionais; era "Produtividade"): por profissional, a
 * ocupação, as sessões realizadas, as faltas e as evoluções em dia ou atrasadas — e, abaixo, a
 * produção do mês e os atendimentos por especialidade, que saíram da Visão geral.
 *
 * O profissional SEM GRADE (sem horário ou sem especialidade) aparece como PENDÊNCIA, com o caminho para o cadastro, e
 * nunca como uma linha de zeros: sem grade não existe ocupação, e 0% seria mentira. A profissional
 * escopada (D11) recebe do servidor só a própria linha.
 */
export function PaginaIndicadoresEquipe() {
  const mes = useMesDosIndicadores()
  const consulta = usePainelDaEquipe(mes)
  const permissoes = useAuthStore((estado) => estado.usuario?.permissoes)

  return (
    <FolhaImpressa titulo="Indicadores — equipe" periodo={rotuloDoMes(mes)}>
      <div className="@container flex flex-col gap-5">
        {consulta.isPending ? (
          <EsqueletoDaAba titulo="Equipe no mês" cartoes={cartoesDaEquipe(permissoes)} quadros={0} />
        ) : null}

        {consulta.isError ? (
          <EstadoErro
            mensagem="Não foi possível carregar os números da equipe."
            aoTentarNovamente={() => void consulta.refetch()}
          />
        ) : null}

        {consulta.isSuccess && mesAntesDoHistorico(consulta.data) ? <SemHistoricoNaAba base={consulta.data} /> : null}
        {consulta.isSuccess && !mesAntesDoHistorico(consulta.data) ? <TopoDaEquipe painel={consulta.data} /> : null}

        {/* a ordem das abas de detalhe (CR-IND-03): período → cartões → GRÁFICOS → tabelas. Os
            atendimentos por especialidade e convênio vêm de outra vista (sob `atendimentos.ver`, que
            a aba já exige), com os quatro estados dela */}
        <BlocoAtendimentos mes={mes} />

        {consulta.isPending ? <QuadroPendente titulo="Por profissional" altura="h-48" /> : null}
        {consulta.isSuccess && !mesAntesDoHistorico(consulta.data) ? <PorProfissional painel={consulta.data} mes={mes} /> : null}

        <BlocoProfissionais mes={mes} />
      </div>
    </FolhaImpressa>
  )
}

/** A linha do período e os três cartões — a parte de cima, que vem do painel da equipe. */
function TopoDaEquipe({ painel }: { painel: PainelDaEquipe }) {
  return (
    <>
      <LinhaDoPeriodo base={painel} />
      <CartoesDaEquipe painel={painel} />
    </>
  )
}

/**
 * Os três cartões, com a MESMA anatomia (DQ-05): número, legenda, a linha de baixo (a comparação nas
 * evoluções em dia; "situação de hoje" nas outras duas, que são fotos do momento) e a frase.
 */
function CartoesDaEquipe({ painel }: { painel: PainelDaEquipe }) {
  const permissoes = useAuthStore((estado) => estado.usuario?.permissoes)
  const podeAbrirEvolucoes = permissoes?.includes('evolucoes.ver') === true
  const { evolucoes, periodo } = painel
  const semGrade = painel.profissionais.filter((linha) => !linha.tem_grade).length

  return (
    <GradeDeCartoes quantidade={3}>
      <CartaoDoIndicador
        rotulo="Evoluções em dia"
        valor={evolucoes.em_dia.atual === null ? null : formatarTaxa(evolucoes.em_dia.atual)}
        legenda="das sessões realizadas"
        comparacao={compararTaxa(evolucoes.em_dia.atual, evolucoes.em_dia.anterior, periodo, 'subir-e-bom')}
        frase={[{ texto: 'Das sessões realizadas no período, as que já têm a evolução escrita.' }]}
        definicao={DEFINICAO_DAS_EVOLUCOES_EM_DIA}
      />
      <CartaoDoIndicador
        rotulo="Evoluções atrasadas"
        valor={formatarContagem(evolucoes.atrasadas)}
        legenda={`${evolucoes.atrasadas === 1 ? 'passou' : 'passaram'} do prazo de ${plural(evolucoes.prazo_dias, 'dia', 'dias')}`}
        contexto={DE_HOJE}
        frase={fraseDoCartaoDeAtrasadas(painel)}
        definicao={definicaoDasEvolucoesAtrasadas(painel)}
        // a porta vale enquanto houver evolução por escrever, mesmo dentro do prazo
        porta={podeAbrirEvolucoes && evolucoes.sem_evolucao > 0 ? { para: '/evolucoes', rotulo: 'Abrir as evoluções' } : undefined}
      />
      <CartaoDoIndicador
        rotulo="Sem grade"
        valor={formatarContagem(semGrade)}
        legenda={semGrade === 1 ? 'profissional sem grade' : 'profissionais sem grade'}
        contexto={DE_HOJE}
        frase={[
          {
            texto:
              semGrade === 0
                ? 'Todos os profissionais com sessão têm horário e especialidade cadastrados.'
                : 'Falta horário ou especialidade no cadastro: ficam fora da ocupação até isso ser resolvido.',
          },
        ]}
        definicao={DEFINICAO_DA_CAPACIDADE}
      />
    </GradeDeCartoes>
  )
}

/**
 * A JANELA da tabela, em palavras (CR-IND-03): "Por profissional" conta o PERÍODO da comparação —
 * no mês em curso, só até hoje —, e a "Produção do mês", logo abaixo, o mês inteiro. Sem dizer, os
 * dois números do mesmo profissional pareciam brigar.
 */
function janelaDoPeriodo(painel: PainelDaEquipe): string {
  const { de, ate, parcial } = painel.periodo
  const intervalo = intervaloEmPalavras(de, ate, ate.slice(0, 4))

  return parcial ? `De ${intervalo}, até hoje` : `Em ${intervalo}`
}

/**
 * A tabela POR PROFISSIONAL — o centro da aba. O nome é porta para o detalhe da produtividade dele
 * (a semana, a perda, a capacidade em horas), no mesmo mês.
 */
function PorProfissional({ painel, mes }: { painel: PainelDaEquipe; mes: string }) {
  const permissoes = useAuthStore((estado) => estado.usuario?.permissoes)
  const vinculo = useAuthStore((estado) => estado.usuario?.profissional_id ?? null)
  const podeCadastrarHorario = permissoes?.includes('profissionais.editar') === true
  // a ficha (o painel do mês) abre para `profissionais.ver` ou para o PRÓPRIO — a mesma régua da rota
  const podeAbrirOPainel = (id: number): boolean => permissoes?.includes('profissionais.ver') === true || vinculo === id

  return (
    <QuadroDoGrafico
      id="equipe-por-profissional"
      titulo="Por profissional"
      subtitulo={`${janelaDoPeriodo(painel)}, em ordem de sessões realizadas. Clique no nome para ver o mês inteiro de cada um: a semana e onde a agenda não rendeu.`}
    >
      <DefinicoesDaTabela />

      {painel.profissionais.length === 0 ? (
        // vazio = ninguém VISÍVEL no seu recorte teve sessão: quem vê só a própria agenda recebe só a
        // própria linha (D11), e "nenhum profissional teve sessão" seria falso para a clínica (CR-IND-16)
        <QuadroVazio>
          Nenhum profissional visível para você teve sessão no período. Quem vê só a própria agenda vê só a própria linha.
        </QuadroVazio>
      ) : (
        <RoladorHorizontal rotulo="Equipe por profissional — role para ver as colunas">
          <Tabela legenda="Ocupação, sessões e evoluções por profissional no período" densidade="compacta" rolagem="externa">
            <Tabela.Cabecalho>
              <Tabela.Linha>
                <Tabela.CelulaCabecalho>Profissional</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho>Ocupação</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho className="text-right">Realizadas</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho className="text-right">Faltas</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho className="text-right">Evoluções em dia</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho className="text-right">Atrasadas</Tabela.CelulaCabecalho>
              </Tabela.Linha>
            </Tabela.Cabecalho>
            <Tabela.Corpo>
              {painel.profissionais.map((linha) => (
                <LinhaDoProfissional
                  key={linha.id}
                  linha={linha}
                  mes={mes}
                  podeCadastrarHorario={podeCadastrarHorario}
                  podeAbrirOPainel={podeAbrirOPainel(linha.id)}
                />
              ))}
            </Tabela.Corpo>
          </Tabela>
        </RoladorHorizontal>
      )}
    </QuadroDoGrafico>
  )
}

/** As duas palavras que a clínica mais pergunta, com a definição a um toque. */
function DefinicoesDaTabela() {
  return (
    <p data-nao-imprimir className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-texto-suave">
      <span className="inline-flex items-center gap-1">
        Capacidade
        <DefinicaoDoIndicador rotulo="Capacidade" definicao={DEFINICAO_DA_CAPACIDADE} />
      </span>
      <span className="inline-flex items-center gap-1">
        Produtividade
        <DefinicaoDoIndicador rotulo="Produtividade" definicao={DEFINICAO_DA_PRODUTIVIDADE} />
      </span>
    </p>
  )
}

/**
 * A OCUPAÇÃO de uma linha: a barra quando há grade; sem grade, a PENDÊNCIA — nunca um zero (sem grade
 * não existe ocupação) —, com o caminho para o cadastro a quem pode editar. "Sem grade" cobre os DOIS
 * casos que a tiram (CR-IND-14): sem horário, ou com horário e sem especialidade (sem o tempo de sessão
 * não há como dividir a grade em vagas). "Sem horário cadastrado" mentia para o segundo.
 */
function OcupacaoDoProfissional({ linha, podeCadastrarHorario }: { linha: LinhaDaEquipe; podeCadastrarHorario: boolean }) {
  if (linha.tem_grade) {
    // a barra recebe a porcentagem inteira, como na tela de produtividade (0–100)
    return <BarraDePercentual valor={linha.ocupacao === null ? null : Math.round(linha.ocupacao * 100)} />
  }

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta">
      <span className="inline-flex items-center gap-1 rounded-pilula bg-alerta-suave px-2 py-0.5 font-medium text-alerta-texto">
        <CalendarPlus aria-hidden="true" className="size-3.5" />
        Sem grade: falta horário ou especialidade
      </span>
      {podeCadastrarHorario ? (
        <Link
          data-nao-imprimir
          to={`/profissionais/${String(linha.id)}`}
          className="rounded-controle font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
        >
          Abrir o cadastro
        </Link>
      ) : null}
    </span>
  )
}

/**
 * Uma linha da tabela. A 1ª célula é o CABEÇALHO DA LINHA (`th scope="row"`, A11Y-IND-02): é ela que
 * dá nome às outras — sem isso, "Abrir o cadastro" e "80%" não diziam de quem eram para o leitor de
 * tela.
 */
function LinhaDoProfissional({
  linha,
  mes,
  podeCadastrarHorario,
  podeAbrirOPainel,
}: {
  linha: LinhaDaEquipe
  mes: string
  podeCadastrarHorario: boolean
  /** A porta do painel do profissional (change painel-do-profissional, D6) — só com a régua da ficha */
  podeAbrirOPainel: boolean
}) {
  return (
    <Tabela.Linha>
      <Tabela.CelulaCabecalho scope="row" pele="corpo">
        <span className="flex min-w-0 flex-col">
          <Link
            to={`/indicadores/produtividade/${String(linha.id)}?mes=${mes}`}
            className="w-fit rounded-controle font-medium text-texto underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
          >
            {linha.nome}
          </Link>
          {linha.especialidades.length === 0 ? null : (
            <span className="text-meta text-texto-suave">{linha.especialidades.join(' · ')}</span>
          )}
          {podeAbrirOPainel ? (
            <Link
              data-nao-imprimir
              to={`/profissionais/${String(linha.id)}?mes=${mes}`}
              className="w-fit rounded-controle text-meta font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
            >
              Abrir o painel <span className="sr-only">de {linha.nome}</span>
            </Link>
          ) : null}
        </span>
      </Tabela.CelulaCabecalho>
      <Tabela.Celula>
        <OcupacaoDoProfissional linha={linha} podeCadastrarHorario={podeCadastrarHorario} />
      </Tabela.Celula>
      <Tabela.Celula numerica>{formatarContagem(linha.realizadas)}</Tabela.Celula>
      <Tabela.Celula numerica>{formatarContagem(linha.faltas)}</Tabela.Celula>
      <Tabela.Celula numerica>{taxaOuSemDados(linha.evolucoes_em_dia)}</Tabela.Celula>
      <Tabela.Celula numerica>
        <span className={linha.evolucoes_atrasadas > 0 ? 'font-semibold text-perigo-texto' : undefined}>
          {formatarContagem(linha.evolucoes_atrasadas)}
        </span>
      </Tabela.Celula>
    </Tabela.Linha>
  )
}
