import { HttpResponse, http as msw } from 'msw'

import type {
  CardAgendamento,
  DetalheDoAgendamento,
  Especialidade,
  FeriadoDaAgenda,
  Profissional,
  ProfissionalDaAgenda,
  StatusAgendamento,
} from '@/tipos'

/** Fixtures da agenda — 100% fictícias (LGPD: nunca dado que possa ser real). */

/** Horários iguais em todos os dias da semana (para preservar a forma dos fixtures antigos). */
function todosOsDias(inicio: string, fim: string): Record<string, Array<{ inicio: string; fim: string }>> {
  const mapa: Record<string, Array<{ inicio: string; fim: string }>> = {}
  for (let dia = 1; dia <= 7; dia++) {
    mapa[String(dia)] = [{ inicio, fim }]
  }
  return mapa
}

export const PROFISSIONAIS_FICTICIOS: ProfissionalDaAgenda[] = [
  {
    id: 1,
    nome: 'Profissional Fictício A',
    foto_versao: null,
    horarios: todosOsDias('08:00', '12:00'),
    obs: 'Atende só pela manhã',
    especialidades: [{ id: 1, nome: 'Fonoaudiologia' }],
  },
  {
    id: 2,
    nome: 'Profissional Fictício B',
    foto_versao: null,
    horarios: todosOsDias('08:00', '18:00'),
    obs: null,
    especialidades: [{ id: 2, nome: 'Psicologia' }],
  },
]

/**
 * O CADASTRO (`GET /profissionais`) — com `ativo`, que é o que a rota devolve de verdade.
 *
 * O handler servia a forma da AGENDA (sem `ativo`) nesta rota: `opcoesDeProfissional` leria
 * `undefined`, e TODO profissional sumiria do select de autoria. É o `!undefined` do bloqueante
 * do feriado, rearmado dentro da correção — fixture de contrato tem a forma do SERVIDOR.
 */
export const PROFISSIONAIS_DO_CADASTRO: Profissional[] = PROFISSIONAIS_FICTICIOS.map((profissional) => ({
  ...profissional,
  updated_at: '2026-07-15T10:00:00.000000Z',
  obs: profissional.obs ?? null,
  conselho: null,
  uf_conselho: null,
  num_conselho: null,
  cbos_id: null,
  ativo: true,
  horarios: profissional.horarios ?? {},
}))

export const ESPECIALIDADES_FICTICIAS: Especialidade[] = [
  {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    nome: 'Fonoaudiologia',
    cor: '#A85550',
    tempo_sessao: 40,
    exige_termo: false,
    oculta_agendamento_online: false,
  },
  {
    id: 2,
    updated_at: '2026-07-15T10:00:00.000000Z',
    nome: 'Psicologia',
    cor: '#A25E2B',
    tempo_sessao: 40,
    exige_termo: false,
    oculta_agendamento_online: false,
  },
]

export const STATUS_FICTICIOS: StatusAgendamento[] = [
  {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    nome: 'Em Aberto',
    cor: '#64748B',
    cor_borda: null,
    tipo: 'circle-dashed',
    desconta_sessao: false,
    ocupa_horario: true,
    marca_falta: false,
    marca_reserva: false,
    // em aberto: é o que ENTRA na baixa em lote (change baixa-em-lote-por-status)
    em_aberto: true,
    aplicavel_em_lote: false,
    // é o de MENOR ordem: o status INICIAL (com que todo agendamento nasce)
    ordem: 1,
  },
]

/**
 * A forma que o SERVIDOR devolve (`/agenda/selecao`), não a que o tipo antigo prometia.
 *
 * O fixture carregava `ativo: true` — um campo que a whitelist da API não manda. Foi ele que
 * manteve invisível, com 427 testes verdes, o bloqueante em que a grade não pintava feriado
 * NENHUM. Fixture de contrato tem a forma do servidor; senão é teatro de cobertura.
 */
export const FERIADOS_FICTICIOS: FeriadoDaAgenda[] = [
  { id: 1, nome: 'Natal', data: '2020-12-25', recorrente: true },
]

export const CONFIGURACAO_FICTICIA = {
  configuracoes: [
    { chave: 'agenda.granularidade_min', tipo: 'int', valor: 60 },
    { chave: 'agenda.fim_de_semana', tipo: 'string', valor: 'nenhum' },
    { chave: 'agenda.visao_padrao', tipo: 'string', valor: 'dia' },
    { chave: 'agenda.janela_padrao_inicio', tipo: 'string', valor: '08:00' },
    { chave: 'agenda.janela_padrao_fim', tipo: 'string', valor: '19:00' },
    { chave: 'clinica.timezone', tipo: 'string', valor: 'America/Sao_Paulo' },
  ],
}

/** 2026-07-13 é uma segunda-feira. */
export const DIA_FICTICIO = '2026-07-13'

/**
 * O DETALHE (`GET /agendamentos/{id}`) no formato da PRODUÇÃO: os escalares, sem as relações do cartão.
 * Responder o detalhe com um cartão completo escondeu o defeito que derrubava a tela (gate CR-EVO-R2-01).
 */
export function detalheFicticio(card: CardAgendamento = cardFicticio()): DetalheDoAgendamento {
  const {
    paciente: _paciente,
    especialidade: _especialidade,
    status: _status,
    profissional: _profissional,
    sala: _sala,
    tratamento_saldo: _saldo,
    tratamento_total: _total,
    tratamento_realce: _realce,
    convenio: _convenio,
    confirmacao: _confirmacao,
    ...escalares
  } = card

  return escalares
}

export function cardFicticio(sobrescritas: Partial<CardAgendamento> = {}): CardAgendamento {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    tipo: 'atendimento',
    profissional_id: 1,
    paciente_id: 10,
    tratamento_id: 5,
    status_id: 1,
    inicio: `${DIA_FICTICIO} 08:00`,
    fim: `${DIA_FICTICIO} 08:40`,
    duracao_minutos: 40,
    is_reposicao: false,
    paciente: { id: 10, nome: 'Paciente Fictício', nome_social: null },
    especialidade: { id: 1, nome: 'Fonoaudiologia', cor: '#A85550' },
    // `ocupa_horario` é o que a grade lê para decidir se o slot ainda está tomado
    status: { id: 1, nome: 'Em Aberto', cor: '#64748B', cor_borda: null, tipo: 'circle-dashed', ocupa_horario: true },
    profissional: { id: 1, nome: 'Profissional Fictício A' },
    sala: null,
    tratamento_saldo: 9,
    tratamento_realce: 'nenhum' as const,
    tratamento_total: 12,
    convenio: { id: 1, nome: 'Convênio Fictício', particular: false },
    ...sobrescritas,
  }
}

/** Catálogos do formulário (GET /api/agenda/selecao) — whitelist do servidor. */
export const SELECAO_FICTICIA = {
  profissionais: PROFISSIONAIS_FICTICIOS,
  especialidades: ESPECIALIDADES_FICTICIAS,
  feriados: FERIADOS_FICTICIOS,
  salas: [{ id: 1, nome: 'Sala Fictícia 1' }],
  equipamentos: [],
  medicos: [{ id: 1, nome: 'Médico Fictício' }],
  status: [
    { id: 1, nome: 'Em Aberto', cor: '#64748B', cor_borda: null, tipo: 'circle-dashed', ordem: 1, desconta_sessao: false, marca_falta: false, aplicavel_em_lote: false },
    // "Finalizado" e "Falta Justificada" nascem aplicáveis em lote (backfill da change baixa-em-lote-por-status)
    { id: 3, nome: 'Finalizado', cor: '#10B981', cor_borda: null, tipo: 'check', ordem: 3, desconta_sessao: true, marca_falta: false, aplicavel_em_lote: true },
    { id: 4, nome: 'Falta Justificada', cor: '#F59E0B', cor_borda: null, tipo: 'file-check', ordem: 4, desconta_sessao: false, marca_falta: false, aplicavel_em_lote: true },
    { id: 5, nome: 'Não Compareceu', cor: '#EF4444', cor_borda: null, tipo: 'user-x', ordem: 5, desconta_sessao: true, marca_falta: true, aplicavel_em_lote: false },
  ],
}

export const PACIENTES_DA_BUSCA = [
  { id: 10, nome: 'Paciente Fictício', nome_social: null },
  // o mesmo do bloco de recentes — o catálogo do servidor não os exclui
  { id: 11, nome: 'Paciente Fictício Recente', nome_social: null },
]

/**
 * Quem teve movimento de agenda na janela — a seção de atalho da caixa de escolha.
 *
 * O id 11 aparece TAMBÉM em `PACIENTES_DA_BUSCA` de propósito: no servidor o catálogo A→Z
 * inclui quem está nos recentes, e é o dedupe do hook que impede a mesma criança de sair
 * duas vezes na caixa. Com ids disjuntos (como estava), esse dedupe nunca era exercitado —
 * podia sumir sem nenhum teste ficar vermelho (achado CR-BPL-05).
 */
export const PACIENTES_RECENTES = [{ id: 11, nome: 'Paciente Fictício Recente', nome_social: null }]

/**
 * Pacotes do paciente fictício em DUAS especialidades — e um par que EMPATA o rótulo.
 *
 * Com um pacote só (como estava), nem o recorte por especialidade nem o desempate pelo
 * identificador podiam falhar: os dois sumiriam sem nenhum teste ficar vermelho. 6 e 7 são o par
 * empatado (mesma especialidade, mesmo saldo, mesma situação); 5 é o da outra especialidade.
 */
export const TRATAMENTOS_DO_PACIENTE = [
  { id: 5, especialidade_id: 1, status: 'andamento', sessoes_total: 12, sessoes_saldo: 9, vencido: false },
  { id: 6, especialidade_id: 2, status: 'andamento', sessoes_total: 10, sessoes_saldo: 10, vencido: false },
  { id: 7, especialidade_id: 2, status: 'andamento', sessoes_total: 10, sessoes_saldo: 10, vencido: false },
]

/** Handlers dos catálogos + agenda; `cards` define o que a grade recebe. */
export function handlersDaAgenda(cards: CardAgendamento[] = [cardFicticio()]) {
  return [
    msw.get('/api/agenda/configuracoes', () => HttpResponse.json(CONFIGURACAO_FICTICIA)),
    msw.get('/api/profissionais', () => HttpResponse.json(PROFISSIONAIS_DO_CADASTRO)),
    msw.get('/api/especialidades', () => HttpResponse.json(ESPECIALIDADES_FICTICIAS)),
    msw.get('/api/status-agendamento', () => HttpResponse.json(STATUS_FICTICIOS)),
    msw.get('/api/notificacoes', () => HttpResponse.json({})),
    msw.get('/api/agenda', () => HttpResponse.json(cards)),
    // escrita
    msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
    msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)),
    // os quatro modos da rota (change busca-de-paciente-com-lista): o handler DISTINGUE,
    // senão um teste de lista passaria por acidente com a resposta da busca
    msw.get('/api/agenda/selecao/pacientes', ({ request }) => {
      const parametros = new URL(request.url).searchParams
      if (parametros.get('recentes') === '1') return HttpResponse.json(PACIENTES_RECENTES)
      return HttpResponse.json(PACIENTES_DA_BUSCA)
    }),
    msw.get('/api/agenda/selecao/tratamentos', () => HttpResponse.json(TRATAMENTOS_DO_PACIENTE)),
    msw.get('/api/agendamentos/:id/serie', () =>
      HttpResponse.json({ em_serie: false, total: 1, a_partir_deste: 1, futuros: 0 }),
    ),
    msw.get('/api/agendamentos/:id', () => HttpResponse.json(detalheFicticio())),
  ]
}
