/**
 * Dados de EXEMPLO do mostruário — 100% fictícios (T-ds-08/LGPD: nunca dado
 * que possa ser de paciente real). Os hex abaixo simulam a COR CRUA vinda do
 * cadastro da clínica (status_agendamento.cor / especialidades.cor) e por isso
 * vivem num módulo de dados (.ts): em componente (.tsx), cor literal é
 * violação do contrato §8.2 — aqui é insumo de demonstração da sanitização.
 */

/** Os 10 status default seedados pelo backend (StatusAgendamentoDefaults) */
export const STATUS_EXEMPLO: ReadonlyArray<{ nome: string; cor: string; tipo: string }> = [
  { nome: 'Em Aberto', cor: '#64748B', tipo: 'circle-dashed' },
  { nome: 'Aguardando Atendimento', cor: '#F59E0B', tipo: 'clock' },
  { nome: 'Finalizado', cor: '#10B981', tipo: 'check' },
  { nome: 'Finalizado com Evolução', cor: '#059669', tipo: 'clipboard-check' },
  { nome: 'Não Compareceu', cor: '#EF4444', tipo: 'user-x' },
  { nome: 'Falta Justificada', cor: '#F97316', tipo: 'file-check' },
  { nome: 'Desmarcado pelo Profissional', cor: '#94A3B8', tipo: 'calendar-x' },
  { nome: 'Reserva de Agenda', cor: '#8B5CF6', tipo: 'bookmark' },
  { nome: 'Consulta', cor: '#3B82F6', tipo: 'stethoscope' },
  { nome: 'Reposição', cor: '#14B8A6', tipo: 'rotate-ccw' },
]

/** Paleta default das 12 especialidades (design-system.md §2.4) */
export const ESPECIALIDADES_EXEMPLO: ReadonlyArray<{ nome: string; cor: string }> = [
  { nome: 'Fonoaudiologia', cor: '#A85550' },
  { nome: 'Psicologia', cor: '#A25E2B' },
  { nome: 'Terapia Ocupacional', cor: '#8F6B09' },
  { nome: 'Psicopedagogia', cor: '#707920' },
  { nome: 'Fisioterapia', cor: '#448247' },
  { nome: 'Musicoterapia', cor: '#09856E' },
  { nome: 'Neuropsicologia', cor: '#0A818B' },
  { nome: 'Nutrição', cor: '#177BA8' },
  { nome: 'Psicomotricidade', cor: '#526FB2' },
  { nome: 'Arteterapia', cor: '#7763AB' },
  { nome: 'Equoterapia', cor: '#915A95' },
  { nome: 'Hidroterapia', cor: '#A35475' },
]

/** Demonstração do fail-safe: cor maliciosa/inválida cai no tom neutro */
export const COR_INVALIDA_EXEMPLO = 'red;position:fixed'

/**
 * Lista do `CampoBusca` no mostruário — FICTÍCIA e local (T-aes-14): o
 * mostruário nunca consulta o cadastro real de pacientes.
 */
export const PACIENTES_DO_MOSTRUARIO: ReadonlyArray<{ valor: number; rotulo: string }> = [
  { valor: 1, rotulo: 'Paciente Exemplo A' },
  { valor: 2, rotulo: 'Paciente Exemplo B' },
  { valor: 3, rotulo: 'Paciente Exemplo C' },
  { valor: 4, rotulo: 'Paciente Exemplo D' },
]

/** Papéis semânticos de cor exibidos na paleta do mostruário */
export const PAPEIS_DE_COR: ReadonlyArray<{ token: string; classe: string; papel: string }> = [
  { token: '--fundo', classe: 'bg-fundo', papel: 'fundo da página/app shell' },
  { token: '--superficie', classe: 'bg-superficie', papel: 'cards, painéis, inputs' },
  { token: '--texto', classe: 'bg-texto', papel: 'texto principal' },
  { token: '--texto-suave', classe: 'bg-texto-suave', papel: 'secundário, metadados' },
  { token: '--linha', classe: 'bg-linha', papel: 'divisórias decorativas' },
  { token: '--linha-forte', classe: 'bg-linha-forte', papel: 'bordas de card, cabeçalho' },
  { token: '--borda-campo', classe: 'bg-borda-campo', papel: 'borda de input/select' },
  { token: '--acento', classe: 'bg-acento', papel: 'ação primária, link, ativo' },
  { token: '--acento-suave', classe: 'bg-acento-suave', papel: 'seleção leve, hover fantasma' },
  { token: '--selecao', classe: 'bg-selecao', papel: 'linha/slot selecionado' },
  { token: '--perigo', classe: 'bg-perigo', papel: 'Botao perigo (único bloco sólido)' },
  { token: '--perigo-suave', classe: 'bg-perigo-suave', papel: 'erros, banners e card SEM SALDO' },
  { token: '--sucesso-suave', classe: 'bg-sucesso-suave', papel: 'toast sucesso' },
  { token: '--alerta-suave', classe: 'bg-alerta-suave', papel: 'avisos e card de pacote ACABANDO' },
  { token: '--info-suave', classe: 'bg-info-suave', papel: 'informativos' },
]
