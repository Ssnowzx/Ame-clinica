import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { TelaDeCatalogo } from '@/componentes/cadastro/tela-de-catalogo'
import { SecaoCiclos } from '@/componentes/convenios/secao-ciclos'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { ROTULO_DA_ACAO, ROTULO_DO_PERIODO } from '@/lib/convenios'
import {
  buscarConvenio,
  especialidades as servicoDeEspecialidades,
  regrasDoConvenio,
  servicosDoConvenio,
  type PayloadRegraLimite,
  type PayloadServico,
} from '@/servicos/catalogos-de-apoio'
import type {
  AcaoDaRegraDeLimite,
  PeriodoDaRegraDeLimite,
  RegraLimiteConvenio,
  Servico,
} from '@/tipos'

const CAMPOS = new Set(['procedimento', 'codigo_procedimento', 'valor'])

interface Valores {
  procedimento: string
  codigo_procedimento: string
  valor: string
}

const CAMPOS_DA_REGRA = new Set(['especialidade_id', 'periodo', 'limite', 'acao'])

interface ValoresDaRegra {
  /** '' = todas as especialidades (vira `especialidade_id: null` no payload) */
  especialidade_id: string
  periodo: PeriodoDaRegraDeLimite | ''
  limite: string
  acao: AcaoDaRegraDeLimite | ''
}

/**
 * Regras de limite geridas INTEIRAS sob `convenios.editar` (delta spec da change
 * limites-e-pedidos-por-convenio) — não existe `regras.criar`: a regra é atributo
 * do convênio, como a validade do pedido.
 */
const PERMISSOES_DA_REGRA = {
  criar: 'convenios.editar',
  editar: 'convenios.editar',
  excluir: 'convenios.editar',
}

/**
 * Os dois domínios são FECHADOS (§13 — o enum é do banco). Estreitar por VERIFICAÇÃO,
 * não por assertion: `as` cala o compilador sem olhar o valor, e o valor aqui vem de um
 * `evento.target.value` (string crua do DOM). O `''` é o único outro estado legal — é o
 * placeholder do select, que o `required` impede de submeter.
 */
function periodoValido(valor: string): valor is PeriodoDaRegraDeLimite {
  return valor === 'dia' || valor === 'semana' || valor === 'mes'
}

function acaoValida(valor: string): valor is AcaoDaRegraDeLimite {
  return valor === 'bloquear' || valor === 'avisar'
}

/** "8 por dia — Fonoaudiologia": é assim que o diálogo NOMEIA o alvo (§2). */
function nomeDaRegra(regra: RegraLimiteConvenio): string {
  const alvo = regra.especialidade?.nome ?? 'todas as especialidades'
  return `${regra.limite} por ${ROTULO_DO_PERIODO[regra.periodo]} — ${alvo}`
}

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function emReais(valor: string | number): string {
  const numero = typeof valor === 'number' ? valor : Number(valor)
  return Number.isFinite(numero) ? MOEDA.format(numero) : '—'
}

/**
 * A tabela de serviços é AGREGADO do convênio (rotas aninhadas na API) — por isso
 * ela vive numa página do convênio, e não numa tela solta. O tratamento e o
 * lançamento no caixa referenciam o serviço; o preço nasce aqui.
 */
export function PaginaConvenio() {
  const { id } = useParams()
  const convenioId = Number(id)
  const valido = Number.isInteger(convenioId) && convenioId > 0

  // catálogo do select de especialidade das regras de limite — domínio da CLÍNICA
  // (o servidor recusa especialidade inexistente com 422, SEC-LP-07)
  const listaDeEspecialidades = useQuery({
    queryKey: chaves.especialidades(),
    queryFn: servicoDeEspecialidades.listar,
    enabled: valido,
  })

  const convenio = useQuery({
    queryKey: chaves.convenio(convenioId),
    queryFn: () => buscarConvenio(convenioId),
    enabled: valido,
    // A regra do detalhe é SEM EXCEÇÃO (guarda em `detalhe-sem-cache.contrato.test.ts`): esta tela hoje só
    // EXIBE o nome, mas a regra que vale "quando o componente hidrata `useState`" exige que
    // alguém julgue isso a cada tela nova — e é o julgamento que falha. O custo aqui é um
    // refetch por navegação; o custo do julgamento errado foi a matrícula de um menor.
    gcTime: 0,
  })

  if (!valido) {
    // botão "tentar novamente" que não faz nada é pior que não ter botão: aqui a
    // saída é voltar para a lista
    return (
      <EstadoVazio
        titulo="Convênio não encontrado"
        descricao="O endereço não corresponde a nenhum convênio."
        acao={
          <Botao asChild variante="secundario">
            <Link to="/convenios">Voltar aos convênios</Link>
          </Botao>
        }
      />
    )
  }

  const recurso = servicosDoConvenio(convenioId)
  const recursoDeRegras = regrasDoConvenio(convenioId)

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/convenios"
        className="flex w-fit items-center gap-1.5 text-corpo text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Convênios
      </Link>

      {convenio.isPending ? <Skeleton className="h-8 w-64" /> : null}
      {convenio.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar o convênio."
          aoTentarNovamente={() => {
            void convenio.refetch()
          }}
        />
      ) : null}

      {/* O `h1` é da PÁGINA — o convênio. As duas seções abaixo são `h2` sob ele: dois
          `h1` na mesma rota (um por TelaDeCatalogo) apagavam a hierarquia para quem
          navega por headings (A11Y-LP-01), e repetiam o nome do convênio três vezes. */}
      {convenio.isSuccess ? (
        <h1 className="text-titulo font-semibold text-texto">{convenio.data.nome}</h1>
      ) : null}

      {convenio.isSuccess ? (
        <TelaDeCatalogo<Servico, PayloadServico, Valores>
          titulo="Tabela de serviços"
          nivelDoTitulo="h2"
          modulo="servicos"
          rotuloSingular="serviço"
          genero="m"
          chave={chaves.servicosDoConvenio(convenioId)}
          listar={recurso.listar}
          recurso={recurso}
          campos={CAMPOS}
          colunas={[
            // o código vem ANTES: é como a clínica lê a tabela da operadora
            // (código → descrição → valor), e é a coluna mais curta
            {
              cabecalho: 'Código',
              celula: (servico) => (
                <span className="tabular-nums">{servico.codigo_procedimento ?? '—'}</span>
              ),
            },
            { cabecalho: 'Procedimento', celula: (servico) => servico.procedimento },
            {
              cabecalho: 'Valor',
              celula: (servico) => (
                <span className="tabular-nums">{emReais(servico.valor)}</span>
              ),
            },
          ]}
          valoresIniciais={(servico) => ({
            procedimento: servico?.procedimento ?? '',
            codigo_procedimento: servico?.codigo_procedimento ?? '',
            valor: servico === undefined ? '' : String(servico.valor),
          })}
          paraPayload={(valores) => ({
            procedimento: valores.procedimento,
            // em branco = ausência, não string vazia
            codigo_procedimento: valores.codigo_procedimento.trim() === ''
              ? null
              : valores.codigo_procedimento.trim(),
            valor: Number(valores.valor),
          })}
          nomeDoRegistro={(servico) => servico.procedimento}
          consequenciaDaExclusao="Se algum tratamento já usa este serviço, o sistema recusa a exclusão."
          vazioTitulo="Nenhum serviço nesta tabela"
          vazioDescricao="O preço do procedimento neste convênio — é o que o tratamento e o caixa referenciam."
          formulario={({ valores, definir, erros }) => (
            <>
              <CampoTexto
                rotulo="Procedimento"
                obrigatorio
                value={valores.procedimento}
                onChange={(evento) => {
                  definir({ procedimento: evento.target.value })
                }}
                erro={erros.campos.get('procedimento')}
              />
              <CampoTexto
                rotulo="Código do procedimento"
                value={valores.codigo_procedimento}
                onChange={(evento) => {
                  definir({ codigo_procedimento: evento.target.value })
                }}
                ajuda="Opcional — o número da tabela da operadora, para conferir com o portal dela. Não entra no valor nem no recibo."
                erro={erros.campos.get('codigo_procedimento')}
              />
              <CampoTexto
                rotulo="Valor (R$)"
                obrigatorio
                type="number"
                min={0}
                step={0.01}
                value={valores.valor}
                onChange={(evento) => {
                  definir({ valor: evento.target.value })
                }}
                ajuda="Duas casas decimais."
                erro={erros.campos.get('valor')}
              />
            </>
          )}
        />
      ) : null}

      {/* Regras de limite (change limites-e-pedidos-por-convenio): teto de sessões por
          PACIENTE no período — dado gerido aqui, aplicado pela GUARDA no servidor.
          "Pedido médico"/"sessões" na linguagem, nunca guia/TISS (§14, SEC-LP-13). */}
      {convenio.isSuccess ? (
        <TelaDeCatalogo<RegraLimiteConvenio, PayloadRegraLimite, ValoresDaRegra>
          titulo="Regras de limite"
          nivelDoTitulo="h2"
          modulo="convenios"
          permissoes={PERMISSOES_DA_REGRA}
          rotuloSingular="regra de limite"
          genero="f"
          chave={chaves.regrasDoConvenio(convenioId)}
          listar={recursoDeRegras.listar}
          recurso={recursoDeRegras}
          campos={CAMPOS_DA_REGRA}
          colunas={[
            {
              cabecalho: 'Especialidade',
              celula: (regra) => regra.especialidade?.nome ?? 'Todas as especialidades',
            },
            {
              cabecalho: 'Limite',
              celula: (regra) => (
                <span className="tabular-nums">
                  {regra.limite} por {ROTULO_DO_PERIODO[regra.periodo]}
                </span>
              ),
            },
            { cabecalho: 'Ação', celula: (regra) => ROTULO_DA_ACAO[regra.acao] },
          ]}
          valoresIniciais={(regra) => ({
            especialidade_id:
              regra?.especialidade_id === null || regra?.especialidade_id === undefined
                ? ''
                : String(regra.especialidade_id),
            periodo: regra?.periodo ?? '',
            limite: regra === undefined ? '' : String(regra.limite),
            acao: regra?.acao ?? '',
          })}
          paraPayload={(valores) => {
            const especialidade_id =
              valores.especialidade_id === '' ? null : Number(valores.especialidade_id)

            // Os selects são de domínio FECHADO e obrigatórios (`required` no
            // `CampoSelect`): o '' não atravessa o submit. O guard existe para FECHAR O
            // TIPO sem assertion — e o caminho impossível vai com `limite: 0`, que o
            // servidor recusa (min 1): se um dia ele deixar de ser impossível, a recusa
            // APARECE, em vez de gravar em silêncio uma regra que ninguém escolheu.
            if (valores.periodo === '' || valores.acao === '') {
              return { especialidade_id, periodo: 'dia', limite: 0, acao: 'avisar' }
            }

            return {
              especialidade_id,
              periodo: valores.periodo,
              limite: Number(valores.limite),
              acao: valores.acao,
            }
          }}
          nomeDoRegistro={nomeDaRegra}
          consequenciaDaExclusao="Sem a regra, a agenda deixa de conferir este limite ao marcar novos atendimentos deste convênio."
          vazioTitulo="Nenhuma regra de limite"
          vazioDescricao="O teto de sessões por paciente neste convênio — por dia, semana ou mês. Ao atingir, a agenda bloqueia ou avisa, conforme a regra."
          formulario={({ valores, definir, erros }) => (
            <>
              <CampoSelect
                rotulo="Especialidade"
                value={valores.especialidade_id}
                onChange={(evento) => {
                  definir({ especialidade_id: evento.target.value })
                }}
                opcoes={[
                  { valor: '', rotulo: 'Todas as especialidades' },
                  ...(listaDeEspecialidades.data ?? []).map((especialidade) => ({
                    valor: String(especialidade.id),
                    rotulo: especialidade.nome,
                  })),
                ]}
                ajuda="A regra de uma especialidade específica vence a regra de todas."
                erro={erros.campos.get('especialidade_id')}
              />
              <CampoSelect
                rotulo="Período"
                obrigatorio
                value={valores.periodo}
                onChange={(evento) => {
                  const valor = evento.target.value
                  definir({ periodo: periodoValido(valor) ? valor : '' })
                }}
                placeholder="Selecione…"
                opcoes={[
                  { valor: 'dia', rotulo: 'Por dia' },
                  { valor: 'semana', rotulo: 'Por semana' },
                  { valor: 'mes', rotulo: 'Por mês' },
                ]}
                erro={erros.campos.get('periodo')}
              />
              <CampoTexto
                rotulo="Limite de sessões"
                obrigatorio
                type="number"
                min={1}
                max={99}
                value={valores.limite}
                onChange={(evento) => {
                  definir({ limite: evento.target.value })
                }}
                ajuda="Sessões do MESMO paciente neste convênio dentro do período."
                erro={erros.campos.get('limite')}
              />
              <CampoSelect
                rotulo="Ação ao atingir o limite"
                obrigatorio
                value={valores.acao}
                onChange={(evento) => {
                  const valor = evento.target.value
                  definir({ acao: acaoValida(valor) ? valor : '' })
                }}
                placeholder="Selecione…"
                opcoes={[
                  { valor: 'bloquear', rotulo: ROTULO_DA_ACAO.bloquear },
                  { valor: 'avisar', rotulo: ROTULO_DA_ACAO.avisar },
                ]}
                erro={erros.campos.get('acao')}
              />
            </>
          )}
        />
      ) : null}

      {/* Ciclos de faturamento (change fechamento-de-ciclo): a 3ª seção, `h2` como as
          duas de cima. Ela se esconde SOZINHA de quem não tem `ciclos.fechar`
          (SEC-FC-09) — o gate mora no componente, não aqui, para que nenhuma tela nova
          que o monte esqueça de repeti-lo. */}
      {convenio.isSuccess ? (
        <SecaoCiclos convenioId={convenioId} nomeDoConvenio={convenio.data.nome} />
      ) : null}
    </div>
  )
}
