import type { FatiaDoRecebido, VozDaFicha } from '@/lib/indicadores/frases-do-profissional'
import type { BaseDoPainel, FinanceiroDoProfissional, MesDaSerieDoProfissional } from '@/tipos'

import { CartaoDoIndicador } from '@/componentes/indicadores/cartao-do-indicador'
import { QuadroVazio } from '@/componentes/indicadores/estados-da-aba'
import { BarrasComDestaque, EquivalenteEmTabela, LegendaDoDestaque, QuadroDoGrafico } from '@/componentes/indicadores/graficos-do-painel'
import { GradeDeCartoes, ParDeQuadros } from '@/componentes/indicadores/moldura-dos-indicadores'
import { QuadroDaSerie, type PontoDaSerie } from '@/componentes/profissionais/painel/quadro-da-serie'
import { SecaoDoPainel } from '@/componentes/profissionais/painel/secao-do-painel'
import { Tabela } from '@/componentes/ui/tabela'
import { dataLegivel } from '@/lib/datas'
import { formatarBRL } from '@/lib/dinheiro'
import { DEFINICAO_DO_RECEBIDO_DO_PROFISSIONAL, DEFINICAO_DO_SEM_PAGAMENTO } from '@/lib/indicadores/definicoes'
import { compararMoeda, formatarMoeda, formatarMoedaCompacta } from '@/lib/indicadores/frases'
import {
  diaDeHojeDoPeriodo,
  fraseDaBaseDoFinanceiro,
  tituloDaMaiorParteDoRecebido,
  tituloDaTendenciaDoRecebidoDoProfissional,
  tituloDoSemPagamento,
} from '@/lib/indicadores/frases-do-profissional'
import { formatarContagem } from '@/lib/numeros'

/**
 * O FINANCEIRO DO PROFISSIONAL (D4/D5) — só quando a chave `financeiro` vem: o pago no caixa da clínica
 * pelos atendimentos DELE. A base vai escrita logo abaixo do título, sempre (spec profissionais-tela):
 * convênio de plano não passa pelo caixa e não aparece (§14).
 *
 * É LEITURA PURA: nenhum botão de lançar, cobrar ou dar baixa — nem na lista das sessões sem pagamento.
 * A cobrança continua com quem tem as permissões do financeiro. E nada aqui soma o que o servidor não
 * mandou: sem total da clínica, sem outro profissional, sem "Sem profissional".
 */
export function FinanceiroDaFicha({
  financeiro,
  base,
  serie,
  voz,
}: {
  financeiro: FinanceiroDoProfissional
  base: BaseDoPainel
  serie?: readonly MesDaSerieDoProfissional[]
  voz: VozDaFicha
}) {
  const comSerie = serie !== undefined && serie.some((mes) => mes.recebido !== undefined)
  // o servidor já NOMEIA "Sem forma de pagamento" e "Sem convênio": nada a completar aqui
  const porForma = financeiro.por_forma.map((linha) => ({ rotulo: linha.forma, valor: linha.valor }))
  const porConvenio = financeiro.por_convenio.map((linha) => ({ rotulo: linha.convenio, valor: linha.valor }))

  return (
    <SecaoDoPainel id="painel-financeiro" titulo="Financeiro" subtitulo={fraseDaBaseDoFinanceiro(voz)}>
      <CartoesDoFinanceiro financeiro={financeiro} base={base} />

      {comSerie ? (
        <QuadroDaSerie
          id="painel-serie-recebido"
          titulo={tituloDaTendenciaDoRecebidoDoProfissional(financeiro.recebido, base)}
          subtitulo="Recebido no caixa por mês, em reais"
          pontos={pontosDoRecebido(serie)}
          coluna="Recebido"
          diaDeHoje={diaDeHojeDoPeriodo(base)}
          vazio="Nenhum pagamento recebido nos seis meses."
        />
      ) : null}

      <ParDeQuadros>
        <QuebraDoRecebido id="painel-recebido-por-forma" subtitulo="Recebido no período, por forma de pagamento" coluna="Forma de pagamento" fatias={porForma} />
        <QuebraDoRecebido id="painel-recebido-por-convenio" subtitulo="Recebido no período, por convênio" coluna="Convênio" fatias={porConvenio} />
      </ParDeQuadros>

      <SessoesSemPagamento semPagamento={financeiro.sem_pagamento} />
    </SecaoDoPainel>
  )
}

/** O recebido no mês, comparado, e quantas sessões realizadas ainda esperam pagamento. */
function CartoesDoFinanceiro({ financeiro, base }: { financeiro: FinanceiroDoProfissional; base: BaseDoPainel }) {
  return (
    <GradeDeCartoes quantidade={2}>
      <CartaoDoIndicador
        rotulo="Recebido"
        valor={formatarMoeda(financeiro.recebido.atual)}
        legenda="no caixa da clínica, pela data do pagamento"
        comparacao={compararMoeda(financeiro.recebido, base.periodo, 'subir-e-bom')}
        definicao={DEFINICAO_DO_RECEBIDO_DO_PROFISSIONAL}
      />
      <CartaoDoIndicador
        rotulo="Sessões sem pagamento"
        valor={formatarContagem(financeiro.sem_pagamento.quantidade)}
        legenda="realizadas no mês, ainda sem pagamento"
        contexto="situação de hoje"
        definicao={DEFINICAO_DO_SEM_PAGAMENTO}
      />
    </GradeDeCartoes>
  )
}

/** A série do recebido: o valor em reais SÓ dimensiona a coluna; o escrito vem dos formatadores únicos. */
function pontosDoRecebido(serie: readonly MesDaSerieDoProfissional[]): PontoDaSerie[] {
  return serie.map((mes) => {
    const valor = mes.sem_dados ? null : (mes.recebido ?? null)

    return {
      mes: mes.mes,
      parcial: mes.parcial,
      medida: valor === null ? null : Number(valor),
      rotulo: valor === null ? '' : formatarMoedaCompacta(valor, { semSimbolo: true }),
      exato: valor === null ? '' : formatarBRL(valor),
    }
  })
}

/** Uma quebra do recebido em barras, a maior fatia em destaque — com a tabela equivalente. */
function QuebraDoRecebido({
  id,
  subtitulo,
  coluna,
  fatias,
}: {
  id: string
  subtitulo: string
  coluna: string
  fatias: readonly FatiaDoRecebido[]
}) {
  const maior = Math.max(0, ...fatias.map((fatia) => Number(fatia.valor)))

  return (
    <QuadroDoGrafico id={id} titulo={tituloDaMaiorParteDoRecebido(fatias)} subtitulo={subtitulo}>
      {maior <= 0 ? (
        <QuadroVazio>Nenhum pagamento recebido no período.</QuadroVazio>
      ) : (
        <>
          <BarrasComDestaque
            barras={fatias.map((fatia) => ({
              chave: fatia.rotulo,
              rotulo: fatia.rotulo,
              // o número SÓ dimensiona a barra; o valor escrito é o BRL exato
              proporcao: (Number(fatia.valor) / maior) * 100,
              valor: formatarMoeda(fatia.valor),
              destaque: Number(fatia.valor) === maior,
            }))}
          />
          <LegendaDoDestaque>A maior parte do recebido</LegendaDoDestaque>
        </>
      )}
      <EquivalenteEmTabela
        legenda={subtitulo}
        colunas={[{ rotulo: coluna }, { rotulo: 'Recebido', numerica: true }]}
        linhas={fatias.map((fatia) => ({ chave: fatia.rotulo, celulas: [fatia.rotulo, formatarBRL(fatia.valor)] }))}
      />
    </QuadroDoGrafico>
  )
}

/**
 * As sessões realizadas ainda sem pagamento — SÓ LEITURA: a cobrança fica com o financeiro da clínica. A
 * lista (a data e a criança de cada uma) só vem para quem vê a agenda; sem ela, o servidor manda só a
 * quantidade, e o bloco diz por quê — nunca uma lista vazia, que seria lida como "nenhuma".
 */
function SessoesSemPagamento({ semPagamento }: { semPagamento: FinanceiroDoProfissional['sem_pagamento'] }) {
  const { quantidade, itens } = semPagamento

  return (
    <section
      aria-labelledby="painel-sem-pagamento"
      className="flex min-w-0 flex-col gap-3 rounded-superficie border border-linha bg-superficie p-5 shadow-e1 print:break-inside-avoid print:shadow-none"
    >
      <div className="flex flex-col gap-1">
        <h3 id="painel-sem-pagamento" className="text-pretty text-subtitulo font-semibold text-texto">
          {tituloDoSemPagamento(quantidade)}
        </h3>
        <p className="text-pretty text-meta text-texto-suave">Só leitura: a cobrança da família fica com o financeiro da clínica.</p>
      </div>
      {itens === undefined ? (
        quantidade === 0 ? null : (
          <p className="text-pretty text-corpo text-texto-suave">A lista, com a data e a criança de cada sessão, aparece para quem vê a agenda.</p>
        )
      ) : (
        <ListaDoSemPagamento itens={itens} quantidade={quantidade} />
      )}
    </section>
  )
}

type ItensDoSemPagamento = NonNullable<FinanceiroDoProfissional['sem_pagamento']['itens']>

/** A lista nominal, com o teto DECLARADO: o servidor pode mandar menos itens do que conta. */
function ListaDoSemPagamento({ itens, quantidade }: { itens: ItensDoSemPagamento; quantidade: number }) {
  return (
    <>
      {itens.length === 0 ? null : (
        <Tabela legenda="Sessões realizadas no mês ainda sem pagamento" densidade="compacta">
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho>Data</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Criança</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho className="text-right">Valor</Tabela.CelulaCabecalho>
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {itens.map((item) => (
              <Tabela.Linha key={item.atendimento_id}>
                <Tabela.Celula className="tabular-nums">{dataLegivel(item.data)}</Tabela.Celula>
                <Tabela.Celula>{item.paciente}</Tabela.Celula>
                <Tabela.Celula numerica>{item.valor === null ? 'sem valor na tabela' : formatarBRL(item.valor)}</Tabela.Celula>
              </Tabela.Linha>
            ))}
          </Tabela.Corpo>
        </Tabela>
      )}
      {itens.length < quantidade ? (
        <p className="text-meta text-texto-suave">
          Mostrando {formatarContagem(itens.length)} de {formatarContagem(quantidade)} sessões.
        </p>
      ) : null}
    </>
  )
}
