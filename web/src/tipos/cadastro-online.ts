/*
 * O AUTO-CADASTRO PÚBLICO (capabilities `cadastro-online` e `cadastro-online-tela`).
 *
 * O formulário que a família abre pelo link não tem lista própria de campos: ele desenha o que o
 * servidor mandar, com o rótulo que o servidor mandar. É a mesma régua do cadastro interno, vista
 * pela chave `online` — e é por isso que duas configurações produzem formulários diferentes no mesmo
 * deploy sem uma linha de condicional aqui.
 */

/** A marca da clínica, e SÓ ela: é tudo que a página pública recebe da clínica. */
export interface MarcaPublica {
  nome: string
  /** `logo` só quando existe arquivo; o servidor já degrada para `nome` quando não existe. */
  identidade: 'nome' | 'logo'
  fonte_do_nome: string
  /** `clinica.tema` (change tema-da-clinica); ausente vale o Padrão */
  tema?: string
}

export interface CampoPublico {
  campo: string
  rotulo: string
  secao: string
  /** Campo-coleção (responsáveis, contatos): a tela repete o bloco. */
  lista: boolean
  obrigatorio: boolean
  /** Teto de caracteres do campo, do servidor — `null` quando não há (change `tetos-do-cadastro-na-tela`). */
  tamanho: number | null
  /** Tetos dos subcampos de um campo-lista. */
  tamanhos_dos_itens: Record<string, number>

}

export interface SecaoPublica {
  secao: string
  rotulo: string
}

/** O que `GET /api/publico/cadastro/{slug}` devolve. */
export interface FormularioPublico {
  clinica: MarcaPublica
  secoes: SecaoPublica[]
  campos: CampoPublico[]
}

/** Um responsável, como o boundary o aceita. */
export interface ResponsavelDoEnvio {
  nome: string
  parentesco: string
  telefone?: string
}

/** Um contato, como o boundary o aceita. */
export interface ContatoDoEnvio {
  tipo: 'telefone' | 'celular' | 'whatsapp' | 'email'
  valor: string
}

/**
 * O corpo do envio. Frouxo de propósito: quem decide as chaves é a régua da clínica, e enumerá-las
 * aqui criaria a lista paralela que a capability inteira existe para não ter.
 */
export type EnvioDeCadastro = Record<string, unknown>

/** Um paciente que já existe e pode ser a mesma pessoa do envio. */
export interface CandidatoParecido {
  id: number
  nome: string
  nome_social?: string | null
  /** Por que ele apareceu: sem isso, quem confere não sabe se olha o CPF ou o telefone. */
  coincide_por: 'cpf' | 'telefone'
}

/** Uma linha da fila de conferência. */
export interface EnvioNaFila {
  id: number
  enviado_em: string
  dados: Record<string, unknown>
  /**
   * AUSENTE (não vazio) para quem não tem `pacientes.ver`: lista vazia diria "procurei e não
   * achei", que já é resposta — e a fila voltaria a ser o oráculo que a resposta cega fecha.
   */
  parecidos?: CandidatoParecido[]
}

/** O estado do link público, do lado de dentro. */
export interface LinkDeCadastro {
  slug: string | null
  ativo: boolean
  url: string | null
}
