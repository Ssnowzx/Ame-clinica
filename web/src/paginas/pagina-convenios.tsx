import { Link } from 'react-router-dom'

import { TelaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { chaves } from '@/lib/chaves-query'
import { convenios, type PayloadConvenio } from '@/servicos/catalogos-de-apoio'
import type { Convenio, TipoDeCorteDoCiclo } from '@/tipos'

/**
 * `flags_tiss_json` NÃO entra: é `array` sem shape nem teto na API, e um editor
 * livre de JSON seria porta para dado de paciente entrar — que a auditoria
 * copiaria para uma trilha append-only sem caminho de exclusão (parecer SEC-CA-04).
 */
const CAMPOS = new Set([
  'nome',
  'registro_ans',
  'codigo_operadora',
  'versao_tiss',
  'guia_sequencial',
  'alerta_agend_mesmo_dia',
  'particular',
  'pedido_validade_meses',
  'ciclo_tipo_corte',
  'ciclo_dia_corte',
  'ativo',
])

/**
 * O domínio do corte é FECHADO (§13 — o enum é do banco). Estreitar por VERIFICAÇÃO,
 * nunca por assertion: o valor vem de um `evento.target.value`, string crua do DOM. O
 * `''` é o outro estado legal — "sem fechamento", que apaga o calendário.
 */
function tipoDeCorteValido(valor: string): valor is TipoDeCorteDoCiclo {
  return valor === 'dia_fixo' || valor === 'ultimo_dia'
}

interface Valores {
  nome: string
  registro_ans: string
  codigo_operadora: string
  versao_tiss: string
  guia_sequencial: boolean
  alerta_agend_mesmo_dia: boolean
  particular: boolean
  pedido_validade_meses: string
  /** `''` = este convênio não tem fechamento (fail-safe: nada é congelado) */
  ciclo_tipo_corte: TipoDeCorteDoCiclo | ''
  ciclo_dia_corte: string
  ativo: boolean
}

/**
 * Convênios da clínica — **cadastro e preço, nunca esteira de convênio**.
 *
 * Os campos de integração (ANS, código da operadora, versão TISS) são
 * **armazenamento dormente** (§14): eles existem porque o sistema irmão
 * `gestao_de_convenios` vai precisar deles. Esta tela — e este sistema — NÃO
 * geram guia, não enviam TISS, não faturam e não conferem glosa. Cruzar essa
 * fronteira exige ADR aprovado.
 */
export function PaginaConvenios() {
  return (
    <TelaDeCatalogo<Convenio, PayloadConvenio, Valores>
      titulo="Convênios"
      modulo="convenios"
      rotuloSingular="convênio"
      genero="m"
      chave={chaves.convenios()}
      listar={convenios.listar}
      recurso={convenios}
      campos={CAMPOS}
      colunas={[
        {
          cabecalho: 'Convênio',
          celula: (convenio) => (
            <Link
              to={`/convenios/${convenio.id}`}
              className="text-corpo font-medium text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
            >
              {convenio.nome}
            </Link>
          ),
        },
        {
          cabecalho: 'Tipo',
          celula: (convenio) => (convenio.particular ? 'Particular' : 'Convênio'),
        },
        {
          cabecalho: 'Registro ANS',
          celula: (convenio) => convenio.registro_ans ?? '—',
        },
        {
          cabecalho: 'Situação',
          celula: (convenio) => (convenio.ativo ? 'Ativo' : 'Inativo'),
        },
      ]}
      valoresIniciais={(convenio) => ({
        nome: convenio?.nome ?? '',
        registro_ans: convenio?.registro_ans ?? '',
        codigo_operadora: convenio?.codigo_operadora ?? '',
        versao_tiss: convenio?.versao_tiss ?? '',
        guia_sequencial: convenio?.guia_sequencial ?? false,
        alerta_agend_mesmo_dia: convenio?.alerta_agend_mesmo_dia ?? false,
        // LER do registro, nunca inventar: mandar `false` fixo apagava a flag que
        // decide o destino do dinheiro, na edição mais banal que existe
        particular: convenio?.particular ?? false,
        pedido_validade_meses:
          convenio?.pedido_validade_meses === null || convenio?.pedido_validade_meses === undefined
            ? ''
            : String(convenio.pedido_validade_meses),
        // LER do registro, como a `particular`: mandar vazio "porque o campo é novo"
        // apagaria o calendário do convênio na primeira edição de nome — e apagar
        // calendário é destravar produção já enviada (SEC-FC-18)
        ciclo_tipo_corte: convenio?.ciclo_tipo_corte ?? '',
        ciclo_dia_corte:
          convenio?.ciclo_dia_corte === null || convenio?.ciclo_dia_corte === undefined
            ? ''
            : String(convenio.ciclo_dia_corte),
        ativo: convenio?.ativo ?? true,
      })}
      paraPayload={(valores) => ({
        nome: valores.nome,
        ciclo_tipo_corte: valores.ciclo_tipo_corte === '' ? null : valores.ciclo_tipo_corte,
        // O dia só existe para `dia_fixo`. Em `ultimo_dia` — e sem fechamento — ele vai
        // `null`: um dia guardado que regra nenhuma lê é a próxima pessoa a acreditar
        // que o convênio fecha no dia 15 quando ele fecha no fim do mês.
        ciclo_dia_corte:
          valores.ciclo_tipo_corte === 'dia_fixo' && valores.ciclo_dia_corte !== ''
            ? Number(valores.ciclo_dia_corte)
            : null,
        registro_ans: valores.registro_ans === '' ? null : valores.registro_ans,
        codigo_operadora: valores.codigo_operadora === '' ? null : valores.codigo_operadora,
        versao_tiss: valores.versao_tiss === '' ? null : valores.versao_tiss,
        guia_sequencial: valores.guia_sequencial,
        alerta_agend_mesmo_dia: valores.alerta_agend_mesmo_dia,
        particular: valores.particular,
        pedido_validade_meses:
          valores.pedido_validade_meses === '' ? null : Number(valores.pedido_validade_meses),
        ativo: valores.ativo,
      })}
      nomeDoRegistro={(convenio) => convenio.nome}
      // `particular` NÃO é preferência: o `FaturamentoService` a relê a cada
      // lançamento. Desligá-la num convênio com tratamentos vivos faz o caixa
      // RECUSAR os lançamentos deles; ligá-la joga tratamentos de plano no caixa.
      consequenciasDaRegra={(valores, original) => {
        if (original === undefined || valores.particular === original.particular) {
          return []
        }
        return [
          valores.particular
            ? `Os tratamentos de "${original.nome}" passam a ser lançados no caixa. Os lançamentos já feitos não mudam.`
            : `Os tratamentos de "${original.nome}" deixam de ser lançados no caixa — o caixa vai RECUSAR os próximos lançamentos deles, porque o faturamento de convênio é feito fora do Ame Clínica. Os lançamentos já feitos não mudam.`,
        ]
      }}
      consequenciaDaExclusao="Um convênio com serviços cadastrados ou tratamentos vinculados não pode ser excluído — nesse caso, desative-o."
      vazioTitulo="Nenhum convênio cadastrado"
      vazioDescricao="O convênio e a tabela de preços dele: é o que o tratamento e o financeiro referenciam."
      formulario={({ valores, definir, erros }) => (
        <>
          <CampoTexto
            rotulo="Nome"
            obrigatorio
            value={valores.nome}
            onChange={(evento) => {
              definir({ nome: evento.target.value })
            }}
            erro={erros.campos.get('nome')}
          />

          {/* REGRA, não decoração: é ela que decide se o tratamento vira lançamento
              no caixa (§14 — o faturamento de plano é do sistema irmão) */}
          <CampoCheckbox
            rotulo="Atendimento particular"
            marcado={valores.particular}
            aoMudar={(marcado) => {
              definir({ particular: marcado })
            }}
            ajuda="Particular: o tratamento deste convênio é lançado no caixa. Convênio de plano: o faturamento é feito fora do Ame Clínica."
          />

          <CampoCheckbox
            rotulo="Alertar agendamento no mesmo dia"
            marcado={valores.alerta_agend_mesmo_dia}
            aoMudar={(marcado) => {
              definir({ alerta_agend_mesmo_dia: marcado })
            }}
            ajuda="Alguns convênios não pagam dois atendimentos do mesmo paciente no mesmo dia."
          />

          {/* REGRA do pedido médico (D4): a validade é DADO por operadora — o vencimento
              de cada pedido é derivado no servidor, nunca uma coluna nem uma conta da tela */}
          <CampoTexto
            rotulo="Validade do pedido médico (meses)"
            type="number"
            min={1}
            max={36}
            value={valores.pedido_validade_meses}
            onChange={(evento) => {
              definir({ pedido_validade_meses: evento.target.value })
            }}
            ajuda="Prazo que o convênio dá ao pedido médico (ex.: 6 meses; SC Saúde, 3). Sem valor, o sistema não acompanha o vencimento dos pedidos deste convênio."
            erro={erros.campos.get('pedido_validade_meses')}
          />

          {/* CALENDÁRIO DO CICLO (change fechamento-de-ciclo, D1): DADO por operadora,
              como a validade do pedido — Unimed fecha no dia 15, SC Saúde no último dia
              do mês. Quem deriva o período é o servidor; aqui só se informa o corte. */}
          {/* Boxed como o irmão "Integração com o faturamento" (mesmo formulário): o
              precedente da casa para "legend + parágrafo explicativo + campos" é o grupo
              CONTIDO — sem a borda, o parágrafo flutua entre dois campos soltos e o
              agrupamento só existe para quem lê o `legend` (achado I2). */}
          <fieldset className="flex flex-col gap-4 rounded-superficie border border-dashed border-linha-forte p-4">
            <legend className="px-1 text-rotulo font-medium text-texto-suave">
              Fechamento do faturamento
            </legend>
            <p className="text-meta text-texto-suave">
              Quando este convênio fecha a produção do mês. Fechado um período, os atendimentos,
              as evoluções e os lançamentos dele com data dentro do período deixam de aceitar
              edição — registrar sessão que aconteceu continua liberado, e só o administrador
              reabre. Sem corte configurado, nada muda para este convênio.
            </p>

            <CampoSelect
              rotulo="Quando fecha"
              value={valores.ciclo_tipo_corte}
              onChange={(evento) => {
                const valor = evento.target.value
                definir({ ciclo_tipo_corte: tipoDeCorteValido(valor) ? valor : '' })
              }}
              opcoes={[
                { valor: '', rotulo: 'Não fecha (sem período)' },
                { valor: 'dia_fixo', rotulo: 'Dia fixo do mês' },
                { valor: 'ultimo_dia', rotulo: 'Último dia do mês' },
              ]}
              erro={erros.campos.get('ciclo_tipo_corte')}
            />

            {/* Só com `dia_fixo`: um "dia do corte" ao lado de "último dia do mês" é um
                campo que não decide nada — e campo que não decide nada é preenchido. */}
            {valores.ciclo_tipo_corte === 'dia_fixo' ? (
              <CampoTexto
                rotulo="Dia do corte"
                obrigatorio
                type="number"
                min={1}
                max={28}
                value={valores.ciclo_dia_corte}
                onChange={(evento) => {
                  definir({ ciclo_dia_corte: evento.target.value })
                }}
                ajuda="De 1 a 28. Corte no dia 15 (Unimed) significa período do dia 16 ao dia 15 do mês seguinte. Quem fecha no dia 29, 30 ou 31 deve escolher “Último dia do mês”: em fevereiro esses dias não existem, e sobrariam dias sem período nenhum."
                erro={erros.campos.get('ciclo_dia_corte')}
              />
            ) : null}
          </fieldset>

          <CampoCheckbox
            rotulo="Ativo"
            marcado={valores.ativo}
            aoMudar={(marcado) => {
              definir({ ativo: marcado })
            }}
          />

          <fieldset className="flex flex-col gap-4 rounded-superficie border border-dashed border-linha-forte p-4">
            <legend className="px-1 text-rotulo font-medium text-texto-suave">
              Integração com o faturamento de convênios
            </legend>
            <p className="text-meta text-texto-suave">
              Estes dados ficam <strong className="font-semibold">guardados</strong> para o sistema
              de faturamento de convênios. O Ame Clínica não emite guia, não envia TISS e não
              fatura — aqui você só cadastra o convênio e o preço.
            </p>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <CampoTexto
                rotulo="Registro ANS"
                value={valores.registro_ans}
                onChange={(evento) => {
                  definir({ registro_ans: evento.target.value })
                }}
                erro={erros.campos.get('registro_ans')}
              />
              <CampoTexto
                rotulo="Código da operadora"
                value={valores.codigo_operadora}
                onChange={(evento) => {
                  definir({ codigo_operadora: evento.target.value })
                }}
                erro={erros.campos.get('codigo_operadora')}
              />
              <CampoTexto
                rotulo="Versão TISS"
                value={valores.versao_tiss}
                onChange={(evento) => {
                  definir({ versao_tiss: evento.target.value })
                }}
                erro={erros.campos.get('versao_tiss')}
              />
            </div>

            {/* FLAG de configuração — nunca um contador de guia (parecer §14) */}
            <CampoCheckbox
              rotulo="Guia numerada em sequência"
              marcado={valores.guia_sequencial}
              aoMudar={(marcado) => {
                definir({ guia_sequencial: marcado })
              }}
              ajuda="Como este convênio numera as guias. É uma característica dele — o Ame Clínica não gera guia."
            />
          </fieldset>
        </>
      )}
    />
  )
}
