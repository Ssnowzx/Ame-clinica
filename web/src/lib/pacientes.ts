import type { Necessidade, PacienteDaLista, Sexo, TipoDeContato } from '@/tipos'

/** Apresentação e cálculo puro do paciente — sem DOM, sem rede. */

export const ROTULOS_DE_SEXO: Record<Sexo, string> = {
  feminino: 'Feminino',
  masculino: 'Masculino',
  outro: 'Outro',
  nao_informado: 'Não informado',
}

export const ROTULOS_DE_NECESSIDADE: Record<Necessidade, string> = {
  sem: 'Sem necessidade especial',
  necessidades_especiais: 'Necessidades especiais',
  outros: 'Outros',
}

export const ROTULOS_DE_CONTATO: Record<TipoDeContato, string> = {
  telefone: 'Telefone',
  celular: 'Celular',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
}

export function rotuloDaNecessidade(necessidade: Necessidade | null): string {
  // null = pré-cadastro ainda sem a ficha completada
  return necessidade === null ? 'Não informado' : (ROTULOS_DE_NECESSIDADE[necessidade] ?? 'Não informado')
}

export function nomeDeExibicao(paciente: Pick<PacienteDaLista, 'nome' | 'nome_social'>): string {
  return paciente.nome_social !== null && paciente.nome_social !== '' ? paciente.nome_social : paciente.nome
}

/**
 * Idade completa em anos a partir de "Y-m-d".
 * @returns Idade em anos, ou `null` se a data não for utilizável (dado torto do
 *   servidor não pode derrubar a lista)
 */
export function anosDeIdade(nascimento: string, hoje: Date = new Date()): number | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nascimento)
  if (partes === null) {
    return null
  }
  const [, ano, mes, dia] = partes.map(Number)

  let idade = hoje.getFullYear() - ano
  const aniversarioPassou =
    hoje.getMonth() + 1 > mes || (hoje.getMonth() + 1 === mes && hoje.getDate() >= dia)
  if (!aniversarioPassou) {
    idade -= 1
  }

  return idade >= 0 ? idade : null
}

/** "8 anos" · "1 ano" · "Não informado" (pré-cadastro) · "—" (data ilegível). */
export function idadeEm(nascimento: string | null, hoje: Date = new Date()): string {
  if (nascimento === null) {
    return 'Não informado'
  }
  const idade = anosDeIdade(nascimento, hoje)
  if (idade === null) {
    return '—'
  }
  return idade === 1 ? '1 ano' : `${idade} anos`
}

/**
 * O paciente é MENOR? A regra é do servidor (menor exige responsável); a tela só
 * a **explica** — por isso este cálculo existe para orientar, nunca para bloquear.
 */
export function ehMenorDeIdade(nascimento: string, hoje: Date = new Date()): boolean {
  const idade = anosDeIdade(nascimento, hoje)
  return idade !== null && idade < 18
}

/** Só dígitos — é o que a API aceita (`digits:11`). */
export function apenasDigitos(valor: string): string {
  return valor.replaceAll(/\D/g, '')
}

/** "529.982.247-25" enquanto se digita; a API recebe os 11 dígitos. */
export function formatarCpf(valor: string): string {
  const digitos = apenasDigitos(valor).slice(0, 11)

  return digitos
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4')
}

/** "12/03/2019 às 14:05" — o registro do consentimento, legível. */
export function dataHoraLegivel(iso: string): string {
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) {
    return iso
  }
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(data)
}
