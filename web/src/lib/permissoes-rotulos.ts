/**
 * Rótulos pt-BR do catálogo de permissões (§12) — APRESENTAÇÃO, não regra. O catálogo
 * de permissões é DADO do servidor (`GET /permissoes`); estes rótulos só o traduzem para
 * a tela de níveis. Módulo/ação sem rótulo conhecido renderiza com o nome CRU — o
 * catálogo cresce por change e a tela nunca esconde permissão nova (SEC-ADM-08).
 */

/** As flags de ESCOPO (D11) — vivem fora da grade módulo×ação, na seção de escopo. */
export const FLAGS_DE_ESCOPO = ['agenda.ver_todos', 'clinico.ver_todos'] as const

/**
 * As permissões que só FUNCIONAM com `agenda.ver_todos` quando o usuário não tem vínculo com um
 * profissional (rodada 4 de `vinculo-previo-para-agendar`, `SEC-VP-37`): a flag é o escopo
 * OPERACIONAL — pacotes, faturamento de sessão, presença, avisos e a própria agenda. Um nível de
 * balcão (recepção, faturamento) com estas permissões e sem a flag nasce cego, de propósito: é a
 * proteção contra vínculo perdido (fail-closed, SEC-VP-02). A tela avisa; não bloqueia, porque o
 * nível Profissional (agenda.* sem a flag, COM vínculo) é legítimo.
 */
export function precisaDaFlagOperacional(permissao: string): boolean {
  return (
    permissao.startsWith('tratamentos.') ||
    permissao.startsWith('lista_espera.') ||
    (permissao.startsWith('agenda.') && permissao !== 'agenda.ver_todos') ||
    permissao === 'lancamentos.criar' ||
    permissao === 'lancamentos.pagar' ||
    permissao === 'pacientes.ver'
  )
}

/** A permissão que equivale a administração total efetiva da clínica (SEC-ADM-02). */
export const PERMISSAO_ADMIN_TOTAL = 'niveis_permissao.editar'

/** Ordem canônica das colunas de ação; ações fora dela vão para o fim, com nome cru. */
export const ORDEM_DAS_ACOES = ['ver', 'criar', 'editar', 'excluir', 'pagar'] as const

/**
 * Mínimo de MÓDULOS que precisam ter uma ação para ela virar COLUNA da grade (design D1).
 *
 * O catálogo cresce por change e chegou a 11 ações distintas — mais colunas do que cabe no
 * `max-w-2xl` do diálogo, e as últimas ficavam CORTADAS na borda do modal (achado da validação
 * em produção, 2026-08-26). Seis dessas ações pertencem a UM módulo cada (`pagar`,
 * `assinar_por_outro`, `conectar`, `responder`, `fechar`, `reabrir`): coluna inteira para uma
 * célula. Abaixo do limiar a permissão vira caixa ROTULADA na linha do próprio módulo — some
 * das colunas, nunca da tela (SEC-ADM-08). Derivado do catálogo: no dia em que um segundo módulo
 * ganhar `pagar`, "Pagar" volta a ser coluna sozinha.
 */
export const LIMIAR_DE_COLUNA = 2

const ACAO_ROTULO: Record<string, string> = {
  ver: 'Ver',
  criar: 'Criar',
  editar: 'Editar',
  excluir: 'Excluir',
  pagar: 'Pagar',
  // as que chegaram com changes posteriores e ninguém traduziu: a grade exibia
  // `assinar_por_outro` em snake_case ao lado de "Ver/Criar/Editar" — chave de máquina na
  // tela de quem administra a clínica (achado da validação em produção, 2026-08-21)
  ver_todos: 'Ver de todos',
  assinar_por_outro: 'Assinar por outro',
  conectar: 'Conectar',
  conferir: 'Conferir',
  responder: 'Responder',
  fechar: 'Fechar',
  reabrir: 'Reabrir',
  arquivar: 'Arquivar',
  aprovar: 'Aprovar',
  baixar: 'Dar baixa',
  estornar: 'Estornar',
  transferir: 'Transferir',
  // a ação genérica; a do repasse tem o rótulo POR EXTENSO em `ROTULO_DA_PERMISSAO` (abaixo)
  ver_proprio: 'Ver o próprio',
}

/**
 * O rótulo de UMA permissão quando o nome da ação, sozinho, não diz o efeito (spec rbac, change
 * painel-do-profissional): `repasse.ver_proprio` não abre "o próprio repasse" — abre o que ENTROU no caixa
 * pelos atendimentos de quem tem vínculo com um profissional, e só dele. A grade diz isso por extenso,
 * para quem monta o nível saber o que está concedendo.
 */
const ROTULO_DA_PERMISSAO: Record<string, string> = {
  'repasse.ver_proprio': 'Ver o que recebeu pelos próprios atendimentos',
}

const MODULO_ROTULO: Record<string, string> = {
  usuarios: 'Usuários',
  niveis_permissao: 'Níveis de permissão',
  configuracoes: 'Configurações',
  auditoria: 'Auditoria',
  especialidades: 'Especialidades',
  convenios: 'Convênios',
  servicos: 'Serviços',
  salas: 'Salas',
  equipamentos: 'Equipamentos',
  medicos: 'Médicos solicitantes',
  anamnese_modelos: 'Modelos de anamnese',
  status_agendamento: 'Status de agendamento',
  termos_consentimento: 'Termo de consentimento',
  profissionais: 'Profissionais',
  pacientes: 'Pacientes',
  tratamentos: 'Tratamentos',
  agenda: 'Agenda',
  feriados: 'Feriados',
  lista_espera: 'Lista de espera',
  atendimentos: 'Atendimentos',
  evolucoes: 'Evoluções',
  anamneses: 'Anamneses',
  contas: 'Contas',
  cartoes: 'Cartões',
  tipos_pagamento: 'Formas de pagamento',
  categorias: 'Categorias',
  fornecedores: 'Fornecedores',
  funcionarios: 'Funcionários',
  lancamentos: 'Lançamentos',
  transferencias: 'Transferências',
  informativos: 'Informativos',
  // idem, dos módulos que nasceram depois deste dicionário
  anexos: 'Anexos do paciente',
  ciclos: 'Ciclos de faturamento',
  fluxo_caixa: 'Fluxo de caixa',
  repasse: 'Repasse ao profissional',
  mensagens: 'Mensagens (WhatsApp)',
  tarefas: 'Tarefas da equipe',
  clinico: 'Prontuário clínico',
  relatorios: 'Relatórios',
  indicadores: 'Indicadores',
  notificacoes: 'Notificações',
  presenca: 'Presença',
  pendencias: 'Pendências de retorno',
  cadastro_online: 'Cadastro pelo link',
}

/** Áreas da grade, na ordem de leitura da clínica; `outros` fecha a lista (design D2). */
export const ORDEM_DAS_AREAS = [
  'administracao',
  'cadastros',
  'agenda',
  'clinico',
  'financeiro',
  'comunicacao',
  'outros',
] as const

export type AreaDeModulo = (typeof ORDEM_DAS_AREAS)[number]

export const AREA_ROTULO: Record<AreaDeModulo, string> = {
  administracao: 'Administração',
  cadastros: 'Cadastros',
  agenda: 'Agenda',
  clinico: 'Clínico',
  financeiro: 'Financeiro',
  comunicacao: 'Comunicação e equipe',
  outros: 'Outros',
}

/**
 * Área de cada módulo — APRESENTAÇÃO, como os rótulos: o servidor não sabe o que é "área".
 * Só os módulos que EXISTEM no catálogo hoje; módulo novo cai em `outros` e continua visível
 * e marcável (a queda é para o dicionário atrasado, nunca para esconder permissão).
 */
const AREA_POR_MODULO: Record<string, AreaDeModulo> = {
  usuarios: 'administracao',
  niveis_permissao: 'administracao',
  configuracoes: 'administracao',
  auditoria: 'administracao',
  termos_consentimento: 'administracao',
  especialidades: 'cadastros',
  convenios: 'cadastros',
  servicos: 'cadastros',
  salas: 'cadastros',
  equipamentos: 'cadastros',
  medicos: 'cadastros',
  anamnese_modelos: 'cadastros',
  status_agendamento: 'cadastros',
  profissionais: 'cadastros',
  agenda: 'agenda',
  feriados: 'agenda',
  lista_espera: 'agenda',
  pacientes: 'clinico',
  tratamentos: 'clinico',
  atendimentos: 'clinico',
  evolucoes: 'clinico',
  anamneses: 'clinico',
  anexos: 'clinico',
  clinico: 'clinico',
  contas: 'financeiro',
  cartoes: 'financeiro',
  tipos_pagamento: 'financeiro',
  categorias: 'financeiro',
  fornecedores: 'financeiro',
  funcionarios: 'financeiro',
  lancamentos: 'financeiro',
  transferencias: 'financeiro',
  fluxo_caixa: 'financeiro',
  repasse: 'financeiro',
  ciclos: 'financeiro',
  mensagens: 'comunicacao',
  informativos: 'comunicacao',
  tarefas: 'comunicacao',
  cadastro_online: 'cadastros',
}

/** Área do módulo, ou `outros` quando o dicionário não o conhece (nunca some). */
export function areaDoModulo(modulo: string): AreaDeModulo {
  return AREA_POR_MODULO[modulo] ?? 'outros'
}

/** Rótulo pt-BR de um módulo, ou o nome cru se desconhecido (nunca some). */
export function rotuloDoModulo(modulo: string): string {
  return MODULO_ROTULO[modulo] ?? modulo
}

/** Rótulo pt-BR de uma ação, ou o nome cru se desconhecido. */
export function rotuloDaAcao(acao: string): string {
  return ACAO_ROTULO[acao] ?? acao
}

/** Rótulo da ação DENTRO de um módulo: o por extenso da permissão, quando existe, ou o da ação. */
export function rotuloDaAcaoNoModulo(modulo: string, acao: string): string {
  return ROTULO_DA_PERMISSAO[`${modulo}.${acao}`] ?? rotuloDaAcao(acao)
}

/** Separa `modulo.acao` no primeiro ponto (o resto é a ação, ex.: `ver_todos`). */
export function partirPermissao(permissao: string): { modulo: string; acao: string } {
  const ponto = permissao.indexOf('.')
  return ponto === -1
    ? { modulo: permissao, acao: '' }
    : { modulo: permissao.slice(0, ponto), acao: permissao.slice(ponto + 1) }
}

/** Texto das flags de escopo (SEC-ADM-09) — as três situações, com o fail-closed dito. */
export const EXPLICACAO_DAS_FLAGS: Record<(typeof FLAGS_DE_ESCOPO)[number], { rotulo: string; ajuda: string }> = {
  'agenda.ver_todos': {
    rotulo: 'Operar a agenda e os pacotes de toda a clínica',
    ajuda:
      'Marcada: este nível alcança a agenda, os pacotes (tratamentos), o faturamento de sessão, a ' +
      'presença e os avisos de TODOS os profissionais — sempre dentro das permissões marcadas acima; ' +
      'a caixa não abre nenhuma tela por si. É a caixa da recepção e do faturamento. ' +
      'Desmarcada, com o usuário vinculado a um profissional: só o que é do próprio profissional, e ' +
      'ele só marca e cadastra pacote para crianças que já atende. ' +
      'Desmarcada e sem vínculo: não vê nem opera nada disso.',
  },
  'clinico.ver_todos': {
    rotulo: 'Ler o prontuário de toda a clínica',
    ajuda:
      'Marcada: lê anamnese, atendimentos e evoluções de TODAS as crianças — dado de saúde de ' +
      'menores (art. 11 da LGPD). Só para administração: recepção e faturamento não precisam dela. ' +
      'Desmarcada, com o usuário vinculado a um profissional: só o prontuário das crianças que ele ' +
      'atende. Desmarcada e sem vínculo: nenhum prontuário.',
  },
}

/**
 * Usuário ou nível com permissão que a pessoa não tem não se edita por ela (change
 * `trava-de-usuarios-e-niveis`): o servidor recusaria com 403, e a tela diz por quê no lugar do botão.
 */
export const ACIMA_DO_SEU_ACESSO = 'Tem acesso que você não tem'
