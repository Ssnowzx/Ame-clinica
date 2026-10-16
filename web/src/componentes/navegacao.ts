import {
  Baby,
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileText,
  FolderCog,
  Inbox,
  ListTodo,
  MessageSquare,
  ScrollText,
  Settings,
  Stethoscope,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

import { PERMISSOES_DE_CADASTRO, PERMISSOES_DE_INDICADORES, PERMISSOES_DE_RELATORIOS } from '@/lib/catalogos'

/**
 * Navegação do §4 — declarativa: rota + ícone + permissão exigida.
 *
 * Só entram itens de tela QUE EXISTEM: cada change de tela acrescenta o seu
 * (link morto ou item "em breve" é ruído). A estrutura completa do mapa do §4
 * (Cadastros, Financeiro, Indicadores, Relatórios, Configurações, Usuários)
 * está documentada no design.md e chega junto com as respectivas telas.
 *
 * UM array só, com `secao` marcando o que é SISTEMA — um segundo array paralelo
 * deixaria um consumidor futuro (command palette, teste rota×menu) importar o
 * nome óbvio e perder Configurações em silêncio (achado do parecer).
 *
 * Esconder um item é EXPERIÊNCIA, nunca controle de acesso — o servidor decide
 * (o mesmo endpoint responde 403 se a URL for digitada à mão).
 */
export interface ItemDeNavegacao {
  rotulo: string
  rota: string
  icone: LucideIcon
  /**
   * Permissão `modulo.acao` exigida — ou uma lista, e basta ter QUALQUER uma.
   *
   * AUSENTE = destino aberto a todo usuário autenticado. É declaração explícita de que
   * **não há dado da clínica para autorizar** (hoje, só o Manual: texto do produto, zero
   * chamada de API), nunca o resultado de esquecer de preencher — a guarda de contrato em
   * `navegacao.contrato.test.ts` fixa a lista EXATA de rotas que podem nascer assim, e um
   * item novo sem permissão derruba a suíte até alguém decidir de propósito.
   */
  permissao?: string | readonly string[]
  /**
   * Ausente = operação do dia (a lista que rola). `'sistema'` = rodapé ancorado
   * do cartão: Manual e Configurações não se abrem no meio de um atendimento —
   * saem da fila que a recepção percorre o dia todo e ganham endereço FIXO,
   * quantos destinos a operação venha a ter. A ORDEM do array é a da tela: o
   * manual vem antes do que ele explica.
   */
  secao?: 'sistema'
  /** Todo destino de OPERAÇÃO pertence a um grupo (o rodapé de sistema não). */
  grupo?: GrupoDeOperacao
}

export type GrupoDeOperacao = 'atendimento' | 'gestao' | 'administracao'

/** Na ordem em que aparecem na barra — a ordem dos ITENS dentro de cada grupo é a de sempre. */
export const GRUPOS_DE_OPERACAO: ReadonlyArray<{ chave: GrupoDeOperacao; rotulo: string }> = [
  { chave: 'atendimento', rotulo: 'Atendimento' },
  { chave: 'gestao', rotulo: 'Gestão' },
  { chave: 'administracao', rotulo: 'Administração' },
]

export const ITENS_DE_NAVEGACAO: readonly ItemDeNavegacao[] = [
  { rotulo: 'Agenda', rota: '/agenda', icone: CalendarDays, permissao: 'agenda.ver', grupo: 'atendimento' },
  { rotulo: 'Lista de espera', rota: '/lista-espera', icone: Users, permissao: 'lista_espera.ver', grupo: 'atendimento' },
  { rotulo: 'Pacientes', rota: '/pacientes', icone: Baby, permissao: 'pacientes.ver', grupo: 'atendimento' },
  // os cadastros que as famílias enviaram pelo link, esperando conferência
  // (change cadastro-online-do-paciente)
  {
    rotulo: 'Cadastros recebidos',
    rota: '/cadastros-recebidos',
    icone: Inbox,
    permissao: 'cadastro_online.conferir',
    grupo: 'atendimento',
  },
  { rotulo: 'Profissionais', rota: '/profissionais', icone: Stethoscope, permissao: 'profissionais.ver', grupo: 'atendimento' },
  { rotulo: 'Tratamentos', rota: '/tratamentos', icone: ClipboardList, permissao: 'tratamentos.ver', grupo: 'atendimento' },
  { rotulo: 'Financeiro', rota: '/financeiro', icone: Wallet, permissao: 'lancamentos.ver', grupo: 'gestao' },
  // mural interno da equipe (kanban-da-equipe) — sem dado de paciente
  { rotulo: 'Tarefas', rota: '/tarefas', icone: ListTodo, permissao: 'tarefas.ver', grupo: 'gestao' },
  // canal de WhatsApp (mensageria-whatsapp): módulo PRÓPRIO — a recepção responde a
  // família sem por isso ganhar acesso a prontuário
  { rotulo: 'Mensagens', rota: '/mensagens', icone: MessageSquare, permissao: 'mensagens.ver', grupo: 'gestao' },
  // dashboard do §11: composto por módulo dono — QUALQUER uma das quatro mostra o item
  { rotulo: 'Indicadores', rota: '/indicadores', icone: BarChart3, permissao: PERMISSOES_DE_INDICADORES, grupo: 'gestao' },
  // a área de relatórios (area-de-relatorios): sem permissão guarda-chuva — QUALQUER
  // permissão de um relatório do catálogo mostra o item; cada cartão e cada rota exigem
  // TODAS as do seu relatório, e o servidor decide de verdade (403)
  { rotulo: 'Relatórios', rota: '/relatorios', icone: FileText, permissao: PERMISSOES_DE_RELATORIOS, grupo: 'gestao' },
  // um item, não sete: sete cadastros soltos fariam do menu uma lista de treze —
  // o "amontoado" que a clínica reclama do sistema antigo (§2)
  { rotulo: 'Cadastros', rota: '/cadastros', icone: FolderCog, permissao: PERMISSOES_DE_CADASTRO, grupo: 'administracao' },
  // administração de acesso (§12): Usuários + Níveis num item só (o mapa do §4) — basta
  // QUALQUER uma das duas permissões para o item aparecer
  { rotulo: 'Usuários', rota: '/usuarios', icone: UserCog, permissao: ['usuarios.ver', 'niveis_permissao.ver'], grupo: 'administracao' },
  // trilha de auditoria (§12, auditoria-tela): consulta somente-leitura, só Administrador
  { rotulo: 'Auditoria', rota: '/auditoria', icone: ScrollText, permissao: 'auditoria.ver', grupo: 'administracao' },
  // manual de uso (change manual-do-operador) — item de SISTEMA, ACIMA de Configurações:
  // quem não sabe operar não tem como pedir permissão para aprender, então ele não exige
  // nenhuma. É o único item sem `permissao` (ver a guarda de contrato).
  { rotulo: 'Manual', rota: '/manual', icone: BookOpen, secao: 'sistema' },
  // parametrização da clínica (§13) — item de SISTEMA: rodapé do cartão
  { rotulo: 'Configurações', rota: '/configuracoes', icone: Settings, permissao: 'configuracoes.ver', secao: 'sistema' },
]
