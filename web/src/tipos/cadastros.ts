/** Cadastros de PESSOAS (payload REAL da API). */

import type { HorariosPorDia } from '@/tipos/catalogos'

export const SEXOS = ['feminino', 'masculino', 'outro', 'nao_informado'] as const
export type Sexo = (typeof SEXOS)[number]

export const NECESSIDADES = ['sem', 'necessidades_especiais', 'outros'] as const
export type Necessidade = (typeof NECESSIDADES)[number]

export const TIPOS_DE_CONTATO = ['telefone', 'celular', 'whatsapp', 'email'] as const
export type TipoDeContato = (typeof TIPOS_DE_CONTATO)[number]

export interface ResponsavelDoPaciente {
  nome: string
  parentesco: string
  telefone?: string | null
  email?: string | null
}

export interface ContatoDoPaciente {
  tipo: TipoDeContato
  valor: string
  obs?: string | null
}

export interface EnderecoDoPaciente {
  cep?: string | null
  logradouro?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  uf?: string | null
}

/**
 * Prova legal do aceite — montada INTEIRA pelo servidor, menos o responsável.
 *
 * `aceito_em` é carimbado por ele (gate cadastros-pessoas, SEC-01/SEC-10): o relógio
 * do balcão não data a prova de consentimento de um menor. E, desde a change
 * `aceite-do-regulamento` (FA-08), a RÉGUA também é dele: o aceite aponta para a
 * versão VIGENTE do termo da clínica, com título e número gravados como SNAPSHOT.
 *
 * Os campos versionados são OPCIONAIS no tipo porque a prova é append-only e nunca
 * se reescreve: os aceites registrados ANTES daquela change existem sem eles, com o
 * `termo` de texto livre que a recepção digitava. A ausência é dado, não erro.
 */
export interface ConsentimentoDoPaciente {
  /** Título do termo aceito (snapshot). Nos registros antigos, o texto digitado à mão. */
  termo: string
  aceito_em: string
  responsavel: string
  /** Versão aceita — ausente nos registros anteriores ao termo versionado */
  termo_id?: number
  versao?: number
  /** `papel` no v1; `digital` quando o titular for quem aceita */
  forma?: string
  /** Usuário que MARCOU o aceite (a assinatura é da família, em papel) */
  registrado_por?: number
}

/**
 * O que a tela ENVIA: só os aceites NOVOS, e só quem aceitou.
 *
 * Termo, versão, forma, autor e instante são do servidor — mandar qualquer um deles
 * é 422. Uma régua digitada no balcão não prova nada (ninguém consegue exibir depois
 * o que foi aceito) e dois balcões digitando produzem duas réguas diferentes.
 */
export interface NovoConsentimento {
  responsavel: string
}

/**
 * A LISTA é minimizada pelo servidor (§5/LGPD): nome, nascimento, necessidade e
 * situação. CPF, responsáveis, contatos e endereço **só existem no detalhe**.
 */
export interface PacienteDaLista {
  id: number
  nome: string
  nome_social: string | null
  /** null = pré-cadastro pelo balcão ainda sem a ficha completada */
  nascimento: string | null
  necessidade: Necessidade | null
  ativo: boolean
  /** DERIVADO no servidor (nascimento/necessidade ausentes) — a coluna de aviso da lista */
  cadastro_incompleto: boolean
}

// `cadastro_incompleto` é da LISTAGEM (serializer do index) — o detalhe não o devolve
export interface Paciente extends Omit<PacienteDaLista, 'cadastro_incompleto'> {
  sexo: Sexo
  cpf: string | null
  /*
   * O convênio VIGENTE da criança (change convenio-no-cadastro-do-paciente). Só vem no
   * DETALHE: `carteirinha` é identificador do menor junto à operadora, da classe do CPF,
   * e a listagem é minimalista por parecer.
   */
  convenio_id: number | null
  /** O convênio resolvido pelo servidor — a ficha precisa do NOME, não do id. */
  convenio: { id: number; nome: string; particular: boolean } | null
  plano: string | null
  carteirinha: string | null
  carteirinha_validade: string | null
  // as colunas JSON vêm NULL do servidor quando vazias (não `[]`) — o tipo reflete a
  // realidade para o TS EXIGIR o `?? []` em cada consumidor (o que faltava e derrubou a ficha)
  responsaveis_json: ResponsavelDoPaciente[] | null
  contatos_json: ContatoDoPaciente[] | null
  endereco_json: EnderecoDoPaciente | null
  consentimentos_json: ConsentimentoDoPaciente[] | null
  indicacao: string | null
  estado_civil: string | null
  profissao: string | null
  obs: string | null
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/**
 * Resumo AGREGADO do paciente para o Painel da ficha (GET /pacientes/:id/resumo).
 * Read-only, minimizado: NÃO traz coluna do menor (nome/CPF vêm do cadastro).
 */
export interface ResumoDoPaciente {
  profissional_atual: { id: number; nome: string } | null
  contrato: {
    id: number
    status: 'andamento' | 'parado' | 'finalizado'
    sessoes_total: number
    sessoes_realizadas: number
    sessoes_saldo: number
    vencido: boolean
  } | null
  /** "Y-m-d H:i" na parede da clínica, ou null */
  primeira_sessao: string | null
  proxima_sessao: string | null
  sessoes_realizadas: number
}

/** Anexo do paciente — METADADOS apenas (o conteúdo só desce pelo download autenticado). */
export interface AnexoDoPaciente {
  id: number
  nome: string
  mime: string
  /** bytes do arquivo ORIGINAL (exibição) */
  tamanho: number
  /** `Y-m-d H:i` */
  criado_em: string
  criado_por: { id: number; nome: string } | null
}

/** Página do Laravel (`paginate`). */
export interface PaginaDeApi<T> {
  data: T[]
  current_page: number
  last_page: number
  per_page: number
  total: number
}

/**
 * O que a tela manda ao salvar um paciente.
 *
 * Quase tudo é OPCIONAL desde a change `campos-do-cadastro-configuraveis`: a régua da
 * clínica governa quais chaves viajam, e campo escondido é OMITIDO (o servidor recusa a
 * presença da chave, com qualquer valor). O tipo diz a verdade sobre isso — a primeira
 * versão mantinha as chaves obrigatórias e um `as PayloadPaciente` apagava do compilador
 * exatamente a mudança de contrato que a change introduziu, deixando o próximo consumidor
 * ler `payload.sexo` e receber `undefined` com o TS jurando `Sexo` (achado CR-I6).
 *
 * `nome` continua obrigatório porque é campo TRAVADO no catálogo do servidor; `nascimento`
 * também, pela mesma razão (é ele que diz se o paciente é menor — parecer SEC-RC-01).
 */
export interface PayloadPaciente {
  nome: string
  nome_social?: string | null
  /** null só sai de um pré-cadastro reenviado inteiro — o servidor recusa (422) */
  nascimento: string | null
  sexo?: Sexo
  cpf?: string | null
  indicacao?: string | null
  necessidade?: Necessidade | null
  estado_civil?: string | null
  profissao?: string | null
  obs?: string | null
  ativo?: boolean
  /** ausente quando a régua esconde a seção */
  responsaveis_json?: ResponsavelDoPaciente[]
  contatos_json?: ContatoDoPaciente[]
  endereco_json?: EnderecoDoPaciente | null
  /** APENAS os novos aceites — o servidor carimba e anexa (nunca substitui) */
  consentimentos_json: NovoConsentimento[]
  /**
   * O envio do link público que originou esta ficha (change `cadastro-online-do-paciente`).
   * Só na CRIAÇÃO: a origem de uma ficha não muda depois, e o servidor recusa a chave no PUT.
   */
  envio_de_cadastro_id?: number
}

// ── Profissionais ────────────────────────────────────────────────────────────

export interface Profissional {
  id: number
  nome: string
  conselho: string | null
  uf_conselho: string | null
  num_conselho: string | null
  cbos_id: number | null
  obs: string | null
  ativo: boolean
  /**
   * Horários de atendimento por dia (mapa dia ISO "1".."7" → intervalos). `{}` = sem horários =
   * atende todos os dias na janela padrão da clínica (retrocompat de "sem escala = janela cheia").
   */
  horarios: HorariosPorDia
  /**
   * Quantos atendimentos sustenta no MESMO horário (change atendimento-em-grupo); 1 = um por
   * vez, o padrão de todo cadastro. Opcional no tipo porque um payload anterior a esta change
   * (deploy fora de ordem, aba velha) não o traz.
   */
  atendimentos_simultaneos?: number
  /**
   * Se as famílias recebem o lembrete da véspera e a confirmação do primeiro agendamento
   * (change mensagens-automaticas-por-profissional); ligado é o padrão. Opcional pelo mesmo
   * motivo de `atendimentos_simultaneos`: ausente vale como ligado.
   */
  mensagens_automaticas?: boolean
  especialidades: Array<{ id: number; nome: string }>
  /** versão da foto do cadastro (`/api/profissionais/{id}/foto?v=`); `null` = sem foto */
  foto_versao: string | null
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

export interface PayloadProfissional {
  nome: string
  conselho?: string | null
  uf_conselho?: string | null
  num_conselho?: string | null
  cbos_id?: number | null
  obs?: string | null
  ativo?: boolean
  /** Mapa dia→intervalos; `{}` = atende todos os dias (sem horários). */
  horarios?: HorariosPorDia
  /** Quantas crianças atende ao mesmo tempo (1..10); ausente mantém o valor gravado. */
  atendimentos_simultaneos?: number
  /** Lembrete e confirmação automáticos às famílias; ausente mantém o valor gravado. */
  mensagens_automaticas?: boolean
  especialidades?: number[]
}

export interface Cbos {
  id: number
  codigo: string
  nome: string
}

/**
 * O número digitado também está em outro paciente? (`POST /pacientes/telefone/conferir`, change
 * telefone-que-chega-no-whatsapp). Só id, nome e situação do outro — nada de contato ou documento.
 */
export interface TelefoneEmUso {
  forma: string | null
  tipo: 'celular' | 'fixo' | null
  tambem_em: Array<{ id: number; nome: string; ativo: boolean }>
  /** quantos ao todo; `tambem_em` traz no máximo 5 */
  total: number
}
