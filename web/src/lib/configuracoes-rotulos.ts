/*
 * As listas de GRUPOS e de RÓTULOS saíram daqui (change secoes-das-configuracoes).
 *
 * Elas duplicavam o catálogo do servidor e divergiram dele em produção: a change
 * `mensageria-whatsapp` acrescentou as chaves `whatsapp.*`, ninguém as acrescentou aqui, e a
 * administradora da clínica viu `whatsapp.limite_mensal` cru na tela (validação de
 * 2026-08-21). Agora `rotulo` e `secao` vêm na leitura, e chave sem eles é erro de catálogo.
 *
 * O que fica neste arquivo é o que NÃO é rótulo de chave: a chave de widget dedicado, as de
 * identidade e a tradução dos VALORES de whitelist.
 */

export const CHAVE_ENCADEAMENTO_ALVO = 'agenda.encadeamento_status_id'

/** Rótulos pt-BR de opções enumeradas conhecidas (fallback: a própria opção). */
const OPCAO_ROTULO: Record<string, string> = {
  nenhum: 'Nenhum',
  sabado: 'Sábado',
  domingo: 'Domingo',
  ambos: 'Sábado e domingo',
  dia: 'Dia',
  semana: 'Semana',
  geral: 'Visão geral',
  nome: 'Nome da clínica',
  logo: 'Logo',
  padrao: 'Padrão',
  serifada: 'Serifada',
  arredondada: 'Arredondada',
  manuscrita: 'Manuscrita',
  // tema de cores (changes tema-da-clinica e tema-menta): nenhum tema leva o nome de uma clínica
  menta: 'Menta',
  // a marca do produto (change tema-xclinicas), oferecida a toda clínica
  xclinicas: 'Xclinicas',
  // ação do eixo PACIENTE do conflito (conflito-do-paciente): o verbo cru não diz o que
  // acontece com o agendamento, e é isso que a administradora precisa saber ao escolher
  bloquear: 'Bloquear o agendamento',
  avisar: 'Avisar e deixar salvar',
  permitir: 'Permitir sem avisar',
  // o toque em "Preciso desmarcar" no lembrete (lembrete-com-botoes-de-resposta): o verbo cru não
  // diz que "sinalizar" deixa a sessão marcada, e é isso que a clínica decide ao escolher. Pelo
  // EFEITO, não pela cor do alerta (achado A11Y-BT-10 do gate: "em vermelho" não diz nada a quem
  // não vê a cor)
  sinalizar: 'Avisar a recepção, que resolve',
  desmarcar: 'Desmarcar sozinho',
}

export function rotuloDaOpcao(opcao: string): string {
  return OPCAO_ROTULO[opcao] ?? opcao
}

/**
 * As chaves da identidade visual têm widget DEDICADO (SecaoIdentidadeDaClinica) —
 * ficam fora da lista genérica da aba Clínica para não renderizar em dobro.
 */
export const CHAVES_DE_IDENTIDADE = ['clinica.identidade', 'clinica.fonte_do_nome', 'clinica.tema'] as const

/** Stack CSS de cada fonte da marca (tokens em index.css) — fallback: padrão. */
const FONTE_DA_MARCA: Record<string, string> = {
  padrao: 'var(--fonte-marca-padrao)',
  serifada: 'var(--fonte-marca-serifada)',
  arredondada: 'var(--fonte-marca-arredondada)',
  manuscrita: 'var(--fonte-marca-manuscrita)',
}

export function fonteDaMarca(fonte: string | undefined): string {
  return FONTE_DA_MARCA[fonte ?? 'padrao'] ?? FONTE_DA_MARCA.padrao
}
