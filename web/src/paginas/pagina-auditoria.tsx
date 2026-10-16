import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ScrollText, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Botao } from '@/componentes/ui/botao'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Paginacao } from '@/componentes/ui/paginacao'
import { Skeleton } from '@/componentes/ui/skeleton'
import { Tabela } from '@/componentes/ui/tabela'
import { usarDebounce } from '@/hooks/usar-debounce'
import { MOTIVO_DA_RECUSA as MOTIVO_DA_RECUSA_DA_BAIXA } from '@/lib/baixa-em-lote'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel } from '@/lib/datas'
import { MOTIVO_DA_RECUSA as MOTIVO_DA_RECUSA_DO_DESMARQUE } from '@/lib/desmarque-em-lote'
import { listarAuditoria } from '@/servicos/auditoria'
import { listarUsuarios } from '@/servicos/usuarios'
import type { LinhaAuditoria } from '@/tipos'

/**
 * A trilha de auditoria pela interface (§12, change auditoria-tela) — a tela é
 * um ESPELHO somente-leitura do que a API entrega: nenhuma mutação parte daqui
 * (T-aud-01), nenhum valor mascarado é "resolvido" (AU-02), nenhum fuso é
 * reinterpretado (o `criado_em` já vem na parede da clínica).
 *
 * Filtros vivem na URL (D5): a consulta vira link compartilhável entre
 * administradores e o refresh preserva o contexto.
 */

/** Entidades auditadas → rótulo humano. O VALOR é o nome de tabela gravado na trilha. */
const ENTIDADES: ReadonlyArray<{ valor: string; rotulo: string }> = [
  { valor: 'agendamentos', rotulo: 'Agendamentos' },
  { valor: 'anamneses', rotulo: 'Anamneses' },
  { valor: 'anamnese_modelos', rotulo: 'Modelos de anamnese' },
  { valor: 'anexos', rotulo: 'Anexos' },
  { valor: 'aprovacoes_de_acesso', rotulo: 'Aprovações de acesso' },
  { valor: 'atendimentos', rotulo: 'Atendimentos' },
  { valor: 'cartoes', rotulo: 'Cartões' },
  { valor: 'categorias', rotulo: 'Categorias' },
  { valor: 'configuracoes', rotulo: 'Configurações' },
  { valor: 'contas', rotulo: 'Contas' },
  { valor: 'convenios', rotulo: 'Convênios' },
  { valor: 'equipamentos', rotulo: 'Equipamentos' },
  { valor: 'especialidades', rotulo: 'Especialidades' },
  { valor: 'evolucoes', rotulo: 'Evoluções' },
  { valor: 'fechamentos_ciclo', rotulo: 'Fechamentos de ciclo' },
  { valor: 'feriados', rotulo: 'Feriados' },
  { valor: 'fornecedores', rotulo: 'Fornecedores' },
  { valor: 'funcionarios', rotulo: 'Funcionários' },
  { valor: 'informativos', rotulo: 'Informativos' },
  { valor: 'lancamentos_caixa', rotulo: 'Lançamentos do caixa' },
  // os arquivos do lançamento (change `anexo-no-lancamento`): tabela própria, trilha própria
  { valor: 'lancamento_anexos', rotulo: 'Anexos de lançamento' },
  { valor: 'lista_espera', rotulo: 'Lista de espera' },
  { valor: 'medicos', rotulo: 'Médicos solicitantes' },
  { valor: 'roles', rotulo: 'Níveis de permissão' },
  { valor: 'pacientes', rotulo: 'Pacientes' },
  { valor: 'profissionais', rotulo: 'Profissionais' },
  { valor: 'regras_limite_convenio', rotulo: 'Regras de limite de convênio' },
  // a planilha baixada (change `relatorio-em-planilha`): a trilha registra sobre o RELATÓRIO, com o
  // slug e os filtros, nunca o conteúdo
  { valor: 'relatorios', rotulo: 'Relatórios' },
  { valor: 'salas', rotulo: 'Salas' },
  { valor: 'servicos', rotulo: 'Serviços' },
  { valor: 'status_agendamento', rotulo: 'Status de agendamento' },
  // a própria CLÍNICA (nome, fuso, logo): os eventos existem na trilha desde sempre, mas a
  // entidade ficava fora do filtro e saía crua na coluna (achado da validação em produção)
  { valor: 'clinica', rotulo: 'Dados da clínica' },
  { valor: 'subcategorias', rotulo: 'Subcategorias' },
  { valor: 'tarefas', rotulo: 'Tarefas da equipe' },
  { valor: 'tarefa_comentarios', rotulo: 'Comentários de tarefa' },
  { valor: 'termos_consentimento', rotulo: 'Termos de consentimento' },
  { valor: 'tipos_pagamento', rotulo: 'Formas de pagamento' },
  { valor: 'transferencias', rotulo: 'Transferências' },
  { valor: 'tratamentos', rotulo: 'Tratamentos' },
  { valor: 'usuarios', rotulo: 'Usuários' },
]

/** Ações conhecidas — SUGESTÃO de filtro; a lista exibe qualquer ação que a API devolva (D2). */
const ACOES: ReadonlyArray<{ valor: string; rotulo: string }> = [
  { valor: 'criou', rotulo: 'Criou' },
  { valor: 'atualizou', rotulo: 'Atualizou' },
  { valor: 'excluiu', rotulo: 'Excluiu' },
  { valor: 'consultou', rotulo: 'Consultou (leitura clínica)' },
  { valor: 'assinou_por_outro', rotulo: 'Assinou por outro' },
  { valor: 'alterou_especialidades', rotulo: 'Alterou especialidades' },
  { valor: 'alterou_horarios', rotulo: 'Alterou horários' },
  // registradas pelo servidor desde as changes de avatar/identidade, mas ausentes daqui:
  // apareciam cruas na coluna (`enviou_logo`) e eram INALCANÇÁVEIS pelo filtro de ação
  { valor: 'alterou_permissoes', rotulo: 'Alterou permissões' },
  { valor: 'enviou_logo', rotulo: 'Enviou a logo' },
  { valor: 'removeu_logo', rotulo: 'Removeu a logo' },
  { valor: 'enviou_avatar', rotulo: 'Enviou a foto de perfil' },
  { valor: 'removeu_avatar', rotulo: 'Removeu a foto de perfil' },
  // a linha-mãe de cada operação em lote (uma por `lote_id`, na entidade do profissional):
  // sem estas duas a coluna saía crua e `?acao=baixa_em_lote` exibia "Criou" no filtro
  { valor: 'baixa_em_lote', rotulo: 'Deu baixa em lote' },
  { valor: 'desmarque_em_lote', rotulo: 'Desmarcou em lote' },
  // a conversa de cobrança aberta no WhatsApp (change `cobranca-pelo-whatsapp`) — ABERTA, não enviada
  { valor: 'cobrou', rotulo: 'Abriu a cobrança pelo WhatsApp' },
  // dado de criança saindo do sistema em arquivo (change `relatorio-em-planilha`)
  { valor: 'exportou', rotulo: 'Baixou em planilha' },
  // o anexo já excluído que some DE VEZ, com o arquivo, junto do lançamento em aberto excluído
  // (change `anexo-no-lancamento`) — distinto de "Excluiu", que é a exclusão lógica
  { valor: 'purgou', rotulo: 'Purgou (apagou o arquivo de vez)' },
  // o pedido de desmarque da família pelo lembrete, resolvido SEM desmarcar — o toque errado desfeito
  // por telefone (change `lembrete-com-botoes-de-resposta`)
  { valor: 'manteve_sessao', rotulo: 'Manteve a sessão (a família desistiu)' },
  // a família confirmou por telefone ou mensagem e a clínica registrou (change `confirmacao-pela-clinica`)
  { valor: 'confirmou_pela_clinica', rotulo: 'Confirmou a sessão (a família confirmou por outro canal)' },
]

const CHAVES_DE_FILTRO = ['entidade', 'id', 'usuario', 'acao', 'de', 'ate'] as const

export function PaginaAuditoria() {
  const [parametros, setParametros] = useSearchParams()
  const [expandida, setExpandida] = useState<number | null>(null)

  const filtros = {
    entidade: parametros.get('entidade') ?? '',
    entidadeId: parametros.get('id') ?? '',
    usuarioId: parametros.get('usuario') ?? '',
    acao: parametros.get('acao') ?? '',
    de: parametros.get('de') ?? '',
    ate: parametros.get('ate') ?? '',
    pagina: Math.max(1, Number(parametros.get('pagina') ?? '1') || 1),
  }
  const temFiltroAtivo = CHAVES_DE_FILTRO.some((chave) => (parametros.get(chave) ?? '') !== '')

  // os campos DIGITADOS (id/usuário numérico) propagam com silêncio (I2): sem o
  // debounce, cada tecla viraria uma consulta com recorte intermediário
  const entidadeIdAtrasado = usarDebounce(filtros.entidadeId)
  const usuarioIdAtrasado = usarDebounce(filtros.usuarioId)
  const filtrosDaConsulta = { ...filtros, entidadeId: entidadeIdAtrasado, usuarioId: usuarioIdAtrasado }

  const trilha = useQuery({
    queryKey: chaves.trilhaDeAuditoria({ ...filtrosDaConsulta }),
    queryFn: () => listarAuditoria(filtrosDaConsulta),
  })

  // o select de autores vem da leitura de gestão (o Administrador a tem — D3);
  // se um dia as permissões divergirem, degrada para o campo numérico
  const usuarios = useQuery({ queryKey: chaves.usuarios(), queryFn: listarUsuarios, retry: 0 })

  /** Muda um filtro na URL — e volta à página 1 (filtro novo, recorte novo). */
  function definirFiltro(chave: (typeof CHAVES_DE_FILTRO)[number], valor: string): void {
    const proximos = new URLSearchParams(parametros)
    if (valor === '') {
      proximos.delete(chave)
    } else {
      proximos.set(chave, valor)
    }
    // trocar a entidade invalida o id do registro (a API exige o par)
    if (chave === 'entidade') {
      proximos.delete('id')
    }
    proximos.delete('pagina')
    setParametros(proximos, { replace: true })
    setExpandida(null)
  }

  function mudarPagina(pagina: number): void {
    const proximos = new URLSearchParams(parametros)
    proximos.set('pagina', String(pagina))
    setParametros(proximos, { replace: true })
    setExpandida(null)
  }

  function limparFiltros(): void {
    setParametros(new URLSearchParams(), { replace: true })
    setExpandida(null)
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-titulo font-semibold text-texto">Auditoria</h1>
        <p className="mt-1 text-corpo text-texto-suave">
          Tudo que foi criado, alterado ou excluído — quem fez, quando e o que mudou. A trilha é
          imutável: esta tela só consulta.
        </p>
      </header>

      <section
        aria-label="Filtros da trilha"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6"
      >
        <CampoSelect
          rotulo="Entidade"
          placeholder="Todas"
          value={filtros.entidade}
          opcoes={ENTIDADES}
          onChange={(evento) => {
            definirFiltro('entidade', evento.target.value)
          }}
        />
        <CampoTexto
          rotulo="Id do registro"
          type="number"
          disabled={filtros.entidade === ''}
          ajuda={filtros.entidade === '' ? 'Escolha a entidade primeiro.' : undefined}
          value={filtros.entidadeId}
          onChange={(evento) => {
            definirFiltro('id', evento.target.value)
          }}
        />
        {usuarios.isError ? (
          <CampoTexto
            rotulo="Usuário (id)"
            type="number"
            value={filtros.usuarioId}
            onChange={(evento) => {
              definirFiltro('usuario', evento.target.value)
            }}
          />
        ) : (
          <CampoSelect
            rotulo="Usuário"
            placeholder="Todos"
            value={filtros.usuarioId}
            opcoes={(usuarios.data ?? []).map((usuario) => ({
              valor: String(usuario.id),
              rotulo: usuario.nome,
            }))}
            onChange={(evento) => {
              definirFiltro('usuario', evento.target.value)
            }}
          />
        )}
        <CampoSelect
          rotulo="Ação"
          placeholder="Todas"
          value={filtros.acao}
          opcoes={ACOES}
          onChange={(evento) => {
            definirFiltro('acao', evento.target.value)
          }}
        />
        <CampoTexto
          rotulo="De"
          type="date"
          value={filtros.de}
          onChange={(evento) => {
            definirFiltro('de', evento.target.value)
          }}
        />
        <CampoTexto
          rotulo="Até"
          type="date"
          value={filtros.ate}
          onChange={(evento) => {
            definirFiltro('ate', evento.target.value)
          }}
        />
      </section>

      {trilha.isPending ? <Skeleton className="h-64 w-full" /> : null}

      {trilha.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar a trilha de auditoria."
          aoTentarNovamente={() => void trilha.refetch()}
        />
      ) : null}

      {trilha.isSuccess && trilha.data.data.length === 0 ? (
        temFiltroAtivo ? (
          <EstadoVazio
            icone={<ScrollText aria-hidden="true" className="size-8" />}
            titulo="Nada casa com estes filtros."
            descricao="A trilha continua inteira — só este recorte veio vazio."
            acao={<Botao onClick={limparFiltros}>Limpar filtros</Botao>}
          />
        ) : (
          <EstadoVazio
            icone={<ScrollText aria-hidden="true" className="size-8" />}
            titulo="Nenhuma movimentação registrada ainda."
            descricao="Toda criação, alteração e exclusão aparecerá aqui, com autor e data."
          />
        )
      ) : null}

      {trilha.isSuccess && trilha.data.data.length > 0 ? (
        <>
          <Tabela legenda={`${trilha.data.total} movimentações na trilha`}>
            <Tabela.Cabecalho>
              <Tabela.Linha>
                <Tabela.CelulaCabecalho scope="col">Quando</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Ação</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Entidade</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Autor</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Alterações</Tabela.CelulaCabecalho>
              </Tabela.Linha>
            </Tabela.Cabecalho>
            <Tabela.Corpo>
              {trilha.data.data.map((linha) => (
                <LinhaDaTrilha
                  key={linha.id}
                  linha={linha}
                  expandida={expandida === linha.id}
                  aoAlternar={() => {
                    setExpandida((atual) => (atual === linha.id ? null : linha.id))
                  }}
                />
              ))}
            </Tabela.Corpo>
          </Tabela>

          <Paginacao
            pagina={trilha.data.current_page}
            totalPaginas={trilha.data.last_page}
            totalItens={trilha.data.total}
            aoMudar={mudarPagina}
          />
        </>
      ) : null}
    </div>
  )
}

/** A linha compacta + o diff expandido (disclosure com aria-expanded/aria-controls). */
function LinhaDaTrilha({
  linha,
  expandida,
  aoAlternar,
}: {
  linha: LinhaAuditoria
  expandida: boolean
  aoAlternar: () => void
}) {
  const rotuloEntidade =
    ENTIDADES.find((entidade) => entidade.valor === linha.entidade)?.rotulo ?? linha.entidade
  const rotuloAcao = ACOES.find((acao) => acao.valor === linha.acao)?.rotulo ?? linha.acao
  // criação é compacta por spec (sem despejo do registro); só expande quem tem diff
  const expansivel = linha.acao !== 'criou' && linha.alteracoes.length > 0
  const idDoDetalhe = `auditoria-diff-${linha.id}`

  return (
    <>
      <Tabela.Linha>
        <Tabela.Celula className="whitespace-nowrap text-texto-suave">
          {dataHoraLegivel(linha.criado_em)}
        </Tabela.Celula>
        <Tabela.Celula>{rotuloAcao}</Tabela.Celula>
        <Tabela.Celula>
          {rotuloEntidade} <span className="text-texto-suave">#{linha.entidade_id}</span>
        </Tabela.Celula>
        <Tabela.Celula>{linha.autor}</Tabela.Celula>
        <Tabela.Celula>
          {expansivel ? (
            <button
              type="button"
              aria-expanded={expandida}
              aria-controls={idDoDetalhe}
              onClick={aoAlternar}
              className="flex items-center gap-1 rounded-controle text-meta font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
            >
              <ChevronDown
                aria-hidden="true"
                className={`size-3.5 transition-transform ${expandida ? 'rotate-180' : ''}`}
              />
              {linha.alteracoes.length === 1 ? '1 campo' : `${linha.alteracoes.length} campos`}
            </button>
          ) : (
            <span className="text-meta text-texto-suave">—</span>
          )}
        </Tabela.Celula>
      </Tabela.Linha>
      {expansivel && expandida ? (
        <Tabela.Linha>
          <Tabela.Celula colSpan={5} id={idDoDetalhe} className="bg-fundo">
            <ul className="flex flex-col gap-1 py-1">
              {linha.alteracoes.map((alteracao) => (
                <li
                  key={alteracao.campo}
                  className="flex flex-wrap items-baseline gap-x-2 text-corpo"
                >
                  <span className="font-medium text-texto">{alteracao.campo}:</span>
                  <ValorDaTrilha valor={alteracao.de} acao={linha.acao} />
                  <span aria-hidden="true" className="text-texto-suave">
                    →
                  </span>
                  <span className="sr-only">passou a</span>
                  <ValorDaTrilha valor={alteracao.para} acao={linha.acao} />
                </li>
              ))}
            </ul>
          </Tabela.Celula>
        </Tabela.Linha>
      ) : null}
    </>
  )
}

/**
 * Um valor do diff, como a API o entrega — a tela NUNCA deriva o que foi
 * mascarado (AU-02): `***` vira o selo "protegido", com a explicação. A `acao` da linha
 * só importa para os `recusados` de um lote: é ela que diz qual operação escreveu o motivo.
 */
function ValorDaTrilha({ valor, acao }: { valor: unknown; acao: string }) {
  if (valor === '***') {
    return (
      <span
        title="Valor protegido — dado sensível não sai na trilha"
        className="flex items-center gap-1 rounded-pilula bg-neutro-100 px-1.5 py-0.5 text-meta text-texto-suave"
      >
        <ShieldCheck aria-hidden="true" className="size-3" />
        protegido
        <span className="sr-only">— dado sensível não sai na trilha</span>
      </span>
    )
  }
  if (valor === null || valor === undefined || valor === '') {
    return <span className="text-texto-suave">—</span>
  }
  if (typeof valor === 'boolean') {
    return <span>{valor ? 'Sim' : 'Não'}</span>
  }
  if (Array.isArray(valor) && valor.length > 0 && valor.every(ehRecusaDeLote)) {
    return <RecusadosDoLote acao={acao} recusados={valor} />
  }
  // valor estruturado (ex.: campos_json de um modelo) sai como JSON legível —
  // `String()` renderia "[object Object]" (I1); o mascarado já foi tratado acima
  if (typeof valor === 'object') {
    return <span className="break-all">{JSON.stringify(valor)}</span>
  }
  return <span className="break-all">{String(valor)}</span>
}

/** Uma linha de `recusados` da linha-mãe de um lote — `{agendamento_id, motivo}`, como a API grava. */
interface RecusaDeLote {
  agendamento_id: number
  motivo: string
}

function ehRecusaDeLote(item: unknown): item is RecusaDeLote {
  return (
    typeof item === 'object'
    && item !== null
    && 'agendamento_id' in item
    && typeof item.agendamento_id === 'number'
    && 'motivo' in item
    && typeof item.motivo === 'string'
  )
}

/**
 * O dicionário de motivos é o da OPERAÇÃO que gravou a linha-mãe: a baixa e o desmarque recusam
 * por chaves próprias, e a mesma chave (`atendimento_registrado`) tem frase diferente em cada
 * um — "não pode virar falta" é razão da baixa, nunca do desmarque. Ação fora destas duas não
 * tem dicionário: o motivo sai cru, como a coluna faz com ação desconhecida (D2).
 */
function motivosDaRecusa(acao: string): Readonly<Record<string, string>> {
  if (acao === 'baixa_em_lote') {
    return MOTIVO_DA_RECUSA_DA_BAIXA
  }
  if (acao === 'desmarque_em_lote') {
    return MOTIVO_DA_RECUSA_DO_DESMARQUE
  }

  return {}
}

/**
 * "Recusados" da linha-mãe do lote como lista, não como JSON: o manual promete ler ali quem
 * ficou de fora e por quê. O motivo constante é traduzido pelo dicionário do diálogo que
 * gravou a linha (`motivosDaRecusa`) — não é valor mascarado nem omitido pela API, é a chave de
 * máquina dela; a frase crua do domínio (recusa na execução) passa como está, igual ao diálogo.
 */
function RecusadosDoLote({ acao, recusados }: { acao: string; recusados: readonly RecusaDeLote[] }) {
  const motivos = motivosDaRecusa(acao)

  return (
    <ul className="flex flex-col gap-0.5">
      {recusados.map((recusa) => (
        <li key={recusa.agendamento_id}>
          agendamento #{recusa.agendamento_id} — {motivos[recusa.motivo] ?? recusa.motivo}
        </li>
      ))}
    </ul>
  )
}
