import { PERMISSOES_DE_INDICADORES } from '@/lib/catalogos'

export interface AbaDeIndicadores {
  rotulo: string
  rota: string
  /**
   * Permissões do DESTINO — sem elas a aba nem aparece. Lista = TODAS exigidas (a Equipe cruza
   * agenda e clínica, e a rota confere as duas), salvo `bastaUma`.
   */
  permissao: string | readonly string[]
  /**
   * Basta UMA das permissões: a Visão geral monta cada cartão pela permissão do painel dele, então
   * qualquer módulo dono abre a aba (o mesmo guarda-chuva do item Indicadores da navegação).
   */
  bastaUma?: boolean
  /**
   * Rotas que, sem serem a da aba, são "dentro dela": o detalhe de um profissional
   * (`/indicadores/produtividade/:id`) é porta da tabela da Equipe.
   */
  rotasFilhas?: readonly string[]
}

/** As permissões de uma aba, sempre como lista. */
export function permissoesDaAba(aba: AbaDeIndicadores): readonly string[] {
  return typeof aba.permissao === 'string' ? [aba.permissao] : aba.permissao
}

/** A pessoa vê a aba? Todas as permissões dela — ou uma, quando a aba diz que basta. */
export function abaVisivel(aba: AbaDeIndicadores, permissoes: readonly string[]): boolean {
  const exigidas = permissoesDaAba(aba)

  return aba.bastaUma === true
    ? exigidas.some((permissao) => permissoes.includes(permissao))
    : exigidas.every((permissao) => permissoes.includes(permissao))
}

/**
 * As abas da área de Indicadores (change indicadores-profissionais): a Visão geral executiva e as
 * quatro de detalhe, uma por frente — cada uma sob a permissão do módulo DONO do seu painel.
 *
 * **Só entram abas CONSTRUÍDAS.** BI ("Comparar") entra na sua própria change. A casa já pagou por
 * prometer o que não existe: o painel da agenda teve um "Lançar no financeiro" marcado "Em breve"
 * que precisou de change inteira para virar real — prometer na barra de navegação seria o mesmo
 * erro num lugar mais visível.
 *
 * Em arquivo próprio (sem componente) para não quebrar o fast refresh.
 */
export const ABAS: readonly AbaDeIndicadores[] = [
  { rotulo: 'Visão geral', rota: '/indicadores', permissao: PERMISSOES_DE_INDICADORES, bastaUma: true },
  { rotulo: 'Financeiro', rota: '/indicadores/financeiro', permissao: 'fluxo_caixa.ver' },
  { rotulo: 'Agenda', rota: '/indicadores/agenda', permissao: 'agenda.ver' },
  { rotulo: 'Pacientes', rota: '/indicadores/pacientes', permissao: 'pacientes.ver' },
  // capacidade e marcações são dado da AGENDA; realizadas e evoluções são dado CLÍNICO — as duas
  {
    rotulo: 'Equipe',
    rota: '/indicadores/equipe',
    permissao: ['agenda.ver', 'atendimentos.ver'],
    rotasFilhas: ['/indicadores/produtividade'],
  },
]
