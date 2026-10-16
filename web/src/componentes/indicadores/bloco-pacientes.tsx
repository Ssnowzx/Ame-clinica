import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { QuadroVazio } from '@/componentes/indicadores/estados-da-aba'
import { Quebra } from '@/componentes/indicadores/graficos'
import { QuadroDoGrafico } from '@/componentes/indicadores/graficos-do-painel'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { ROTULOS_DE_SEXO } from '@/lib/pacientes'
import { buscarIndicadoresDePacientes } from '@/servicos/indicadores'
import { SEXOS, type IndicadoresDePacientes, type Sexo } from '@/tipos'

/**
 * QUEM SÃO os pacientes — as quebras demográficas da base (§11), na aba Pacientes (change
 * indicadores-profissionais: o bloco saiu da Visão geral). SÓ agregado: o bloco não lista, não nomeia
 * e não linka paciente (LGPD). As quebras são foto do momento da base ATIVA (só a Indicação "no mês"
 * acompanha o período); cada uma só aparece quando há base para quebrar.
 *
 * Os números de cima (ativos, novos, saíram) e a série de novos moram nos cartões e no gráfico da
 * aba, que vêm do painel com a comparação JUSTA — a variação antiga, tirada dos dois últimos meses
 * da série, punha o mês parcial contra o mês cheio da importação e lia "−387" como debandada.
 */
export function BlocoDemografiaDosPacientes({ mes }: { mes: string }) {
  const vista = useQuery({
    queryKey: chaves.indicadores('pacientes', mes),
    queryFn: () => buscarIndicadoresDePacientes(mes),
  })

  return (
    <QuadroDoGrafico
      id="demografia-dos-pacientes"
      titulo={vista.isSuccess ? tituloDaDemografia(vista.data) : 'Quem são os pacientes'}
      subtitulo="A base ativa hoje. Só a indicação dos novos acompanha o período."
    >
      {vista.isPending ? (
        <div aria-busy="true">
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {vista.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar as quebras dos pacientes."
          aoTentarNovamente={() => void vista.refetch()}
        />
      ) : null}

      {vista.isSuccess ? (
        // `@container`: o arranjo decide pela largura do QUADRO, não da janela — com a barra lateral
        // aberta, 768 px de janela são 452 px de quadro, e duas colunas transbordavam (DQA-PAC-01)
        <div className="@container">
          {temQuebras(vista.data) ? (
            <Demografia dados={vista.data} />
          ) : (
            <QuadroVazio>Nenhum paciente ativo para descrever.</QuadroVazio>
          )}
        </div>
      ) : null}
    </QuadroDoGrafico>
  )
}

/** O título-conclusão: a faixa etária com mais pacientes (a pergunta que a clínica faz primeiro). */
function tituloDaDemografia(dados: IndicadoresDePacientes): string {
  const faixas = dados.por_faixa_etaria.filter((linha) => linha.total > 0 && /^\d/.test(linha.faixa))
  if (faixas.length === 0) {
    return 'Quem são os pacientes'
  }
  const maior = faixas.reduce((atual, linha) => (linha.total > atual.total ? linha : atual))

  return `A faixa etária com mais pacientes é a de ${rotuloDaFaixa(maior.faixa)}`
}

/**
 * As quebras demográficas da base (§11). Cada uma só entra quando há dado — clínica
 * sem pacientes mostra só os KPIs, não quebras vazias. Nenhuma tem porta de drill:
 * o dado é agregado (a porta do bloco leva à lista de pacientes).
 *
 * Fluem em COLUNAS (CSS `columns`), e cada quebra é inteira numa coluna só (D1): as quebras vão de 3
 * a 9 linhas, e numa grade em linhas cada par abria um buraco do tamanho da diferença — "sexo" (3)
 * ao lado de "faixa etária" (8).
 *
 * No máximo DUAS colunas, e só quando o cartão comporta duas de 20rem (a linha de barra precisa de
 * ~288 px). Com cinco blocos indivisíveis, três colunas deixavam um vazio maior que uma quebra inteira
 * no pé de uma delas (gate DQA-PAC-02). A ordem é a que equilibra as duas pelas alturas medidas na
 * escala da produção (~60 px de diferença): sexo, faixa etária e indicação do mês | convênio e
 * indicação total.
 */
function Demografia({ dados }: { dados: IndicadoresDePacientes }) {
  const temFaixa = dados.por_faixa_etaria.some((linha) => linha.total > 0)

  return (
    // `-mb-6`: o espaço entre as quebras é o `pb-6` de cada uma (padding, não margem: no fluxo em
    // colunas o Safari leva a margem para o topo da coluna seguinte — DQA-PAC-03); a última o devolve.
    // `print:break-inside-avoid`: partido entre duas folhas, o Chrome joga o resto do fluxo numa
    // coluna FORA do papel, e "Por indicação (total)" sumia da impressão (DQA-PAC-R2-01). Inteiro, o
    // fluxo cabe numa folha — no papel são duas colunas, e cada quebra tem teto de linhas
    <div data-fluxo-em-colunas className="-mb-6 columns-1 gap-x-10 @min-[44rem]:columns-2 print:break-inside-avoid">
      {dados.por_sexo.length > 0 ? (
        <NaColuna>
          <Quebra
            destacarMaior
            titulo="Por sexo"
            linhas={dados.por_sexo.map((linha) => ({ chave: `sexo-${linha.sexo}`, rotulo: rotuloDoSexo(linha.sexo), total: linha.total }))}
          />
        </NaColuna>
      ) : null}

      {temFaixa ? (
        <NaColuna>
          <Quebra
            destacarMaior
            titulo="Por faixa etária"
            linhas={dados.por_faixa_etaria.map((linha) => ({ chave: `faixa-${linha.faixa}`, rotulo: rotuloDaFaixa(linha.faixa), total: linha.total }))}
          />
        </NaColuna>
      ) : null}

      {dados.por_indicacao.mensal.length > 0 ? (
        <NaColuna>
          <Quebra destacarMaior titulo="Por indicação (novos no mês)" linhas={linhasDeIndicacao(dados.por_indicacao.mensal, 'mensal')} />
        </NaColuna>
      ) : null}
      {dados.por_convenio.length > 0 ? (
        <NaColuna>
          <QuebraPorConvenio linhas={dados.por_convenio} />
        </NaColuna>
      ) : null}

      {dados.por_indicacao.total.length > 0 ? (
        <NaColuna>
          <Quebra destacarMaior titulo="Por indicação (total)" linhas={linhasDeIndicacao(dados.por_indicacao.total, 'total')} />
        </NaColuna>
      ) : null}
    </div>
  )
}

/** Pacientes distintos por convênio — com o aviso de que a soma não fecha a base (um paciente em vários). */
function QuebraPorConvenio({ linhas }: { linhas: IndicadoresDePacientes['por_convenio'] }) {
  return (
    <>
      <Quebra
        destacarMaior
        titulo="Por convênio"
        linhas={linhas.map((linha) => ({
          chave: `convenio-${linha.convenio.id}`,
          rotulo: linha.convenio.nome ?? '—',
          total: linha.total,
        }))}
      />
      {/* soma ≠ total: um paciente com pacotes em vários convênios conta em cada um */}
      <p className="mt-1.5 text-meta text-texto-suave">
        Conta por vínculo de tratamento — um paciente pode aparecer em mais de um convênio.
      </p>
    </>
  )
}

/** Uma quebra inteira numa coluna do fluxo — partida entre duas, o título ficaria longe das barras. */
function NaColuna({ children }: { children: ReactNode }) {
  return <div className="break-inside-avoid pb-6">{children}</div>
}

/** Há alguma quebra a mostrar? Sem nenhuma, o contêiner nem monta — não deixa espaço no pé (DQA-PAC-05). */
function temQuebras(dados: IndicadoresDePacientes): boolean {
  return (
    dados.por_sexo.length > 0
    || dados.por_faixa_etaria.some((linha) => linha.total > 0)
    || dados.por_convenio.length > 0
    || dados.por_indicacao.total.length > 0
    || dados.por_indicacao.mensal.length > 0
  )
}

/** O sexo pelo MESMO mapa do cadastro ("nao_informado" → "Não informado"); valor novo, legível. */
function rotuloDoSexo(sexo: string): string {
  return ehSexoConhecido(sexo) ? ROTULOS_DE_SEXO[sexo] : capitalizar(sexo.replaceAll('_', ' '))
}

function ehSexoConhecido(valor: string): valor is Sexo {
  return (SEXOS as readonly string[]).includes(valor)
}

/** A banda pelo nome legível: "18+" vira "18 anos ou mais"; a sem nascimento, "Não informado" (sem "anos"). */
function rotuloDaFaixa(faixa: string): string {
  if (faixa === '18+') {
    return '18 anos ou mais'
  }

  return /^\d/.test(faixa) ? `${faixa} anos` : capitalizar(faixa)
}

/** Linhas de uma quebra por indicação — `null` é "Não informado"; `prefixo` isola a chave entre as duas vistas. */
function linhasDeIndicacao(itens: Array<{ indicacao: string | null; total: number }>, prefixo: string) {
  return itens.map((linha) => ({
    chave: linha.indicacao === null ? `${prefixo}-indicacao-sem` : `${prefixo}-indicacao-${linha.indicacao}`,
    rotulo: linha.indicacao ?? 'Não informado',
    total: linha.total,
  }))
}

/** Primeira letra maiúscula — o cadastro guarda o sexo em minúsculas ('feminino'). */
function capitalizar(texto: string): string {
  return texto.length === 0 ? texto : texto.charAt(0).toUpperCase() + texto.slice(1)
}
