import { FileSpreadsheet, Printer, TriangleAlert } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import { TabelaDeRelatorio } from '@/componentes/relatorios/tabela-de-relatorio'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { usarPlanilhaDoRelatorio } from '@/hooks/usar-planilha-do-relatorio'
import { formatarContagem } from '@/lib/numeros'
import { formatarCelula } from '@/lib/relatorios/formatacao'
import { periodoDoEnvelope } from '@/lib/relatorios/periodo'
import type { ColunaDeRelatorio, EnvelopeDeRelatorio, ParametrosDeRelatorio, TotaisDeRelatorio } from '@/tipos'

export interface ResultadoDoRelatorioProps {
  envelope: EnvelopeDeRelatorio
  /** O vazio oferece a saída: tirar os filtros e manter o período. */
  aoLimparFiltros: () => void
  /**
   * Há filtro que dá para tirar? Quem sabe é a página (pelos parâmetros): o cabeçalho do envelope
   * traz também linhas que não são filtro (a "Base" do recebido). Sem a prop, vale o cabeçalho.
   */
  podeLimparFiltros?: boolean
  /**
   * O que fazer a respeito dos avisos — ex.: "Vincular pagamentos" ao lado de "N pagamentos sem
   * profissional". Quem decide se existe (relatório e permissões) é a página; fica fora do papel.
   */
  acaoDosAvisos?: ReactNode
  /**
   * O recorte que a TELA consultou — a planilha é o mesmo relatório, pelos mesmos parâmetros
   * (change `relatorio-em-planilha`). Sem ele, o botão não aparece.
   */
  parametrosDaPlanilha?: ParametrosDeRelatorio
}

/**
 * Linhas do cabeçalho que DESCREVEM o papel e não recortam nada: a base da data, de quem são as
 * baixas, por onde o sintético dividiu. Ficam no cabeçalho, mas não entram na frase do vazio —
 * "nenhum registro com base pela data do pagamento" não diz o que tirar para achar algo.
 */
const ROTULOS_QUE_NAO_SAO_FILTRO = new Set(['Base', 'Baixas', 'Dividido por'])

/**
 * O resultado de um relatório — o que vai ao PAPEL: contagem e período por extenso, os
 * filtros aplicados (o cabeçalho diz de que recorte a folha é), o aviso de corte, e as
 * tabelas: uma só, ou um bloco por grupo com o total próprio e o total geral no fim.
 */
export function ResultadoDoRelatorio({
  envelope,
  aoLimparFiltros,
  podeLimparFiltros,
  acaoDosAvisos,
  parametrosDaPlanilha,
}: ResultadoDoRelatorioProps) {
  const periodo = periodoDoEnvelope(envelope)
  const planilha = usarPlanilhaDoRelatorio(envelope.slug, parametrosDaPlanilha ?? {})
  const idBase = useId()
  const temFiltros = envelope.filtros_aplicados.length > 0
  const recortes = envelope.filtros_aplicados.filter((filtro) => !ROTULOS_QUE_NAO_SAO_FILTRO.has(filtro.rotulo))
  // Sintético "puro": grupos SEM linhas (só totais) — é UMA tabela com uma linha por grupo,
  // não um bloco por grupo com uma tabela de rodapé só (conferido ao vivo: "Em Aberto" virava
  // um título, uma tabela sem corpo e um total — três coisas para dizer um número).
  const grupos = envelope.grupos
  const sinteticoPuro = grupos !== null && grupos.length > 0 && grupos.every((grupo) => grupo.linhas.length === 0)
  const rotuloDaContagem = sinteticoPuro
    ? envelope.contagem === 1
      ? 'grupo'
      : 'grupos'
    : envelope.contagem === 1
      ? 'linha'
      : 'linhas'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-corpo text-texto">
            <span className="font-semibold">
              {formatarContagem(envelope.contagem)} {rotuloDaContagem}
            </span>
            {periodo !== null ? <span className="text-texto-suave"> · {periodo}</span> : null}
          </p>
          {temFiltros ? (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-texto-suave">
              {envelope.filtros_aplicados.map((filtro) => (
                <div key={`${filtro.rotulo}-${filtro.valor}`} className="flex gap-1">
                  <dt>{filtro.rotulo}:</dt>{' '}
                  <dd className="font-medium text-texto">{filtro.valor}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {envelope.contagem > 0 ? (
          <div data-nao-imprimir className="flex flex-wrap items-center gap-2">
            {parametrosDaPlanilha === undefined ? null : (
              <Botao
                data-nao-imprimir
                variante="secundario"
                tamanho="sm"
                carregando={planilha.baixando}
                onClick={() => {
                  void planilha.baixar()
                }}
              >
                <FileSpreadsheet aria-hidden="true" className="size-4" />
                Baixar planilha
              </Botao>
            )}
            <Botao
              data-nao-imprimir
              variante="secundario"
              tamanho="sm"
              onClick={() => {
                window.print()
              }}
            >
              <Printer aria-hidden="true" className="size-4" />
              Imprimir
            </Botao>
          </div>
        ) : null}
      </div>

      {planilha.erro === null ? null : (
        <div data-nao-imprimir>
          <AvisoErro mensagens={[planilha.erro]} />
        </div>
      )}

      {(envelope.avisos ?? []).map((aviso) => (
        <p
          key={aviso}
          role="status"
          className="flex items-start gap-2 rounded-superficie bg-alerta-suave px-4 py-3 text-corpo text-alerta-texto"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-2">
            <span>{aviso}</span>
            {acaoDosAvisos === undefined ? null : <span data-nao-imprimir>{acaoDosAvisos}</span>}
          </span>
        </p>
      ))}

      {envelope.truncado ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-superficie bg-alerta-suave px-4 py-3 text-corpo text-alerta-texto"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          O relatório foi cortado em {formatarContagem(envelope.contagem)} linhas — há mais registros neste
          recorte. Reduza o período ou use os filtros para ver tudo.
        </p>
      ) : null}

      {envelope.contagem === 0 ? (
        <EstadoVazio
          titulo={`Nenhum registro para ${periodo ?? 'este recorte'}${
            recortes.length > 0
              ? ` com ${recortes.map((filtro) => `${filtro.rotulo.toLowerCase()} ${filtro.valor}`).join(', ')}`
              : ''
          }.`}
          descricao="Amplie o período ou limpe os filtros."
          acao={
            (podeLimparFiltros ?? recortes.length > 0) ? (
              <Botao variante="secundario" onClick={aoLimparFiltros}>
                Gerar sem os filtros
              </Botao>
            ) : undefined
          }
        />
      ) : sinteticoPuro && grupos !== null ? (
        <TabelaDeRelatorio
          colunas={envelope.colunas}
          // a primeira coluna declarada é o rótulo do grupo; as demais vêm dos totais do grupo
          linhas={grupos.map((grupo) => ({ ...grupo.totais, [envelope.colunas[0]?.chave ?? 'grupo']: grupo.titulo }))}
          totais={envelope.totais}
          legenda={`${envelope.titulo}: ${formatarContagem(grupos.length)} grupos`}
          rotuloDoTotal="Total geral"
        />
      ) : grupos !== null ? (
        <div className="flex flex-col gap-6">
          {grupos.map((grupo, indice) => (
            <section key={`${indice}-${grupo.titulo}`} aria-labelledby={`${idBase}-grupo-${indice}`} className="flex flex-col gap-2">
              <h3 id={`${idBase}-grupo-${indice}`} className="text-subtitulo font-semibold text-texto">
                {grupo.titulo}
              </h3>
              <TabelaDeRelatorio
                colunas={envelope.colunas}
                linhas={grupo.linhas}
                totais={grupo.totais}
                legenda={`${envelope.titulo} — ${grupo.titulo}: ${formatarContagem(grupo.linhas.length)} linhas`}
                rotuloDoTotal={`Total de ${grupo.titulo}`}
              />
            </section>
          ))}
          <TotaisGerais colunas={envelope.colunas} totais={envelope.totais} />
        </div>
      ) : (
        <TabelaDeRelatorio
          colunas={envelope.colunas}
          linhas={envelope.linhas}
          totais={envelope.totais}
          legenda={`${envelope.titulo}: ${formatarContagem(envelope.contagem)} linhas`}
        />
      )}
    </div>
  )
}

/** O total geral do sintético com divisão — só as chaves que são colunas declaradas. */
function TotaisGerais({ colunas, totais }: { colunas: ColunaDeRelatorio[]; totais: TotaisDeRelatorio }) {
  const comTotal = colunas.filter((coluna) => coluna.chave in totais)
  if (comTotal.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2 rounded-superficie border border-linha bg-fundo px-4 py-3">
      <h3 className="text-subtitulo font-semibold text-texto">Total geral</h3>
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        {comTotal.map((coluna) => (
          <div key={coluna.chave} className="flex flex-col">
            <dt className="text-meta text-texto-suave">{coluna.rotulo}</dt>
            <dd className="text-corpo font-semibold tabular-nums text-texto">
              {formatarCelula(totais[coluna.chave] ?? null, coluna.tipo)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
