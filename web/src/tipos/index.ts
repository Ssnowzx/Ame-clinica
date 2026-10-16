export interface Usuario {
  id: number
  nome: string
  email: string
  acesso_mobile: boolean
  ativo: boolean
  /** Vínculo com o profissional executante (quando o usuário é um deles) */
  profissional_id: number | null
  nivel_permissao_id: number | null
  nivel_permissao: string | null
  /** Lista plana `modulo.acao` — guard de UI apenas; o servidor decide */
  permissoes: string[]
  /** token da concorrência otimista (If-Match) */
  updated_at: string
  /** Identidade visual da clínica — viaja no /me porque o shell é de todos */
  marca: MarcaDaClinica
  /** versão de cache-bust da foto de perfil; `null` = sem foto (cai para o ícone) */
  avatar_versao: string | null
}

/** O que a barra lateral exibe no lugar do nome do produto (identidade-da-clinica). */
export interface MarcaDaClinica {
  /** `clinica.nome` efetivo — vazio cai no nome do produto */
  nome: string
  /** `nome` | `logo` */
  identidade: string
  /** chave da fonte curada (`padrao` | `serifada` | `arredondada` | `manuscrita`) */
  fonte: string
  /**
   * `clinica.tema` (`padrao` | `menta` | `xclinicas`), changes tema-da-clinica, tema-xclinicas e tema-menta.
   * Opcional porque um /me anterior ao deploy não o traz — ausente vale o Padrão.
   */
  tema?: string
  /** versão de cache-bust da logo; `null` = sem logo (cai para o nome) */
  logo_versao: string | null
}

export * from '@/tipos/administracao'
export * from '@/tipos/agenda'
export * from '@/tipos/agenda-escrita'
export * from '@/tipos/anamneses'
export * from '@/tipos/atendimentos'
export * from '@/tipos/auditoria'
export * from '@/tipos/cadastros'
export * from '@/tipos/ciclos'
export * from '@/tipos/dre'
export * from '@/tipos/financeiro'
export * from '@/tipos/indicadores'
export * from '@/tipos/catalogos'
export * from '@/tipos/lista-espera'
export * from '@/tipos/mensageria'
export * from '@/tipos/tarefas'
export * from '@/tipos/termos'
export * from '@/tipos/tratamentos'
export * from '@/tipos/cadastro-online'
export * from '@/tipos/relatorios'
