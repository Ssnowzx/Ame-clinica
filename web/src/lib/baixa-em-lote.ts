import { dataLegivel, NOMES_DOS_MESES } from '@/lib/datas'
import { diaDaSemana, somarDias } from '@/lib/grade-agenda'
import type { RecusaDaBaixa, SelecaoDaAgenda } from '@/tipos'

/**
 * Helpers PUROS do diálogo "Dar baixa" (change `baixa-em-lote-por-status`): tudo o que a tela
 * escreve a partir de números e datas do servidor, sem `new Date()` — as strings já são a
 * parede da clínica (§13), recortá-las é o cálculo certo (mesma regra de `datas.ts`).
 */

export type StatusDaSelecao = SelecaoDaAgenda['status'][number]

/** Os três alcances da tela (D3): "últimos 7 dias" é açúcar, nunca chave de configuração. */
export type AlcanceDaTela = 'dia' | 'ultimos7' | 'datas'

/** Quantos dias para trás o preset "Últimos 7 dias" alcança, contando a data da agenda. */
const DIAS_DO_PRESET = 7

/** Motivos constantes do servidor (`BaixaEmLote::RECUSA_*`) → título do grupo em pt-BR. */
export const MOTIVO_DA_RECUSA: Record<string, string> = {
  ainda_nao_comecou: 'Ainda não começou',
  sem_saldo: 'Sem saldo no pacote',
  ciclo_fechado: 'Produção do período já fechada',
  atendimento_registrado: 'Já tem atendimento registrado — não pode virar falta',
}

/** Índice de `diaDaSemana` (0 = domingo … 6 = sábado). */
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const
const DIAS_SEM_FEIRA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const

/** Concordância EXPLÍCITA, nunca "(s)" (spec). */
export function plural(quantidade: number, singular: string, pluralizado: string): string {
  return `${String(quantidade)} ${quantidade === 1 ? singular : pluralizado}`
}

/** O primeiro status aplicável em lote na `ordem` do cadastro — regra de dado, zero config (D4). */
export function statusAplicaveisEmLote(status: readonly StatusDaSelecao[]): StatusDaSelecao[] {
  return status
    .filter((item) => item.aplicavel_em_lote)
    .sort((a, b) => a.ordem - b.ordem || a.id - b.id)
}

/** A consequência derivada das FLAGS do status escolhido (§13) — nunca do nome. */
export function consequenciaDoStatus(status: Pick<StatusDaSelecao, 'desconta_sessao' | 'marca_falta'>): string {
  if (status.desconta_sessao) {
    return 'Desconta uma sessão do pacote de cada criança.'
  }
  if (status.marca_falta) {
    return 'Conta como falta para a criança.'
  }

  return 'Só muda o status.'
}

/** `de`/`ate` de cada alcance a partir da data da agenda; "Escolher datas" usa o que foi digitado. */
export function intervaloDoAlcance(
  alcance: AlcanceDaTela,
  dataDaAgenda: string,
  escolhido: { de: string; ate: string },
): { de: string; ate: string } {
  if (alcance === 'dia') {
    return { de: dataDaAgenda, ate: dataDaAgenda }
  }
  if (alcance === 'ultimos7') {
    return { de: somarDias(dataDaAgenda, -(DIAS_DO_PRESET - 1)), ate: dataDaAgenda }
  }

  return escolhido
}

/** `2026-09-10` → `10/09`. */
export function diaEMes(iso: string): string {
  return dataLegivel(iso).slice(0, 5)
}

/** `2026-09-10` → `quinta, 10 de setembro` (o apoio de "Dia à vista"). */
export function diaEmPalavrasCurto(iso: string): string {
  const [, mes = 1, dia = 1] = iso.split('-').map(Number)
  const nomeDoMes = NOMES_DOS_MESES[mes - 1] ?? ''

  return `${DIAS_SEM_FEIRA[diaDaSemana(iso)]}, ${dia === 1 ? '1º' : String(dia)} de ${nomeDoMes}`
}

/** `2026-09-10 14:10` → `{ dia: 'qui 10/09', hora: '14:10', data: '2026-09-10' }`. */
export function partesDoInicio(inicio: string): { dia: string; hora: string; data: string } {
  const [data = '', hora = ''] = inicio.split(' ')

  return { data, dia: `${DIAS_CURTOS[diaDaSemana(data)]} ${diaEMes(data)}`, hora: hora.slice(0, 5) }
}

/** Quantas e QUAIS linhas por motivo — a lista crua repetia a mesma frase e não dizia nada. */
export function agruparPorMotivo(itens: readonly RecusaDaBaixa[]): Map<string, RecusaDaBaixa[]> {
  const porMotivo = new Map<string, RecusaDaBaixa[]>()
  for (const item of itens) {
    const grupo = porMotivo.get(item.motivo) ?? []
    grupo.push(item)
    porMotivo.set(item.motivo, grupo)
  }

  return porMotivo
}

/** Título do grupo: a constante traduzida ou a frase crua do domínio (D6), sempre com a contagem. */
export function tituloDoGrupo(motivo: string, quantidade: number): string {
  return `${MOTIVO_DA_RECUSA[motivo] ?? motivo} (${String(quantidade)})`
}

/**
 * O que a caixa diz quando a prévia conta ZERO elegíveis. Sem recusado, a agenda está mesmo
 * fechada. Com recusados há agenda em aberto que só não pode receber a baixa AGORA (ainda não
 * começou, sem saldo…) — dizer "já está com baixa" nesse caso é falso, e a mesma caixa listava
 * os em aberto logo abaixo (achado do gate: 0 elegíveis + "Ficam de fora").
 */
export function fraseDaPreviaVazia(recusados: number): string {
  if (recusados === 0) {
    return 'Nada em aberto nesse alcance — a agenda já está com baixa, ou escolha outra data.'
  }
  if (recusados === 1) {
    return 'O único agendamento em aberto nesse alcance não pode receber a baixa agora — veja o motivo em “Ficam de fora”.'
  }

  return `Nenhum dos ${String(recusados)} agendamentos em aberto nesse alcance pode receber a baixa agora — veja os motivos em “Ficam de fora”.`
}

/** O anúncio da região viva no mesmo caso: quem só OUVE recebe o número de recusados também. */
export function anuncioDaPreviaVazia(recusados: number): string {
  if (recusados === 0) {
    return fraseDaPreviaVazia(0)
  }

  return `Prévia: nenhum agendamento pode receber a baixa agora, ${plural(recusados, 'fica de fora', 'ficam de fora')}`
}
